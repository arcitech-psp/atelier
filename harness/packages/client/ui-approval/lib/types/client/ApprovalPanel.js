import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Composer takeover for one pending approval waterfall. */
import { useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './ApprovalPanel.module.css';
/**
 * Render one pending approval and its optional Tool-owned detail.
 * @param props - selector-matched request and standard Slot props.
 * @returns The approval composer takeover.
 */
export function ApprovalPanel(props) {
    const approval = props.matched;
    const detail = approval.callId === undefined
        ? null
        : props.renderSlot('conversation.approval.detail', { callId: approval.callId });
    return _jsx(ApprovalFlow, { pending: approval, detail: detail, t: props.t }, approval.key);
}
function ApprovalFlow({ pending, detail, t }) {
    const [answered, setAnswered] = useState(false);
    const answer = (outcome) => {
        setAnswered(true);
        void pending.answer(outcome).catch(() => { setAnswered(false); });
    };
    return (_jsx("div", { className: css.root, "data-approval-key": pending.key, children: _jsxs("div", { className: css.card, children: [_jsxs("div", { className: css.strip, children: [_jsx("span", { className: css.dot }), t('waiting')] }), _jsxs("div", { className: css.body, "data-approval-scroll": "", tabIndex: 0, role: "group", "aria-label": t('detail.aria'), children: [_jsx("div", { className: css.headline, children: pending.reason ?? t('escalation', { toolName: pending.toolName }) }), detail !== null && _jsx("div", { className: css.command, children: detail })] }), _jsxs("div", { className: css.actionRow, children: [_jsx(Button, { variant: "outline", className: css.reject, disabled: answered, onClick: () => { answer('rejected'); }, children: t('reject') }), _jsx(Button, { variant: "primary", disabled: answered, onClick: () => { answer('allowed-once'); }, children: t('allowOnce') })] })] }) }));
}
