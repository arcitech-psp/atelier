import { ToolCallTree } from "./tool/ToolCallTree.js";
import { ToolDetails } from "./tool/ToolDetails.js";
import { CONVERSATION_NS as NS } from "./locale.js";
import { askQuestionToolview } from "./tool/toolviews/ask-question-row.js";
import { bashToolviewSample } from "./tool/toolviews/bash-sample.js";
import { fileMutationToolview } from "./tool/toolviews/file-mutation-row.js";
import { readToolview } from "./tool/toolviews/read-row.js";
import { searchToolview } from "./tool/toolviews/search-row.js";
import { todoToolview } from "./tool/toolviews/todo-row.js";
import { webToolview } from "./tool/toolviews/web-row.js";
/** Required services: the slot registry and the Host description used for POSIX `~`. */
export const inject = ['slots', 'connection'];
/**
 * Mount the whole-Tool renderers and built-in atomic Tool registrations.
 * @param ctx - Client root context.
 */
export function apply(ctx) {
    const connection = ctx.get('connection');
    const toolInject = () => ({ hooks: { connectionGeneration: connection.generation } });
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
        name: 'conversation.chat.node',
        key: 'tool-call',
        locale: NS,
        children: {
            'tool.call.toolview': { kind: 'keyed', scope: 'session' },
        },
        inject: toolInject,
    }, ToolCallTree));
    ctx.slots.inject('conversation.details.tool', () => ctx.slots.register({
        name: 'conversation.details.tool',
        locale: NS,
        inject: toolInject,
    }, ToolDetails));
    ctx.plugin(bashToolviewSample);
    ctx.plugin(readToolview);
    ctx.plugin(fileMutationToolview);
    ctx.plugin(searchToolview);
    ctx.plugin(webToolview);
    ctx.plugin(todoToolview);
    ctx.plugin(askQuestionToolview);
}
