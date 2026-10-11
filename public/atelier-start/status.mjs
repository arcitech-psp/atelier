// Read-only model status for the new-chat page: which endpoint new chats use and whether it answers.
// Reads the home settings.yaml the launcher wrote. Returns names and a reachability word only: never keys, tokens or emails.
import { parse } from 'yaml';

const PLACEHOLDER = /YOUR_OPENAI_COMPATIBLE_HOST|YOUR_MODEL_ID/;
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|::1)$/i;
const PRIVATE = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(\.\d{1,3}){2})$|\.(local|lan|home|internal|ts\.net)$/i;
/** The Cloud profile's local bridge (profiles/cloud): OmniRoute and the ChatGPT plan both sit behind it. */
const CLOUD_BRIDGE = '127.0.0.1:18345';

/**
 * Describe the default endpoint from parsed settings.
 * @param {any} settings - parsed settings.yaml.
 * @returns {{kind: 'unset'|'local'|'network'|'remote'|'cloud', provider: string, providerName: string, model: string,
 *   modelName: string, vision: boolean, baseURL?: string, apiKeyEnv?: string} | null} null when settings name no model.
 */
export function describeEndpoint(settings) {
  const pick = settings?.['agent-default-model'];
  const providers = settings?.['llm-pi-ai']?.providers;
  if (!pick || typeof pick.provider !== 'string' || typeof pick.model !== 'string' || !providers) return null;
  const provider = providers[pick.provider];
  if (!provider || typeof provider.baseURL !== 'string') return null;
  const entry = Array.isArray(provider.models) ? provider.models.find(m => m && m.id === pick.model) : undefined;
  const generic = !entry?.name || /^your model$/i.test(entry.name);
  const input = entry?.input ?? provider.defaultInput ?? [];
  const base = {provider: pick.provider, providerName: String(provider.displayName ?? pick.provider),
    model: pick.model, modelName: generic ? pick.model : String(entry.name), vision: Array.isArray(input) && input.includes('image')};
  if (PLACEHOLDER.test(provider.baseURL) || PLACEHOLDER.test(pick.model)) return {...base, kind: 'unset'};
  let url;
  try { url = new URL(provider.baseURL); } catch { return {...base, kind: 'unset'}; }
  const kind = url.host === CLOUD_BRIDGE ? 'cloud' : LOOPBACK.test(url.hostname) ? 'local' : PRIVATE.test(url.hostname) ? 'network' : 'remote';
  return {...base, kind, baseURL: provider.baseURL.replace(/\/+$/, ''), apiKeyEnv: typeof provider.apiKeyEnv === 'string' ? provider.apiKeyEnv : undefined};
}

/**
 * Ask the endpoint once whether it answers. Cloud asks the local bridge's /status instead of a model route, so the
 * check never starts OmniRoute or spends a provider request.
 * @returns {Promise<'ok'|'refused'|'signin'|'down'>}
 */
export async function probe(endpoint, {fetchImpl = fetch, env = process.env, timeoutMs = 2500} = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    if (endpoint.kind === 'cloud') {
      const response = await fetchImpl(`http://${CLOUD_BRIDGE}/status`, {signal});
      if (!response.ok) return 'down';
      const body = await response.json().catch(() => ({}));
      return endpoint.provider === 'chatgpt-plan' && body?.signedIn === false ? 'signin' : 'ok';
    }
    const key = endpoint.apiKeyEnv ? env[endpoint.apiKeyEnv] : undefined;
    const response = await fetchImpl(`${endpoint.baseURL}/models`, {signal, headers: key ? {authorization: `Bearer ${key}`} : {}});
    if (response.status === 401 || response.status === 403) return 'refused';
    // Some servers do not list models (404/405) but still serve chats; only a 5xx or no answer counts as down.
    return response.status >= 500 ? 'down' : 'ok';
  } catch {
    return 'down';
  }
}

/**
 * Settings text to the payload the page shows.
 * @param {string} text - settings.yaml contents.
 */
export async function readStatus(text, options) {
  let settings;
  try { settings = parse(text); } catch { return {kind: 'unset'}; }
  const endpoint = describeEndpoint(settings);
  if (!endpoint) return {kind: 'unset'};
  const {baseURL: _b, apiKeyEnv: _k, ...shown} = endpoint;
  return {...shown, reach: endpoint.kind === 'unset' ? undefined : await probe(endpoint, options)};
}
