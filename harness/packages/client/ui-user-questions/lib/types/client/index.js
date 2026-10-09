import { PendingQuestion } from "./contract/slots.js";
import { createQuestionDraftStore } from "./draft-store.js";
import { QuestionComposer } from "./QuestionComposer.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'question';
/** Required services: Agent scopes, Remote Events, Session UI, Slot registry, and copy. */
export const inject = ['sessions', 'remote', 'uiSession', 'slots', 'locale'];
/** Present one request until the user answers, cancels, or its lifetime ends. */
async function answerQuestion(ctx, owner, request, next, registerPendingInteraction) {
    const sessionId = ctx.sessions.scopeOf(owner);
    if (sessionId === undefined)
        return next();
    const pending = new PendingQuestion(sessionId, request.questions, request.signal);
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
/**
 * Client plugin body: register the `question` dictionaries and the question
 * composer into the composer chain. Zero business face — data and verbs live
 * on the matched carrier; t rides the standard locale seat.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-user-questions: dictionaries');
    const questionDraftStore = createQuestionDraftStore();
    const registerPendingInteraction = ctx.uiSession.registerPendingInteraction(pending => pending.kind === 'plan-review' ? 2 : 1);
    ctx.slots.inject('conversation.composer', () => ctx.slots.register({
        name: 'conversation.composer',
        select: ({ pendingInteraction }) => pendingInteraction instanceof PendingQuestion ? pendingInteraction : null,
        locale: NS,
        store: questionDraftStore,
    }, QuestionComposer));
    ctx.remote.$on('user-questions/request', function (request, next) {
        return answerQuestion(ctx, this, request, next, registerPendingInteraction);
    });
}
