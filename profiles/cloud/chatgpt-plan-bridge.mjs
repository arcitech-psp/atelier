#!/usr/bin/env node
// Atelier ChatGPT-plan bridge.
//
// Lets Atelier (or any OpenAI-Responses client on this computer) use the signed-in user's
// ChatGPT plan through OpenAI's official "Sign in with ChatGPT" flow for open-source,
// locally run apps:
//   https://developers.openai.com/siwc/token-sharing-open-source
//
// What it does
//   * GET  /signin            starts Sign in with ChatGPT (opens nothing itself: open this
//                             address in your own browser, approve "ChatGPT plan usage").
//   * GET  /status            signed-in account, plan-usage permission, token expiry (never tokens).
//   * GET  /v1/models         the models your plan offers, plus reasoning-level variants
//                             such as  gpt-6-luna@none  or  gpt-6.1-sol@high .
//   * POST /v1/responses      forwards an OpenAI Responses request to https://api.openai.com/v1/responses
//                             with your plan's access token, applying the documented preview rules
//                             (store:false, stream:true, unsupported fields removed, system -> developer).
//   * POST /signout           revokes the renewable session and clears local tokens.
//   * ANY  /omniroute/...     optional: passes requests to a local OmniRoute gateway (cloud free tiers + your keys),
//                             starting it on demand with --omniroute-start when it is not running.
//
// It listens on 127.0.0.1 only, answers only local, non-browser-origin requests, keeps tokens in a
// private file under your home folder and never prints or logs them. No dependencies (Node 22+).
//
// Usage:  node chatgpt-plan-bridge.mjs [--port 18345] [--home <dir>] [--app-name Atelier]
// Env:    ATELIER_CHATGPT_PORT, ATELIER_CHATGPT_HOME, ATELIER_CHATGPT_BRIDGE_KEY (optional client key; a
//         bridge-key.txt file in the home folder works too)

import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, createPublicKey, randomBytes, randomUUID, verify as cryptoVerify } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(arg('port', process.env.ATELIER_CHATGPT_PORT ?? '18345'));
const HOME = arg('home', process.env.ATELIER_CHATGPT_HOME ?? join(homedir(), '.atelier', 'chatgpt-plan'));
const APP_NAME = arg('app-name', 'Atelier');
// Optional on-demand OmniRoute passthrough (/omniroute/* -> OMNIROUTE_URL/*). OmniRoute checks its own client key.
const OMNIROUTE_URL = new URL(arg('omniroute-url', process.env.ATELIER_OMNIROUTE_URL ?? 'http://127.0.0.1:20128'));
const OMNIROUTE_START = arg('omniroute-start', process.env.ATELIER_OMNIROUTE_START ?? '');
if (!['127.0.0.1', 'localhost'].includes(OMNIROUTE_URL.hostname)) throw new Error('--omniroute-url must be a loopback address');
// Optional client key: when set (env, or a bridge-key.txt file in the home folder), every /v1 call must send it
// as "Authorization: Bearer <key>", so other programs on this computer cannot spend the plan.
const CLIENT_KEY = process.env.ATELIER_CHATGPT_BRIDGE_KEY
  || (() => { try { return readFileSync(join(HOME, 'bridge-key.txt'), 'utf8').trim(); } catch { return ''; } })();
const ISSUER = 'https://auth.openai.com';
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
// Offline tests may point the bridge at a loopback mock; any other override is ignored so tokens only go to OpenAI.
const TEST_API = process.env.ATELIER_CHATGPT_API_BASE_FOR_TESTS ?? '';
const API = /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(TEST_API) ? TEST_API : 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const CALLBACK_PORTS = [1455, 1456, 1457, 1458, 1459];
const EFFORTS = ['none', 'low', 'medium', 'high'];
// Documented preview limitations: these request fields are rejected on this route.
const UNSUPPORTED_FIELDS = ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata',
  'moderation', 'multi_agent', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature',
  'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id', 'service_tier'];

const HOST_FILE = join(HOME, 'host.json');
const PROFILE_FILE = join(HOME, 'profile.json');

