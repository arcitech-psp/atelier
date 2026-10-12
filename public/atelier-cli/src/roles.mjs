// `atelier roles`: the same Model roles the web page edits (Settings > Model roles), stored the same way:
//   brain and helper  ordinary llm-pi-ai routes in settings.yaml ("atelier-brain", "atelier-helper"); the brain is also
//                     the agent-default-model selection, so chats use it exactly like any configured model;
//   the other roles   plain addresses in <home>/atelier-roles/roles.json.
// Keys are never stored or printed here: --key-env names an environment variable that holds the key.
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse as parseYaml} from 'yaml';
import {APP_ROOT} from './paths.mjs';
import {mutateRoles, mutateSettings, readRoles, readSettings} from './settings.mjs';

// The role list itself belongs to the Model roles package; this fallback only covers a build without it.
const FALLBACK_ROLES = [
  {id: 'brain', name: 'Brain', kind: 'chat', required: true, whenMissing: 'Atelier cannot answer until a brain is connected.'},
  {id: 'vision', name: 'Vision', kind: 'chat', whenMissing: 'Without it, a text-only brain cannot look at images you attach.'},
  {id: 'stt', name: 'Speech to text', kind: 'transcribe', whenMissing: 'The microphone button stays hidden.'},
  {id: 'tts', name: 'Text to speech', kind: 'speech', whenMissing: 'The "Read aloud" button stays hidden.'},
  {id: 'embeddings', name: 'Embeddings', kind: 'embeddings', whenMissing: 'The project search tool is not offered to the assistant.'},
  {id: 'image', name: 'Image generation', kind: 'image', whenMissing: 'Moodboards use colour and material cards only.'},
  {id: 'helper', name: 'Small helper', kind: 'chat', whenMissing: 'Everything runs on the brain.'},
];
export const BRAIN_ROUTE = 'atelier-brain';
export const HELPER_ROUTE = 'atelier-helper';
export const keyRefFor = id => `ATELIER_ROLE_${id.toUpperCase()}_KEY`;
const PLACEHOLDER = /YOUR_OPENAI_COMPATIBLE_HOST|YOUR_MODEL_ID/;

let rolesCatalog;
/** The role catalog from @arcitech/atelier-roles when present, else the fallback above. */
export async function roleCatalog() {
  if (rolesCatalog) return rolesCatalog;
  const file = join(APP_ROOT, 'public', 'atelier-roles', 'roles.mjs');
  if (existsSync(file)) {
    try { rolesCatalog = (await import(pathToFileURL(file).href)).ROLES; } catch { /* fall back */ }
  }
  return (rolesCatalog ??= FALLBACK_ROLES);
}

const trimBase = url => String(url ?? '').trim().replace(/\/+$/, '');
const isUrl = url => { try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };

function route(settings, provider, model) {
  const p = settings?.['llm-pi-ai']?.providers?.[provider];
  if (!p) return undefined;
  const entry = (p.models ?? []).find(m => m?.id === model) ?? p.models?.[0];
  return {baseURL: trimBase(p.baseURL), model: model ?? entry?.id ?? '', apiKeyEnv: p.apiKeyEnv, route: provider,
    vision: (entry?.input ?? p.defaultInput ?? []).includes('image'), contextWindow: entry?.contextWindow ?? p.defaultContextWindow};
}

/** Where one role points now, or undefined when it is not set. Never contains a key. */
export function effectiveRole(id, settings, saved, env = process.env) {
  if (id === 'brain') {
    const pick = settings?.['agent-default-model'];
    if (!pick?.provider || !pick?.model || PLACEHOLDER.test(pick.model)) return undefined;
    const found = route(settings, pick.provider, pick.model);
    if (!found) return {baseURL: '', model: pick.model, route: pick.provider, managed: true};
    if (PLACEHOLDER.test(found.baseURL)) return undefined;
    return found;
  }
  if (id === 'helper') return route(settings, HELPER_ROUTE);
  const role = saved?.roles?.[id];
  if (role?.baseURL) return role;
  if (id === 'image' && env.ATELIER_IMAGE_ENDPOINT) return {baseURL: env.ATELIER_IMAGE_ENDPOINT, model: env.ATELIER_IMAGE_MODEL ?? '', source: 'environment'};
  return undefined;
}

