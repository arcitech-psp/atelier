import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { useEffect, useRef, useState } from 'react';
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import { useThrottledVisualUpdate } from "./use-throttled-visual-update.js";
import a11yCss from './accessibility.module.css';
import css from './ReasoningRow.module.css';
function firstLine(text) {
    const newline = text.indexOf('\n');
    return newline === -1 ? text : text.slice(0, newline);
}
const STREAMING_PREVIEW_CHARS = 1200;
function latestWrappedTail(text) {
    const visible = text.trimEnd();
    if (visible.length <= STREAMING_PREVIEW_CHARS)
        return visible;
    const tail = visible.slice(-STREAMING_PREVIEW_CHARS);
    const firstBoundary = tail.search(/\s/u);
    return firstBoundary === -1 ? tail : tail.slice(firstBoundary + 1);
}
/**
 * Render one assistant reasoning block as the Think disclosure row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({ text, running, t }) {
    const [expanded, setExpanded] = useState(true);
    const summaryRef = useRef(null);
    const summary = running ? latestWrappedTail(text) : firstLine(text);
    const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
        const element = summaryRef.current;
        if (element === null)
            return;
        element.scrollLeft = 0;
        element.scrollTop = running ? element.scrollHeight - element.clientHeight : 0;
    });
    useEffect(() => {
        scheduleSummaryScroll();
    }, [running, scheduleSummaryScroll, summary]);
    return (_jsxs("div", { className: css.root, "data-variant": "think", "data-state": running ? 'running' : 'ok', children: [running && _jsx("span", { className: a11yCss.visuallyHidden, children: t('row.running') }), _jsx(DisclosureRow, { rowClassName: css.row, leadingClassName: css.leading, titleClassName: css.title, chevronClassName: css.chevron, icon: _jsx(IconThinkOutline14, { size: 14 }), title: t('message.think'), open: expanded, expandable: true, expandOnRowClick: true, onToggle: () => { setExpanded(value => !value); }, collapsedContent: (_jsxs(_Fragment, { children: [_jsx("span", { className: css.separator, "aria-hidden": true }), _jsx("span", { ref: summaryRef, className: css.summary, "data-follow-end": running || undefined, children: summary })] })), children: _jsx("div", { className: css.thinkBody, children: text }) })] }));
}