// ---------- storage ----------
function ensureHome() {
  if (!existsSync(HOME)) mkdirSync(HOME, { recursive: true, mode: 0o700 });
}
function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
}
function writeJsonAtomic(path, value) {
  ensureHome();
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
  try { chmodSync(path, 0o600); } catch { /* Windows: the user profile folder is already private */ }
}
function hostId() {
  const existing = readJson(HOST_FILE);
  if (existing?.ext_agent_host_id) return existing.ext_agent_host_id;
  const id = `urn:uuid:${randomUUID()}`;
  writeJsonAtomic(HOST_FILE, { ext_agent_host_id: id, created_at: new Date().toISOString() });
  return id;
}
const loadProfile = () => readJson(PROFILE_FILE);
const saveProfile = (p) => writeJsonAtomic(PROFILE_FILE, p);

// ---------- helpers ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const log = (msg) => process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}
function sendHtml(res, status, title, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem">
<h1 style="font-size:1.4rem">${title}</h1>${body}</body>`);
}
async function readBody(req, limit = 64 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// ---------- ID token validation (RS256 against OpenAI's published JWKS) ----------
let jwksCache;
async function jwks() {
  if (jwksCache && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const conf = await (await fetch(`${ISSUER}/.well-known/openid-configuration`)).json();
  const set = await (await fetch(conf.jwks_uri)).json();
  jwksCache = { at: Date.now(), keys: set.keys ?? [], revocation: conf.revocation_endpoint };
  return jwksCache.keys;
}
async function revocationEndpoint() {
  if (!jwksCache) await jwks();
  return jwksCache.revocation;
}
async function verifyIdToken(idToken, clientId, nonce) {
  const parts = String(idToken ?? '').split('.');
  if (parts.length !== 3) throw new Error('ID token missing or malformed');
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header.alg !== 'RS256') throw new Error(`unexpected ID token algorithm ${header.alg}`);
  let keys = await jwks();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { jwksCache = undefined; keys = await jwks(); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) throw new Error('ID token signing key not found in OpenAI JWKS');
  const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('ID token signature is invalid');
  if (claims.iss !== ISSUER) throw new Error('ID token issuer mismatch');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error('ID token audience does not match the issued client');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000) throw new Error('ID token expired');
  if (nonce !== undefined && claims.nonce !== nonce) throw new Error('ID token nonce mismatch');
  return claims;
}

// ---------- sign-in ----------
let pending; // { state, nonce, verifier, redirectUri, clientId, newRegistration, server, timer }

function closePending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  try { pending.server.close(); } catch { /* already closed */ }
  pending = undefined;
}

async function listenCallback() {
  for (const port of CALLBACK_PORTS) {
    const server = createServer((req, res) => handleCallback(req, res).catch((e) => {
      log(`sign-in failed: ${e.message}`);
      sendHtml(res, 400, 'Sign-in did not finish', `<p>${String(e.message).replace(/[<>&]/g, '')}</p><p>Go back to Atelier and try again.</p>`);
      closePending();
    }));
    const ok = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (ok) return { server, redirectUri: `http://127.0.0.1:${port}/auth/callback` };
  }
  throw new Error(`no free sign-in callback port (${CALLBACK_PORTS.join(', ')}); close Codex sign-in windows and retry`);
}

