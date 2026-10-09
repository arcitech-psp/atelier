import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useEffect, useMemo, useState } from 'react';
import { JsonBlock, projectUserText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { CompactionItem } from "./CompactionItem.js";
import { ContextInjectionRow } from "./ContextInjectionRow.js";
import { MessageIconActions } from "./MessageIconActions.js";
import { splitVoiceMarkers } from "./voice-markers.js";
import css from './MessageItem.module.css';
function contentParts(content) {
    const texts = [];
    const images = [];
    const rest = [];
    for (const block of content) {
        const b = block;
        if (b.type === 'text' && typeof b.text === 'string')
            texts.push(b.text);
        else if (b.type === 'image' && b.attachment !== undefined) {
            images.push({ attachment: b.attachment });
        }
        else
            rest.push(block);
    }
    return { text: texts.join(''), images, rest };
}
function retrySeconds(milliseconds) {
    return Math.max(1, Math.ceil(milliseconds / 1_000));
}
function failureMessage(message, code, t) {
    return code === 'AUTH' ? t('message.failure.auth') : message;
}
function ModelRetryItem({ node, active, t }) {
    // Anchor the host-scheduled delay to this browser's first render of the
    // retry node. Host event time and Date.now() may belong to different clocks.
    const deadline = useMemo(() => Date.now() + node.delayMs, [node.delayMs, node.seq]);
    const scheduledSeconds = retrySeconds(node.delayMs);
    const maximum = node.mode === 'normal' ? node.maxRetries : '∞';
    const [countdown, setCountdown] = useState(() => ({
        deadline,
        seconds: retrySeconds(deadline - Date.now()),
    }));
    const remainingSeconds = countdown.deadline === deadline
        ? countdown.seconds
        : retrySeconds(deadline - Date.now());
    useEffect(() => {
        if (!active)
            return;
        const updateCountdown = () => {
            const next = retrySeconds(deadline - Date.now());
            setCountdown(current => (current.deadline === deadline && current.seconds === next
                ? current
                : { deadline, seconds: next }));
            return next;
        };
        if (updateCountdown() === 1)
            return;
        const timer = window.setInterval(() => {
            if (updateCountdown() === 1)
                window.clearInterval(timer);
        }, 250);
        return () => { window.clearInterval(timer); };
    }, [active, deadline]);
    const label = active
        ? t('message.retry.active')
        : node.retryState === 'cancelled'
            ? t('message.retry.cancelled')
            : node.retryState === 'started'
                ? t('message.retry.started')
                : t('message.retry.scheduled');
    const seconds = active ? remainingSeconds : scheduledSeconds;
    return (_jsxs("details", { className: css.retryRow, "data-active": active || undefined, children: [_jsx("summary", { className: css.retrySummary, children: _jsx("span", { className: css.retryText, role: "status", children: t('message.retry.status', { label, retry: node.retry, maximum, seconds }) }) }), _jsxs("div", { className: css.retryDetails, children: [_jsxs("div", { children: [_jsx("span", { className: css.retryDetailLabel, children: t('message.retry.delay') }), t('duration.milliseconds', { milliseconds: Math.round(node.delayMs) })] }), _jsxs("div", { children: [_jsx("span", { className: css.retryDetailLabel, children: t('message.retry.failure') }), failureMessage(node.failure.message, node.failure.code, t)] })] })] }));
}
/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, t }) {
    return (_jsxs("div", { className: css.turnErrorRow, role: "status", children: [_jsx(StateDot, { state: "error", className: css.turnErrorDot }), _jsxs("div", { className: css.turnErrorCopy, children: [_jsx("span", { className: css.turnErrorTitle, children: t('message.turnError') }), _jsx("span", { className: css.turnErrorMessage, children: failureMessage(node.message, node.code, t) })] }), node.code !== undefined && _jsx("code", { className: css.turnErrorCode, children: node.code })] }));
}
/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t }) {
    return (_jsxs("div", { className: css.turnErrorRow, role: "status", children: [_jsx(StateDot, { state: "warning", className: css.turnErrorDot }), _jsxs("div", { className: css.turnErrorCopy, children: [_jsx("span", { className: css.maxTokensTitle, children: t('message.maxTokens') }), _jsx("span", { className: css.turnErrorMessage, children: t('message.maxTokens.hint') })] })] }));
}
/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({ content, renderMessageImages, actions, pending = false, echo = false, referenceLabels = [], previewImages, t, }) {
    const { text: rawText, images: contentImages, rest } = contentParts(content);
    const { text, note: voiceNote } = splitVoiceMarkers(rawText);
    const images = previewImages ?? contentImages;
    const truncated = (total) => t('json.truncated', { total });
    const showBubble = text !== '' || rest.length > 0;
    return (_jsxs("div", { className: css.userRow, "data-pending-steering": pending || undefined, "data-submission-echo": echo || undefined, "data-time-hover-root": true, children: [_jsxs("div", { className: css.userStack, children: [renderMessageImages({ images, align: 'end' }), showBubble && _jsxs("div", { className: css.bubble, children: [projectUserText(text, referenceLabels), rest.map((block, i) => _jsx(JsonBlock, { label: t('message.extraBlock'), payload: block, truncatedLabel: truncated }, i))] }), voiceNote !== null && _jsx("div", { className: css.voiceNote, children: voiceNote }), referenceLabels.length > 0 && (_jsx("div", { className: css.referenceSummary, children: t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) }) }))] }), actions?.(text)] }));
}
/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, renderMessageImages, t }) {
    return (_jsx(UserStyleBubble, { content: content, renderMessageImages: renderMessageImages, pending: true, t: t, actions: text => (_jsx(MessageIconActions, { text: text, clock: "start", className: css.actions, t: t })) }));
}
/**
 * Render one local submission echo with the exact visual language of the
 * durable user node that replaces it: draft text plus object-URL previews,
 * visible from the submit click until the durable `user/message` (or its
 * queue occurrence) renders.
 * @param props - the session snapshot's pending submission and render seats.
 * @returns the echoed user bubble.
 */
