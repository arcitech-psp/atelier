// Atelier model roles, host side: one endpoint per role, a status check per role, and the browser RPC for the
// "Model roles" settings page. It reuses the harness's own mechanisms:
//   - the brain and the small helper are ordinary `llm-pi-ai` provider routes, and the brain is the
//     `agent-default-model` selection, so the chat uses them exactly as it uses any configured model;
//   - API keys live in the harness's local credentials file ($DSH_HOME/.credentials.yaml, owner-only on Linux)
//     under ATELIER_ROLE_<ROLE>_KEY, are never sent back to the browser and never written to a log;
//   - the other roles (vision, speech, embeddings, images) are plain addresses in $DSH_HOME/atelier-roles/roles.json.
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {dshHomePath} from '@deepseek-ai/dsh-home-paths';
import {credentialRef} from '@deepseek-ai/dsh-credentials';
import {settingsNamespace} from '@deepseek-ai/dsh-settings';
import {ROLES, ROLE_IDS, roleById, keyRefFor, BRAIN_ROUTE, HELPER_ROUTE, PRESETS, RECOMMENDED, TIERS, ARCITECH_BRAIN_REPO} from './roles.mjs';
import {Kit, defaultKitFolder} from './setup.mjs';

export const name = 'atelier-roles';
export const inject = [];

const LLM = settingsNamespace('llm-pi-ai');
const DEFAULT_MODEL = settingsNamespace('agent-default-model');
const PLACEHOLDER_MODEL = 'YOUR_MODEL_ID';
const STATUS_TTL_MS = 30_000;
const TEST_TIMEOUT_MS = 6000;

const isUrl = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
const trimBase = value => String(value ?? '').trim().replace(/\/+$/, '');
const text = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : '';
/** A failure in words, without echoing request headers (and so never the key). */
export function describeFailure(error) {
  const code = error?.cause?.code ?? error?.cause?.errors?.[0]?.code;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'No answer within a few seconds.';
  if (code === 'ECONNREFUSED') return 'Nothing is listening at this address. Is the server running?';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'This host name cannot be found.';
  if (code === 'ECONNRESET') return 'The server closed the connection.';
  if (code) return `Connection failed (${code}).`;
  return String(error?.message ?? error).replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, 200);
}

/** A short silent WAV (16 kHz mono), used to check a speech-to-text server without recording anything. */
export function silentWav(seconds = 0.5, rate = 16000) {
  const samples = Math.round(seconds * rate), bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + samples * 2, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  return bytes;
}