async function startSignIn() {
  closePending();
  const profile = loadProfile();
  const { server, redirectUri } = await listenCallback();
  const verifier = b64url(randomBytes(48));
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const savedClient = profile?.client_id;
  const params = new URLSearchParams({
    client_id: savedClient || 'dynamic_agent_client',
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    ext_agent_host_id: hostId(),
  });
  if (!savedClient) params.set('agent_name_hint', APP_NAME);
  if (savedClient && profile?.id_token) params.set('id_token_hint', profile.id_token);
  if (savedClient && profile?.email) params.set('login_hint', profile.email);
  pending = {
    state, nonce, verifier, redirectUri, clientId: savedClient, newRegistration: !savedClient, server,
    timer: setTimeout(closePending, 10 * 60_000),
  };
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function handleCallback(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/auth/callback') { res.writeHead(404); res.end(); return; }
  if (!pending) throw new Error('no sign-in is in progress');
  if (url.searchParams.get('state') !== pending.state) throw new Error('state mismatch; start sign-in again');
  const error = url.searchParams.get('error');
  if (error) {
    closePending();
    sendHtml(res, 200, 'ChatGPT plan usage was not enabled',
      `<p>OpenAI returned <code>${error.replace(/[<>&]/g, '')}</code>. Nothing was saved. You can start again from Atelier at any time.</p>`);
    return;
  }
  const code = url.searchParams.get('code');
  const issued = url.searchParams.get('client_id');
  let clientId = pending.clientId;
  if (pending.newRegistration) {
    if (!issued || issued === 'dynamic_agent_client') throw new Error('registration incomplete: no issued client id');
    clientId = issued;
    // Save the registration before the exchange, so a failed exchange can reuse it.
    const prior = loadProfile() ?? {};
    saveProfile({ ...prior, client_id: clientId, ext_agent_host_id: hostId(), registered_at: new Date().toISOString() });
  } else if (issued && issued !== clientId) {
    throw new Error('callback returned a different client id; refusing to replace this account');
  }
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pending.verifier,
      redirect_uri: pending.redirectUri, resource: RESOURCE }),
  });
  const data = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) throw new Error(`token exchange failed (HTTP ${tokenRes.status} ${data.error ?? ''})`);
  const claims = await verifyIdToken(data.id_token, clientId, pending.nonce);
  const prior = loadProfile();
  if (prior?.subject && prior.client_id === clientId && prior.subject !== claims.sub)
    throw new Error('signed in as a different account than this registration');
  const scopes = String(data.scope ?? url.searchParams.get('scope') ?? '').split(/\s+/).filter(Boolean);
  saveProfile({
    email: claims.email ?? null,
    issuer: ISSUER,
    subject: claims.sub,
    client_id: clientId,
    ext_agent_host_id: hostId(),
    id_token: data.id_token,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type ?? 'Bearer',
    expires_in: data.expires_in,
    expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    scopes,
    saved_at: new Date().toISOString(),
  });
  closePending();
  const sharing = scopes.includes(PLAN_SCOPE);
  log(`signed in (${sharing ? 'plan usage enabled' : 'plan usage NOT granted'})`);
  sendHtml(res, 200, sharing ? 'Connected to ChatGPT' : 'Signed in, but plan usage is off',
    sharing
      ? `<p>${APP_NAME} can now use your ChatGPT plan. You can close this tab.</p><p>Review or limit usage any time in <a href="https://chatgpt.com/settings/usage">ChatGPT Settings &rarr; Usage</a>.</p>`
      : `<p>You signed in but did not allow ChatGPT plan usage, so ${APP_NAME} cannot send requests with it. Start sign-in again and allow plan usage, or use another provider.</p>`);
}

// ---------- tokens ----------
let refreshing;
async function refreshTokens() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const p = loadProfile();
    if (!p?.refresh_token || !p.client_id) throw Object.assign(new Error('not signed in'), { status: 401 });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: p.client_id, refresh_token: p.refresh_token, resource: RESOURCE }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = data.error ?? data.code ?? `http_${r.status}`;
      const terminal = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired',
        'refresh_token_invalidated', 'refresh_token_reused'].includes(code);
      if (terminal) saveProfile({ ...p, access_token: null, refresh_token: null, expires_at: 0, needs_signin: code });
      throw Object.assign(new Error(`token refresh failed (${code})${terminal ? '; sign in again' : ''}`), { status: terminal ? 401 : 503 });
    }
    const next = {
      ...p,
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? p.refresh_token,
      id_token: data.id_token ?? p.id_token,
      expires_in: data.expires_in,
      expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000,
      scopes: data.scope ? String(data.scope).split(/\s+/).filter(Boolean) : p.scopes,
      saved_at: new Date().toISOString(),
      needs_signin: undefined,
    };
    saveProfile(next);
    log('access token refreshed');
    return next;
  })();
  try { return await refreshing; } finally { refreshing = undefined; }
}
async function accessToken(force = false) {
  let p = loadProfile();
  if (!p?.access_token && !p?.refresh_token) throw Object.assign(new Error(`not signed in: open http://127.0.0.1:${PORT}/signin`), { status: 401 });
  if (!(p.scopes ?? []).includes(PLAN_SCOPE)) throw Object.assign(new Error('ChatGPT plan usage was not granted; sign in again and allow it'), { status: 403 });
  if (force || !p.access_token || (p.expires_at ?? 0) - Date.now() < 120_000) p = await refreshTokens();
  return p.access_token;
}

