import { jsx as _jsx } from "react/jsx-runtime";
import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { searchCardModel } from "../models/search-card-model.js";
import { toolRowModel } from "../models/tool-call-model.js";
import { ToolRow } from "../components/ToolRow.js";
import { CONVERSATION_NS as NS } from "../../locale.js";
const SEARCH_TITLE_KEYS = {
    grep: 'tool.title.grep',
    glob: 'tool.title.glob',
};
/** Lets users expand grep or glob results and recover capped searches. */
export function SearchRow({ toolName, block, inspect, t }) {
    const model = toolRowModel(toolName, block);
    const search = searchCardModel(block);
    return (_jsx(ToolRow, { t: t, variant: model.variant, toolName: toolName, icon: _jsx(IconSearchOutline16, { size: 14 }), title: t(toolName === 'grep'
            ? SEARCH_TITLE_KEYS.grep
            : toolName === 'glob' ? SEARCH_TITLE_KEYS.glob : model.titleKey), summary: model.summary, body: null, 
        // ToolRow ignores output when a structured card is present; otherwise it
        // preserves the generic fallback for errors and legacy results.
        output: model.output, errorSummary: model.errorSummary, search: search, state: model.state, inspect: inspect }));
}
/** Registers the grep and glob conversation rows. */
export const searchToolview = {
    name: 'search-toolview',
    inject: ['slots'],
    apply(ctx) {
        ctx.slots.inject('tool.call.toolview', function* () {
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'grep', locale: NS }, SearchRow);
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'glob', locale: NS }, SearchRow);
        });
    },
};
