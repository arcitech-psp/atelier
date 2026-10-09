/** Browser caller for generic Connection unary RPC channels. */
import { RpcId, } from "../rpc.js";
import { randomUuid } from "./random-uuid.js";
const INTERNAL_BASE = 'http://dsh.internal';
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/;
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
/**
 * Create the browser-backed generic RPC caller.
 * @param doFetch - transport override; defaults to the page's global fetch.
 * @param openStream - optional worker-local Gateway stream carrier.
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createWebConnectionRpc(doFetch, openStream) {
    const send = doFetch ?? ((input, init) => globalThis.fetch(input, init));
    return {
        async call(channel, endpoint, payload, signal) {
            assertTarget(channel, endpoint);
            const rpcId = RpcId(randomUuid());
            const message = {
                type: 'client-request',
                rpcId,
                method: endpoint,
                payload,
            };
            const response = await send(new URL(`${channel}/${endpoint}`, resolveBase()), {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(message),
                ...signal === undefined ? {} : { signal },
            });
            if (!response.ok) {
                throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`);
            }
            const full = parseConnectionResponse(await response.json());
            if (full.rpcId !== rpcId) {
                throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`);
            }
            return full.result;
        },
        ...openStream === undefined ? {} : {
            open(channel, endpoint, payload, signal) {
                assertTarget(channel, endpoint);
                if (channel !== '/api') {
                    throw new Error(`connection: worker-local streams require the /api channel, got ${JSON.stringify(channel)}`);
                }
                return openStream(endpoint, payload, signal);
            },
        },
    };
}
function parseConnectionResponse(value) {
    if (!isRecord(value) || value.type !== 'server-response' || typeof value.rpcId !== 'string') {
        throw new TypeError('connection: invalid server-response envelope');
    }
    const result = value.result;
    if (!isRecord(result))
        throw new TypeError('connection: invalid server-response result');
    if (result.ok === true) {
        return {
            rpcId: RpcId(value.rpcId),
            result: { ok: true, value: result.value },
        };
    }
    if (result.ok !== false || !isRecord(result.error)) {
        throw new TypeError('connection: invalid server-response result');
    }
    const error = result.error;
    if (typeof error.code !== 'string' || typeof error.message !== 'string' || !isRecord(error.details)) {
        throw new TypeError('connection: invalid server-response failure');
    }
    return {
        rpcId: RpcId(value.rpcId),
        result: {
            ok: false,
            error: { code: error.code, message: error.message, details: error.details },
        },
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function resolveBase() {
    const location = globalThis.location;
    return location?.origin !== undefined && location.origin !== 'null' ? location.origin : INTERNAL_BASE;
}
function assertTarget(channel, endpoint) {
    const segments = endpoint.split('/');
    if (!CHANNEL_PATTERN.test(channel)
        || segments.some(segment => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
        throw new Error(`connection: invalid RPC target ${JSON.stringify(`${channel}/${endpoint}`)}`);
    }
}
