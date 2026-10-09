/**
 * Safe HTTP(S) retrieval for `ctx.web`: validates and pins public IP destinations, follows
 * only same-origin redirects, enforces time and size limits, classifies and decodes text,
 * and leaves presentation to `@deepseek-ai/dsh-tool-web`. Requests carry no browser cookies
 * or ambient credentials.
 * @module @deepseek-ai/dsh-web-fetch-http/provider
 */
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import { WebError } from '@deepseek-ai/dsh-web';
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout';
import { publicHttpNetwork } from "./network.js";
import { classifyContentType, decoderForCharset, isSameOrigin, parseCharset, validateFetchUrl } from "./policy.js";
/** Stable id this provider registers under. */
export const LOCAL_FETCH_PROVIDER_ID = 'http';
/** The anonymous public HTTP(S) fetch provider. */
export class HttpFetchProvider {
    limits;
    resolveAddresses;
    id = LOCAL_FETCH_PROVIDER_ID;
    /**
     * @param limits - resolved transport and response limits.
     * @param resolveAddresses - resolver that rejects non-public destinations before returning.
     */
    constructor(limits, resolveAddresses = publicHttpNetwork.resolve) {
        this.limits = limits;
        this.resolveAddresses = resolveAddresses;
    }
    /** No credentials to check — an anonymous public fetcher is always usable. */
    available() {
        return true;
    }
    async fetch(request, signal) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            if (signal?.aborted)
                throw new WebError('web fetch aborted', 'WEB_ABORTED');
            // One signal stops both the request and body read. The deadline's TimeoutReason later
            // distinguishes this provider's timeout from caller or outer-deadline cancellation.
            const d = __addDisposableResource(env_1, deadline(signal, this.limits.timeoutMs, 'WEB_FETCH_TIMEOUT'), false);
            return await this.followAndRead(request.url, d.signal);
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    }
    /** Follow same-origin redirects up to the hop cap, then read the final response. */
    async followAndRead(initialUrl, signal) {
        let currentUrl = validateFetchUrl(initialUrl);
        let redirectsFollowed = 0;
        for (;;) {
            const request = await this.requestOnce(currentUrl, signal);
            const { response } = request;
            try {
                if (isRedirectStatus(response.status)) {
                    // Enforce the redirect budget before resolving or validating the next hop.
                    if (redirectsFollowed >= this.limits.maxRedirects) {
                        await response.body?.cancel();
                        throw new WebError(`exceeded the maximum of ${this.limits.maxRedirects} redirects`, 'WEB_REDIRECT_BLOCKED');
                    }
                    const location = response.headers.get('location');
                    if (location === null) {
                        // A redirect status with no Location is not a usable resource. Cancel
                        // the (possibly streaming) body before throwing so no socket leaks.
                        await response.body?.cancel();
                        throw new WebError(`redirect response (HTTP ${response.status}) without a Location header`, 'WEB_PROVIDER_ERROR');
                    }
                    const target = resolveRedirect(location, currentUrl);
                    // Re-validate the target against the same transport hygiene a direct request gets: a
                    // redirect must not be a back door to a credentialed, non-http(s), or over-long URL
                    // that validateFetchUrl would reject.
                    let validatedTarget;
                    try {
                        validatedTarget = validateFetchUrl(target.toString());
                        if (!isSameOrigin(validatedTarget, currentUrl)) {
                            throw new WebError(`cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`, 'WEB_REDIRECT_BLOCKED');
                        }
                    }
                    catch (error) {
                        await response.body?.cancel();
                        throw error;
                    }
                    await response.body?.cancel();
                    currentUrl = validatedTarget;
                    redirectsFollowed++;
                    continue;
                }
                return await this.readBody(response, currentUrl, signal);
            }
            finally {
                await request.close();
            }
        }
    }
    async requestOnce(url, signal) {
        try {
            const addresses = await this.resolveAddresses(url.hostname, signal);
            return await publicHttpNetwork.request(url, addresses, {
                'user-agent': this.limits.userAgent,
                'accept': 'text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8',
            }, signal);
        }
        catch (error) {
            if (error instanceof WebError)
                throw error;
            throw translateAbortOrNetwork(error, signal);
        }
    }
    /** Read, byte-cap, classify, and decode the final response body. */
    async readBody(response, finalUrl, signal) {
        const contentType = response.headers.get('content-type');
        const kind = classifyContentType(contentType);
        if (kind === undefined) {
            await response.body?.cancel();
            throw new WebError(`unsupported content type "${contentType ?? 'unknown'}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE');
        }
        // Resolve the decoder BEFORE reading the body so an unsupported charset
        // fails without consuming the stream — but cancel the body on that failure
        // so the socket does not leak (matching the unsupported-content-type path).
        let decoder;
        try {
            decoder = decoderForCharset(parseCharset(contentType));
        }
        catch (error) {
            await response.body?.cancel();
            throw error;
        }
        const { bytes, truncatedByBytes } = await this.readCapped(response, signal);
        const decoded = decoder.decode(bytes);
        const truncatedByChars = decoded.length > this.limits.maxBodyChars;
        const content = truncatedByChars ? decoded.slice(0, this.limits.maxBodyChars) : decoded;
        const body = kind === 'html' ? { kind: 'html', content } : { kind: 'text', content };
        return {
            url: finalUrl.toString(),
            statusCode: response.status,
            body,
            truncated: truncatedByBytes || truncatedByChars,
        };
    }
    /**
     * Read the response stream up to `maxResponseBytes`. A `Content-Length` over
     * the cap rejects immediately with `WEB_FETCH_TOO_LARGE`; a stream that grows
     * past the cap is cut short (`truncatedByBytes`) rather than rejected, so a
     * server that under-reports still yields a bounded usable body.
     */
    async readCapped(response, signal) {
        const declared = response.headers.get('content-length');
        if (declared !== null) {
            const length = Number(declared);
            if (Number.isFinite(length) && length > this.limits.maxResponseBytes) {
                await response.body?.cancel();
                throw new WebError(`response exceeds the maximum of ${this.limits.maxResponseBytes} bytes`, 'WEB_FETCH_TOO_LARGE');
            }
        }
        /* v8 ignore next -- a 2xx Response from fetch always exposes a body stream; the null guard is defensive. */
        if (response.body === null)
            return { bytes: new Uint8Array(0), truncatedByBytes: false };
        const chunks = [];
        let total = 0;
        let truncatedByBytes = false;
        // Undici exposes response chunks as `any`; Fetch guarantees body chunks are Uint8Array.
        const reader = response.body.getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                const remaining = this.limits.maxResponseBytes - total;
                // Only DROPPED bytes count as truncation: a chunk that exactly fills the
                // remaining capacity keeps all its bytes and we read on to observe EOF,
                // so an exactly-at-cap body is not falsely flagged truncated.
                if (value.byteLength > remaining) {
                    chunks.push(value.subarray(0, remaining));
                    total += remaining;
                    truncatedByBytes = true;
                    break;
                }
                chunks.push(value);
                total += value.byteLength;
            }
        }
        catch (error) {
            /* v8 ignore next -- mid-stream read fault needs a network drop after headers; translate path covered by request-phase tests. */
            throw translateAbortOrNetwork(error, signal);
        }
        finally {
            /* v8 ignore next 4 -- cancel() after a completed/broken read settles without rejecting; unobserved best-effort cleanup. */
            await reader.cancel().catch(() => {
                // Cancel after a successful read (or after we broke past the cap) is
                // best-effort cleanup; the bytes we need are already collected.
            });
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return { bytes, truncatedByBytes };
    }
}
/** HTTP redirect status codes that carry a `Location`. */
function isRedirectStatus(status) {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
/** Resolve a (possibly relative) `Location` against the current URL. */
function resolveRedirect(location, base) {
    try {
        return new URL(location, base);
    }
    catch (error) {
        /* v8 ignore next 2 -- URL resolution against a valid absolute base effectively never throws; defensive guard. */
        throw new WebError(`invalid redirect Location "${location}"`, 'WEB_PROVIDER_ERROR', { cause: error });
    }
}
/**
 * Translate a thrown fetch/stream error into a `WebError`, classified by the
 * deadline signal rather than the thrown value (which differs by phase: the
 * request-phase `fetch` rejects with the abort reason, while the read-phase
 * reader surfaces a bare `AbortError`). `timeoutOf(signal, 'WEB_FETCH_TIMEOUT')`
 * recovering OUR reason means our timeout fired (`WEB_FETCH_TIMEOUT`); any other
 * abort — an upstream cancel, or a foreign/outer deadline's timeout under
 * nesting — is `WEB_ABORTED`; a throw with the signal NOT aborted is a
 * transport/network failure (`WEB_PROVIDER_ERROR`).
 */
function translateAbortOrNetwork(error, signal) {
    const timeout = timeoutOf(signal, 'WEB_FETCH_TIMEOUT');
    if (timeout !== undefined)
        return new WebError('web fetch timed out', 'WEB_FETCH_TIMEOUT', { cause: timeout });
    if (signal.aborted)
        return new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error });
    return new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error });
}
