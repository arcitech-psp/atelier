import { ConnectionController, } from "./connection.js";
import { createFixtureConnectionRpc } from "./fixture.js";
import { createWebConnectionRpc } from "./rpc.js";
import { isLoopbackHostname } from "../loopback-hostname.js";
export { RpcId, transportError, } from "./api.js";
/** Required services (none — this is the wire root). */
export const inject = [];
/**
 * Client plugin body: pick the api by page mode and provide ctx.connection.
 * @param ctx - client cordis context.
 */
export function apply(ctx) {
    const pageLocation = typeof location === 'undefined' ? undefined : location;
    const fixture = pageLocation !== undefined && new URLSearchParams(pageLocation.search).has('fixture');
    const fixtureRpc = fixture ? createFixtureConnectionRpc() : undefined;
    const transport = globalThis.__DSH_TRANSPORT__;
    const rpc = fixtureRpc ?? createWebConnectionRpc(transport?.fetch, transport?.openStream);
    let generationSource;
    let owner;
    let generationId = 0;
    let generation;
    const generationListeners = new Set();
    const publishGeneration = (next) => {
        if (Object.is(generation, next))
            return;
        generation = next;
        for (const listener of [...generationListeners]) {
            try {
                listener();
            }
            catch (error) {
                console.error('[connection] generation listener threw:', error);
            }
        }
    };
    const releaseOwner = (current) => {
        if (owner !== current)
            return;
        owner = undefined;
        current.controller.stop();
        publishGeneration(undefined);
    };
    const handle = {
        isLoopback: transport?.ownsHost === true || pageLocation === undefined || isLoopbackHostname(pageLocation.hostname),
        generation: {
            getSnapshot: () => generation,
            subscribe: (listener) => {
                generationListeners.add(listener);
                return () => { generationListeners.delete(listener); };
            },
        },
        rpc,
        registerGenerationSource(source) {
            if (generationSource !== undefined) {
                throw new Error('connection: a generation source is already registered');
            }
            generationSource = source;
            return () => {
                if (generationSource !== source)
                    return;
                generationSource = undefined;
                const current = owner;
                if (current?.source === source)
                    releaseOwner(current);
            };
        },
        start(sinks, config) {
            if (owner !== undefined)
                throw new Error('connection: the stream loop is already owned by another consumer');
            const source = generationSource;
            if (source === undefined)
                throw new Error('connection: no generation source is registered');
            const token = {};
            const ownsGeneration = () => owner?.token === token;
            const controller = new ConnectionController(source, {
                ...sinks,
                onConnected: (host) => {
                    const nextGeneration = { id: ++generationId, host };
                    publishGeneration(nextGeneration);
                    if (!ownsGeneration() || !Object.is(generation, nextGeneration))
                        return;
                    sinks.onConnected?.(host);
                },
                onStateChange: (state) => {
                    if (state === 'reconnecting') {
                        publishGeneration(undefined);
                    }
                    if (!ownsGeneration())
                        return;
                    sinks.onStateChange?.(state);
                },
            }, config ?? {});
            const current = { token, source, controller };
            owner = current;
            controller.start();
            return {
                stop: () => { releaseOwner(current); },
            };
        },
    };
    ctx.provide('connection', handle);
}
