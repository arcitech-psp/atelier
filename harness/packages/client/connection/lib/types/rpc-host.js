/** Host registry and HTTP adapter for generic Connection RPC channels. */
import { Service } from '@deepseek-ai/cordis';
import { RpcId, } from "./rpc.js";
import { clientRequestSchema } from "./rpc-schema.js";
import { bridge } from "./http-bridge.js";
import { isTrustedApiRequest } from "./api-request-trust.js";
import { API_PATH } from "./api-path.js";
const INVALID_REQUEST_RPC_ID = RpcId('invalid-request');
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/;
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
/** Host Connection service whose channel registrations belong to the caller fiber. */
export class HostConnectionService extends Service {
    trustedHosts;
    browserAuth;
    interceptors = new Map();
    fetchRoutes = new Map();
    /**
     * Provide the Host half over the active HTTP server.
     * @param ctx - owning Connection plugin context.
     * @param trustedHosts - deployment authorities accepted by the Host/Origin fence.
     * @param browserAuth - process token and persistent browser-session owner.
     */
    constructor(ctx, trustedHosts, browserAuth) {
        super(ctx, 'connection');
        this.trustedHosts = trustedHosts;
        this.browserAuth = browserAuth;
    }
    /** Generic channel registry scoped to the Context reading this service. */
    get rpc() {
        const owner = this.ctx;
        return {
            handle: (channel, handler) => this.register(owner, channel, handler),
            intercept: (channel, matches, handler) => this.registerInterceptor(owner, channel, matches, handler),
        };
    }
    /** Exact Fetch-route registry scoped to the Context reading this service. */
    get fetch() {
        const owner = this.ctx;
        return {
            register: route => this.registerFetchRoute(owner, route),
        };
    }
    /** Apply the configured Host/Origin fence, then browser authentication. */
    requestRejection(request) {
        if (!isTrustedApiRequest(request, this.trustedHosts))
            return 403;
        return this.browserAuth.isAuthenticated(request) ? undefined : 401;
    }
    /** Authenticate an index request through the process-token exchange or cookie. */
    authorizeIndex(request, response) {
        return this.browserAuth.authorizeIndex(request, response);
    }
    /** Add this process's launch token to the clean application URL. */
    authenticatedUrl(baseUrl) {
        return this.browserAuth.authenticatedUrl(baseUrl);
    }
    /**
     * Compose one shared-channel Fetch handler from exact routes and its interceptor.
     * @param channel - shared channel mounted by Connection.
     * @returns Fetch handler that selects one owner or returns 404.
     */
    createSharedFetchHandler(channel) {
        return {
            fetch: (request) => {
                const pathname = new URL(request.url).pathname;
                const route = this.fetchRoutes.get(pathname);
                if (route?.methods.has(request.method) === true)
                    return route.fetch(request);
                const endpoint = endpointFromPath(channel, pathname);
                const interceptor = this.interceptors.get(channel);
                if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
                    return Promise.resolve(new Response('not found', { status: 404 }));
                }
                return interceptor.fetchHandler.fetch(request);
            },
        };
    }
    registerFetchRoute(owner, route) {
        assertFetchRoute(route);
        const registered = {
            methods: new Set(route.methods),
            fetch: route.fetch,
        };
        return owner.effect(() => {
            if (this.fetchRoutes.has(route.path)) {
                throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`);
            }
            this.fetchRoutes.set(route.path, registered);
            return () => { this.fetchRoutes.delete(route.path); };
        }, `client-connection: ${route.path} Fetch route`);
    }
    register(owner, channel, handler) {
        assertChannel(channel);
        const fetchHandler = rpcFetchHandler(channel, handler);
        const route = {
            kind: 'prefix',
            path: channel,
            handler: async (req, res) => {
                const rejection = this.requestRejection(req);
                if (rejection !== undefined) {
                    res.writeHead(rejection);
                    res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
                    return;
                }
                await bridge(req, res, fetchHandler);
            },
        };
        return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`);
    }
    registerInterceptor(owner, channel, matches, handler) {
        if (channel !== API_PATH) {
            throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`);
        }
        const interceptor = {
            matches,
            fetchHandler: rpcFetchHandler(channel, handler),
        };
        return owner.effect(() => {
            if (this.interceptors.has(channel)) {
                throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`);
            }
            this.interceptors.set(channel, interceptor);
            return () => {
                this.interceptors.delete(channel);
            };
        }, `client-connection: ${channel} rpc interceptor`);
    }
}
function rpcFetchHandler(channel, handler) {
    return {
        async fetch(request) {
            const endpoint = endpointFromPath(channel, new URL(request.url).pathname);
            if (request.method !== 'POST' || endpoint === undefined) {
                return new Response('not found', { status: 404 });
            }
            const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
            if (mediaType !== 'application/json') {
                return new Response('content type must be application/json', { status: 415 });
            }
            let body;
            try {
                body = await request.json();
            }
            catch {
                return new Response('body is not JSON', { status: 400 });
            }
            const envelope = clientRequestSchema.safeParse(body);
            if (!envelope.success) {
                return invalidEnvelopeResponse(body, envelope.error.issues);
            }
            const message = envelope.data;
            if (message.method !== endpoint) {
                return errorResponse(message.rpcId, {
                    code: 'bad-request',
                    message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
                    details: { issues: [] },
                });
            }
            try {
                const result = await handler(endpoint, message.payload, request.signal);
                return fullResponse(message.rpcId, result);
            }
            catch (error) {
                return new Response(`handler failure: ${String(error)}`, { status: 500 });
            }
        },
    };
}
function invalidEnvelopeResponse(body, issues) {
    const rawId = body?.rpcId;
    const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID;
    return errorResponse(rpcId, {
        code: 'bad-request',
        message: 'invalid client-request message',
        details: { issues },
    });
}
function endpointFromPath(channel, pathname) {
    if (!pathname.startsWith(`${channel}/`))
        return undefined;
    const endpoint = pathname.slice(channel.length + 1);
    const segments = endpoint.split('/');
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
        return undefined;
    }
    return endpoint;
}
function errorResponse(rpcId, error) {
    return fullResponse(rpcId, { ok: false, error });
}
function fullResponse(rpcId, result) {
    const body = { type: 'server-response', rpcId, result };
    return Response.json(body);
}
function assertChannel(channel) {
    if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
        throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`);
    }
}
function assertFetchRoute(route) {
    if (endpointFromPath(API_PATH, route.path) === undefined) {
        throw new Error(`connection: invalid exact Fetch route ${JSON.stringify(route.path)}`);
    }
    if (route.methods.length === 0) {
        throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} declares no methods`);
    }
    const methods = new Set(route.methods);
    if (methods.size !== route.methods.length) {
        throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} repeats a method`);
    }
}