export function PendingSubmissionBubble({ submission, renderMessageImages, t }) {
    const content = useMemo(() => (submission.text === '' ? [] : [{ type: 'text', text: submission.text }]), [submission.text]);
    const previewImages = useMemo(() => submission.images.map(image => ({
        preview: {
            url: image.previewUrl,
            ...(image.name === undefined ? {} : { name: image.name }),
            ...(image.width === undefined ? {} : { width: image.width }),
            ...(image.height === undefined ? {} : { height: image.height }),
        },
    })), [submission.images]);
    return (_jsx(UserStyleBubble, { content: content, previewImages: previewImages, renderMessageImages: renderMessageImages, echo: true, t: t, actions: text => (_jsx(MessageIconActions, { text: text, time: submission.time, clock: "start", className: css.actions, t: t })) }));
}
/** User and admitted-steering keyed Chat renderer. */
export const UserMessageNodeView = memo(function UserMessageNodeView({ node, renderMessageImages, t, }) {
    const data = node.data;
    return (_jsx(UserStyleBubble, { content: data.content, renderMessageImages: renderMessageImages, ...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }, t: t, actions: text => (_jsx(MessageIconActions, { text: text, time: data.time, clock: "start", className: css.actions, t: t })) }));
});
/** Injected-context keyed Chat renderer. */
export const ContextMessageNodeView = memo(function ContextMessageNodeView({ node, t }) {
    const data = node.data;
    return (_jsx(ContextInjectionRow, { content: data.content, source: data.source, provenance: data.provenance, form: data.form, t: t }));
});
/** Automatic compaction keyed Chat renderer. */
export const CompactionNodeView = memo(function CompactionNodeView({ node, t }) {
    return _jsx(CompactionItem, { node: node.data, t: t });
});
/** Correlated retry-chain keyed Chat renderer. */
export const RetryNodeView = memo(function RetryNodeView({ node, t }) {
    const data = node.data;
    return _jsx(ModelRetryItem, { node: data.current, active: data.current.retryState === 'scheduled', t: t });
});
/** Terminal turn-error keyed Chat renderer. */
export const TurnErrorNodeView = memo(function TurnErrorNodeView({ node, t }) {
    return _jsx(TurnErrorItem, { node: node.data, t: t });
});
/** Max-tokens turn-end notice keyed Chat renderer. */
export const TurnMaxTokensNodeView = memo(function TurnMaxTokensNodeView({ t }) {
    return _jsx(TurnMaxTokensItem, { t: t });
});
/** Explicit unknown-surface keyed Chat renderer. */
export const UnknownNodeView = memo(function UnknownNodeView({ node, t }) {
    const data = node.data;
    return (_jsx("div", { className: css.contextRow, children: _jsx(JsonBlock, { label: t('message.unknownSurface', { type: data.type }), payload: data.data, truncatedLabel: total => t('json.truncated', { total }) }) }));
});
