import { jsx as _jsx } from "react/jsx-runtime";
import { IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { diffCardModel } from "../models/diff-card-model.js";
import { toolRowModel } from "../models/tool-call-model.js";
import { ToolRow } from "../components/ToolRow.js";
import { CONVERSATION_NS as NS } from "../../locale.js";
/**
 * Lets users expand an applied file diff and open the reported path.
 */
export function FileMutationRow({ toolName, block, cwd, home, openFile, inspect, t }) {
    const model = toolRowModel(toolName, block, cwd, home);
    const diff = diffCardModel(block);
    return (_jsx(ToolRow, { t: t, variant: model.variant, toolName: toolName, icon: _jsx(IconEditOutline16, { size: 14 }), title: t(model.titleKey), summary: model.summary, body: null, output: model.output, errorSummary: model.errorSummary, diff: diff, state: model.state, filePath: model.filePath, onOpenFile: openFile, inspect: inspect }));
}
/** Registers the edit and write conversation rows. */
export const fileMutationToolview = {
    name: 'file-mutation-toolview',
    inject: ['slots'],
    apply(ctx) {
        ctx.slots.inject('tool.call.toolview', function* () {
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', locale: NS }, FileMutationRow);
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'write', locale: NS }, FileMutationRow);
        });
    },
};
