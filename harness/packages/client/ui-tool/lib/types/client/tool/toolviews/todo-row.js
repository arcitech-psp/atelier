import { jsx as _jsx } from "react/jsx-runtime";
import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import { toolRowModel } from "../models/tool-call-model.js";
import { ToolRow } from "../components/ToolRow.js";
import { CONVERSATION_NS as NS } from "../../locale.js";
import { planSummary } from "./plan-summary.js";
function isItem(value) {
    return typeof value === 'object' && value !== null;
}
function summarize(argsRaw, t) {
    let parsed;
    try {
        parsed = JSON.parse(argsRaw);
    }
    catch {
        // Mid-stream truncation or malformed model JSON: fall back to the generic summary.
        return null;
    }
    // Valid JSON with invalid todo fields (null root, non-array todos, null items —
    // a rejected tool/call retains such args verbatim): same generic fallback.
    if (typeof parsed !== 'object' || parsed === null)
        return null;
    const todos = parsed.todos;
    if (!Array.isArray(todos) || !todos.every(isItem))
        return null;
    const { done, total, activeContent, activeExtra } = planSummary(todos);
    const head = t('todo.completed', { done, total });
    return {
        text: activeContent === null ? head : `${head} · ${activeContent}`,
        extra: activeExtra,
    };
}
/** Summarizes a plan update without presenting a cancelled call as completed. */
export function TodoRow({ toolName, block, inspect, t }) {
    const model = toolRowModel(toolName, block);
    const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? '';
    const summary = summarize(argsRaw, t) ?? { text: model.summary, extra: 0 };
    return (_jsx(ToolRow, { t: t, variant: model.variant, toolName: toolName, icon: _jsx(IconChecklistOutline14, {}), title: t('todo.rowTitle'), summary: summary.text, summarySuffix: summary.extra > 0 ? `+${summary.extra}` : null, body: model.body, output: model.output, errorSummary: model.errorSummary, state: model.state, inspect: inspect }));
}
/** Registers the todo conversation row. */
export const todoToolview = {
    name: 'todo-toolview',
    inject: ['slots'],
    apply(ctx) {
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'todo_write', locale: NS }, TodoRow));
    },
};
