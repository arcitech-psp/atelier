// Which model is loaded right now? Read from the model server's OWN endpoints, never guessed:
//   LM Studio   GET /api/v0/models   (state: loaded | not-loaded)   and, in newer versions, GET /api/v1/models (loaded_instances)
//   Ollama      GET /api/ps          (the models in memory, with expires_at = when the keep_alive timer unloads them)
//   llama-swap  GET /running         (state: starting | ready | stopping | stopped | shutdown)
// Anything else is reported as "not tracked": a plain llama.cpp or vLLM server keeps its one model loaded.
//
// Everything in this file is pure or takes fetch as an argument, so the parsing is tested with fake responses.

/** One word per state; the panel and the header chip use the same words. */
export const STATES = ['loaded', 'loading', 'unloading', 'unloaded', 'unknown', 'offline'];

export const PROVIDER_NAMES = {lmstudio: 'LM Studio', ollama: 'Ollama', 'llama-swap': 'llama-swap', other: 'Other server'};

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const text = value => (typeof value === 'string' && value.length > 0 ? value : undefined);

/** "http://localhost:1234/v1" becomes "http://localhost:1234". Returns undefined for anything that is not http(s). */
export function originOf(baseURL) {
  try {
    const url = new URL(String(baseURL));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Parsers. Each returns {provider, models: [{id, state, ...}]} or null when the body is not that server's shape.
// ---------------------------------------------------------------------------------------------------------------

/** LM Studio REST API v0: {object: "list", data: [{id, type, state: "loaded" | "not-loaded", ...}]}. */
export function parseLmStudioV0(body) {
  if (!isObject(body) || !Array.isArray(body.data)) return null;
  const rows = body.data.filter(row => isObject(row) && text(row.id));
  // The shape check that tells LM Studio from other servers' /models lists: every row carries a loaded / not-loaded state.
  if (rows.length === 0 || !rows.every(row => row.state === 'loaded' || row.state === 'not-loaded')) return null;
  return {provider: 'lmstudio', models: rows.map(row => ({
    id: row.id, kind: text(row.type), state: row.state === 'loaded' ? 'loaded' : 'unloaded',
    contextLength: number(row.loaded_context_length), maxContextLength: number(row.max_context_length),
  }))};
}

/** LM Studio REST API v1: {models: [{key, display_name, type, size_bytes, loaded_instances: [...]}]}. */
export function parseLmStudioV1(body) {
  if (!isObject(body) || !Array.isArray(body.models)) return null;
  const rows = body.models.filter(row => isObject(row) && text(row.key) && Array.isArray(row.loaded_instances));
  if (rows.length === 0) return null;
  return {provider: 'lmstudio', models: rows.map(row => ({
    id: row.key, name: text(row.display_name), kind: text(row.type), state: row.loaded_instances.length > 0 ? 'loaded' : 'unloaded',
    sizeBytes: number(row.size_bytes), contextLength: number(row.loaded_instances[0]?.config?.context_length),
    instances: row.loaded_instances.map(instance => text(instance?.id)).filter(Boolean),
  }))};
}

/** Ollama GET /api/ps: {models: [{name, model, size, size_vram, expires_at}]}: only models in memory are listed. */
export function parseOllamaPs(body) {
  if (!isObject(body) || !Array.isArray(body.models)) return null;
  const rows = body.models.filter(row => isObject(row) && (text(row.model) || text(row.name)));
  // An idle Ollama answers {"models": []}; that is still Ollama, with nothing loaded.
  if (rows.length !== body.models.length) return null;
  if (rows.length > 0 && !rows.every(row => 'size_vram' in row || 'expires_at' in row || 'digest' in row)) return null;
  return {provider: 'ollama', models: rows.map(row => {
    const expires = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : NaN;
    return {
      id: text(row.model) ?? row.name, state: 'loaded', sizeBytes: number(row.size), vramBytes: number(row.size_vram),
      // Ollama uses year 0001 / far-future values for "never unload"; only a real near date is shown as a timer.
      expiresAt: Number.isFinite(expires) && expires > 1e12 && expires < Date.now() + 10 * 365 * 86_400_000 ? expires : undefined,
    };
  })};
}

/** llama-swap GET /running: {running: [{model, state: starting | ready | stopping | stopped | shutdown, ttl, ...}]}. */
export function parseLlamaSwapRunning(body) {
  if (!isObject(body) || !Array.isArray(body.running)) return null;
  const rows = body.running.filter(row => isObject(row) && text(row.model));
  if (rows.length !== body.running.length) return null;
  const map = {ready: 'loaded', starting: 'loading', stopping: 'unloading', shutdown: 'unloading', stopped: 'unloaded'};
  return {provider: 'llama-swap', models: rows.map(row => ({
    id: row.model, name: text(row.name), state: map[row.state] ?? 'unknown', ttlSeconds: number(row.ttl) > 0 ? row.ttl : undefined,
  }))};
}

// ---------------------------------------------------------------------------------------------------------------
// Matching a configured model id against a server's list
// ---------------------------------------------------------------------------------------------------------------

/** Compare model ids the way the servers name them: case-insensitive, Ollama's ":latest" optional, LM Studio's
 *  "publisher/name" matching a bare "name". */
export function sameModel(a, b) {
  const clean = value => String(value ?? '').trim().toLowerCase().replace(/:latest$/, '');
  const x = clean(a), y = clean(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tail = value => value.slice(value.lastIndexOf('/') + 1);
  return tail(x) === tail(y);
}

/**
 * The state of one configured model on one server.
 * @param {{provider: string, models: any[]}|null} snapshot parsed server answer, or null when the server did not answer
 * @param {string} wanted the model id the harness is configured to use
 * @returns {{state: string, entry?: any}}
 */
export function stateOf(snapshot, wanted) {
  if (!snapshot) return {state: 'offline'};
  if (snapshot.provider === 'other') return {state: 'unknown'};
  const listed = snapshot.models.filter(entry => sameModel(entry.id, wanted) || (entry.name && sameModel(entry.name, wanted)));
  // Several instances of one model (LM Studio): the most loaded one decides.
  const rank = {loaded: 5, loading: 4, unloading: 3, unloaded: 2, unknown: 1};
  const best = listed.sort((x, y) => (rank[y.state] ?? 0) - (rank[x.state] ?? 0))[0];
  if (best) return {state: best.state, entry: best};
  // Ollama and llama-swap list only what is in memory / running: absence means "not loaded".
  return {state: 'unloaded'};
}

/**
 * A request that has waited for its first token, to a model the server says is not in memory, is a model load.
 * This is the one place the indicator infers instead of reads, and the panel marks it that way.
 */
export function inferLoading(state, waitingMs, thresholdMs = 1500) {
  return state === 'unloaded' && waitingMs >= thresholdMs ? 'loading' : state;
}

// ---------------------------------------------------------------------------------------------------------------
// Probing a server
// ---------------------------------------------------------------------------------------------------------------

const PROBES = [
  {path: '/api/v0/models', parse: parseLmStudioV0},
  {path: '/api/ps', parse: parseOllamaPs},
  {path: '/running', parse: parseLlamaSwapRunning},
  {path: '/api/v1/models', parse: parseLmStudioV1},
];

async function getJson(fetchImpl, url, headers, timeoutMs) {
  const response = await fetchImpl(url, {headers, signal: AbortSignal.timeout(timeoutMs)});
  if (!response.ok) return {status: response.status};
  try { return {status: response.status, body: await response.json()}; } catch { return {status: response.status}; }
}

/**
 * Ask a server which of the three known tools it is, and what it has loaded. The probes run together; the answer
 * whose shape matches wins (LM Studio, then Ollama, then llama-swap). A server that answers none of them but
 * serves the OpenAI /models list is "other": reachable, and its models are not tracked.
 * @param {string} origin e.g. http://localhost:11434
 * @param {{fetchImpl?: typeof fetch, headers?: Record<string,string>, timeoutMs?: number, apiBase?: string}} [options]
 *   apiBase is the OpenAI base URL (".../v1") used for the reachability check of untracked servers.
 * @returns {Promise<{origin: string, provider: string, ok: boolean, models: any[], error?: string}>}
 */
export async function probeServer(origin, {fetchImpl = fetch, headers = {}, timeoutMs = 2000, apiBase} = {}) {
  const results = await Promise.all(PROBES.map(async probe => {
    try {
      const reply = await getJson(fetchImpl, origin + probe.path, headers, timeoutMs);
      return {probe, reply, parsed: reply.body === undefined ? null : probe.parse(reply.body)};
    } catch (error) {
      return {probe, error};
    }
  }));
  const hit = results.find(result => result.parsed);
  if (hit) return {origin, provider: hit.parsed.provider, ok: true, models: hit.parsed.models};
  // Something answered but is none of the three: reachable, untracked. Nothing answered: offline.
  const answered = results.some(result => result.reply);
  if (answered) return {origin, provider: 'other', ok: true, models: []};
  if (apiBase) {
    try {
      const reply = await fetchImpl(`${apiBase.replace(/\/+$/, '')}/models`, {headers, signal: AbortSignal.timeout(timeoutMs)});
      if (reply.status < 500) return {origin, provider: 'other', ok: true, models: []};
    } catch { /* offline below */ }
  }
  const first = results.find(result => result.error)?.error;
  return {origin, provider: 'other', ok: false, models: [], error: describeNetworkError(first)};
}

/** A connection failure in words (never includes request headers, so never a key). */
export function describeNetworkError(error) {
  const code = error?.cause?.code ?? error?.cause?.errors?.[0]?.code;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'No answer within a few seconds.';
  if (code === 'ECONNREFUSED') return 'Nothing is listening at this address. Is the server running?';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'This host name cannot be found.';
  if (code) return `Connection failed (${code}).`;
  return 'The server did not answer.';
}

// ---------------------------------------------------------------------------------------------------------------
// Which models does the harness use? (the "roles")
// ---------------------------------------------------------------------------------------------------------------

export const ROLE_LABELS = {brain: 'Main model', helper: 'Small helper', vision: 'Vision', embeddings: 'Embeddings', transcribe: 'Speech to text', speech: 'Text to speech', image: 'Images'};
const ROLE_ORDER = Object.keys(ROLE_LABELS);

/**
 * The models the harness is set up to use, with the server each one lives on.
 * @param {{providers?: Record<string, any>, selection?: {provider?: string, model?: string}, roles?: Record<string, any>}} input
 *   providers: the llm-pi-ai providers from settings.yaml; selection: agent-default-model; roles: atelier-roles/roles.json "roles".
 * @returns {{role: string, label: string, model: string, baseURL: string, origin: string, route?: string, apiKeyEnv?: string}[]}
 */
export function collectRoles({providers = {}, selection = {}, roles = {}} = {}) {
  const out = [];
  const add = (role, model, baseURL, extra = {}) => {
    const origin = originOf(baseURL);
    if (!origin || !text(model) || /YOUR_MODEL_ID|YOUR_OPENAI_COMPATIBLE_HOST/.test(`${model}${baseURL}`)) return;
    out.push({role, label: ROLE_LABELS[role] ?? role, model, baseURL: String(baseURL).replace(/\/+$/, ''), origin, ...extra});
  };
  const route = selection.provider ? providers[selection.provider] : undefined;
  if (route) add('brain', selection.model, route.baseURL, {route: selection.provider, apiKeyEnv: route.apiKeyEnv});
  const helper = providers['atelier-helper'];
  if (helper) add('helper', helper.models?.[0]?.id, helper.baseURL, {route: 'atelier-helper', apiKeyEnv: helper.apiKeyEnv});
  for (const [role, row] of Object.entries(roles)) {
    if (role === 'brain' || role === 'helper' || !isObject(row)) continue;
    add(role, row.model, row.baseURL);
  }
  return out.sort((x, y) => (ROLE_ORDER.indexOf(x.role) + 1 || 99) - (ROLE_ORDER.indexOf(y.role) + 1 || 99));
}

/**
 * Join the roles with the probed servers: one row per role with its state, plus per-server lists for the panel.
 * @param {ReturnType<typeof collectRoles>} roles
 * @param {Map<string, Awaited<ReturnType<typeof probeServer>>>|Record<string, any>} servers keyed by origin
 */
export function buildStatus(roles, servers) {
  const lookup = origin => (servers instanceof Map ? servers.get(origin) : servers[origin]);
  const rows = roles.map(role => {
    const server = lookup(role.origin);
    const found = stateOf(server?.ok ? server : null, role.model);
    return {
      role: role.role, label: role.label, model: role.model, origin: role.origin, provider: server?.provider ?? 'other',
      providerName: PROVIDER_NAMES[server?.provider] ?? PROVIDER_NAMES.other, state: found.state, inferred: false,
      sizeBytes: found.entry?.sizeBytes, vramBytes: found.entry?.vramBytes, expiresAt: found.entry?.expiresAt, ttlSeconds: found.entry?.ttlSeconds,
      error: server && !server.ok ? server.error : undefined,
    };
  });
  const list = servers instanceof Map ? [...servers.values()] : Object.values(servers);
  const serverRows = list.map(server => ({
    origin: server.origin, provider: server.provider, providerName: PROVIDER_NAMES[server.provider] ?? PROVIDER_NAMES.other, ok: server.ok, error: server.error,
    loaded: server.models.filter(model => model.state === 'loaded' || model.state === 'loading').map(model => ({
      id: model.id, state: model.state, sizeBytes: model.sizeBytes, vramBytes: model.vramBytes, expiresAt: model.expiresAt, ttlSeconds: model.ttlSeconds,
    })),
    knownModels: server.models.length,
  }));
  return summarize({rows, servers: serverRows});
}

/** The header chip shows the main model's state (or the first role's when there is no main model). */
function summarize(status) {
  const pick = status.rows.find(row => row.role === 'brain') ?? status.rows[0];
  return {...status, summary: pick ? {role: pick.role, label: pick.label, model: pick.model, state: pick.state, inferred: pick.inferred} : null};
}

/**
 * Add what the harness itself knows: the main model is being waited on. A request that has waited for its first token
 * to a model the server says is not in memory is a model load. The panel marks such a state as inferred.
 * @param {ReturnType<typeof buildStatus>} status
 * @param {number} waitingMs how long the oldest request has waited for its first token (0 when none waits)
 */
export function applyWaiting(status, waitingMs) {
  if (!(waitingMs > 0)) return status;
  const rows = status.rows.map(row => {
    if (row.role !== 'brain') return row;
    const state = inferLoading(row.state, waitingMs);
    return state === row.state ? row : {...row, state, inferred: true};
  });
  return summarize({...status, rows});
}
