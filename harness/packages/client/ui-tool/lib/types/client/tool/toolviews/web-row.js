import { jsx as _jsx } from "react/jsx-runtime";
import { IconBrowseOutline16, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import { webCardModel } from "../models/web-card-model.js";
import { toolRowModel } from "../models/tool-call-model.js";
import { ToolRow } from "../components/ToolRow.js";
import { CONVERSATION_NS as NS } from "../../locale.js";
const WEB_TITLE_KEYS = {
    web_search: 'tool.title.webSearch',
    web_fetch: 'tool.title.webFetch',
};
/** Lets users expand a completed web search or fetch result. */
export function WebRow({ toolName, block, inspect, t }) {
    const model = toolRowModel(toolName, block);
    const web = webCardModel(block);
    const icon = toolName === 'web_fetch' ? _jsx(IconBrowseOutline16, { size: 14 }) : _jsx(IconGlobeOutline14, { size: 14 });
    return (_jsx(ToolRow, { t: t, variant: model.variant, toolName: toolName, icon: icon, title: t(toolName === 'web_search'
            ? WEB_TITLE_KEYS.web_search
            : toolName === 'web_fetch' ? WEB_TITLE_KEYS.web_fetch : model.titleKey), summary: model.summary, body: null, output: model.output, errorSummary: model.errorSummary, web: web, state: model.state, inspect: inspect }));
}
/** Registers the web search and fetch conversation rows. */
export const webToolview = {
    name: 'web-toolview',
    inject: ['slots'],
    apply(ctx) {
        ctx.slots.inject('tool.call.toolview', function* () {
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'web_search', locale: NS }, WebRow);
            yield ctx.slots.register({ name: 'tool.call.toolview', key: 'web_fetch', locale: NS }, WebRow);
        });
    },
};
