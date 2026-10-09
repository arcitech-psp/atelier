import z from '@deepseek-ai/schemastery';
import { API_PATH } from "./api-path.js";
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from "./http-bridge.js";
import { assertTrustedAuthority } from "./api-request-trust.js";
import { BrowserAuth } from "./browser-auth.js";
import { HostConnectionService } from "./rpc-host.js";
export { RpcId, transportError } from "./rpc.js";
export { clientRequestSchema, rpcErrorSchema, rpcIdSchema, rpcMessageSchema, rpcResultSchema, serverResponseSchema, } from "./rpc-schema.js";
export { HostConnectionService } from "./rpc-host.js";
export { API_PATH } from "./api-path.js";
/** Stable Cordis plugin name. */
export const name = 'client-connection';
/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024;
function assertImageBodyCapacity(ctx, maxRequestBodyBytes) {
    const attachments = ctx.get('attachments');
    if (attachments === undefined)
        return;
    const requiredImageBodyBytes = Math.ceil(attachments.imageLimits.maxMessageImageBytes * 4 / 3) + REQUEST_ENVELOPE_HEADROOM_BYTES;
    if (maxRequestBodyBytes < requiredImageBodyBytes) {
        throw new Error(`client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
            + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`);
    }
}
/** Services required before providing Connection. */
export const inject = ['webServer', 'credentials'];
export const Config = z.object({
    trustedHosts: z.array(String).default([]),
    cookieMaxAgeDays: z.natural().min(1).default(30),
    maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
});
/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the Host/Origin browser-trust fence and persistent browser
 * authentication before dispatch.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export async function apply(ctx, config) {
    // The Loader resolves schema defaults; hand-built test contexts may pass none.
    const trustedHosts = config?.trustedHosts ?? [];
    const cookieMaxAgeDays = config?.cookieMaxAgeDays ?? 30;
    const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
    // Config boundary: a malformed entry fails the load loudly here rather than
    // silently authorizing its hostname prefix at request time.
    for (const entry of trustedHosts)
        assertTrustedAuthority(entry);
    assertImageBodyCapacity(ctx, maxRequestBodyBytes);
    const connection = new HostConnectionService(ctx, trustedHosts, await BrowserAuth.create(ctx.root, ctx.credentials, cookieMaxAgeDays));
    const fetchHandler = connection.createSharedFetchHandler(API_PATH);
    const route = {
        kind: 'prefix',
        path: API_PATH,
        handler: async (req, res) => {
            const rejection = connection.requestRejection(req);
            if (rejection !== undefined) {
                res.writeHead(rejection);
                res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
                return;
            }
            await bridge(req, res, fetchHandler, maxRequestBodyBytes);
        },
    };
    ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route');
    ctx.inject(['attachments'], (attachmentCtx) => {
        assertImageBodyCapacity(attachmentCtx, maxRequestBodyBytes);
    });
}
