import { chatNode } from "./common.js";
/** Place a request's system field at the start of its visible message series. */
function requestPromptAnchor(match, previous, isInitial) {
    if (match.location.kind !== 'step')
        return match.event.seq;
    if (previous === undefined && !isInitial)
        return match.event.seq;
    if (previous?.turn === match.location.turn.turn
        && previous.step === match.location.step.step)
        return match.event.seq;
    return match.location.step.step === 1
        ? match.location.turn.start?.seq ?? match.location.step.start?.seq ?? match.event.seq
        : match.location.step.start?.seq ?? match.event.seq;
}
/** Keep an already rendered prompt at its page-lifetime presentation anchor. */
function stableRequestPromptAnchor(context, match, previous, isInitial) {
    const current = context.current.get('chat');
    return current?.kind === 'system-prompt'
        ? current.anchorSeq
        : requestPromptAnchor(match, previous, isInitial);
}
/**
 * Request-header prompt Definition for the Chat target.
 * @param inspect - the shared prompt interpretation, supplied by the
 * uiConversation service (a client bundle cannot value-import it).
 * @returns the Chat request-prompt Definition.
 */
export function requestPromptDefinition(inspect) {
    return {
        kind: 'request-prompt',
        target: 'chat',
        match: event => event.type === 'request/header'
            ? { id: String(event.seq), role: 'start' }
            : null,
        start: (context, match, reader) => {
            if (match.event.type !== 'request/header') {
                throw new Error('request-prompt start requires request/header');
            }
            const previous = reader.previous('request-prompt')?.state;
            const location = match.location.kind === 'step'
                ? { turn: match.location.turn.turn, step: match.location.step.step }
                : {};
            const inspection = inspect(previous?.prompt, match.event);
            const change = inspection.change?.kind;
            return {
                anchorSeq: stableRequestPromptAnchor(context, match, previous, match.event.data.reason === 'initial'),
                showsPrompt: previous === undefined
                    || match.event.data.reason !== 'change'
                    || match.event.data.startsSeries === true
                    || change === 'system'
                    || change === 'system-and-tools',
                ...location,
                ...inspection,
            };
        },
        update: context => context.state,
        buildViewNode: (context) => {
            const state = context.state;
            if (state === undefined || !state.showsPrompt || state.prompt.system === '')
                return null;
            return chatNode(context, 'system-prompt', state.anchorSeq, { text: state.prompt.system });
        },
    };
}
/**
 * Register model-request system prompts in the Chat flow.
 * @param ctx - Owning UI Conversation context.
 */
export function registerRequestPromptConversationNode(ctx) {
    ctx.uiConversation.events.register(requestPromptDefinition((previous, event) => ctx.uiConversation.inspectRequestPrompt(previous, event)));
}
