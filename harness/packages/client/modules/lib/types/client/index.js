import { ClientModuleSystem } from "./system.js";
import { parseBootManifest } from "./manifest.js";
export { ClientModuleSystem };
export { parseBootManifest, stripClientSuffix } from "./manifest.js";
let moduleSystem;
/**
 * Build the live module system from the HTML facade's materialized modules bundle.
 * @param target - Stable registration facade whose pending queue becomes the live sink.
 * @param bootstrapModule - This bundle's id and already-materialized exports.
 * @param options - Raw boot graph, platform seed, and optional bundle transport.
 * @returns The created module system, also published for this package's Cordis plugin face.
 */
export function createClientModuleSystem(target, bootstrapModule, options) {
    moduleSystem = new ClientModuleSystem({
        manifest: parseBootManifest(options.boot),
        staticModules: options.staticModules,
        registrationTarget: target,
        bootstrapModule,
        ...(options.loadBundle === undefined ? {} : { loadBundle: options.loadBundle }),
    });
    return moduleSystem;
}
/**
 * Enroll the kernel-built module system as `ctx.modules`.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    if (moduleSystem === undefined) {
        throw new Error('client-modules: createClientModuleSystem must run before plugin boot');
    }
    ctx.reflect.provide('modules', moduleSystem);
}