// ---------- models ----------
let modelCache;
async function upstreamModels() {
  if (modelCache && Date.now() - modelCache.at < 300_000) return modelCache.models;
  let token = await accessToken();
  let r = await fetch(`${API}/models`, { headers: { authorization: `Bearer ${token}` } });
  if (r.status === 401) { token = await accessToken(true); r = await fetch(`${API}/models`, { headers: { authorization: `Bearer ${token}` } }); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`model list failed (HTTP ${r.status})`), { status: r.status });
  const list = (body.models ?? body.data ?? []).filter((m) => (m.visibility ?? 'list') === 'list');
  modelCache = { at: Date.now(), models: list };
  return list;
}
function splitAlias(model) {
  const m = /^(.*)@(none|minimal|low|medium|high|xhigh|max)$/.exec(String(model ?? ''));
  return m ? { model: m[1], effort: m[2] } : { model: String(model ?? ''), effort: undefined };
}

// ---------- request shaping (documented preview rules) ----------
function shapeRequest(body) {
  const out = { ...body };
  const { model, effort } = splitAlias(out.model);
  out.model = model;
  if (effort) {
    out.reasoning = { ...(out.reasoning ?? {}), effort };
    if (effort === 'none') {
      delete out.reasoning.summary;
      if (Array.isArray(out.include)) out.include = out.include.filter((x) => x !== 'reasoning.encrypted_content');
      if (Array.isArray(out.include) && out.include.length === 0) delete out.include;
    }
  }
  for (const f of UNSUPPORTED_FIELDS) delete out[f];
  delete out.prompt_cache_options;
  out.store = false;
  out.stream = true;
  if (typeof out.input === 'string') out.input = [{ role: 'user', content: out.input }];
  if (Array.isArray(out.input)) {
    out.input = out.input.map((item) => (item && item.role === 'system' && (item.type === undefined || item.type === 'message')
      ? { ...item, role: 'developer' } : item));
  }
  return out;
}

// The preview route asks for function/custom tools to be grouped in namespaces. Plain top-level tools are tried
// first; if the route refuses them, every later request groups them under one namespace and tags replayed calls.
const NAMESPACE = 'atelier';
let toolMode = 'flat';
function namespaceTools(body) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const grouped = tools.filter((t) => t && (t.type === 'function' || t.type === 'custom'));
  if (grouped.length === 0) return body;
  const names = new Set(grouped.map((t) => t.name));
  const out = { ...body, tools: [{ type: 'namespace', name: NAMESPACE, description: 'Tools provided by the Atelier harness.', tools: grouped },
    ...tools.filter((t) => !grouped.includes(t))] };
  if (Array.isArray(out.input)) {
    out.input = out.input.map((item) => (item && (item.type === 'function_call' || item.type === 'custom_tool_call') && names.has(item.name) && !item.namespace
      ? { ...item, namespace: NAMESPACE } : item));
  }
  return out;
}
function refusesFlatTools(status, text) {
  if (status !== 400) return false;
  try {
    const err = JSON.parse(text).error ?? {};
    return err.code === 'subscription_sharing_unsupported_capability' && /tool/i.test(String(err.param ?? err.message ?? ''));
  } catch { return false; }
}

