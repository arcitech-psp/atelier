import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** General Settings row for completed-Turn transcript presentation. */
import { useState } from 'react';
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './TranscriptViewRow.module.css';
const OPTIONS = [
    { id: 'normal', label: 'settings.transcript.normal' },
    { id: 'compact', label: 'settings.transcript.compact' },
];
/**
 * Render the completed-Turn transcript mode selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function TranscriptViewRow({ useTranscriptView, setTranscriptView, t }) {
    const mode = useTranscriptView(value => value);
    const [open, setOpen] = useState(false);
    const selectedLabel = mode === 'normal'
        ? 'settings.transcript.normal'
        : 'settings.transcript.compact';
    const closeMenu = () => { setOpen(false); };
    const selectMode = (id) => {
        closeMenu();
        setTranscriptView(id);
    };
    const selector = (_jsxs("button", { type: "button", className: css.selector, "aria-haspopup": "menu", "aria-expanded": open, onClick: () => { setOpen(value => !value); }, children: [t(selectedLabel), _jsx(IconChevronDownOutline14, { className: css.chevron })] }));
    return (_jsxs("div", { className: css.row, children: [_jsxs("div", { className: css.rowText, children: [_jsx("div", { className: css.title, children: t('settings.transcript.title') }), _jsx("div", { className: css.desc, children: t('settings.transcript.description') })] }), _jsx(Menu, { open: open, onClose: closeMenu, items: OPTIONS.map(option => ({ id: option.id, label: t(option.label) })), selectedId: mode, onSelect: selectMode, align: "end", portal: true, anchor: selector })] }));
}
