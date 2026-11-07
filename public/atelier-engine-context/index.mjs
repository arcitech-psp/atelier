// Engine-reported context windows.
//
// For every llm-pi-ai route whose baseURL is on this computer or a private network, this asks the serving engine which
// context window it actually runs:
//   vLLM                 GET {baseURL}/models -> data[].max_model_len (a LoRA adapter with null inherits its parent's)
//   llama.cpp-style      GET {baseURL}/models -> data[].meta.n_ctx, else GET {origin}/health -> max_context / n_ctx
// at boot, every intervalMs, and right after a stream ends at its token limit or overflows (llm-pi-ai/length-stop).
// The reported window is published as `ctx.engineContext`; llm-pi-ai applies it to the route's next request, so the
// request's contextWindow and compaction thresholds follow the engine without a restart and without writing settings.
// Running requests keep the window they started with.
// Never applied: a route that does not report or does not answer (its current value stays, with one warning per route per
// hour), a value above contextWindowMax, and routes listed in observeOnly (logged only).
// Every observation and change is one line in <Atelier home>/logs/engine-context.jsonl. Read-only towards engines: GET only.
import {appendFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {dshHomePath} from '@deepseek-ai/dsh-home-paths';
import {settingsNamespace} from '@deepseek-ai/dsh-settings';

export const name = 'atelier-engine-context';
export const inject = ['settings'];

const LLM = settingsNamespace('llm-pi-ai');
const WARN_EVERY_MS = 3600_000;

/** Loopback and private-network (RFC 1918 / RFC 4193) host names. Engines elsewhere are never probed by default. */
export const PRIVATE_HOST = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[f[cd][0-9a-f]{2}:[0-9a-f:]*\])$/i;

const positive = (v) => (Number.isInteger(v) && v > 0 ? v : undefined);

/** The window one listing entry reports, following a LoRA adapter to its parent. Pure. */
export function entryWindow(entry, data) {
  const own = positive(entry?.max_model_len) ?? positive(entry?.meta?.n_ctx) ?? positive(entry?.context_length)
    ?? positive(entry?.context_window) ?? positive(entry?.max_context);
  if (own !== undefined) {
    const source = positive(entry?.max_model_len) ? 'max_model_len' : positive(entry?.meta?.n_ctx) ? 'meta.n_ctx' : 'listing';
    return {window: own, source};
  }
  const parent = entry?.parent && data.find((e) => e?.id === entry.parent);
  return parent && parent !== entry ? entryWindow(parent, data.filter((e) => e !== entry)) : undefined;
}

/** Window for one configured model id from a /models reply: exact id, an alias, or the only served model. Pure. */
export function modelWindow(body, modelId) {
  const data = Array.isArray(body?.data) ? body.data : [];
  const hit = data.find((e) => e?.id === modelId) ?? data.find((e) => Array.isArray(e?.aliases) && e.aliases.includes(modelId))
    ?? (data.length === 1 ? data[0] : undefined);
  return hit ? entryWindow(hit, data) : undefined;
}

/** /health -> window. Pure. */
export function healthWindow(body) {
  const w = positive(body?.max_context) ?? positive(body?.n_ctx) ?? positive(body?.meta?.n_ctx);
  return w === undefined ? undefined : {window: w, source: 'health'};
}

/**
 * The engine-window source without any host wiring.
 * @param {{getProviders: () => Record<string, any>, config?: object, logger?: {info: Function, warn: Function},
 *   env?: Record<string, string | undefined>, logFile?: string, fetch?: typeof fetch}} options
 */