// ---------- on-demand OmniRoute passthrough ----------
let omnirouteLastUsed = 0;
let omnirouteStarting;
function omnirouteUp() {
  return new Promise((resolve) => {
    const r = httpRequest({ host: OMNIROUTE_URL.hostname, port: OMNIROUTE_URL.port, path: '/api/health', method: 'GET', timeout: 3000 },
      (res) => { res.resume(); resolve(res.statusCode < 500); });
    r.on('error', () => resolve(false));
    r.on('timeout', () => { r.destroy(); resolve(false); });
    r.end();
  });
}
async function ensureOmniroute() {
  if (await omnirouteUp()) return;
  if (!OMNIROUTE_START) throw Object.assign(new Error('OmniRoute is not running'), { status: 503 });
  omnirouteStarting ??= (async () => {
    log('OmniRoute is not running; starting it on demand');
    spawn(OMNIROUTE_START, { shell: true, windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    const started = Date.now();
    while (Date.now() - started < 360_000) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await omnirouteUp()) { log(`OmniRoute up after ${Math.round((Date.now() - started) / 1000)}s`); return; }
    }
    throw Object.assign(new Error('OmniRoute did not start within 6 minutes'), { status: 503 });
  })().finally(() => { omnirouteStarting = undefined; });
  return omnirouteStarting;
}
async function proxyOmniroute(req, res, path, search) {
  omnirouteLastUsed = Date.now();
  await ensureOmniroute();
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    body = Buffer.concat(chunks);
  }
  await new Promise((resolve) => {
    const headers = { ...req.headers, host: OMNIROUTE_URL.host };
    delete headers.origin;
    if (body) headers['content-length'] = String(body.length);
    const up = httpRequest({ host: OMNIROUTE_URL.hostname, port: OMNIROUTE_URL.port, method: req.method,
      path: path.replace(/^\/omniroute/, '') + search, headers }, (ures) => {
      res.writeHead(ures.statusCode ?? 502, ures.headers);
      ures.on('data', (c) => { omnirouteLastUsed = Date.now(); res.write(c); });
      ures.on('end', () => { omnirouteLastUsed = Date.now(); res.end(); resolve(); });
    });
    up.on('error', (e) => { if (!res.headersSent) sendJson(res, 502, { error: { message: `OmniRoute: ${e.message}` } }); else res.end(); resolve(); });
    res.on('close', () => { if (!res.writableFinished) up.destroy(); });
    if (body) up.write(body);
    up.end();
  });
}

