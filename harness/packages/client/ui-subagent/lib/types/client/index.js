import { SubagentHeaderLineage } from "./SubagentHeaderLineage.js";
import { SubagentReadOnlyComposer, } from "./SubagentReadOnlyComposer.js";
import { en, NS, zh } from "./locales.js";
/** Required services for conversation slots and session navigation. */
export const inject = ['sessions', 'slots', 'locale'];
/** Claim the composer for one-shot history or an unavailable continuation owner. */
function selectReadOnlySubagent(owner) {
    const subagent = owner.session?.subagent;
    if (subagent === undefined || subagent === null)
        return null;
    if (subagent.address.mode === 'one-shot')
        return { reason: 'one-shot' };
    // The parent catalog is fetched ahead of the selected Session. Until it
    // resolves, leave the normal disabled composer in place instead of briefly
    // claiming that the parent is offline.
    if (subagent.parentAvailable !== false)
        return null;
    // A RUNNING parent-offline continuable child keeps the default composer:
    // its input is disabled there, but the same primary Stop stays available so
    // the child can be interrupted. Once it stops, this takeover returns.
    return owner.session?.running === true ? null : { reason: 'parent-unavailable' };
}
/**
 * Client plugin body: register the subagent catalog and read-only composer seats.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-subagent: dictionaries');
    const sessions = ctx.sessions;
    const catalogActions = (_parentSessionId) => ({
        openChild(address) {
            sessions.openSubagent(address);
        },
        refresh(parentSessionId) {
            void sessions.refreshSubagents(parentSessionId);
        },
        setCatalogOpen(parentSessionId, open) {
            sessions.setSubagentCatalogOpen(parentSessionId, open);
        },
    });
    ctx.slots.inject('conversation.session.header.lineage', () => ctx.slots.register({
        name: 'conversation.session.header.lineage',
        locale: NS,
        inject: catalogActions,
    }, SubagentHeaderLineage));
    ctx.slots.inject('conversation.composer', () => ctx.slots.register({
        name: 'conversation.composer',
        priority: -10,
        locale: NS,
        select: selectReadOnlySubagent,
    }, SubagentReadOnlyComposer));
}
