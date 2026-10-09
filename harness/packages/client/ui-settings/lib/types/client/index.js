import { SettingsSchemaService } from "./schema.js";
import { SettingsScopeBinder } from "./settings-scope.js";
import { SettingsDescribeMirror } from "./settings-mirror.js";
/**
 * Required services: the wire handle for the mirror's reads and the forwarded
 * settings invalidation the mirror refreshes on.
 */
export const inject = ['connection', 'remote', 'remote.settings'];
/**
 * Provide the settings-namespace scope service over one shared describe
 * mirror, and keep that mirror fresh on the two signals that can move the
 * settings document: a document commit and a (re)connect.
 *
 * Constructing the service in this plugin's fiber keeps its traced methods
 * bound to each consuming plugin's context.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    const schema = new SettingsSchemaService(ctx);
    const connection = ctx.get('connection');
    // Captured once here, where `remote.settings` is declared in this plugin's
    // own `inject`; the binder hands the same face to every scope it binds.
    const wire = { settings: ctx.remote.settings };
    const mirror = new SettingsDescribeMirror(wire, connection.isLoopback ? 'host' : 'memory');
    ctx.effect(() => {
        const disposers = [
            ctx.remote.$on('settings/document-updated', () => { void mirror.load(); }),
            ctx.on('connection/reset', () => { void mirror.load(); }),
        ];
        // The first connection also emits connection/reset, so startup normally
        // costs two reads (budgeted in startup-rpc-budget.e2e.ts). The in-flight
        // fold does not merge them into one; it guarantees at most one pending
        // read at a time and that no invalidation arriving mid-read is lost.
        void mirror.ensure();
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'ui-settings: describe mirror invalidations');
    new SettingsScopeBinder(ctx, { mirror, schema, wire });
}
