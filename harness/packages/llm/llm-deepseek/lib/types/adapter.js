/**
 * `DeepSeekAdapter`: fetch + SSE against a DeepSeek (OpenAI-compatible)
 * chat-completions endpoint, emitting harness StreamChunks. The adapter is
 * transport-only: connection facts arrive through a thunk resolved once per
 * operation and the bearer token through a per-request resolver, so the
 * registering plugin owns validation, layering, and credential policy.
 *
 * @module dsh-llm-deepseek/adapter
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
import { attributionHeaders, contentHasImage, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, isQuotaExceededError, LlmAdapter, LlmError, offloadedImageText, offloadRequestImagesWithPolicy, ProviderRequestId, QUOTA_EXCEEDED_CODE, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { deadline, idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout';
import { serializeRequest, serializeRequestWithImages } from "./serialize.js";
import { deepSeekImageRequestPricing, resolveRequestImagePolicy } from "./request-pricing.js";
import { DeepSeekFileStore } from "./file-store.js";
import { parseSse } from "./sse.js";
import { translate } from "./translate.js";
/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;
/** Default combined request/response context capacity. */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;
/** Default per-request output-token cap. */
export const DEFAULT_MAX_TOKENS = 256_000;
/** Default bound on accumulated base64 image payload after Files API fallback. */
export const DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;
/** Deterministic raw-byte removal step. */
export const DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM = 64 * 1024 * 1024;
/** Deterministic base64-byte removal step after Files API fallback. */
export const DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM = 10 * 1024 * 1024;
/** Deterministic image-count removal step. */
export const DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM = 20;
/** Default explicit lifetime for uploaded images. */
export const DEFAULT_FILE_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
/** Default proactive refresh window for indexed file ids. */
export const DEFAULT_FILE_REFRESH_MARGIN_SECONDS = 60 * 60;
/** Default number of oldest harness-owned files removed on quota recovery. */
export const DEFAULT_FILE_QUOTA_CLEANUP_BATCH = 100;
/** Default deadline for resolving one request image through the Files API. */
export const DEFAULT_FILES_API_TIMEOUT_MS = 60_000;
const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT';
const FILES_API_TIMEOUT_CODE = 'DEEPSEEK_FILES_API_TIMEOUT';
const OFF_REASONING_EFFORT = ReasoningEffortId('off');
const LOW_REASONING_EFFORT = ReasoningEffortId('low');
const HIGH_REASONING_EFFORT = ReasoningEffortId('high');
const MAX_REASONING_EFFORT = ReasoningEffortId('max');
const REASONING_EFFORTS = [
    {
        id: OFF_REASONING_EFFORT,
        name: 'Off',
        description: 'Use for simple tasks that do not need reasoning.',
    },
    {
        id: LOW_REASONING_EFFORT,
        name: 'Low',
        description: 'Prefer for routine or latency-sensitive tasks.',
    },
    {
        id: HIGH_REASONING_EFFORT,
        name: 'High',
        description: 'The default balance for most tasks.',
    },
    {
        id: MAX_REASONING_EFFORT,
        name: 'Max',
        description: 'Reserve for the hardest quality-first tasks.',
    },
];
const OFF_ONLY_REASONING_EFFORTS = [
    {
        id: OFF_REASONING_EFFORT,
        name: 'Off',
        description: 'Use for simple tasks that do not need reasoning.',
    },
];
/** Marks a failed file-id resolution that may be retried as an inline request. */
class FileResolutionFailure extends Error {
    constructor(cause) {
        super('DeepSeek Files API could not resolve a request image.', { cause });
        this.name = 'FileResolutionFailure';
    }
}
function collectImageRefs(content, refs) {
    for (const block of content) {
        if (block.type === 'image')
            refs.set(block.attachment.attachmentId, block.attachment);
        else if (block.type === 'tool-result')
            collectImageRefs(block.content, refs);
    }
}
async function prepareRequestImages(options, attachments, model, signal) {
    const refs = new Map();
    for (const message of options.messages)
        collectImageRefs(message.content, refs);
    const policy = resolveRequestImagePolicy(model);
    const orderedRefs = [...refs.values()];
    const projected = await Promise.all(orderedRefs.map(ref => attachments.readImageRequest(ref, policy, signal)));
    return new Map(orderedRefs.map((ref, index) => ([ref.attachmentId, projected[index]])));
}
function providerRejectedNormalizedImage(detail) {
    const reasonBeforeImage = /(?:unsupported|invalid|cannot read|failed to (?:decode|process)).{0,40}image/iu;
    const imageBeforeReason = /image.{0,40}(?:unsupported|invalid|cannot be decoded)/iu;
    return reasonBeforeImage.test(detail) || imageBeforeReason.test(detail);
}
function providerRejectedFileId(detail) {
    const file = /\bfile(?:[_ -]?(?:id|api|not[_ -]?found|deleted|expired))?/iu.test(detail);
    const missing = /(?:expired|not[_ -]?found|deleted|do(?:es)? not exist|not created under (?:this|your) account)/iu.test(detail);
    const invalidId = /(?:invalid.{0,20}file[_ -]?(?:id|api)|file[_ -]?(?:id|api).{0,20}invalid)/iu.test(detail);
    return file && (missing || invalidId);
}
function detailNamesFileId(detail, fileId) {
    let index = detail.indexOf(fileId);
    while (index >= 0) {
        const before = detail[index - 1];
        const after = detail[index + fileId.length];
        if ((before === undefined || !/[\p{L}\p{N}_-]/u.test(before))
            && (after === undefined || !/[\p{L}\p{N}_-]/u.test(after)))
            return true;
        index = detail.indexOf(fileId, index + 1);
    }
    return false;
}
function staleMappings(files, detail) {
    const unique = [...new Map(files.map(file => [`${file.version.variantId}\0${file.fileId}`, file])).values()];
    const exact = unique.filter(file => detailNamesFileId(detail, file.fileId));
    return exact.length > 0 ? exact : unique;
}
function normalizedImageFacts(file) {
    const version = file.version;
    const name = version.attachment.name ?? version.attachment.attachmentId;
    const colour = version.hasAlpha ? 'sRGBA' : 'sRGB';
    return `"${name}" at message ${file.location.message}, image ${file.location.image} `
        + `(${version.mediaType}, 8-bit ${colour}, ${version.width}x${version.height})`;
}
function normalizedImageDiagnostic(files, providerMessage, providerDetail) {
    const exact = files.find(file => detailNamesFileId(providerDetail, file.fileId));
    const target = exact ?? (files.length === 1 ? files[0] : undefined);
    if (target !== undefined) {
        return `DeepSeek rejected normalized image ${normalizedImageFacts(target)}: ${providerMessage}. `
            + 'The provider rejected bytes already normalized by the harness; PNG, JPEG, WebP, and GIF remain supported input formats.';
    }
    const candidates = [...new Map(files.map(file => [
            `${file.version.variantId}\0${file.location.message}\0${file.location.image}`,
            file,
        ])).values()];
    return `DeepSeek rejected a normalized request image: ${providerMessage}. Candidate images: `
        + `${candidates.map(normalizedImageFacts).join('; ')}. `
        + 'The provider rejected bytes already normalized by the harness; PNG, JPEG, WebP, and GIF remain supported input formats.';
}
function modelInfo(provider, model) {
    return {
        provider,
        id: model.id,
        name: model.name ?? model.id,
        ...model.description === undefined ? {} : { description: model.description },
        inputModalities: model.inputModalities ?? ['text'],
    };
}
function providerRetryAfterMs(value) {
    if (value === null)
        return undefined;
    if (/^\d+$/.test(value)) {
        const delay = Number(value) * 1_000;
        return Number.isFinite(delay) && delay > 0 ? delay : undefined;
    }
    const delay = Date.parse(value) - Date.now();
    return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}
