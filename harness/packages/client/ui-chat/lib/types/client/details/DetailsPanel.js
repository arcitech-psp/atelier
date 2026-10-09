import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment } from 'react';
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives';
import { shallowEqual } from '@deepseek-ai/dsh-client-store';
import { findToolCall } from "./tool-node-reader.js";
import css from './DetailsPanel.module.css';
function settledMaterial(node, callId) {
    return { name: node.call?.name ?? callId, argsRaw: node.call?.argsRaw ?? null, block: node };
}
function runningMaterial(call) {
    return { name: call.name, argsRaw: call.argsRaw, block: call };
}
function materialFor(s, callId) {
    const found = findToolCall(s, callId);
    if (found === undefined)
        return null;
    return 'kind' in found ? settledMaterial(found, callId) : runningMaterial(found);
}
function pretty(raw) {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    }
    catch {
        return raw;
    }
}
/** Flatten a settled result for the no-ui-tool fallback. */
function rawResultText(block) {
    if (!('kind' in block))
        return '';
    const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2));
    if (parts.length === 0 && block.error !== undefined)
        parts.push(`${block.error.name}: ${block.error.code}`);
    return parts.join('\n');
}
export function DetailsPanel({ useChat, useSessions, sessionId, useStore, renderSlot, closeDetails, t }) {
    const selection = useStore(s => s.selection);
    // Session workspace root: a card model resolves omitted or relative
    // tool paths against it without reading Session services.
    const sessionCwd = useSessions(list => list.byId[sessionId]?.cwd);
    const callId = selection?.callId;
    // materialFor builds a fresh wrapper; shallowEqual short-circuits on its
    // stable members (result node reference rides the snapshot's structural sharing).
    const material = useChat(s => (callId === undefined ? null : materialFor(s, callId)), (a, b) => shallowEqual(a, b));
    return (_jsxs("div", { className: css.root, children: [_jsxs("div", { className: css.header, children: [_jsx("div", { className: css.title, children: selection === null ? t('details.title') : material?.name ?? selection.toolName ?? t('details.title') }), _jsx("button", { type: "button", className: css.close, "aria-label": t('details.close'), onClick: () => { closeDetails(); }, children: _jsx("svg", { viewBox: "0 0 16 16", width: "14", height: "14", "aria-hidden": true, children: _jsx("path", { d: "M4 4l8 8M12 4l-8 8", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }) }) })] }), _jsx("div", { className: css.body, children: selection === null || callId === undefined
                    ? _jsx("div", { className: css.empty, children: t('details.empty') })
                    : material === null
                        ? _jsx("div", { className: css.empty, children: t('details.notInWindow') })
                        : (_jsxs(_Fragment, { children: [material.argsRaw !== null && (_jsxs("section", { className: css.section, children: [_jsx("div", { className: css.sectionLabel, children: t('details.input') }), _jsx(CodeBlock, { code: pretty(material.argsRaw), lang: "json", copyLabel: t('copy'), copiedLabel: t('copied') })] })), _jsxs("section", { className: css.section, children: [_jsx("div", { className: css.sectionLabel, children: t('details.output') }), _jsx(Fragment, { children: renderSlot('conversation.details.tool', { block: material.block, cwd: sessionCwd }, {
                                                fallback: 'kind' in material.block
                                                    ? (_jsx("pre", { className: css.code, "data-error": material.block.isError || undefined, children: rawResultText(material.block) }))
                                                    : _jsx("div", { className: css.empty, children: t('details.running') }),
                                            }) }, callId)] })] })) })] }));
}