// ---------- server ----------
function localOnly(req) {
  const host = String(req.headers.host ?? '');
  if (!new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${PORT}$`).test(host)) return 'host not allowed';
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) return 'cross-site request refused';
  return undefined;
}
function clientAuthorized(req) {
  if (!CLIENT_KEY) return true;
  return String(req.headers.authorization ?? '') === `Bearer ${CLIENT_KEY}`;
}

async function proxyResponses(req, res) {
  if (!/application\/json/i.test(String(req.headers['content-type'] ?? ''))) return sendJson(res, 415, { error: { message: 'JSON body required' } });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: { message: 'invalid JSON body' } }); }
  const wantsStream = body.stream !== false;
  let shaped = shapeRequest(body);
  if (toolMode === 'namespace') shaped = namespaceTools(shaped);
  const send = async (token) => fetch(`${API}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(shaped),
  });
  let upstream = await send(await accessToken());
  if (upstream.status === 401) upstream = await send(await accessToken(true));
  let requestId = upstream.headers.get('x-request-id') ?? '';
  if (!upstream.ok) {
    let text = await upstream.text();
    if (toolMode === 'flat' && refusesFlatTools(upstream.status, text)) {
      log(`route refused top-level tools (${requestId}); grouping tools in a namespace from now on`);
      toolMode = 'namespace';
      shaped = namespaceTools(shaped);
      upstream = await send(await accessToken());
      requestId = upstream.headers.get('x-request-id') ?? '';
      if (upstream.ok) return relayOk(upstream, requestId, shaped, wantsStream, res);
      text = await upstream.text();
    }
    log(`upstream ${upstream.status} ${requestId} model=${shaped.model} ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'x-request-id': requestId });
    res.end(text);
    return;
  }
  return relayOk(upstream, requestId, shaped, wantsStream, res);
}

async function relayOk(upstream, requestId, shaped, wantsStream, res) {
  log(`responses ${requestId} model=${shaped.model} effort=${shaped.reasoning?.effort ?? 'default'} tools=${(shaped.tools ?? []).length} mode=${toolMode}`);
  if (wantsStream) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-request-id': requestId });
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
    return;
  }
  // Non-streaming client: read the stream through to the terminal event and return its response object.
  const text = await upstream.text();
  let final;
  for (const block of text.split(/\n\n/)) {
    const dataLine = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (!dataLine || dataLine === '[DONE]') continue;
    try {
      const ev = JSON.parse(dataLine);
      if (['response.completed', 'response.failed', 'response.incomplete'].includes(ev.type)) final = ev.response;
    } catch { /* ignore partial */ }
  }
  if (!final) return sendJson(res, 502, { error: { message: 'stream ended without a terminal event' } });
  sendJson(res, final.status === 'failed' ? 502 : 200, final);
}

const server = createServer(async (req, res) => {
  try {
    const refused = localOnly(req);
    if (refused) return sendJson(res, 403, { error: { message: refused } });
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && (path === '/' || path === '/status')) {
      const p = loadProfile();
      return sendJson(res, 200, {
        service: 'atelier-chatgpt-plan-bridge',
        signedIn: Boolean(p?.access_token || p?.refresh_token),
        email: p?.email ?? null,
        planUsage: Boolean((p?.scopes ?? []).includes(PLAN_SCOPE)),
        accessTokenExpiresAt: p?.expires_at ? new Date(p.expires_at).toISOString() : null,
        needsSignIn: p?.needs_signin ?? (!p?.refresh_token ? 'not signed in' : null),
        signInUrl: `http://127.0.0.1:${PORT}/signin`,
        manageUsage: 'https://chatgpt.com/settings/usage',
        docs: 'https://developers.openai.com/siwc/token-sharing-open-source',
        omniroute: { url: OMNIROUTE_URL.origin, startsOnDemand: Boolean(OMNIROUTE_START),
          lastUsed: omnirouteLastUsed ? new Date(omnirouteLastUsed).toISOString() : null,
          idleSeconds: omnirouteLastUsed ? Math.round((Date.now() - omnirouteLastUsed) / 1000) : null },
      });
    }
    if (req.method === 'GET' && path === '/signin') {
      const target = await startSignIn();
      res.writeHead(302, { location: target, 'cache-control': 'no-store' });
      return res.end();
    }
    if (req.method === 'POST' && path === '/signout') {
      const p = loadProfile();
      let revoked = false;
      if (p?.refresh_token && p.client_id) {
        try {
          const r = await fetch(await revocationEndpoint(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: p.refresh_token, token_type_hint: 'refresh_token', client_id: p.client_id }) });
          revoked = r.ok;
        } catch { /* reported below */ }
      }
      if (p) saveProfile({ ...p, access_token: null, refresh_token: null, id_token: p.id_token, expires_at: 0, needs_signin: 'signed out' });
      return sendJson(res, 200, { signedOut: true, remoteRevocationConfirmed: revoked });
    }

    if (path === '/omniroute' || path.startsWith('/omniroute/')) return await proxyOmniroute(req, res, url.pathname, url.search);

    if (!clientAuthorized(req)) return sendJson(res, 401, { error: { message: 'bridge key required' } });

    if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
      const models = await upstreamModels();
      const data = [];
      for (const m of models) {
        const slug = m.slug ?? m.id;
        const base = { object: 'model', owned_by: 'chatgpt-plan', display_name: m.display_name ?? slug };
        data.push({ id: slug, ...base });
        for (const e of EFFORTS) data.push({ id: `${slug}@${e}`, ...base, display_name: `${m.display_name ?? slug} (${e === 'none' ? 'no reasoning' : `${e} reasoning`})` });
      }
      return sendJson(res, 200, { object: 'list', data });
    }
    if (req.method === 'POST' && (path === '/v1/responses' || path === '/responses')) return await proxyResponses(req, res);
    return sendJson(res, 404, { error: { message: `not found: ${req.method} ${path}` } });
  } catch (e) {
    log(`error: ${e.message}`);
    if (!res.headersSent) sendJson(res, e.status ?? 500, { error: { message: e.message } });
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  ensureHome();
  hostId();
  const p = loadProfile();
  log(`Atelier ChatGPT-plan bridge on http://127.0.0.1:${PORT}/v1 (${p?.refresh_token ? 'signed in' : `not signed in: open http://127.0.0.1:${PORT}/signin`}; client key ${CLIENT_KEY ? 'required' : 'not required'})`);
});
