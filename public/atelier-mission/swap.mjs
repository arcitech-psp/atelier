// "Wait for models to load": what the harness needs so a request to a model that is not in memory yet waits for it
// instead of failing. The model servers do the loading (LM Studio just-in-time loading, Ollama, llama-swap); the
// harness only has to be patient. It has three timers that can give up too early on a one-GPU machine:
//   1. the HTTP layer of Node (undici): 5 minutes to the first byte of the reply            -> raised here, process wide
//   2. the model provider's own request timeout (timeoutMs)                                  -> raised in settings.yaml
//   3. the stream idle watchdog (streamIdleTimeoutMs, 5 minutes with no token)               -> raised in settings.yaml
// plus the retry policy, so a connection reset or a 503 during a swap is retried for a while instead of ending the turn.
// Everything below is pure so it can be tested; index.mjs applies it.

export const DEFAULT_WAIT_SECONDS = 900;
export const MIN_WAIT_SECONDS = 60;
export const MAX_WAIT_SECONDS = 3600;

/** The values the harness uses when nothing is configured (kept here only to explain the change in the panel). */
export const HARNESS_DEFAULTS = {streamIdleTimeoutMs: 300_000, httpHeadersTimeoutMs: 300_000, retries: 5};

export function clampWait(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return DEFAULT_WAIT_SECONDS;
  return Math.min(MAX_WAIT_SECONDS, Math.max(MIN_WAIT_SECONDS, Math.round(value)));
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|::1)$/i;
const PRIVATE = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(\.\d{1,3}){2})$|\.(local|lan|home|internal|ts\.net)$/i;

/** Only models served from this computer or its own network can be "loading"; hosted APIs keep their timeouts. */
export function isLocalEndpoint(baseURL) {
  try { const host = new URL(String(baseURL)).hostname; return LOOPBACK.test(host) || PRIVATE.test(host); } catch { return false; }
}

/** The retry policy used while waiting for loads: more tries and longer pauses, so a refused connection or a 5xx while
 *  a server swaps models is retried for about two minutes. TIMEOUT is left out on purpose: after a wait of many minutes
 *  a silent server is stuck, and repeating the wait eight times would hide that for hours. */
export const swapRetryPolicy = () => ({
  mode: 'normal', maxRetries: 8, retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TRANSPORT'],
  backoff: {initialDelayMs: 2000, maxDelayMs: 15_000},
});

/**
 * The settings changes for "wait for models to load".
 * A provider keeps any value the person set themselves: only missing keys are filled in, and the keys filled in are
 * remembered in `managed` so turning the mode off removes exactly those and nothing else.
 * @param {Record<string, any>} providers llm-pi-ai providers from settings.yaml
 * @param {number} waitSeconds
 * @param {Record<string, string[]>} managed keys this feature set earlier, by provider route
 * @returns {{ops: {op: 'set', path: string[], value: any}[], managed: Record<string, string[]>, routes: string[]}}
 */
export function planEnable(providers, waitSeconds, managed = {}) {
  const wait = clampWait(waitSeconds) * 1000;
  const ops = [], nextManaged = {}, routes = [];
  for (const [route, provider] of Object.entries(providers ?? {})) {
    if (!provider || typeof provider !== 'object' || !isLocalEndpoint(provider.baseURL)) continue;
    const mine = new Set(managed[route] ?? []);
    const keys = [];
    const wanted = {streamIdleTimeoutMs: wait, timeoutMs: wait, retryPolicy: swapRetryPolicy()};
    for (const [key, value] of Object.entries(wanted)) {
      const current = provider[key];
      if (current === undefined || mine.has(key)) {
        // Rewrite our own earlier value (the wait may have changed); never touch a value we did not set.
        if (JSON.stringify(current) !== JSON.stringify(value)) ops.push({op: 'set', path: ['providers', route, key], value});
        keys.push(key);
      }
    }
    if (keys.length > 0) { nextManaged[route] = keys; routes.push(route); }
  }
  return {ops, managed: nextManaged, routes};
}

/** Remove exactly the keys this feature set. */
export function planDisable(managed = {}) {
  const ops = [];
  for (const [route, keys] of Object.entries(managed)) for (const key of keys) ops.push({op: 'unset', path: ['providers', route, key]});
  return {ops};
}

/** Options for the Node HTTP layer: wait this long for the first byte, and this long between body chunks. */
export function dispatcherOptions(waitSeconds) {
  const wait = clampWait(waitSeconds) * 1000;
  return {headersTimeout: wait, bodyTimeout: wait};
}
