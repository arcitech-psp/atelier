/** Session-log download command and Host-owned streaming route. */
import Schema from '@deepseek-ai/schemastery';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import { DEFAULT_SESSION_LOG_COMPRESSION_LEVEL, flushLiveSessionLog, sessionLogExportDeps, sessionLogZipFilename, streamSessionLogZip, } from "./archive.js";
export { DEFAULT_SESSION_LOG_COMPRESSION_LEVEL, flushLiveSessionLog, sessionLogExportDeps, sessionLogZipEntries, sessionLogZipFilename, streamSessionLogZip, } from "./archive.js";
export const name = 'session-log-download';
export const inject = ['commands', 'connection'];
/** Stable browser download path retained across the transport migration. */
export const SESSION_LOG_EXPORT_PATH = '/api/session.export';
/** Validate Session-log archive configuration. */
export const Config = Schema.object({
    compressionLevel: Schema.number().step(1).min(0).max(9)
        .default(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL),
});
const REQUESTED = {
    kind: 'success',
    text: 'Session log download requested.',
};
/**
 * Register the Web-only `/export` command and authenticated ZIP download route.
 * @param ctx - Host context carrying the human-command registry.
 * @param config - resolved compression policy.
 */
export function apply(ctx, config = {}) {
    ctx.effect(() => ctx.commands.register({
        name: 'export',
        description: 'Download this Session log as a ZIP archive',
        handler: invocation => Promise.resolve(invocation.rawInput.trim() === ''
            ? REQUESTED
            : { kind: 'error', text: 'The Web /export command does not accept a path.' }),
    }), 'session-log-download: command');
    connectionOf(ctx).fetch.register({
        path: SESSION_LOG_EXPORT_PATH,
        methods: ['GET', 'HEAD'],
        fetch: async (request) => {
            const response = await sessionLogExportResponse(ctx, request, config.compressionLevel ?? DEFAULT_SESSION_LOG_COMPRESSION_LEVEL);
            if (request.method === 'GET')
                return response;
            await response.body?.cancel();
            return new Response(null, { status: response.status, headers: response.headers });
        },
    });
}
function connectionOf(ctx) {
    return Reflect.get(ctx, 'connection');
}
async function sessionLogExportResponse(ctx, request, compressionLevel) {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams);
    const sessionIdValue = query['sessionId'];
    const descendantsValue = query['includeDescendants'];
    if (sessionIdValue === undefined || sessionIdValue.length === 0
        || (descendantsValue !== undefined && descendantsValue !== 'true' && descendantsValue !== 'false')) {
        return new Response('missing or invalid sessionId query parameter', { status: 400 });
    }
    const sessionId = SessionId(sessionIdValue);
    const deps = sessionLogExportDeps(ctx);
    if (deps.sessionQuery === undefined
        || deps.sessionPersistence === undefined
        || deps.attachments === undefined) {
        return new Response('session log export is unavailable: missing session-query, session-persistence, or attachments service', { status: 500 });
    }
    if (!deps.sessionPersistence.supportsRawArtifacts) {
        return new Response('session log export is unavailable: the persistence backend does not expose per-session raw artifacts', { status: 501 });
    }
    const ready = {
        sessionQuery: deps.sessionQuery,
        sessionPersistence: deps.sessionPersistence,
        attachments: deps.attachments,
        sessions: deps.sessions,
    };
    let root;
    try {
        await flushLiveSessionLog(deps, sessionId, request.signal);
        root = await deps.sessionPersistence.readRaw(sessionId, request.signal);
        request.signal.throwIfAborted();
    }
    catch {
        request.signal.throwIfAborted();
        return new Response('session log export failed to prepare the stored artifact', { status: 500 });
    }
    if (root === undefined)
        return new Response('session not found', { status: 404 });
    const response = new Response(streamSessionLogZip(ready, root, sessionId, descendantsValue === 'true', compressionLevel, request.signal), {
        headers: {
            'content-type': 'application/zip',
            'content-disposition': `attachment; filename="${sessionLogZipFilename(sessionId)}"`,
        },
    });
    return response;
}
