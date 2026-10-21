import {WebError} from '@deepseek-ai/dsh-web';

export const name = 'atelier-search';
export const DEFAULTS = Object.freeze({timeoutMs: 8000, maxResults: 10, snippetChars: 400});

const clip = (value, max) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export function resolveConfig(config = {}) {
  const raw = String(config.baseUrl ?? '').trim();
  if (!raw) throw new WebError('web search is not configured', 'WEB_PROVIDER_MISSING');
  let url;
  try { url = new URL(raw); } catch { throw new WebError('SearXNG URL must be a valid http(s) URL.', 'WEB_PROVIDER_ERROR'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new WebError('SearXNG URL must be a valid http(s) URL.', 'WEB_PROVIDER_ERROR');
  const positiveInt = (key, fallback) => {
    const value = config[key] ?? fallback;
    if (!Number.isInteger(value) || value < 1) throw new WebError(`${key} must be a positive integer.`, 'WEB_PROVIDER_ERROR');
    return value;
  };
  let fallbackUrl = String(config.fallbackUrl ?? '').trim();
  if (fallbackUrl) {
    try {
      const fallback = new URL(fallbackUrl);
      if (!['http:', 'https:'].includes(fallback.protocol)) throw new Error('protocol');
      fallbackUrl = fallback.href.replace(/\/+$/, '');
    } catch { throw new WebError('Fallback URL must be a valid http(s) URL.', 'WEB_PROVIDER_ERROR'); }
  }
  return {baseUrl: url.href.replace(/\/+$/, ''), fallbackUrl,
    timeoutMs: positiveInt('timeoutMs', DEFAULTS.timeoutMs), maxResults: positiveInt('maxResults', DEFAULTS.maxResults),
    snippetChars: positiveInt('snippetChars', DEFAULTS.snippetChars)};
}

export function buildSearchUrl(config, query) {
  const url = new URL(`${config.baseUrl}/search`);
  url.search = new URLSearchParams({q: query, format: 'json'}).toString();
  return url.href;
}

export function mapResponse(json, {limit = DEFAULTS.maxResults, snippetChars = DEFAULTS.snippetChars} = {}) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.results)) {
    throw new WebError('SearXNG returned JSON without a results array.', 'WEB_PROVIDER_ERROR');
  }
  const seen = new Set(), all = [];
  for (const result of json.results) {
    const url = typeof result?.url === 'string' ? result.url : '';
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const title = clip(result.title, 300), snippet = clip(result.content, snippetChars);
    all.push({url, ...(title ? {title} : {}), ...(snippet ? {snippet} : {})});
  }
  const sources = all.slice(0, limit);
  // SearXNG 2024+ returns answers as objects ({answer, url}); older instances return strings.
  const answers = (Array.isArray(json.answers) ? json.answers : []).map(answer => clip(answer && typeof answer === 'object' ? answer.answer ?? answer.text ?? '' : answer, 600)).filter(Boolean);
  return {...(answers.length ? {content: answers.join('\n')} : {}), sources, truncated: sources.length < all.length};
}

export class SearxngSearchProvider {
  constructor(getConfig, {fetchImpl = globalThis.fetch} = {}) {
    this.id = 'atelier-searxng';
    this.getConfig = getConfig;
    this.fetchImpl = fetchImpl;
  }

  // Always selectable, so a missing URL reaches search() and the model gets the plain
  // "web search is not configured" instead of the registry's generic "registered but unavailable".
  available() { return typeof this.fetchImpl === 'function'; }

  async search(request, signal) {
    const query = String(request?.query ?? '').trim();
    if (!query) throw new WebError('web search query is empty', 'WEB_INVALID_REQUEST');
    const current = this.getConfig() ?? {};
    const config = resolveConfig({baseUrl: current.baseUrl, fallbackUrl: current.fallbackUrl});
    const urls = [config.baseUrl, config.fallbackUrl].filter(Boolean);
    let lastError;
    for (const baseUrl of urls) {
      try { return await this.searchAt({...config, baseUrl}, query, request, signal); }
      catch (error) {
        lastError = error;
        if (!['WEB_PROVIDER_UNREACHABLE', 'WEB_PROVIDER_TIMEOUT', 'WEB_PROVIDER_ERROR'].includes(error?.code) || signal?.aborted) throw error;
      }
    }
    throw lastError;
  }

  async searchAt(config, query, request, signal) {
    if (signal?.aborted) throw new WebError('web search was cancelled', 'WEB_ABORTED', {cause: signal.reason});
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try { response = await this.fetchImpl(buildSearchUrl(config, query), {signal: combined, headers: {accept: 'application/json'}}); }
    catch (error) {
      if (signal?.aborted) throw new WebError('web search was cancelled', 'WEB_ABORTED', {cause: error});
      if (timeout.aborted) throw new WebError(`SearXNG did not answer within ${config.timeoutMs} ms.`, 'WEB_PROVIDER_TIMEOUT', {cause: error});
      throw new WebError('SearXNG is unreachable.', 'WEB_PROVIDER_UNREACHABLE', {cause: error});
    }
    if (!response.ok) throw new WebError(`SearXNG answered HTTP ${response.status}.`, 'WEB_PROVIDER_ERROR');
    let json;
    try { json = await response.json(); }
    catch (error) { throw new WebError('SearXNG returned a body that is not JSON.', 'WEB_PROVIDER_ERROR', {cause: error}); }
    const maxResults = Math.min(request.maxResults ?? config.maxResults, config.maxResults);
    return mapResponse(json, {limit: maxResults, snippetChars: config.snippetChars});
  }
}
