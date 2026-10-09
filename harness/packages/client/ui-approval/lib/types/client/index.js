import { ApprovalPanel } from "./ApprovalPanel.js";
import { PendingApproval } from "./contract/slots.js";
import { en, zh } from "./locales.js";
/** Required services: Agent scopes, Remote Events, Session UI, Slot registry, and copy. */
export const inject = ['sessions', 'remote', 'uiSession', 'slots', 'locale'];
const NS = 'approval';
/* jscpd:ignore-start -- Approval and Question intentionally mirror one Remote waterfall lifecycle. */
/** Present one request until the user answers or its lifetime ends. */
async function answerApproval(ctx, owner, request, next, registerPendingInteraction) {
    const sessionId = ctx.sessions.scopeOf(owner);
    if (sessionId === undefined)
        return next();
    const pending = new PendingApproval(sessionId, {
        toolName: request.toolName,
        ...(request.callId === undefined
            ? {}
            : { callId: request.callId }),
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const completed = Promise.withResolvers();
    const remove = registerPendingInteraction(pending, async () => {
        pending.delegate();
        await completed.promise;
    });
    try {
        try {
            return await pending.result;
        }
        catch (error) {
            if (pending.isDelegation(error))
                return await next();
            throw error;
        }
    }
    finally {
        remove();
        completed.resolve();
    }
}
/* jscpd:ignore-end */
/**
 * Install approval copy and the scoped waterfall consumer.
 * @param ctx - Client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-approval: dictionaries');
    const registerPendingInteraction = ctx.uiSession.registerPendingInteraction(() => 0);
    ctx.slots.inject('conversation.composer', () => ctx.slots.register({
        name: 'conversation.composer',
        priority: 1,
        select: ({ pendingInteraction }) => pendingInteraction instanceof PendingApproval ? pendingInteraction : null,
        locale: NS,
        children: {
            'conversation.approval.detail': { kind: 'single', scope: 'session' },
        },
    }, ApprovalPanel));
    ctx.remote.$on('approval/request', function (request, next) {
        return answerApproval(ctx, this, request, next, registerPendingInteraction);
    });
}
