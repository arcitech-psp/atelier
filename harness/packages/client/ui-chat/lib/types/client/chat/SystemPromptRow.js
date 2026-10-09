import { jsx as _jsx } from "react/jsx-runtime";
import { memo, useState } from 'react';
import { DisclosureRow, IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { OpaqueBody } from "./ContextBody.js";
import css from './ContextInjectionRow.module.css';
/**
 * Render one complete system prompt as a collapsed disclosure whose expanded
 * body is the same opaque context chrome: 141px code-block scrollport and
 * model-facing text with its real line breaks.
 * @param props - Complete prompt text and the locale seat.
 * @returns The system-prompt disclosure row.
 */
export function SystemPromptRow({ text, t }) {
    const [open, setOpen] = useState(false);
    return (_jsx(DisclosureRow, { className: css.root, icon: _jsx(IconBrowseOutline16, { size: 14 }), chevronClassName: css.chevron, title: t('message.systemPrompt'), open: open, expandable: true, expandOnRowClick: true, onToggle: () => { setOpen(value => !value); }, children: _jsx("div", { className: css.body, "data-system-prompt-body": true, children: _jsx(OpaqueBody, { content: [{ type: 'text', text }], source: null, t: t }) }) }));
}
/** System-prompt keyed Chat renderer. */
export const SystemPromptNodeView = memo(function SystemPromptNodeView({ node, t, }) {
    return _jsx(SystemPromptRow, { text: node.data.text, t: t });
});