export function createEngineContext({getProviders, config = {}, logger = console, env = process.env, logFile, fetch: fetchImpl = fetch}) {
  const intervalMs = Number(config.intervalMs) > 0 ? Number(config.intervalMs) : 120_000;
  const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 3_000;
  const caps = config.contextWindowMax ?? {};
  const observeOnly = new Set(config.observeOnly ?? []);
  const only = Array.isArray(config.routes) && config.routes.length ? new Set(config.routes) : undefined;
  const extraHosts = new Set((config.allowHosts ?? []).map((h) => String(h).toLowerCase()));
  const applied = new Map(); // "provider/model" -> { window, source, at }
  const routes = new Map(); // provider -> last probe status
  const warned = new Map(); // provider -> epoch ms of the last warning
  const seen = new Set(); // routes already logged as observed
  let revision = 0;
  let closed = false;

  const log = (line) => {
    logger.info?.('engine-context: %s', JSON.stringify(line));
    if (!logFile) return;
    try {
      mkdirSync(dirname(logFile), {recursive: true});
      appendFileSync(logFile, JSON.stringify({at: new Date().toISOString(), ...line}) + '\n');
    } catch { /* the in-memory status still answers */ }
  };
  const warnOnce = (provider, line) => {
    const last = warned.get(provider) ?? 0;
    if (Date.now() - last < WARN_EVERY_MS) return;
    warned.set(provider, Date.now());
    log(line);
  };
  const configuredWindow = (profile, model) => positive(model?.contextWindow) ?? positive(profile?.defaultContextWindow);
  const capFor = (provider, model) => positive(caps[`${provider}/${model}`]) ?? positive(caps[provider]);
  const probeable = (hostname) => PRIVATE_HOST.test(hostname) || extraHosts.has(hostname.toLowerCase());

  async function getJson(url, headers) {
    const r = await fetchImpl(url, {headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'error'});
    if (!r.ok) throw Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function probe(provider, why) {
    const profile = getProviders()[provider];
    if (!profile?.baseURL || closed) return;
    let url;
    try { url = new URL(profile.baseURL); } catch { return; }
    if (!probeable(url.hostname)) return;
    const base = profile.baseURL.replace(/\/+$/, '');
    const origin = base.replace(/\/v1$/, '');
    const key = profile.apiKeyEnv ? env[profile.apiKeyEnv] : undefined;
    const headers = key ? {Authorization: `Bearer ${key}`} : {};
    const status = {provider, at: Date.now(), why, ok: false, models: {}};
    routes.set(provider, status);
    let listing, health;
    try { listing = await getJson(`${base}/models`, headers); } catch (e) { status.error = `models: ${e.message}`; }
    let changed = false;
    for (const model of profile.models ?? []) {
      const id = `${provider}/${model.id}`;
      const configured = configuredWindow(profile, model);
      let found = listing ? modelWindow(listing, model.id) : undefined;
      if (!found && health === undefined) {
        try { health = await getJson(`${origin}/health`, headers); } catch (e) { health = null; status.error = `${status.error ? status.error + '; ' : ''}health: ${e.message}`; }
      }
      found ??= health ? healthWindow(health) : undefined;
      const before = applied.get(id)?.window ?? configured;
      if (!found) {
        status.models[model.id] = {configured, reported: null, effective: before};
        warnOnce(provider, {kind: listing || health ? 'unreported' : 'unreachable', route: provider, configured, error: status.error ?? 'no window field', why});
        continue;
      }
      status.ok = true;
      const cap = capFor(provider, model.id);
      const capped = cap !== undefined && found.window > cap ? cap : found.window;
      const observe = observeOnly.has(provider) || observeOnly.has(id);
      const effective = observe ? before : capped;
      status.models[model.id] = {configured, reported: found.window, source: found.source, cap: cap ?? null, effective, observeOnly: observe};
      if (!seen.has(id)) {
        seen.add(id);
        log({kind: 'observed', route: id, configured, reported: found.window, source: found.source, cap: cap ?? null, applies: !observe, why});
      }
      if (observe) continue;
      if (capped === configured) {
        if (applied.delete(id)) { changed = true; log({kind: 'changed', route: id, from: before, to: configured, source: found.source, why}); }
        continue;
      }
      if (applied.get(id)?.window !== capped) {
        applied.set(id, {window: capped, source: found.source, at: Date.now()});
        changed = true;
        log({kind: 'changed', route: id, from: before, to: capped, source: found.source, capped: capped !== found.window, why});
      }
    }
    if (changed) revision += 1;
  }

  async function probeAll(why) {
    const all = Object.keys(getProviders()).filter((p) => !only || only.has(p));
    await Promise.all(all.map((p) => probe(p, why).catch((e) => logger.warn?.(e))));
  }

  const lastStop = new Map();
  return {
    intervalMs,
    get revision() { return revision; },
    window(provider, model) { return applied.get(`${provider}/${model}`)?.window; },
    status() {
      return {
        revision, intervalMs,
        applied: Object.fromEntries([...applied].map(([k, v]) => [k, {...v, at: new Date(v.at).toISOString()}])),
        routes: Object.fromEntries([...routes].map(([k, v]) => [k, {...v, at: new Date(v.at).toISOString()}])),
        logFile: logFile ?? null,
      };
    },
    refresh: (provider) => (provider ? probe(provider, 'requested') : probeAll('requested')),
    probeAll,
    /** A stream on `stop.provider` ended at its limit: re-probe that route, at most once per 10 s. */
    onLengthStop(stop) {
      const last = lastStop.get(stop.provider) ?? 0;
      if (Date.now() - last < 10_000) return undefined;
      lastStop.set(stop.provider, Date.now());
      return probe(stop.provider, `${stop.reason} at ${stop.contextWindow}`).catch((e) => logger.warn?.(e));
    },
    close() { closed = true; },
  };
}

export function apply(ctx, config = {}) {
  const source = createEngineContext({
    // The provider section registers a moment after this plugin starts; until then there is simply nothing to probe.
    getProviders: () => { try { return ctx.settings.get(LLM)?.providers ?? {}; } catch { return {}; } },
    config,
    logger: ctx.logger,
    logFile: config.logFile ?? dshHomePath('logs', 'engine-context.jsonl'),
  });
  ctx.provide('engineContext', source);
  ctx.on('llm-pi-ai/length-stop', (stop) => { void source.onLengthStop(stop); });
  // Routes appear or change (boot order, a settings edit): probe again, at most once per 5 s.
  let lastTopology = 0;
  ctx.on('llm/adapters-updated', () => {
    if (Date.now() - lastTopology < 5_000) return;
    lastTopology = Date.now();
    void source.probeAll('providers-changed');
  });
  ctx.effect(() => {
    void source.probeAll('boot');
    const timer = setInterval(() => { void source.probeAll('interval'); }, source.intervalMs);
    return () => { source.close(); clearInterval(timer); };
  });
  // Read-only status (GET) and a manual re-probe (POST) for the local, signed-in browser only.
  ctx.inject(['webServer', 'connection'], (wctx) => wctx.effect(() => wctx.webServer.register({
    kind: 'exact',
    path: '/api/atelier/engine-context',
    handler: async (req, res) => {
      if (!wctx.connection.authorizeIndex(req, res)) return;
      try {
        if (req.method === 'POST') await source.refresh(new URL(req.url, 'http://localhost').searchParams.get('provider') ?? undefined);
        else if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(JSON.stringify(source.status()));
      } catch (e) {
        res.writeHead(500, {'content-type': 'application/json'});
        res.end(JSON.stringify({error: String(e?.message ?? e)}));
      }
    },
  })));
}