function requestId(headers) {
    const value = headers.get('x-request-id') ?? headers.get('x-deepseek-request-id');
    return value === null || value.length === 0 ? undefined : ProviderRequestId(value);
}
/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx provider response.
 * @param error - parsed provider error body, when available.
 * @returns the normalized harness error code.
 */
export function httpErrorCode(status, error) {
    if (status === 401 || status === 403)
        return 'AUTH';
    if (status === 413)
        return 'INVALID_REQUEST';
    const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ');
    if (isQuotaExceededError(detail))
        return QUOTA_EXCEEDED_CODE;
    if (status === 429)
        return 'RATE_LIMIT';
    if (status === 400) {
        if (isContextWindowExceededError(detail))
            return CONTEXT_WINDOW_EXCEEDED_CODE;
        return 'INVALID_REQUEST';
    }
    if (status >= 500)
        return 'SERVER';
    return `HTTP_${status}`;
}
/**
 * The first real `LlmAdapter`. One instance serves every model name it was
 * registered under (the harness model name IS the wire model name).
 *
 * One stable signal reaches both initial fetch and body reads. Caller aborts
 * map to `ABORTED`; the configured per-read idle watchdog maps to `TIMEOUT`.
 */
export class DeepSeekAdapter extends LlmAdapter {
    config;
    files;
    constructor(config) {
        super();
        this.config = config;
        this.files = config.resolveFiles?.() ?? new DeepSeekFileStore();
    }
    providerInfo(provider) {
        return { id: provider, name: 'DeepSeek' };
    }
    providerRetryPolicy(_provider) {
        return this.config.options().retryPolicy;
    }
    imageRequestPricing(_provider, model) {
        // The same access resolution the serializer uses, so priced handle and
        // placeholder text matches what the request actually sends.
        const attachments = this.config.resolveAttachments?.();
        const resolveAccess = attachments === undefined
            ? undefined
            : (ref) => (this.config.resolveImageAccess?.(attachments, ref));
        return deepSeekImageRequestPricing(this.config.options(), model, resolveAccess);
    }
    listModels(provider) {
        return Promise.resolve(this.config.options().models.map(model => modelInfo(provider, model)));
    }
    resolveModel(provider, model, _signal) {
        return Promise.resolve(this.modelInfoFor(this.config.options(), provider, model));
    }
    modelInfoFor(connection, provider, model) {
        const configured = connection.models.find(entry => entry.id === model);
        const contextWindow = configured?.contextWindow
            ?? connection.defaultContextWindow;
        return {
            // An uncatalogued endpoint is safely treated as text-only. Declaring an
            // unverified image capability would let the host persist input that the
            // endpoint may reject on every later turn.
            ...configured === undefined
                ? { provider, id: model, name: model, inputModalities: ['text'] }
                : modelInfo(provider, configured),
            context: { contextWindow },
            defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
            ...connection.defaults.thinking === 'disabled'
                ? {
                    reasoning: {
                        efforts: OFF_ONLY_REASONING_EFFORTS,
                        defaultEffort: OFF_REASONING_EFFORT,
                    },
                }
                : {
                    reasoning: {
                        efforts: REASONING_EFFORTS,
                        defaultEffort: connection.defaults.reasoningEffort === 'off'
                            ? OFF_REASONING_EFFORT
                            : connection.defaults.reasoningEffort === 'low'
                                ? LOW_REASONING_EFFORT
                                : connection.defaults.reasoningEffort === 'max'
                                    ? MAX_REASONING_EFFORT
                                    : HIGH_REASONING_EFFORT,
                    },
                },
        };
    }
    prepareCall(provider, model, _signal) {
        const connection = this.config.options();
        return Promise.resolve({
            model: this.modelInfoFor(connection, provider, model),
            stream: options => this.streamWithConnection(options, connection),
        });
    }
    stream(options) {
        return this.streamWithConnection(options, this.config.options());
    }
    async *streamWithConnection(options, connection) {
        const env_1 = { stack: [], error: void 0, hasError: false };
        try {
            // One resolution per stream call: connection facts and the credential
            // freeze here and hold for this whole request, so an in-flight stream
            // never observes a configuration change and the next call re-resolves.
            // The key resolves *from this snapshot*, so an endpoint and the secret
            // sent to it can never come from different configuration generations.
            const hasImages = options.messages.some(message => contentHasImage(message.content));
            let attachments;
            if (hasImages) {
                const model = connection.models.find(entry => entry.id === options.model);
                if (model?.inputModalities?.includes('image') !== true) {
                    throw new LlmError(`DeepSeek model "${options.model}" does not accept image input.`, 'UNSUPPORTED_CONTENT');
                }
                attachments = this.config.resolveAttachments?.();
                if (attachments === undefined) {
                    throw new LlmError('DeepSeek image conversion requires the durable attachment service.', 'UNSUPPORTED_CONTENT');
                }
            }
            const apiKey = await this.config.resolveApiKey(connection);
            const userId = this.config.resolveUserId();
            const consumer = new AbortController();
            const upstream = options.signal === undefined
                ? consumer.signal
                : AbortSignal.any([options.signal, consumer.signal]);
            const watchdog = __addDisposableResource(env_1, idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE), false);
            const iterator = this.request(options, watchdog.signal, connection, apiKey, userId, attachments, () => { watchdog.pulse(); })[Symbol.asyncIterator]();
            let exhausted = false;
            try {
                while (true) {
                    const result = await watchdog.next(iterator);
                    if (result.done) {
                        exhausted = true;
                        return;
                    }
                    yield result.value;
                }
            }
            catch (error) {
                if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
                    throw new LlmError(`DeepSeek stream idle timeout after ${connection.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error });
                }
                if (options.signal?.aborted) {
                    throw new LlmError('DeepSeek request aborted by caller', 'ABORTED', { cause: error });
                }
                if (error instanceof LlmError)
                    throw error;
                throw new LlmError(`DeepSeek API stream from ${connection.baseURL} failed`, 'TRANSPORT', { cause: error });
            }
            finally {
                consumer.abort('DeepSeek stream consumer stopped');
                if (!exhausted && iterator.return !== undefined) {
                    try {
                        await iterator.return();
                    }
                    catch (_abortedTransportTeardown) {
                        // The consumer controller already owns termination; a return-time abort cannot add a second outcome.
                    }
                }
            }
        }
        catch (e_1) {
            env_1.error = e_1;
            env_1.hasError = true;
        }
        finally {
            __disposeResources(env_1);
        }
    }
    async *request(options, signal, connection, apiKey, userId, attachments, onActivity) {
        const headers = {
            'authorization': `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'accept': 'text/event-stream',
            ...attributionHeaders(),
            'x-deepseek-harness-user-id': String(userId),
            ...options.sessionId !== undefined
                ? { 'x-deepseek-harness-session-id': String(options.sessionId) }
                : {},
            ...options.purpose === 'compaction'
                ? { 'x-deepseek-harness-compact': '1' }
                : {},
        };
        const fileConnection = { baseURL: connection.baseURL, apiKey };
        const model = connection.models.find(entry => entry.id === options.model);
        const policy = model === undefined ? undefined : resolveRequestImagePolicy(model);
        const resolveImageAccess = attachments === undefined
            ? undefined
            : (ref) => this.config.resolveImageAccess?.(attachments, ref);
        const imageAccessOptions = resolveImageAccess === undefined ? {} : { resolveImageAccess };
        const requestMessages = policy === undefined ? options.messages : offloadRequestImagesWithPolicy(options.messages, {
            representation: 'raw',
            maxBytes: connection.maxRequestFilesBytes,
            maxImages: connection.maxImagesPerRequest,
            byteQuantum: connection.imageOffloadByteQuantum,
            countQuantum: connection.imageOffloadCountQuantum,
            byteLength: ref => Math.min(ref.bytes, policy.maxBytes),
            placeholder: ref => offloadedImageText(ref, resolveImageAccess?.(ref)),
        });
        const requestOptions = requestMessages === options.messages ? options : { ...options, messages: [...requestMessages] };
        const requestImages = attachments === undefined || model === undefined
            ? new Map()
            : await prepareRequestImages(requestOptions, attachments, model, signal);
        let representation = 'file';
        let fileAttempt = 0;
        while (true) {
            const usedFiles = [];
            let body;
            if (attachments === undefined) {
                body = serializeRequest(requestOptions, connection.defaults);
            }
            else if (representation === 'base64') {
                body = await serializeRequestWithImages(requestOptions, {
                    representation: { kind: 'base64' },
                    requestImages,
                    ...imageAccessOptions,
                    maxRequestImageBytes: connection.maxInlineRequestImageBytes,
                    maxImagesPerRequest: connection.maxImagesPerRequest,
                    byteQuantum: connection.inlineImageOffloadByteQuantum,
                    countQuantum: connection.imageOffloadCountQuantum,
                }, connection.defaults);
            }
            else {
                try {
                    body = await serializeRequestWithImages(requestOptions, {
                        representation: {
                            kind: 'file',
                            resolveFileId: async (version, _block, location) => {
                                const env_2 = { stack: [], error: void 0, hasError: false };
                                try {
                                    const filesDeadline = __addDisposableResource(env_2, deadline(signal, connection.filesApiTimeoutMs, FILES_API_TIMEOUT_CODE), false);
                                    let resolved;
                                    try {
                                        resolved = await this.files.ensureUploaded(version, fileConnection, connection.filePolicy, filesDeadline.signal);
                                    }
                                    catch (error) {
                                        if (signal.aborted)
                                            throw error;
                                        throw new FileResolutionFailure(error);
                                    }
                                    onActivity();
                                    usedFiles.push({ version, fileId: resolved.record.fileId, location });
                                    return resolved.record.fileId;
                                }
                                catch (e_2) {
                                    env_2.error = e_2;
                                    env_2.hasError = true;
                                }
                                finally {
                                    __disposeResources(env_2);
                                }
                            },
                        },
                        requestImages,
                        ...imageAccessOptions,
                        maxRequestImageBytes: connection.maxRequestFilesBytes,
                        maxImagesPerRequest: connection.maxImagesPerRequest,
                        byteQuantum: connection.imageOffloadByteQuantum,
                        countQuantum: connection.imageOffloadCountQuantum,
                    }, connection.defaults);
                }
                catch (error) {
                    if (!(error instanceof FileResolutionFailure))
                        throw error;
                    representation = 'base64';
                    continue;
                }
            }
            let extensions;
            try {
                extensions = await this.config.prepareExtensions({
                    body: body,
                    signal,
                    ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
                    ...options.purpose === undefined ? {} : { purpose: options.purpose },
                });
            }
            catch (error) {
                throw new LlmError('DeepSeek request extension preparation failed', 'REQUEST_EXTENSION', { cause: error });
            }
            for (const field of Object.keys(extensions.fields)) {
                if (Object.hasOwn(body, field)) {
                    throw new LlmError(`DeepSeek request extension field ${JSON.stringify(field)} collides with the base request`, 'REQUEST_EXTENSION');
                }
            }
            // Prepared outside the try so the TRANSPORT label below covers exactly the
            // transport boundary, never a serialization failure.
            const payload = JSON.stringify({ ...body, ...extensions.fields });
            // TODO(http): adopt the Cordis HTTP service when shared transport configuration
            // outweighs its additional runtime dependencies.
            let response;
            try {
                response = await fetch(`${connection.baseURL}/chat/completions`, {
                    method: 'POST',
                    headers,
                    body: payload,
                    signal,
                });
            }
            catch (error) {
                if (signal.aborted)
                    throw error;
                throw new LlmError(`DeepSeek API request to ${connection.baseURL} failed`, 'TRANSPORT', { cause: error });
            }
            if (!response.ok) {
                let message = `DeepSeek API error (HTTP ${response.status})`;
                let providerError;
                const rawResponse = await response.text();
                try {
                    const parsed = JSON.parse(rawResponse);
                    providerError = parsed.error;
                    if (providerError?.message)
                        message = providerError.message;
                }
                catch {
                    // The HTTP status remains authoritative when a gateway returns malformed JSON.
                }
                const detail = [providerError?.code, providerError?.type, providerError?.message]
                    .filter((field) => typeof field === 'string')
                    .join(' ');
                const staleFile = usedFiles.length > 0 && providerRejectedFileId(detail);
                if (staleFile) {
                    await Promise.all(staleMappings(usedFiles, detail).map(file => (this.files.invalidate(file.version, file.fileId, fileConnection))));
                    if (fileAttempt === 0) {
                        fileAttempt += 1;
                        continue;
                    }
                }
                if (response.status === 400 && usedFiles.length > 0 && providerRejectedNormalizedImage(detail)) {
                    message = normalizedImageDiagnostic(usedFiles, message, detail);
                }
                const delay = providerRetryAfterMs(response.headers.get('retry-after'));
                const id = requestId(response.headers);
                throw new LlmError(message, httpErrorCode(response.status, providerError), {
                    cause: new Error(rawResponse.length > 0 ? rawResponse : `DeepSeek HTTP ${response.status}`),
                    status: response.status,
                    ...delay === undefined ? {} : { providerRetryAfterMs: delay },
                    ...id === undefined ? {} : { requestId: id },
                });
            }
            try {
                await extensions.accept();
            }
            catch (error) {
                throw new LlmError('DeepSeek request extension acceptance failed', 'REQUEST_EXTENSION', { cause: error });
            }
            if (!response.body) {
                throw new LlmError('DeepSeek API returned no response body', 'EMPTY_RESPONSE');
            }
            yield* translate(parseSse(response.body, onActivity));
            return;
        }
    }
}