export async function listRoles(home, env = process.env) {
  const settings = readSettings(home), saved = readRoles(home);
  return (await roleCatalog()).map(role => {
    const cfg = effectiveRole(role.id, settings, saved, env);
    const coveredByBrain = role.id === 'vision' && !cfg && effectiveRole('brain', settings, saved, env)?.vision === true;
    return {id: role.id, name: role.name, kind: role.kind, required: role.required === true, whenMissing: role.whenMissing,
      set: Boolean(cfg?.baseURL || cfg?.managed), coveredByBrain,
      config: cfg ? {baseURL: cfg.baseURL, model: cfg.model, route: cfg.route, vision: cfg.vision === true,
        keyEnv: cfg.apiKeyEnv, managed: cfg.managed === true} : undefined};
  });
}

/**
 * Point a role at an endpoint. Same result as Connect > Save on the Model roles page.
 * @param {{url: string, model?: string, keyEnv?: string, vision?: boolean, context?: number, voice?: string}} input
 */
export async function setRole(home, id, input) {
  const role = (await roleCatalog()).find(r => r.id === id);
  if (!role) throw Error(`Unknown role "${id}". Roles: ${(await roleCatalog()).map(r => r.id).join(', ')}.`);
  const baseURL = trimBase(input.url), model = String(input.model ?? '').trim();
  if (!isUrl(baseURL)) throw Error('Enter an address that starts with http:// or https://, e.g. http://localhost:8000/v1');
  if (role.kind !== 'image' && role.kind !== 'transcribe' && role.kind !== 'speech' && !model) throw Error(`The ${role.name} role needs --model: the model name exactly as the server lists it.`);
  if (input.keyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.keyEnv)) throw Error('--key-env takes the name of an environment variable, e.g. OPENAI_API_KEY (not the key itself).');
  const context = Number.isInteger(input.context) && input.context >= 2048 ? input.context : undefined;
  if (id === 'brain' || id === 'helper') {
    const routeId = id === 'brain' ? BRAIN_ROUTE : HELPER_ROUTE;
    const contextWindow = context ?? 32768;
    await mutateSettings(home, doc => {
      doc.setIn(['llm-pi-ai', 'providers', routeId], doc.createNode({
        displayName: id === 'brain' ? 'Brain (Model roles)' : 'Small helper (Model roles)',
        api: 'openai-completions', baseURL,
        apiKeyEnv: input.keyEnv ?? keyRefFor(id),
        models: [{id: model, name: model, contextWindow, maxTokens: Math.min(8192, contextWindow), input: input.vision ? ['text', 'image'] : ['text']}],
      }));
      if (id === 'brain') {
        doc.setIn(['agent-default-model', 'provider'], BRAIN_ROUTE);
        doc.setIn(['agent-default-model', 'model'], model);
        // The shipped placeholder provider is no longer needed once a real brain is set.
        if (PLACEHOLDER.test(String(doc.getIn(['llm-pi-ai', 'providers', 'atelier-openai', 'baseURL']) ?? ''))) doc.deleteIn(['llm-pi-ai', 'providers', 'atelier-openai']);
      }
    });
    await mutateRoles(home, value => { value.roles[id] = {...value.roles[id], preset: 'custom', source: 'cli'}; });
  } else {
    await mutateRoles(home, value => {
      value.roles[id] = {baseURL, model, preset: 'custom', source: 'cli',
        ...input.voice ? {voice: input.voice} : {}, ...input.keyEnv ? {apiKeyEnv: input.keyEnv} : {}};
    });
  }
  return (await listRoles(home)).find(r => r.id === id);
}

/** A role key, resolved like the harness does: environment first, then the local credentials file. */
export function resolveKey(home, name, env = process.env) {
  if (!name) return undefined;
  if (env[name]) return env[name];
  try {
    const value = parseYaml(readFileSync(join(home, '.credentials.yaml'), 'utf8'))?.[name];
    return typeof value === 'string' ? value : undefined;
  } catch { return undefined; }
}

