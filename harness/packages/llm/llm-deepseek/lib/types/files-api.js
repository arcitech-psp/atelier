/** OpenAI-compatible DeepSeek Files API transport. @module dsh-llm-deepseek/files-api */
import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm';
import { DeepSeekFileId } from "./file-id.js";
/** Minimum provider-supported file lifetime. */
export const MIN_FILE_EXPIRY_SECONDS = 3_600;
/** Maximum provider-supported file lifetime. */
export const MAX_FILE_EXPIRY_SECONDS = 2_592_000;
/** Maximum Files API upload size. */
export const MAX_FILE_UPLOAD_BYTES = 128 * 1024 * 1024;
/** Current per-key file-count quota. */
export const MAX_STORED_FILE_COUNT = 10_000;
/** Current per-key storage quota. */
export const MAX_STORED_FILE_BYTES = 25 * 1024 * 1024 * 1024;
/** Files API operation failure with its HTTP status retained for recovery policy. */
export class DeepSeekFilesError extends LlmError {
    /** Parsed provider detail used only for error classification. */
    detail;
    /**
     * @param message - user-readable provider failure.
     * @param status - HTTP status returned by the Files API.
     * @param detail - provider error fields joined for classification.
     */
    constructor(message, status, detail) {
        super(message, status === 401 || status === 403
            ? 'AUTH'
            : status === 429
                ? 'RATE_LIMIT'
                : status >= 500
                    ? 'SERVER'
                    : 'FILES_API', { status });
        this.name = 'DeepSeekFilesError';
        this.detail = detail;
    }
}
/**
 * Whether an upload failure reports a provider storage or file-count quota.
 * @param error - Files API operation failure.
 * @returns whether one bounded remote cleanup and upload retry may recover.
 */
