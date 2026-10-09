import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CodeBlock, DiffBlock, DisclosureRow, IconInspectOutline12, ReadBlock, SearchBlock, StateDot, TerminalBlock, WebBlock, } from '@deepseek-ai/dsh-client-ui-primitives';
import { CHAT_DIFF_MAX_LINES } from "../models/diff-card-model.js";
import { CHAT_READ_MAX_LINES } from "../models/read-card-model.js";
import { CHAT_SEARCH_MAX_LINES } from "../models/search-card-model.js";
import { localizeTerminalCardModel, terminalBlockLabels, } from "../models/terminal-card-model.js";
import { diffBlockLabels, readBlockLabels, searchBlockLabels, webBlockLabels, } from "../models/primitive-labels.js";
import { AskQuestionCard } from "./AskQuestionCard.js";
import css from './ToolRow.module.css';
function leadingFor(state, icon) {
    switch (state) {
        case 'error': return _jsx(StateDot, { state: "error" });
        case 'stopped': return _jsx(StateDot, { state: "warning" });
        default: return icon;
    }
}
/** Visually hidden run-state label: the StateDot and the CSS sweep are both
 *  aria-hidden / colour-only, so assistive technology needs this text to know a
 *  row is running, failed, or interrupted. null in the ok state (the icon and
 *  summary already describe a settled row). */
function stateStatus(state, t) {
    switch (state) {
        case 'running': return t('row.running');
        case 'error': return t('row.failed');
        case 'stopped': return t('row.stopped');
        default: return null;
    }
}
export function ToolRow({ t, variant, toolName, icon, title, summary, summarySuffix, body, output, askQuestion, errorSummary, terminal, diff, read, search, web, state, filePath, onOpenFile, inspect, }) {
    const [expanded, setExpanded] = useState(false);
    const terminalLabels = useMemo(() => terminalBlockLabels(t), [t]);
    const diffLabels = useMemo(() => diffBlockLabels(t), [t]);
    const readLabels = useMemo(() => readBlockLabels(t), [t]);
    const searchLabels = useMemo(() => searchBlockLabels(t), [t]);
    const webLabels = useMemo(() => webBlockLabels(t), [t]);
    const terminalBody = terminal === undefined || terminal === null
        ? null
        : localizeTerminalCardModel(terminal, t);
    const diffBody = diff ?? null;
    const readBody = read ?? null;
    const searchBody = search ?? null;
    const webBody = web ?? null;
    const askQuestionBody = askQuestion ?? null;
    const outputText = output ?? null;
    const card = askQuestionBody ?? terminalBody ?? diffBody ?? readBody ?? searchBody ?? webBody;
    const expandable = body !== null || outputText !== null || card !== null;
    const open = expanded && expandable;
    const status = stateStatus(state, t);
    // A failure must replace, not supplement, the normal summary.
    const failureLine = state === 'error' ? errorSummary ?? null : null;
    const summaryText = failureLine ?? terminalBody?.description ?? summary;
    const suffix = failureLine === null ? summarySuffix ?? null : null;
    const fileLink = filePath !== undefined && onOpenFile !== undefined && failureLine === null;
    const toggleExpand = () => {
        setExpanded(v => !v);
    };
    const openFile = (event) => {
        event.stopPropagation();
        if (filePath !== undefined)
            onOpenFile?.(filePath);
    };
    // Keep Enter/Space on the focused path link from bubbling to the row's
    // keydown handler, which would preventDefault() the key and toggle expand
    // instead of activating the link — the keyboard analogue of openFile's
    // stopPropagation. The native button still fires its own onClick from the key.
    const fileLinkKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ' ')
            event.stopPropagation();
    };
    // The code variant's program renders through CodeBlock (shiki), so only its
    // output joins the IN/OUT card; every other variant's input does too.
    const cardBody = variant === 'code' ? null : body;
    return (_jsxs("div", { className: css.root, "data-variant": variant, "data-tool": toolName, "data-state": state, children: [status !== null && _jsx("span", { className: css.visuallyHidden, children: status }), _jsx(DisclosureRow, { rowClassName: css.row, leadingClassName: css.leading, titleClassName: css.title, chevronClassName: css.chevron, icon: leadingFor(state, icon), title: title, open: open, expandable: expandable, expandOnRowClick: true, keepContentWhenOpen: true, onToggle: toggleExpand, collapsedContent: summaryText !== '' && (_jsxs(_Fragment, { children: [_jsx("span", { className: css.sep, "aria-hidden": true }), fileLink ? (_jsx("button", { type: "button", className: css.fileLink, onClick: openFile, onKeyDown: fileLinkKeyDown, children: summaryText })) : (_jsx("span", { className: clsx(css.summary, failureLine !== null && css.errorSummary), children: summaryText })), suffix !== null && _jsx("span", { className: css.summarySuffix, children: suffix })] })), children: _jsxs("div", { className: css.bodyWrap, children: [askQuestionBody !== null
                            ? _jsx(AskQuestionCard, { card: askQuestionBody })
                            : terminalBody !== null
                                ? (_jsx(TerminalBlock, { ...terminalBody.card, maxLines: Infinity, labels: terminalLabels, className: css.terminalBody }))
                                : diffBody !== null
                                    ? _jsx(DiffBlock, { ...diffBody.card, labels: diffLabels, maxLines: CHAT_DIFF_MAX_LINES, className: css.diffBody })
                                    : readBody !== null
                                        ? _jsx(ReadBlock, { ...readBody, labels: readLabels, maxLines: CHAT_READ_MAX_LINES, className: css.readBody })
                                        : searchBody !== null
                                            ? (_jsxs(_Fragment, { children: [_jsx(SearchBlock, { ...searchBody.card, labels: searchLabels, maxLines: CHAT_SEARCH_MAX_LINES, className: css.searchBody }), searchBody.recovery !== undefined && (_jsx("div", { className: css.searchRecovery, children: searchBody.recovery }))] }))
                                            : webBody !== null
                                                ? _jsx(WebBlock, { ...webBody, labels: webLabels, className: css.webBody })
                                                : (_jsxs(_Fragment, { children: [variant === 'code' && body !== null && (_jsx("div", { className: css.bodyScroll, children: _jsx(CodeBlock, { code: body, lang: "typescript", copyLabel: t('copy'), copiedLabel: t('copied'), className: css.codeBody }) })), (cardBody !== null || outputText !== null) && (_jsxs("div", { className: css.ioCard, children: [cardBody !== null && (_jsxs("div", { className: css.ioSection, children: [_jsx("span", { className: css.ioLabel, children: t('row.input') }), _jsx("span", { className: css.ioText, children: cardBody })] })), cardBody !== null && outputText !== null && (_jsx("span", { className: css.ioDivider, "aria-hidden": true })), outputText !== null && (_jsxs("div", { className: css.ioSection, children: [_jsx("span", { className: css.ioLabel, children: t('row.output') }), _jsx("span", { className: css.ioText, "data-error": state === 'error' || undefined, children: outputText })] }))] }))] })), inspect !== undefined && (_jsxs("button", { type: "button", className: css.inspectButton, onClick: inspect, children: [_jsx(IconInspectOutline12, {}), t('row.inspect')] }))] }) })] }));
}
