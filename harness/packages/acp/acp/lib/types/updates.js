/** Standard ACP updates derived from committed DSH session events. */
import { assistantBlockToAcp } from "./content.js";
/**
 * Convert one committed assistant message and its context usage in block order.
 * @param ctx - bridge context carrying attachment and token-meter services.
 * @param session - durable session used for context pressure.
 * @param event - committed assistant message event.
 * @returns ordered standard thought, message, and optional usage updates.
 */
export async function assistantUpdates(ctx, session, event) {
    const updates = [];
    for (const block of event.data.message.content) {
        if (block.type === 'reasoning') {
            if (block.text.length > 0) {
                updates.push({
                    sessionUpdate: 'agent_thought_chunk',
                    messageId: event.data.message.id,
                    content: { type: 'text', text: block.text },
                });
            }
            continue;
        }
        const content = await assistantBlockToAcp(ctx, block);
        if (content !== undefined) {
            updates.push({
                sessionUpdate: 'agent_message_chunk',
                messageId: event.data.message.id,
                content,
            });
        }
    }
    const usage = usageUpdate(ctx, session, event);
    if (usage !== undefined)
        updates.push(usage);
    return updates;
}
/**
 * Start one generic ACP tool lifecycle from the durable call fact.
 * @param event - committed DSH tool-call event.
 * @returns the standard generic tool-call update.
 */
export function toolCallUpdate(event) {
    return {
        sessionUpdate: 'tool_call',
        toolCallId: event.data.callId,
        title: event.data.name,
        kind: 'other',
        status: 'in_progress',
        rawInput: parseToolArguments(event.data.arguments),
    };
}
/**
 * Finish one generic ACP tool lifecycle from its committed model-facing result.
 * @param ctx - bridge context carrying the attachment store.
 * @param event - committed DSH tool-result event.
 * @returns the standard completed or failed tool-call update.
 */
export async function toolResultUpdate(ctx, event) {
    const result = event.data.message.content[0];
    const content = [];
    for (const block of result.content) {
        const converted = await assistantBlockToAcp(ctx, block);
        if (converted !== undefined)
            content.push({ type: 'content', content: converted });
    }
    return {
        sessionUpdate: 'tool_call_update',
        toolCallId: result.toolCallId,
        status: result.isError === true ? 'failed' : 'completed',
        content,
    };
}
/** Report current context occupancy only when DSH has both usage and capacity facts. */
function usageUpdate(ctx, session, event) {
    if (event.data.usage === undefined)
        return undefined;
    const size = session.requestContext()?.contextWindow;
    const meter = ctx.get('tokenMeter');
    if (size === undefined || meter === undefined)
        return undefined;
    return {
        sessionUpdate: 'usage_update',
        used: meter.measure(session).totalTokens,
        size,
    };
}
/** Preserve malformed model output as opaque input instead of dropping the call update. */
function parseToolArguments(value) {
    try {
        return JSON.parse(value);
    }
    catch (_invalidModelJson) {
        return value;
    }
}