export function isFilesQuotaError(error) {
    return error instanceof DeepSeekFilesError
        && /(?:quota|storage|stored files|file count|too many files)/iu.test(error.detail);
}
function invalidResponse(operation) {
    return new LlmError(`DeepSeek Files API returned an invalid ${operation} response.`, 'INVALID_RESPONSE');
}
function parseFileObject(value, operation) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw invalidResponse(operation);
    const wire = value;
    if (typeof wire.id !== 'string' || wire.id.length === 0
        || wire.object !== 'file'
        || !Number.isSafeInteger(wire.bytes) || wire.bytes < 0
        || !Number.isSafeInteger(wire.created_at) || wire.created_at < 0
        || typeof wire.filename !== 'string' || wire.filename.length === 0
        || wire.purpose !== 'user_data'
        || (wire.expires_at !== undefined
            && (!Number.isSafeInteger(wire.expires_at) || wire.expires_at < 0))) {
        throw invalidResponse(operation);
    }
    return {
        id: DeepSeekFileId(wire.id),
        bytes: wire.bytes,
        createdAt: wire.created_at,
        filename: wire.filename,
        purpose: 'user_data',
        ...wire.expires_at === undefined ? {} : { expiresAt: wire.expires_at },
    };
}
function providerErrorDetail(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return { detail: '' };
    const error = value.error;
    if (error === null || typeof error !== 'object' || Array.isArray(error))
        return { detail: '' };
    const fields = error;
    const message = typeof fields.message === 'string' ? fields.message : undefined;
    return {
        ...message === undefined ? {} : { message },
        detail: [fields.code, fields.type, fields.message]
            .filter((field) => typeof field === 'string')
            .join(' '),
    };
}
/** Direct client for the OpenAI-compatible `/files` endpoints. */
export class DeepSeekFilesClient {
    baseURL;
    apiKey;
    fetchImpl;
    /**
     * @param options - endpoint, API-key snapshot, and optional test transport.
     */
    constructor(options) {
        this.baseURL = options.baseURL.replace(/\/+$/u, '');
        this.apiKey = options.apiKey;
        this.fetchImpl = options.fetch ?? globalThis.fetch;
    }
    async request(path, init, signal) {
        let response;
        try {
            const headers = new Headers(attributionHeaders());
            headers.set('authorization', `Bearer ${this.apiKey}`);
            response = await this.fetchImpl(`${this.baseURL}${path}`, {
                ...init,
                headers,
                ...signal === undefined ? {} : { signal },
            });
        }
        catch (error) {
            if (signal?.aborted)
                throw error;
            throw new LlmError(`DeepSeek Files API request to ${this.baseURL} failed`, 'TRANSPORT', { cause: error });
        }
        if (response.ok)
            return response;
        let parsed;
        try {
            parsed = await response.json();
        }
        catch {
            // A status remains sufficient to report the provider failure.
        }
        const { message, detail } = providerErrorDetail(parsed);
        throw new DeepSeekFilesError(message ?? `DeepSeek Files API error (HTTP ${response.status})`, response.status, detail);
    }
    /**
     * Upload one image with an explicit expiry.
     * @param input - deterministic request-version bytes, media type, filename, lifetime, and cancellation.
     * @returns the validated provider file object, including `expires_at`.
     */
    async upload(input) {
        if (input.data.byteLength > MAX_FILE_UPLOAD_BYTES) {
            throw new LlmError('DeepSeek Files API upload exceeds 128 MiB.', 'INVALID_REQUEST');
        }
        if (!Number.isSafeInteger(input.expiresAfterSeconds)
            || input.expiresAfterSeconds < MIN_FILE_EXPIRY_SECONDS
            || input.expiresAfterSeconds > MAX_FILE_EXPIRY_SECONDS) {
            throw new LlmError('DeepSeek file expiry must be between 3600 and 2592000 seconds.', 'INVALID_REQUEST');
        }
        const form = new FormData();
        form.set('purpose', 'user_data');
        form.set('expires_after[anchor]', 'created_at');
        form.set('expires_after[seconds]', String(input.expiresAfterSeconds));
        form.set('file', new Blob([Uint8Array.from(input.data).buffer], { type: input.mediaType }), input.filename);
        const response = await this.request('/files', { method: 'POST', body: form }, input.signal);
        const file = parseFileObject(await response.json(), 'upload');
        if (file.expiresAt === undefined)
            throw invalidResponse('upload');
        return { ...file, expiresAt: file.expiresAt };
    }
    /**
     * List one ascending or descending page of user-data files.
     * @param options - pagination, ordering, and cancellation.
     * @returns the validated page.
     */
    async list(options = {}) {
        const query = new URLSearchParams({ purpose: 'user_data' });
        if (options.after !== undefined)
            query.set('after', options.after);
        if (options.limit !== undefined)
            query.set('limit', String(options.limit));
        if (options.order !== undefined)
            query.set('order', options.order);
        const response = await this.request(`/files?${query.toString()}`, { method: 'GET' }, options.signal);
        const value = await response.json();
        if (value === null || typeof value !== 'object' || Array.isArray(value))
            throw invalidResponse('list');
        const wire = value;
        if (wire.object !== 'list' || !Array.isArray(wire.data) || typeof wire.has_more !== 'boolean'
            || (wire.first_id !== undefined && typeof wire.first_id !== 'string')
            || (wire.last_id !== undefined && typeof wire.last_id !== 'string')) {
            throw invalidResponse('list');
        }
        return {
            data: wire.data.map(item => parseFileObject(item, 'list')),
            ...typeof wire.first_id === 'string' ? { firstId: DeepSeekFileId(wire.first_id) } : {},
            ...typeof wire.last_id === 'string' ? { lastId: DeepSeekFileId(wire.last_id) } : {},
            hasMore: wire.has_more,
        };
    }
    /**
     * Retrieve one file object.
     * @param fileId - provider file identifier.
     * @param signal - request cancellation.
     * @returns the validated file object.
     */
    async retrieve(fileId, signal) {
        const response = await this.request(`/files/${encodeURIComponent(fileId)}`, { method: 'GET' }, signal);
        return parseFileObject(await response.json(), 'retrieve');
    }
    /**
     * Delete one provider file.
     * @param fileId - provider file identifier.
     * @param signal - request cancellation.
     */
    async delete(fileId, signal) {
        const response = await this.request(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, signal);
        const value = await response.json();
        if (value === null || typeof value !== 'object' || Array.isArray(value))
            throw invalidResponse('delete');
        const wire = value;
        if (wire.id !== fileId || wire.object !== 'file' || wire.deleted !== true)
            throw invalidResponse('delete');
    }
}
