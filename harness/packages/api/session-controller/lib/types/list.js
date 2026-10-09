/** Cold-safe Session list and search projection. */
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
import { stat } from 'node:fs/promises';
import { SessionQueryError } from '@deepseek-ai/dsh-session-query';
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { SESSION_SEARCH_RESULT_LIMIT, SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS, } from "./types.js";
/** Default maximum artifact size eligible for one cold projection observation. */
export const DEFAULT_COLD_BLANK_PROBE_MAX_BYTES = 1024;
const COLD_SUMMARY_BATCH_SIZE = 1024;
const COLD_SUMMARY_CACHE_LIMIT = 4096;
const SEARCH_PROVIDER_CALL_LIMIT = 100;
const SESSION_SEARCH_QUERY_MAX_CHARS = 500;
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message']);
const sessionListMetadataSchema = z.object({
    blank: z.boolean(),
    lastPromptAt: z.number().nullable(),
});
const imageLimitsSchema = z.object({
    maxImageBytes: z.number().int().positive(),
    maxImagesPerMessage: z.number().int().positive(),
    maxMessageImageBytes: z.number().int().positive(),
    maxImagePixels: z.number().int().positive(),
    maxImageDimension: z.number().int().positive(),
    mediaTypes: z.array(z.string()),
});
/**
 * Advance the Session-list metadata projection by one committed event.
 * @param state - metadata before the event.
 * @param event - next committed Session event.
 * @returns the original or advanced metadata value.
 */
export function applySessionListMetadata(state, event) {
    const blank = state.blank && event.type !== 'turn/start';
    const lastPromptAt = event.type === 'user/message' && event.data.source.kind === 'user'
        ? event.time
        : state.lastPromptAt;
    return blank === state.blank && lastPromptAt === state.lastPromptAt
        ? state
        : { blank, lastPromptAt };
}
/**
 * Return the longest prefix containing at most `maximum` Unicode code points.
 * @param value - source text.
 * @param maximum - maximum number of Unicode code points.
 * @returns the source text or its longest allowed prefix.
 */