export function apply(ctx, config = {}) {
  const root = config.home ?? dshHomePath('atelier-roles');
  const file = join(root, 'roles.json');
  const status = new Map();
  let settings;   // the harness settings service, once mounted
  let saved = {roles: {}, kit: {}};

  const load = async () => {
    try { saved = {roles: {}, kit: {}, ...JSON.parse(await readFile(file, 'utf8'))}; }
    catch (e) { if (e.code !== 'ENOENT') ctx.logger?.warn?.('atelier-roles: could not read roles.json: %s', e.message); }
    return saved;
  };
  const persist = async () => {
    await mkdir(root, {recursive: true});
    const temp = join(root, randomUUID() + '.pending');
    await writeFile(temp, JSON.stringify(saved, null, 2), {mode: 0o600}); await rename(temp, file);
  };
  const credentials = () => ctx.get('credentials');
  const readKey = async id => {
    try { return (await credentials()?.resolve(credentialRef(keyRefFor(id))))?.value; } catch { return undefined; }
  };
  const keyInfo = async id => {
    try { return await credentials()?.describe(credentialRef(keyRefFor(id))); } catch { return undefined; }
  };
  const storeKey = async (id, key) => {
    const store = credentials();
    if (!store) throw Error('This Atelier has no local credentials store, so keys cannot be saved. Set ' + keyRefFor(id) + ' in the environment instead.');
    if (key) await store.set(credentialRef(keyRefFor(id)), key); else await store.unset(credentialRef(keyRefFor(id)));
  };

  // ---------- reading the current configuration of a role ----------
  const llmSettings = () => settings?.get(LLM) ?? {};
  const defaultSelection = () => settings?.get(DEFAULT_MODEL) ?? {};
  function routeEndpoint(route, model) {
    const provider = llmSettings().providers?.[route];
    if (!provider) return undefined;
    const entry = (provider.models ?? []).find(m => m.id === model) ?? provider.models?.[0];
    return {baseURL: provider.baseURL ?? '', model: model ?? entry?.id ?? '', apiKeyEnv: provider.apiKeyEnv,
      vision: (entry?.input ?? provider.defaultInput ?? []).includes('image'),
      contextWindow: entry?.contextWindow ?? provider.defaultContextWindow, route, displayName: provider.displayName};
  }
  /** The effective configuration of a role, or undefined when it is not set. Never contains a key. */
  function current(id) {
    if (id === 'brain') {
      const {provider, model} = defaultSelection();
      if (!provider || !model || model === PLACEHOLDER_MODEL) return undefined;
      const found = routeEndpoint(provider, model);
      if (!found) return {baseURL: '', model, route: provider, managed: true, preset: saved.roles.brain?.preset, source: 'models'};
      if (found.baseURL.includes('YOUR_OPENAI_COMPATIBLE_HOST')) return undefined;
      return {...found, preset: saved.roles.brain?.preset, source: provider === BRAIN_ROUTE ? (saved.roles.brain?.source ?? 'roles') : 'models'};
    }
    if (id === 'helper') {
      const found = routeEndpoint(HELPER_ROUTE);
      return found ? {...found, preset: saved.roles.helper?.preset, source: saved.roles.helper?.source ?? 'roles'} : undefined;
    }
    const role = saved.roles[id];
    if (role?.baseURL) return role;
    if (id === 'image' && process.env.ATELIER_IMAGE_ENDPOINT) return {baseURL: process.env.ATELIER_IMAGE_ENDPOINT, model: process.env.ATELIER_IMAGE_MODEL ?? '', source: 'environment'};
    return undefined;
  }
  const brainReadsImages = () => current('brain')?.vision === true;

  // ---------- writing a role ----------
  async function writeRoute(route, {baseURL, model, vision, contextWindow, displayName}) {
    const models = [{id: model, name: model, contextWindow: contextWindow || 32768, maxTokens: Math.min(8192, contextWindow || 32768), input: vision ? ['text', 'image'] : ['text']}];
    await settings.mutate(LLM, [{op: 'set', path: ['providers', route], value: {displayName, api: 'openai-completions', baseURL, apiKeyEnv: keyRefFor(route === BRAIN_ROUTE ? 'brain' : 'helper'), models}}]);
  }
  async function save(id, input, source = 'roles') {
    const role = roleById(id); if (!role) throw Error('Unknown role.');
    const baseURL = trimBase(input.baseURL), model = text(input.model, 200);
    if (!isUrl(baseURL)) throw Error('Enter an address that starts with http:// or https://.');
    if (role.kind !== 'image' && role.kind !== 'transcribe' && role.kind !== 'speech' && !model) throw Error('Enter the model name the server uses.');
    if (input.key !== undefined) await storeKey(id, typeof input.key === 'string' ? input.key.trim() : '');
    const contextWindow = Number.isInteger(input.contextWindow) && input.contextWindow >= 2048 ? input.contextWindow : undefined;
    if (id === 'brain' || id === 'helper') {
      if (!settings) throw Error('Settings are not available in this Atelier mode.');
      // A server without a key still needs a value for the OpenAI client; it is stored locally like any key.
      if (!(await readKey(id))) await storeKey(id, 'not-needed');
      await writeRoute(id === 'brain' ? BRAIN_ROUTE : HELPER_ROUTE, {baseURL, model, vision: input.vision === true, contextWindow,
        displayName: id === 'brain' ? 'Brain (Model roles)' : 'Small helper (Model roles)'});
      if (id === 'brain') await settings.mutate(DEFAULT_MODEL, [{op: 'set', path: ['provider'], value: BRAIN_ROUTE}, {op: 'set', path: ['model'], value: model}]);
      saved.roles[id] = {preset: text(input.preset, 40), source};
    } else {
      saved.roles[id] = {baseURL, model, preset: text(input.preset, 40), voice: text(input.voice, 80) || undefined, source};
    }
    await persist(); status.delete(id);
  }
  async function reset(id) {
    const kitRole = kit.endpointFor(id);
    if (kitRole) return save(id, kitRole, 'kit');
    if (id === 'brain') {
      // Back to the endpoint chosen at first start (the launcher's settings), i.e. the composition default.
      if (settings) await settings.mutate(DEFAULT_MODEL, [{op: 'unset', path: ['provider']}, {op: 'unset', path: ['model']}]);
    } else if (id === 'helper') {
      if (settings) await settings.mutate(LLM, [{op: 'unset', path: ['providers', HELPER_ROUTE]}]);
    }
    delete saved.roles[id]; await persist(); status.delete(id);
  }

  // ---------- talking to a role's endpoint ----------
  async function authHeaders(id, cfg) {
    const key = cfg.draftKey ?? (cfg.apiKeyEnv && cfg.apiKeyEnv !== keyRefFor(id) ? await resolveEnvKey(cfg.apiKeyEnv) : await readKey(id));
    return key && key !== 'not-needed' ? {authorization: `Bearer ${key}`} : {};
  }
  async function resolveEnvKey(name) {
    try { return (await credentials()?.resolve(credentialRef(name)))?.value ?? process.env[name]; } catch { return process.env[name]; }
  }
  async function call(id, path, init = {}, cfg = current(id), timeout = TEST_TIMEOUT_MS) {
    if (!cfg?.baseURL) throw Error(`${roleById(id).name} is not set. ${roleById(id).whenMissing}`);
    const url = path === null ? cfg.baseURL : cfg.baseURL + path;
    return fetch(url, {...init, headers: {...init.headers, ...await authHeaders(id, cfg)}, redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)});
  }
  async function test(id, cfg = current(id)) {
    const role = roleById(id);
    if (!cfg?.baseURL) return {state: cfg?.managed ? 'connected' : 'not-set', message: cfg?.managed ? 'Uses a model from the Models settings.' : role.whenMissing};
    try {
      if (role.kind === 'chat') {
        const response = await call(id, '/models', {}, cfg);
        if (response.status === 401 || response.status === 403) return {state: 'failing', message: `The server refused the key (HTTP ${response.status}).`};
        if (!response.ok) return {state: 'failing', message: `The server answered HTTP ${response.status} at /models.`};
        const ids = ((await response.json())?.data ?? []).map(m => m?.id).filter(Boolean);
        if (ids.length && cfg.model && !ids.includes(cfg.model)) return {state: 'failing', models: ids.slice(0, 50), message: `The server does not serve "${cfg.model}". It serves: ${ids.slice(0, 6).join(', ')}.`};
        return {state: 'connected', models: ids.slice(0, 50), message: ids.length ? `Answers and serves ${cfg.model || ids[0]}.` : 'Answers.'};
      }
      if (role.kind === 'embeddings') {
        const response = await call(id, '/embeddings', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({model: cfg.model, input: 'Atelier test'})}, cfg);
        if (!response.ok) return {state: 'failing', message: `The server answered HTTP ${response.status} at /embeddings.`};
        const size = (await response.json())?.data?.[0]?.embedding?.length;
        return size ? {state: 'connected', message: `Answers (${size} numbers per text).`} : {state: 'failing', message: 'The answer held no embedding.'};
      }
      if (role.kind === 'transcribe') {
        const result = await transcribe(silentWav(), 'audio/wav', cfg);
        return {state: 'connected', message: `Answers${result.text ? '' : ' (heard silence, as expected)'}.`};
      }
      if (role.kind === 'speech') {
        const audio = await speak('Test.', cfg);
        return {state: 'connected', message: `Answers (${Math.round(audio.bytes.length / 1024)} KB of audio).`};
      }
      // Images: a reachability check only, so a test never spends a generation.
      const response = await call(id, null, {method: 'GET'}, cfg);
      return response.status >= 500 ? {state: 'failing', message: `The server answered HTTP ${response.status}.`}
        : {state: 'connected', message: 'The address answers. Images are not generated by the test.'};
    } catch (error) {
      return {state: 'failing', message: describeFailure(error)};
    }
  }
  async function cachedStatus(id, force = false) {
    const hit = status.get(id);
    if (!force && hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value;
    const value = await test(id);
    status.set(id, {at: Date.now(), value});
    return value;
  }

  /** Speech to text: OpenAI multipart first, then the JSON {audio_base64} form some speech servers use. */
  async function transcribe(bytes, mime = 'audio/wav', cfg = current('stt'), signal) {
    const form = new FormData();
    form.append('file', new Blob([bytes], {type: mime}), mime.includes('wav') ? 'audio.wav' : 'audio.webm');
    form.append('model', cfg?.model || 'whisper-1'); form.append('response_format', 'json');
    let response = await call('stt', '/audio/transcriptions', {method: 'POST', body: form, signal}, cfg, 120_000);
    if ([400, 415, 422].includes(response.status)) {
      response = await call('stt', '/audio/transcriptions', {method: 'POST', headers: {'content-type': 'application/json'}, signal,
        body: JSON.stringify({audio_base64: Buffer.from(bytes).toString('base64'), model: cfg?.model || undefined})}, cfg, 120_000);
    }
    if (!response.ok) throw Error(`Speech to text answered HTTP ${response.status}.`);
    const body = await response.text();
    try { return {text: String(JSON.parse(body)?.text ?? '').trim()}; } catch { return {text: body.trim()}; }
  }
  async function speak(input, cfg = current('tts'), signal) {
    const response = await call('tts', '/audio/speech', {method: 'POST', headers: {'content-type': 'application/json'}, signal,
      body: JSON.stringify({model: cfg?.model || 'kokoro', input, voice: cfg?.voice || 'af_bella', response_format: 'mp3'})}, cfg, 120_000);
    if (!response.ok) throw Error(`Text to speech answered HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 64) throw Error('Text to speech returned no audio.');
    if (bytes.length > 12 * 1024 * 1024) throw Error('The audio is larger than 12 MB.');
    return {bytes, mime: response.headers.get('content-type')?.startsWith('audio/') ? response.headers.get('content-type') : 'audio/mpeg'};
  }

  // ---------- the starter kit ----------
  const kit = new Kit({
    home: root, logger: ctx.logger,
    wire: async (endpoints, force) => {
      for (const [id, endpoint] of Object.entries(endpoints)) {
        // "Set me up" wires every role it installed. On later starts the kit fills a role only when it is still empty
        // or already the kit's own, so it never overwrites a choice made since.
        const existing = current(id);
        if (force || !existing || existing.source === 'kit') await save(id, endpoint, 'kit');
      }
    },
  });

  // ---------- the service other Atelier plugins use ----------
  const service = {
    roles: ROLE_IDS,
    /** The role's address and model (no key), or undefined when the role is not set. */
    peek: id => { const cfg = current(id); return cfg?.baseURL ? {baseURL: cfg.baseURL, model: cfg.model, voice: cfg.voice} : undefined; },
    isSet: id => Boolean(current(id)?.baseURL),
    brainReadsImages,
    /** fetch() against a role's endpoint with its stored key; path is appended to the role's base address. */
    fetch: (id, path, init) => call(id, path, init, current(id), 180_000),
    transcribe: (bytes, mime, signal) => transcribe(bytes, mime, current('stt'), signal),
    speak: (input, signal) => speak(input, current('tts'), signal),
  };
  ctx.provide('atelierRoles', service);

  ctx.effect(() => {
    void load().then(() => kit.resume(saved.kit)).catch(e => ctx.logger?.warn?.('atelier-roles: %s', e.message));
    return () => kit.dispose();
  });
  ctx.inject(['settings'], sctx => { settings = sctx.settings; sctx.effect(() => () => { settings = undefined; }); });

  // ---------- the browser RPC (the Model roles page) ----------
  async function describe(id) {
    const role = roleById(id), cfg = current(id), info = await keyInfo(id);
    return {...role, config: cfg ? {baseURL: cfg.baseURL, model: cfg.model, preset: cfg.preset ?? '', voice: cfg.voice ?? '', vision: cfg.vision === true,
      contextWindow: cfg.contextWindow, source: cfg.source, route: cfg.route, managed: cfg.managed === true} : null,
      // "not-needed" is the stand-in a keyless local server gets; it is not a key the user stored.
      key: {stored: Boolean(info?.configured) && (await readKey(id)) !== 'not-needed', fromEnvironment: info?.source === 'env'},
      kitHas: Boolean(kit.endpointFor(id)), coveredByBrain: id === 'vision' && brainReadsImages()};
  }
  async function list(force) {
    const roles = await Promise.all(ROLE_IDS.map(async id => ({...await describe(id), status: await cachedStatus(id, force)})));
    return {roles, presets: PRESETS, recommended: RECOMMENDED, tiers: TIERS, brainRepo: ARCITECH_BRAIN_REPO,
      kit: kit.summary(), defaultKitFolder: defaultKitFolder()};
  }
  const draftOf = (id, payload) => {
    const draft = payload?.draft;
    if (!draft) return current(id);
    const baseURL = trimBase(draft.baseURL);
    if (!isUrl(baseURL)) throw Error('Enter an address that starts with http:// or https://.');
    return {baseURL, model: text(draft.model, 200), voice: text(draft.voice, 80), draftKey: typeof draft.key === 'string' && draft.key ? draft.key : undefined,
      apiKeyEnv: undefined};
  };
  ctx.inject(['connection'], cctx => cctx.effect(() => cctx.connection.rpc.handle('/atelier-roles', async (endpoint, payload) => {
    try {
      const id = payload?.role;
      if (id !== undefined && !ROLE_IDS.includes(id)) throw Error('Unknown role.');
      switch (endpoint) {
        case 'list': return {ok: true, value: await list(payload?.force === true)};
        // Cheap question for the chat buttons: which optional features have a role behind them (no network calls).
        case 'available': return {ok: true, value: Object.fromEntries(ROLE_IDS.map(r => [r, service.isSet(r)]))};
        case 'save': await save(id, payload); return {ok: true, value: await list(false)};
        case 'reset': await reset(id); return {ok: true, value: await list(false)};
        case 'test': {
          const value = await test(id, draftOf(id, payload));
          if (!payload?.draft) status.set(id, {at: Date.now(), value});
          return {ok: true, value};
        }
        case 'transcribe': {
          if (typeof payload?.audio !== 'string' || payload.audio.length > 16 * 1024 * 1024) throw Error('Recording is missing or too long.');
          return {ok: true, value: await service.transcribe(Buffer.from(payload.audio, 'base64'), text(payload.mime, 60) || 'audio/wav')};
        }
        case 'speak': {
          const input = text(payload?.text, 4000);
          if (!input) throw Error('Nothing to read.');
          const audio = await service.speak(input);
          return {ok: true, value: {audio: audio.bytes.toString('base64'), mime: audio.mime}};
        }
        case 'kit-plan': return {ok: true, value: await kit.plan(payload ?? {})};
        case 'kit-start': {
          const value = await kit.start(payload ?? {});
          saved.kit = {folder: value.folder, autostart: true}; await persist();
          return {ok: true, value};
        }
        case 'kit-status': return {ok: true, value: kit.summary()};
        case 'kit-cancel': kit.cancel(); return {ok: true, value: kit.summary()};
        case 'kit-stop': await kit.stopServers(); saved.kit = {...saved.kit, autostart: false}; await persist(); return {ok: true, value: kit.summary()};
        case 'kit-run': saved.kit = {...saved.kit, autostart: true}; await persist(); await kit.resume(saved.kit); return {ok: true, value: kit.summary()};
        default: throw Error('Unknown model roles operation.');
      }
    } catch (e) {
      return {ok: false, error: {code: 'bad-request', message: describeFailure(e)}};
    }
  })));
}
