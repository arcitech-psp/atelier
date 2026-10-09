import { jsx as _jsx } from "react/jsx-runtime";
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { readCardModel } from "../models/read-card-model.js";
import { toolRowModel } from "../models/tool-call-model.js";
import { ToolRow } from "../components/ToolRow.js";
import { CONVERSATION_NS as NS } from "../../locale.js";
/**
 * Lets users expand a completed read result and open its reported path.
 */
export function ReadRow({ toolName, block, cwd, home, openFile, inspect, t }) {
    const model = toolRowModel(toolName, block, cwd, home);
    const read = readCardModel(block, cwd, home);
    return (_jsx(ToolRow, { t: t, variant: model.variant, toolName: toolName, icon: _jsx(IconBrowseOutline16, { size: 14 }), title: t(model.titleKey), summary: model.summary, body: null, output: model.output, errorSummary: model.errorSummary, read: read, state: model.state, filePath: model.filePath, onOpenFile: openFile, inspect: inspect }));
}
/** Registers the read tool's conversation row. */
export const readToolview = {
    name: 'read-toolview',
    inject: ['slots'],
    apply(ctx) {
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'read', locale: NS }, ReadRow));
    },
};
