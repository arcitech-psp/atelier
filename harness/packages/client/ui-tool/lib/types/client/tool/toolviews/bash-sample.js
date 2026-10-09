import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import clsx from 'clsx';
import { IconApiOutline14, IconChevronDownOutline14, IconInspectOutline12, StateDot, TerminalBlock, } from '@deepseek-ai/dsh-client-ui-primitives';
import { isSettledPersistentShellCall, localizeTerminalCardModel, terminalBlockLabels, terminalCardModel, terminalFailed, } from "../models/terminal-card-model.js";
import { toolRowModel } from "../models/tool-call-model.js";
import { CONVERSATION_NS as NS } from "../../locale.js";
import css from './bash-sample.module.css';
function leadingFor(state) {
    switch (state) {
        case 'error': return _jsx(StateDot, { state: "error" });
        case 'stopped': return _jsx(StateDot, { state: "warning" });
        // Running keeps the icon — the row sweep carries the in-flight signal.
        default: return _jsx(IconApiOutline14, { size: 14 });
    }
}
/** Visually hidden status — StateDot is aria-hidden; AT needs a text label. */
function stateStatus(state, t) {
    switch (state) {
        case 'running': return t('bash.running');
        case 'error': return t('bash.failed');
        case 'stopped': return t('bash.stopped');
        default: return null;
    }
}
/** Renders expandable Bash output with an accessible lifecycle label. */
export function BashRow({ toolName, block, sessionId, useSessions, inspect, t }) {
    const model = toolRowModel(toolName, block);
    // An omitted shell workdir is the session workspace; relative values resolve
    // against it before reaching the terminal primitive.
    const cwd = useSessions(list => list.byId[sessionId]?.cwd);
    const terminalModel = terminalCardModel(block, cwd);
    const terminal = terminalModel === null ? null : localizeTerminalCardModel(terminalModel, t);
    // A failing exit status is the terminal card's own error signal (the call
    // itself settles isError:false), surfaced as the row's red state dot.
    const state = model.state === 'ok' && terminalModel !== null && terminalFailed(terminalModel)
        ? 'error'
        : model.state;
    const status = stateStatus(state, t);
    const [expanded, setExpanded] = useState(false);
    // Execution failures and persistent-shell results have no terminal card.
    // Keep their recorded args and complete output reachable through the generic
    // body; background acknowledgements and malformed calls remain collapsed.
    const genericBody = terminal === null
        && (model.state === 'error' || isSettledPersistentShellCall(block))
        && (model.body !== null || model.output !== null);
    const expandable = terminal !== null || genericBody;
    const open = expanded && expandable;
    const failureLine = model.state === 'error' ? model.errorSummary : null;
    const toggleExpand = () => {
        setExpanded(v => !v);
    };
    const toggleFromKeyboard = (event) => {
        if (!expandable || (event.key !== 'Enter' && event.key !== ' '))
            return;
        event.preventDefault();
        toggleExpand();
    };
    const leading = open
        ? _jsx(IconChevronDownOutline14, { className: css.chevron })
        : expandable
            ? (_jsxs(_Fragment, { children: [_jsx("span", { className: css.iconIdle, children: leadingFor(state) }), _jsx(IconChevronDownOutline14, { className: clsx(css.chevron, css.chevronHover) })] }))
            : leadingFor(state);
    return (_jsxs("div", { className: css.card, children: [_jsxs("div", { className: css.root, "data-sample": "bash", "data-variant": "bash", "data-state": state, "data-expandable": expandable || undefined, role: expandable ? 'button' : undefined, tabIndex: expandable ? 0 : undefined, "aria-expanded": expandable ? open : undefined, onClick: expandable ? toggleExpand : undefined, onKeyDown: expandable ? toggleFromKeyboard : undefined, children: [_jsx("span", { className: css.leading, children: leading }), status !== null && _jsx("span", { className: css.visuallyHidden, children: status }), _jsx("span", { className: css.title, children: t(model.titleKey) }), _jsx("span", { className: css.sep, "aria-hidden": true }), _jsx("span", { className: clsx(css.summary, failureLine !== null && css.errorSummary), children: failureLine ?? terminal?.description ?? model.summary })] }), open && (_jsxs("div", { className: css.bodyWrap, children: [terminal !== null
                        ? (_jsx(TerminalBlock, { ...terminal.card, maxLines: Infinity, labels: terminalBlockLabels(t), className: css.terminal }))
                        : (_jsxs("div", { className: css.ioCard, children: [model.body !== null && (_jsxs("div", { className: css.ioSection, children: [_jsx("span", { className: css.ioLabel, children: t('row.input') }), _jsx("span", { className: css.ioText, children: model.body })] })), model.body !== null && model.output !== null && (_jsx("span", { className: css.ioDivider, "aria-hidden": true })), model.output !== null && (_jsxs("div", { className: css.ioSection, children: [_jsx("span", { className: css.ioLabel, children: t('row.output') }), _jsx("span", { className: css.ioText, "data-error": state === 'error' || undefined, children: model.output })] }))] })), inspect !== undefined && (_jsxs("button", { type: "button", className: css.inspectButton, onClick: inspect, children: [_jsx(IconInspectOutline12, {}), t('row.inspect')] }))] }))] }));
}
/** Registers the standalone Bash conversation-row sample. */
export const bashToolviewSample = {
    name: 'bash-toolview-sample',
    inject: ['slots'],
    apply(ctx) {
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'bash', locale: NS }, BashRow));
    },
};
