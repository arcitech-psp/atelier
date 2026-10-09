/**
 * Anonymous public HTTP(S) `WebFetchProvider` plugin. It contributes to the
 * `ctx.web` registry without owning the service.
 *
 * @module @deepseek-ai/dsh-web-fetch-http
 */
import z from '@deepseek-ai/schemastery';
import { HttpFetchProvider } from "./provider.js";
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;
export { LOCAL_FETCH_PROVIDER_ID, HttpFetchProvider, } from "./provider.js";
/** Default `User-Agent`: an explicit product agent, never a browser disguise. */
export const DEFAULT_USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)';
/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fetch-http';
/** The web seam this provider registers into. */
export const inject = ['web'];
export const Config = z.object({
    maxResponseBytes: z.number().default(5_000_000),
    maxBodyChars: z.number().default(100_000),
    timeoutMs: z.number().default(30_000),
    maxRedirects: z.number().default(5),
    userAgent: z.string().default(DEFAULT_USER_AGENT),
});
/** A resource limit (byte/char/length/timeout cap) must be a positive finite number. */
function assertPositiveFinite(name, value) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`web-fetch-http: ${name} must be a positive finite number`);
    }
}
/** Node coerces larger timer delays to 1 ms, so reject them at configuration time. */
function assertTimeoutMs(value) {
    assertPositiveFinite('timeoutMs', value);
    if (value > MAX_NODE_TIMER_DELAY_MS) {
        throw new Error(`web-fetch-http: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`);
    }
}
/** The redirect hop cap must be a non-negative integer (0 follows no redirects). */
function assertNonNegativeInteger(name, value) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`web-fetch-http: ${name} must be a non-negative integer`);
    }
}
/** Register the local HTTP(S) fetch provider with `ctx.web`. */
export function apply(ctx, config) {
    // schemastery (Config) has already filled every defaulted field.
    const resolved = config;
    assertPositiveFinite('maxResponseBytes', resolved.maxResponseBytes);
    assertPositiveFinite('maxBodyChars', resolved.maxBodyChars);
    assertTimeoutMs(resolved.timeoutMs);
    assertNonNegativeInteger('maxRedirects', resolved.maxRedirects);
    const limits = {
        maxResponseBytes: resolved.maxResponseBytes,
        maxBodyChars: resolved.maxBodyChars,
        timeoutMs: resolved.timeoutMs,
        maxRedirects: resolved.maxRedirects,
        userAgent: resolved.userAgent,
    };
    ctx.web.registerFetchProvider(new HttpFetchProvider(limits));
}
