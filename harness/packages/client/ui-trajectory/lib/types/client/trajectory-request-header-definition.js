import { trajectoryNode } from "./trajectory-definition-common.js";
/**
 * Request-header fact Definition for the Trajectory target.
 * @param inspect - the shared prompt interpretation, supplied by the
 * uiConversation service (a client bundle cannot value-import it).
 * @returns the Trajectory request-header Definition.
 */
function trajectoryRequestHeaderDefinition(inspect) {
    return {
        kind: 'trajectory-request-header',
        target: 'trajectory',
        match: event => event.type === 'request/header'
            ? { id: String(event.seq), role: 'start' }
            : null,
        start: (_context, match, reader) => {
            if (match.event.type !== 'request/header') {
                throw new Error('trajectory-request-header start requires request/header');
            }
            const previous = reader.previous('trajectory-request-header')
                ?.state.prompt;
            const { prompt, change } = inspect(previous, match.event);
            return {
                seq: match.event.seq,
                time: match.event.time,
                prompt,
                location: match.location,
                ...(change === undefined ? {} : { change }),
            };
        },
        update: context => context.state,
        buildViewNode: context => context.state === undefined
            ? null
            : trajectoryNode(context, context.state.seq, {
                kind: 'request-header',
                header: context.state,
            }),
    };
}
/**
 * Register Trajectory request-header facts.
 *
 * @param ctx - Plugin context receiving the Definition.
 */
export function registerTrajectoryRequestHeaderDefinition(ctx) {
    ctx.uiConversation.events.register(trajectoryRequestHeaderDefinition((previous, event) => ctx.uiConversation.inspectRequestPrompt(previous, event)));
}