/** A silent WAV, so a speech-to-text test never records anything. */
function silentWav(seconds = 0.5, rate = 16000) {
  const samples = Math.floor(seconds * rate), buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

/** Plain-English reason for a failed request. */
export function describeFailure(error) {
  const code = error?.cause?.code ?? error?.code;
  if (code === 'ECONNREFUSED') return 'Nothing is listening at this address. Start the server, or check the port.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'This address does not resolve. Check the host name.';
  if (/bad port/.test(error?.cause?.message ?? '')) return 'This port is blocked for web requests (a reserved port). Use the port your server listens on.';
  if (error?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'No answer within a few seconds. The server may still be loading a model; try again in a minute.';
  return String(error?.message ?? error);
}

/** Test one role the way the Model roles page does. */
export async function testRole(home, id, {env = process.env, timeoutMs = 8000, fetchImpl = fetch} = {}) {
  const role = (await roleCatalog()).find(r => r.id === id);
  if (!role) throw Error(`Unknown role "${id}".`);
  const cfg = effectiveRole(id, readSettings(home), readRoles(home), env);
  if (!cfg?.baseURL) {
    if (cfg?.managed) return {state: 'connected', message: 'Uses a model from the Models settings.'};
    if (id === 'vision' && effectiveRole('brain', readSettings(home), readRoles(home), env)?.vision) return {state: 'covered', message: 'Covered by the brain: it reads images itself.'};
    return {state: 'not-set', message: role.whenMissing};
  }
  const key = resolveKey(home, cfg.apiKeyEnv ?? keyRefFor(id), env);
  const auth = key && key !== 'not-needed' ? {authorization: `Bearer ${key}`} : {};
  const call = (path, init = {}) => fetchImpl(path === null ? cfg.baseURL : cfg.baseURL + path,
    {...init, headers: {...init.headers, ...auth}, redirect: 'error', signal: AbortSignal.timeout(timeoutMs)});
  try {
    if (role.kind === 'chat') {
      const response = await call('/models');
      if (response.status === 401 || response.status === 403) return {state: 'failing', message: `The server refused the key (HTTP ${response.status}). Check the variable named by --key-env.`};
      if (!response.ok) return {state: 'failing', message: `The server answered HTTP ${response.status} at /models.`};
      const ids = ((await response.json())?.data ?? []).map(m => m?.id).filter(Boolean);
      if (ids.length && cfg.model && !ids.includes(cfg.model)) return {state: 'failing', models: ids.slice(0, 50), message: `The server does not serve "${cfg.model}". It serves: ${ids.slice(0, 6).join(', ')}.`};
      return {state: 'connected', models: ids.slice(0, 50), message: ids.length ? `Answers and serves ${cfg.model || ids[0]}.` : 'Answers.'};
    }
    if (role.kind === 'embeddings') {
      const response = await call('/embeddings', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({model: cfg.model, input: 'Atelier test'})});
      if (!response.ok) return {state: 'failing', message: `The server answered HTTP ${response.status} at /embeddings.`};
      const size = (await response.json())?.data?.[0]?.embedding?.length;
      return size ? {state: 'connected', message: `Answers (${size} numbers per text).`} : {state: 'failing', message: 'The answer held no embedding.'};
    }
    if (role.kind === 'transcribe') {
      const form = new FormData();
      form.append('file', new Blob([silentWav()], {type: 'audio/wav'}), 'test.wav');
      if (cfg.model) form.append('model', cfg.model);
      const response = await call('/audio/transcriptions', {method: 'POST', body: form});
      return response.ok ? {state: 'connected', message: 'Answers (heard silence, as expected).'} : {state: 'failing', message: `The server answered HTTP ${response.status} at /audio/transcriptions.`};
    }
    if (role.kind === 'speech') {
      const response = await call('/audio/speech', {method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({model: cfg.model || 'tts-1', input: 'Test.', voice: cfg.voice || 'alloy'})});
      if (!response.ok) return {state: 'failing', message: `The server answered HTTP ${response.status} at /audio/speech.`};
      const bytes = (await response.arrayBuffer()).byteLength;
      return {state: 'connected', message: `Answers (${Math.round(bytes / 1024)} KB of audio).`};
    }
    const response = await call(null, {method: 'GET'});
    return response.status >= 500 ? {state: 'failing', message: `The server answered HTTP ${response.status}.`}
      : {state: 'connected', message: 'The address answers. Images are not generated by the test.'};
  } catch (error) {
    return {state: 'failing', message: describeFailure(error)};
  }
}