export function truncateUnicodeCodePoints(value, maximum) {
    let count = 0;
    let end = 0;
    for (const codePoint of value) {
        if (count === maximum)
            return value.slice(0, end);
        count++;
        end += codePoint.length;
    }
    return value;
}
/** Owns list projection registration, bounded cold summaries, and authorized search. */
export class ApiSessionList {
    ctx;
    coldBlankProbeMaxBytes;
    cachedItems;
    coldSummaryCache = new Map();
    /**
     * @param ctx - Host context carrying Session, query, persistence, and projection services.
     * @param coldBlankProbeMaxBytes - maximum physical artifact size eligible for a full observation.
     */
    constructor(ctx, coldBlankProbeMaxBytes) {
        this.ctx = ctx;
        this.coldBlankProbeMaxBytes = coldBlankProbeMaxBytes;
        const invalidate = () => { this.cachedItems = undefined; };
        ctx.on('session/created', invalidate);
        ctx.on('session/disposed', invalidate);
        ctx.on('session/event', invalidate);
        ctx.on('agent/status', invalidate);
        ctx.inject(['sessionProjections'], (projectionCtx) => {
            projectionCtx.sessionProjections.register({
                key: 'sessionListMetadata',
                stateSchema: sessionListMetadataSchema,
                init: () => ({ blank: true, lastPromptAt: null }),
                apply: applySessionListMetadata,
                wire: { viewSchema: sessionListMetadataSchema, view: state => state },
                stateVersion: 1,
            });
        });
        ctx.inject(['sessionProjections', 'attachments'], (projectionCtx) => {
            projectionCtx.sessionProjections.register({
                key: 'imageLimits',
                stateSchema: z.null(),
                init: () => null,
                apply: state => state,
                wire: {
                    viewSchema: imageLimitsSchema,
                    view: () => projectionCtx.attachments.imageLimits,
                },
                stateVersion: 1,
            });
        });
    }
    /**
     * Build one current attached-Session summary.
     * @param session - attached Session to summarize.
     * @returns current list metadata and available projections.
     */
    summaryFor(session) {
        const projections = this.projectionsFor(session.header, session);
        const metadata = projections?.values.sessionListMetadata;
        return {
            sessionId: session.id,
            updatedAt: updatedAt(session.header, metadata),
            running: this.ctx.agents.get(session.id)?.status === 'running',
            blank: metadata?.blank ?? session.seq === 0,
            ...listFields(session.header),
            ...(projections === undefined ? {} : { projections }),
        };
    }
    /**
     * Read renderable attached and persisted Sessions without activating an Agent.
     * Blank and archived rows are omitted except for the selected Session;
     * subagent rows use their parent's catalog and are never top-level rows.
     * Stable results are reused until a Session or Agent event changes a summary.
     * @param currentSessionId - optional selected blank row to retain.
     * @param signal - optional cancellation for persistence reads.
     * @returns visible Session summaries ordered by activity.
     */
    async list(currentSessionId, signal) {
        signal?.throwIfAborted();
        let allItems = this.cachedItems;
        if (allItems === undefined) {
            const items = [];
            const cold = [];
            const registry = this.ctx.get('workspaceRegistry');
            const catalog = registry?.listSessionHeaders();
            const headers = catalog === undefined || catalog.length === 0
                ? (await this.ctx.sessionQuery.listSessions(signal)).map(record => record.header)
                : catalog;
            signal?.throwIfAborted();
            const candidates = new Map(headers.map(header => [header.id, header]));
            for (const session of this.ctx.sessions.list())
                candidates.set(session.id, session.header);
            const archived = new Set(registry?.archivedSessionIds ?? []);
            for (const header of candidates.values()) {
                if (header.origin === 'subagent')
                    continue;
                if (archived.has(header.id))
                    continue;
                const live = this.ctx.sessions.get(header.id);
                if (live !== undefined) {
                    items.push(this.summaryFor(live));
                    continue;
                }
                cold.push(header);
            }
            if (this.coldBlankProbeMaxBytes === 0) {
                for (const header of cold) {
                    signal?.throwIfAborted();
                    const live = this.ctx.sessions.get(header.id);
                    items.push(live === undefined
                        ? this.coldSummary(header, this.projectionsFor(header, undefined))
                        : this.summaryFor(live));
                }
            }
            else {
                for (let offset = 0; offset < cold.length; offset += COLD_SUMMARY_BATCH_SIZE) {
                    const settled = await Promise.allSettled(cold.slice(offset, offset + COLD_SUMMARY_BATCH_SIZE)
                        .map(header => this.summarizeCold(header, signal)));
                    for (const result of settled) {
                        if (result.status === 'rejected')
                            throw result.reason;
                        items.push(result.value);
                    }
                }
            }
            items.sort((left, right) => right.updatedAt - left.updatedAt);
            this.cachedItems = items;
            allItems = items;
        }
        const archived = new Set(this.ctx.get('workspaceRegistry')?.archivedSessionIds ?? []);
        return allItems.filter(item => item.origin !== 'subagent'
            && (!item.blank || item.sessionId === currentSessionId)
            && !archived.has(item.sessionId));
    }
    async summarizeCold(header, signal) {
        const cached = this.projectionsFor(header, undefined);
        // Once a checkpoint says a Session is nonblank, no cold observation can
        // change its navigation visibility. Avoid a per-row filesystem stat.
        if (cached?.values.sessionListMetadata?.blank === false) {
            const raced = this.ctx.sessions.get(header.id);
            return raced === undefined ? this.coldSummary(header, cached) : this.summaryFor(raced);
        }
        if (this.coldBlankProbeMaxBytes === 0) {
            const raced = this.ctx.sessions.get(header.id);
            if (raced !== undefined)
                return this.summaryFor(raced);
            return this.coldSummary(header, cached);
        }
        let summary;
        const location = this.ctx.get('sessionPersistence')?.locate(header);
        if (location !== undefined) {
            try {
                const identity = await stat(location.path, { bigint: true });
                const size = identity.size.toString();
                const mtimeNs = identity.mtimeNs.toString();
                const prior = this.coldSummaryCache.get(header.id);
                if (prior?.size === size && prior.mtimeNs === mtimeNs) {
                    // Refresh insertion order for the bounded LRU cache.
                    this.coldSummaryCache.delete(header.id);
                    this.coldSummaryCache.set(header.id, prior);
                    summary = prior.summary;
                }
                else {
                    const projections = this.coldBlankProbeMaxBytes === 0
                        || identity.size > BigInt(this.coldBlankProbeMaxBytes)
                        ? cached
                        : await this.probeSmallCold(header, signal)
                            ?? cached;
                    summary = this.coldSummary(header, projections);
                    this.coldSummaryCache.delete(header.id);
                    this.coldSummaryCache.set(header.id, { size, mtimeNs, summary });
                    if (this.coldSummaryCache.size > COLD_SUMMARY_CACHE_LIMIT) {
                        const oldest = this.coldSummaryCache.keys().next().value;
                        if (oldest !== undefined)
                            this.coldSummaryCache.delete(oldest);
                    }
                }
            }
            catch {
                signal?.throwIfAborted();
            }
        }
        const raced = this.ctx.sessions.get(header.id);
        if (raced !== undefined)
            return this.summaryFor(raced);
        return summary ?? this.coldSummary(header, cached);
    }
    coldSummary(header, projections) {
        const metadata = projections?.values.sessionListMetadata;
        return {
            sessionId: header.id,
            updatedAt: updatedAt(header, metadata),
            running: false,
            // A large or inaccessible cache miss remains unknown and visible.
            blank: metadata?.blank ?? false,
            ...listFields(header),
            ...(projections === undefined ? {} : { projections }),
        };
    }
    async probeSmallCold(header, signal) {
        if (this.coldBlankProbeMaxBytes === 0)
            return undefined;
        const persistence = this.ctx.get('sessionPersistence');
        const location = persistence?.locate(header);
        if (location === undefined)
            return undefined;
        signal?.throwIfAborted();
        try {
            if ((await stat(location.path)).size > this.coldBlankProbeMaxBytes)
                return undefined;
        }
        catch {
            signal?.throwIfAborted();
            return undefined;
        }
        try {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const observation = __addDisposableResource(env_1, await this.ctx.sessionQuery.observeSession(header.id, {
                    ...(signal === undefined ? {} : { signal }),
                    projectionMode: 'all',
                }), false);
                const block = observation.projections;
                return block === undefined
                    ? undefined
                    : { asOfSeq: block.asOfSeq, values: block.values };
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources(env_1);
            }
        }
        catch (error) {
            signal?.throwIfAborted();
            this.ctx.logger.warn(`api-session.list: small cold observation for "${header.id}" failed; serving it as visible: ${String(error)}`);
            return undefined;
        }
    }
    /**
     * Search current visible message content without activating any matching Session.
     * @param query - literal message-content query.
     * @param signal - cancellation for list and search reads.
     * @returns authorized bounded Session search results.
     */
    async search(query, signal) {
        const normalizedQuery = normalizeSearchQuery(query);
        signal.throwIfAborted();
        const provider = this.ctx.get('sessionQuery');
        if (provider === undefined) {
            reject('internal', 'session search is unavailable: this deployment does not mount @deepseek-ai/dsh-session-query', {});
        }
        try {
            const visible = await provider.listSessions(signal);
            signal.throwIfAborted();
            const visibleIds = new Set(visible
                .filter(record => record.header.cwd !== undefined)
                .map(record => record.header.id));
            if (visibleIds.size === 0)
                return { items: [], hasMore: false };
            const authorized = [];
            const acceptedIds = new Set();
            const seenCursors = new Set();
            let cursor;
            let providerCalls = 0;
            let pageLimit = SESSION_SEARCH_RESULT_LIMIT;
            while (authorized.length <= SESSION_SEARCH_RESULT_LIMIT) {
                signal.throwIfAborted();
                if (providerCalls >= SEARCH_PROVIDER_CALL_LIMIT) {
                    throw new Error(`session search provider exceeded the ${SEARCH_PROVIDER_CALL_LIMIT}-call work budget`);
                }
                providerCalls++;
                const requestedCursor = cursor;
                const requestedLimit = pageLimit;
                let page;
                try {
                    page = await provider.searchSessions({
                        query: normalizedQuery,
                        eventFilters: [
                            { kind: 'type', values: ['user/message', 'assistant/message'] },
                            { kind: 'surface', values: ['current'] },
                        ],
                        limit: requestedLimit,
                        ...(requestedCursor === undefined ? {} : { cursor: requestedCursor }),
                    }, { signal });
                    signal.throwIfAborted();
                }
                catch (error) {
                    signal.throwIfAborted();
                    if (requestedCursor === undefined
                        && error instanceof SessionQueryError
                        && error.code === 'SESSION_QUERY_INVALID_LIMIT'
                        && requestedLimit > 1) {
                        pageLimit = Math.max(1, Math.floor(requestedLimit / 2));
                        continue;
                    }
                    if (requestedCursor !== undefined
                        && error instanceof SessionQueryError
                        && error.code === 'SESSION_QUERY_STALE_CURSOR') {
                        authorized.length = 0;
                        acceptedIds.clear();
                        seenCursors.clear();
                        cursor = undefined;
                        continue;
                    }
                    throw error;
                }
                if (page.items.length > requestedLimit) {
                    throw new Error(`session search provider returned ${String(page.items.length)} items; maximum is ${String(requestedLimit)}`);
                }
                for (const hit of page.items) {
                    if (authorized.length > SESSION_SEARCH_RESULT_LIMIT)
                        continue;
                    if (!visibleIds.has(hit.header.id)
                        || hit.bestMatch.sessionId !== hit.header.id
                        || hit.bestMatch.surface !== 'current'
                        || !MESSAGE_TYPES.has(hit.bestMatch.type)
                        || acceptedIds.has(hit.header.id))
                        continue;
                    acceptedIds.add(hit.header.id);
                    authorized.push({
                        sessionId: hit.header.id,
                        snippet: truncateUnicodeCodePoints(hit.bestMatch.snippet, SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS),
                    });
                }
                if (page.nextCursor !== undefined) {
                    if (seenCursors.has(page.nextCursor)) {
                        throw new Error('session search provider repeated a continuation cursor');
                    }
                    seenCursors.add(page.nextCursor);
                }
                if (authorized.length > SESSION_SEARCH_RESULT_LIMIT || page.nextCursor === undefined)
                    break;
                cursor = page.nextCursor;
            }
            return {
                items: authorized.slice(0, SESSION_SEARCH_RESULT_LIMIT),
                hasMore: authorized.length > SESSION_SEARCH_RESULT_LIMIT,
            };
        }
        catch (error) {
            signal.throwIfAborted();
            if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED') {
                reject('cancelled', 'session search was aborted', {});
            }
            reject('internal', `session search failed: ${String(error)}`, {});
        }
    }
    projectionsFor(header, session) {
        try {
            const block = session === undefined
                ? this.ctx.get('sessionProjectionCache')?.cachedSnapshot(header)
                : this.ctx.get('sessionProjections')?.cachedSnapshot(session);
            return block !== undefined && Object.keys(block.values).length > 0
                ? {
                    asOfSeq: block.asOfSeq,
                    // Listing hints contain every currently cached wire value but remain
                    // partial: missing cells and cache rows are never materialized here.
                    values: block.values,
                }
                : undefined;
        }
        catch (error) {
            this.ctx.logger.warn(`api-session.list: projection column for "${header.id}" failed; serving the row without it: ${String(error)}`);
            return undefined;
        }
    }
}
function normalizeSearchQuery(query) {
    const normalized = query.trim();
    if (normalized.length === 0) {
        reject('bad-request', 'session search query must not be empty', {});
    }
    if (normalized.length > SESSION_SEARCH_QUERY_MAX_CHARS) {
        reject('bad-request', `session search query must contain at most ${SESSION_SEARCH_QUERY_MAX_CHARS} UTF-16 code units`, {});
    }
    if (normalized.includes('\0')) {
        reject('bad-request', 'session search query must not contain NUL', {});
    }
    return normalized;
}
function reject(code, message, details) {
    throw new TypertRemoteFailure({ code, message, details });
}
function updatedAt(header, metadata) {
    return Math.max(header.createdAt, metadata?.lastPromptAt ?? 0);
}
function listFields(header) {
    return {
        ...(header.parentSession === undefined ? {} : { parentSessionId: header.parentSession }),
        ...(header.origin === undefined ? {} : { origin: header.origin }),
        ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    };
}
