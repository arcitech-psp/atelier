import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** Turn-aware trajectory event ledger with a local record inspector. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconChevronRightOutline14, IconSettingsOutline16, IconSparkle16, IconUserOutline16, JsonTree, MarkdownText, Tooltip, } from '@deepseek-ai/dsh-client-ui-primitives';
import { structuredPatch } from 'diff';
import { formatElapsedSeconds, trajectoryRecordId } from "./trajectory-record.js";
import { groupTrajectoryVirtualRows, trajectoryVirtualRecordKey, } from "./trajectory-virtual-rows.js";
import { trajectoryPreviewText } from "./trajectory-preview.js";
import { COMPACTION_INTERRUPTED_ERROR } from "./copy-codes.js";
import css from './TrajectoryTable.module.css';
const BOTTOM_FOLLOW_THRESHOLD_PX = 2;
const OLDER_LOAD_THRESHOLD_PX = 48;
const HISTORY_LOAD_ROW_HEIGHT_PX = 30;
const VIRTUALIZATION_THRESHOLD = 100;
const VIRTUAL_OVERSCAN_ROWS = 12;
const VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX = 600;
const KIND_LABEL_KEY = {
    system: 'kind.system',
    user: 'kind.user',
    context: 'kind.context',
    compacted: 'kind.compacted',
    message: 'kind.assistant',
    tool: 'kind.tool',
    subtool: 'kind.subtool',
};
function ToolWrenchIcon() {
    return (_jsx("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "data-role-icon": "wrench", "aria-hidden": "true", children: _jsx("path", { d: "M14 3.3a3.8 3.8 0 0 1-4.8 4.8l-5.1 5.1a1.6 1.6 0 1 1-2.3-2.3l5.1-5.1A3.8 3.8 0 0 1 11.7 1l-2.3 2.3 2.3 2.3L14 3.3Z" }) }));
}
function InformationIcon() {
    return (_jsxs("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", "data-role-icon": "information", "aria-hidden": "true", children: [_jsx("circle", { cx: "8", cy: "8", r: "6.7" }), _jsx("circle", { cx: "8", cy: "5.5", r: ".85", fill: "currentColor", stroke: "none" }), _jsx("path", { d: "M8 7.75v3.4", strokeWidth: "1.8" })] }));
}
function CompactedIcon() {
    return (_jsxs("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "data-role-icon": "compacted", "aria-hidden": "true", children: [_jsx("path", { d: "m2.5 2.5 3.75 3.75M3 6.25h3.25V3" }), _jsx("path", { d: "m13.5 2.5-3.75 3.75M13 6.25H9.75V3" }), _jsx("path", { d: "m2.5 13.5 3.75-3.75M3 9.75h3.25V13" }), _jsx("path", { d: "m13.5 13.5-3.75-3.75M13 9.75H9.75V13" })] }));
}
const KIND_ICON = {
    system: _jsx(IconSettingsOutline16, { size: 13 }),
    user: _jsx(IconUserOutline16, { size: 13 }),
    context: _jsx(InformationIcon, {}),
    compacted: _jsx(CompactedIcon, {}),
    message: _jsx(IconSparkle16, { size: 13 }),
    tool: _jsx(ToolWrenchIcon, {}),
    subtool: _jsx(ToolWrenchIcon, {}),
};
function useStableVirtualRowStructure(rows) {
    const cache = useRef({ rows: [], structure: [] });
    if (cache.current.rows === rows)
        return cache.current.structure;
    const structure = cache.current.structure.length === rows.length
        && rows.every((row, index) => {
            const previous = cache.current.structure[index];
            return previous?.key === row.key && previous.height === row.height;
        })
        ? cache.current.structure
        : rows.map(row => ({ key: row.key, height: row.height }));
    cache.current = { rows, structure };
    return structure;
}
const DETAILS_MIN_WIDTH = 320;
const DETAILS_MAX_WIDTH = 720;
const TABLE_MIN_WIDTH = 280;
const DETAILS_RESIZE_STEP = 16;
const TOOL_REQUEST_SHARE = 0.58;
const TOOL_REQUEST_MIN_WIDTH = 180;
const TOOL_REQUEST_MAX_WIDTH = 480;
const DEFAULT_TOOL_REQUEST_SHARE = 0.36;
const DEFAULT_TOOL_REQUEST_OFFSET = 56;
const SYSTEM_PROMPT_TABS = [
    { id: 'system-prompt', labelKey: 'tab.systemPrompt' },
    { id: 'tools', labelKey: 'tab.tools' },
];
const SYSTEM_UPDATE_TABS = [
    { id: 'diff', labelKey: 'tab.diff' },
    ...SYSTEM_PROMPT_TABS,
];
const REQUEST_TABS = [
    { id: 'overview', labelKey: 'tab.summary' },
    { id: 'options', labelKey: 'tab.options' },
    { id: 'usage', labelKey: 'tab.usage' },
    { id: 'timing', labelKey: 'tab.timing' },
];
function jsonTreeLabels(t) {
    return {
        copyValue: t('copy.value'),
        copyJson: t('copy.json'),
        copyPath: t('copy.path'),
        copyPrettyJson: t('copy.prettyJson'),
        copyCompactJson: t('copy.compactJson'),
        copied: t('copied'),
        copyFailed: t('copy.failed'),
        collapseNode: t('json.collapseNode'),
        expandNode: t('json.expandNode'),
        copyButtonTitle: action => t('copy.optionsHint', { action }),
    };
}
function markdownLabels(t) {
    return {
        code: { copyLabel: t('copy'), copiedLabel: t('copied') },
        footnotes: t('markdown.footnotes'),
    };
}
function clampDetailsWidth(width, splitWidth) {
    const maxWidth = Math.max(DETAILS_MIN_WIDTH, Math.min(DETAILS_MAX_WIDTH, splitWidth - TABLE_MIN_WIDTH));
    return Math.round(Math.min(Math.max(width, DETAILS_MIN_WIDTH), maxWidth));
}
function defaultToolRequestWidth(splitWidth) {
    return Math.min(Math.max(splitWidth * DEFAULT_TOOL_REQUEST_SHARE - DEFAULT_TOOL_REQUEST_OFFSET, TOOL_REQUEST_MIN_WIDTH), TOOL_REQUEST_MAX_WIDTH);
}
function formatDurationMs(milliseconds, t) {
    if (milliseconds < 1_000)
        return t('unit.milliseconds', { value: Math.round(milliseconds) });
    return t('unit.seconds', {
        value: (milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1),
    });
}
function formatStartedAt(timestamp, t) {
    if (timestamp === null || !Number.isFinite(timestamp))
        return t('timing.notAvailable');
    const date = new Date(timestamp);
    const two = (value) => String(value).padStart(2, '0');
    const three = (value) => String(value).padStart(3, '0');
    const time = `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${three(date.getMilliseconds())}`;
    const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    return `${day} ${time}`;
}
/** Whether a click lands on an active text selection and should keep it. */
function clickSelectsText(target) {
    const selection = window.getSelection();
    return selection !== null
        && !selection.isCollapsed
        && selection.rangeCount > 0
        && selection.getRangeAt(0).intersectsNode(target);
}
function StartedAtValue({ timestamp, t }) {
    const [showUnix, setShowUnix] = useState(false);
    if (timestamp === null || !Number.isFinite(timestamp))
        return _jsx("dd", { children: t('timing.notAvailable') });
    return (_jsx("dd", { children: _jsx("button", { type: "button", className: css.timestampToggle, title: showUnix ? t('timing.showLocalTime') : t('timing.showUnixTimestamp'), onClick: (event) => {
                if (clickSelectsText(event.currentTarget))
                    return;
                setShowUnix(current => !current);
            }, children: showUnix ? (timestamp / 1_000).toFixed(3) : formatStartedAt(timestamp, t) }) }));
}
function totalTime(metrics, t) {
    if (!metrics.timingRecorded)
        return t('timing.notRecorded');
    if (metrics.stepStartTime === null)
        return t('timing.stepStartUnavailable');
    if (metrics.completedTime === null)
        return t('status.pending');
    return formatDurationMs(Math.max(0, metrics.completedTime - metrics.stepStartTime), t);
}
function ttft(metrics, t) {
    if (!metrics.timingRecorded)
        return t('timing.notRecorded');
    if (metrics.stepStartTime === null)
        return t('timing.stepStartUnavailable');
    if (metrics.firstTokenTime === null)
        return t('timing.firstTokenUnavailable');
    return formatDurationMs(Math.max(0, metrics.firstTokenTime - metrics.stepStartTime), t);
}
function generationTime(metrics, t) {
    if (!metrics.timingRecorded || metrics.firstTokenTime === null)
        return t('timing.firstTokenUnavailable');
    if (metrics.completedTime === null)
        return t('status.pending');
    return formatDurationMs(Math.max(0, metrics.completedTime - metrics.firstTokenTime), t);
}
function throughput(metrics, t) {
    if (!metrics.usageProvided)
        return t('timing.usageUnavailable');
    if (metrics.outputTokens === null)
        return t('timing.outputTokensUnavailable');
    if (!metrics.timingRecorded || metrics.firstTokenTime === null)
        return t('timing.firstTokenUnavailable');
    if (metrics.completedTime === null)
        return t('status.pending');
    const generationSeconds = (metrics.completedTime - metrics.firstTokenTime) / 1_000;
    if (generationSeconds <= 0)
        return t('timing.durationTooShort');
    return t('unit.tokensPerSecond', {
        value: (metrics.outputTokens / generationSeconds).toFixed(1),
    });
}
function AssistantTimingPanel({ metrics, t, }) {
    return (_jsxs("dl", { className: css.overview, children: [_jsxs("div", { children: [_jsx("dt", { children: t('timing.started') }), _jsx(StartedAtValue, { timestamp: metrics.stepStartTime, t: t })] }), _jsxs("div", { children: [_jsx("dt", { children: t('timing.totalDuration') }), _jsx("dd", { children: totalTime(metrics, t) })] }), _jsxs("div", { children: [_jsx("dt", { children: t('timing.ttft') }), _jsx("dd", { children: ttft(metrics, t) })] }), _jsxs("div", { children: [_jsx("dt", { children: t('timing.generation') }), _jsx("dd", { children: generationTime(metrics, t) })] }), _jsxs("div", { children: [_jsx("dt", { children: t('timing.throughput') }), _jsx("dd", { children: throughput(metrics, t) })] })] }));
}
function flattenRecords(turns) {
    return turns.flatMap((turn, section) => {
        let firstInSection = true;
        const records = turn.groups.flatMap((group) => {
            return group.cells.map((cell, index) => {
                const turnStart = firstInSection
                    && cell.requestOnly !== true
                    && cell.kind !== 'system'
                    && (cell.kind !== 'compacted' || turn.turn === null);
                if (turnStart)
                    firstInSection = false;
                return {
                    turn: turn.turn,
                    section,
                    group: group.title,
                    groupStart: index === 0,
                    turnStart,
                    cell,
                    turnEnd: false,
                };
            });
        });
        const last = records.at(-1);
        if (last !== undefined)
            last.turnEnd = true;
        return records;
    });
}
function filterRecords(records, matches) {
    const filtered = records
        .filter(record => record.cell.requestOnly !== true && matches.has(record.cell.index))
        .map(record => ({ ...record, groupStart: false, turnStart: false, turnEnd: false }));
    const startedSections = new Set();
    for (const [index, record] of filtered.entries()) {
        const previous = filtered[index - 1];
        const next = filtered[index + 1];
        record.groupStart = previous === undefined
            || previous.section !== record.section
            || previous.group !== record.group;
        record.turnStart = !startedSections.has(record.section)
            && record.cell.kind !== 'system'
            && (record.cell.kind !== 'compacted' || record.turn === null);
        if (record.turnStart)
            startedSections.add(record.section);
        record.turnEnd = next === undefined || next.section !== record.section;
    }
    return filtered;
}
function requestKey(turn, group) {
    return `${turn}\u0000${group}`;
}
function requestIdentity(request) {
    return request.purpose === 'compaction'
        ? `compaction\u0000${request.seq}`
        : `assistant\u0000${request.turn}\u0000${request.step}`;
}
function indexRequestBoundaries(records, requestGroups) {
    const boundaries = new Map();
    for (const record of records) {
        const key = requestKey(record.turn, record.group);
        if (!requestGroups.has(key))
            continue;
        if (boundaries.has(key))
            continue;
        if (record.cell.kind === 'user' || record.cell.kind === 'context')
            continue;
        boundaries.set(key, record.cell.index);
    }
    return boundaries;
}
function sectionLabel(turn, t) {
    return turn === null ? t('section.betweenTurns') : t('turn.label', { turn });
}
function indexRequestNumbers(sessionNumbers) {
    const numbers = new Map();
    for (const request of sessionNumbers ?? []) {
        numbers.set(requestKey(request.turn, request.group), request.number);
    }
    return numbers;
}
function indexRequestBoundaryRuns(records, requestGroups) {
    const indexes = new Map();
    let runLength = 0;
    for (const record of records) {
        if (record.cell.requestOnly === true) {
            indexes.set(record.cell.index, runLength++);
            continue;
        }
        if (runLength > 0
            && record.groupStart
            && requestGroups.has(requestKey(record.turn, record.group))) {
            indexes.set(record.cell.index, runLength);
        }
        runLength = 0;
    }
    return indexes;
}
function summarizeTurn(records, requestGroups, t) {
    const steps = new Set(records
        .map(record => requestKey(record.turn, record.group))
        .filter(key => requestGroups.has(key))).size;
    const toolCalls = records.filter(record => record.cell.kind === 'tool' || record.cell.kind === 'subtool').length;
    return [
        t(steps === 1 ? 'summary.steps.one' : 'summary.steps.other', { count: steps }),
        t(toolCalls === 1 ? 'summary.toolCalls.one' : 'summary.toolCalls.other', {
            count: toolCalls,
        }),
    ].join(' · ');
}
function collapseTurnRecords(records, collapsedTurns, requestGroups, t) {
    const recordsByTurn = new Map();
    for (const record of records) {
        if (record.turn === null)
            continue;
        const turnRecords = recordsByTurn.get(record.turn) ?? [];
        turnRecords.push(record);
        recordsByTurn.set(record.turn, turnRecords);
    }
    return records.flatMap((record) => {
        if (record.turn === null || !collapsedTurns.has(record.turn))
            return [record];
        const turnRecords = recordsByTurn.get(record.turn) ?? [record];
        if (record.cell.requestOnly === true || record.cell.kind === 'system')
            return [record];
        const contentRecords = turnRecords.filter(candidate => candidate.cell.requestOnly !== true && candidate.cell.kind !== 'system');
        if (contentRecords.length <= 1)
            return [record];
        if (record.cell.index !== contentRecords[0]?.cell.index)
            return [];
        return [
            { ...record, turnEnd: false },
            {
                ...record,
                groupStart: false,
                turnStart: false,
                turnEnd: true,
                collapsedSummary: summarizeTurn(contentRecords.slice(1), requestGroups, t),
                collapsedSummaryKind: 'turn',
            },
        ];
    });
}
function assistantToolCalls(records, assistantIndex) {
    const at = records.findIndex(record => record.cell.index === assistantIndex);
    if (at === -1 || records[at]?.cell.kind !== 'message')
        return [];
    const calls = [];
    for (let i = at + 1; i < records.length; i++) {
        const record = records[i];
        if (record === undefined)
            break;
        if (record.cell.kind !== 'tool' && record.cell.kind !== 'subtool')
            break;
        calls.push(record);
    }
    return calls;
}
function summarizeAssistantTools(records, t) {
    const names = [...new Set(records.map((record) => {
            const separator = record.cell.text.indexOf(' · ');
            return separator === -1 ? record.cell.text : record.cell.text.slice(0, separator);
        }).filter(name => name !== ''))];
    const count = records.length;
    const summary = t(count === 1 ? 'summary.toolCalls.one' : 'summary.toolCalls.other', { count });
    return names.length > 0 ? `${summary} · ${names.join(', ')}` : summary;
}
function collapseAssistantRecords(records, collapsedAssistants, t) {
    const out = [];
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (record === undefined)
            continue;
        out.push(record);
        if (record.cell.kind !== 'message'
            || !collapsedAssistants.has(trajectoryRecordId(record.cell)))
            continue;
        const calls = [];
        for (let j = i + 1; j < records.length; j++) {
            const candidate = records[j];
            if (candidate === undefined
                || candidate.collapsedSummary !== undefined
                || (candidate.cell.kind !== 'tool' && candidate.cell.kind !== 'subtool'))
                break;
            calls.push(candidate);
        }
        if (calls.length === 0)
            continue;
        const last = calls.at(-1);
        out[out.length - 1] = { ...record, turnEnd: false };
        out.push({
            ...record,
            groupStart: false,
            turnStart: false,
            turnEnd: last?.turnEnd ?? false,
            collapsedSummary: summarizeAssistantTools(calls, t),
            collapsedSummaryKind: 'assistant',
        });
        i += calls.length;
    }
    return out;
}
function stateOf(record) {
    if (record.cell.isError)
        return 'error';
    if (record.cell.kind === 'compacted' && record.cell.timeSeconds === null)
        return 'running';
    if ((record.cell.kind === 'tool' || record.cell.kind === 'subtool')
        && record.cell.outputDetail === undefined)
        return 'running';
    return 'complete';
}
function statusLabel(state, t) {
    if (state === 'error')
        return t('status.failed');
    if (state === 'running')
        return t('status.pending');
    return t('status.completed');
}
function requestErrorMessage(request, t) {
    if (request.errorCode === 'AUTH')
        return t('details.failure.auth');
    if (request.error === COMPACTION_INTERRUPTED_ERROR)
        return t('layout.compactionInterrupted');
    return request.error;
}
function TokenRows({ cell, t }) {
    const content = cell.output !== undefined && cell.think !== undefined
        ? Math.max(0, cell.output - cell.think)
        : undefined;
    return (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("dt", { children: t('usage.tokens') }), _jsx("dd", { children: cell.output === undefined ? '—' : t('unit.tokens', { value: cell.output }) })] }), cell.think !== undefined && (_jsxs("div", { className: css.requestTokenDetail, children: [_jsx("dt", { children: t('usage.reasoning') }), _jsx("dd", { children: t('unit.tokens', { value: cell.think }) })] })), content !== undefined && (_jsxs("div", { className: css.requestTokenDetail, children: [_jsx("dt", { children: t('usage.content') }), _jsx("dd", { children: t('unit.tokens', { value: content }) })] }))] }));
}
function inputTotal(usage) {
    if (usage.input === undefined
        && usage.cacheRead === undefined
        && usage.cacheWrite === undefined)
        return undefined;
    return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}
function UsageRows({ usage, t }) {
    if (usage === undefined)
        return _jsx("p", { className: css.noPayload, children: t('usage.notReported') });
    const totalInput = inputTotal(usage);
    const otherOutput = usage.output !== undefined && usage.reasoning !== undefined
        ? usage.output - usage.reasoning
        : undefined;
    return (_jsxs("dl", { className: css.overview, children: [totalInput !== undefined && (_jsxs("div", { children: [_jsx("dt", { children: t('usage.input') }), _jsx("dd", { children: t('unit.tokens', { value: totalInput }) })] })), usage.cacheRead !== undefined && (_jsxs("div", { className: css.requestTokenDetail, children: [_jsx("dt", { children: t('usage.cached') }), _jsx("dd", { children: t('unit.tokens', { value: usage.cacheRead }) })] })), usage.cacheWrite !== undefined && (_jsxs("div", { className: css.requestTokenDetail, children: [_jsx("dt", { children: t('usage.cacheCreated') }), _jsx("dd", { children: t('unit.tokens', { value: usage.cacheWrite }) })] })), usage.input !== undefined && (_jsxs("div", { className: css.requestTokenDetail, children: [_jsx("dt", { children: t('usage.other') }), _jsx("dd", { children: t('unit.tokens', { value: usage.input }) })] })), usage.output !== undefined && (_jsxs("div", { children: [_jsx("dt", { children: t('usage.output') }), _jsx("dd", { children: t('unit.tokens', { value: usage.output }) })] })), usage.reasoning !== undefined && (_jsxs("div", { className: css.requestTokenDetail, children: [_jsx("dt", { children: t('usage.reasoning') }), _jsx("dd", { children: t('unit.tokens', { value: usage.reasoning }) })] })), otherOutput !== undefined && (_jsxs("div", { className: css.requestTokenDetail, children: [_jsx("dt", { children: t('usage.content') }), _jsx("dd", { children: t('unit.tokens', { value: otherOutput }) })] }))] }));
}
function RequestUsagePanel({ usage, cumulative, t, }) {
    return (_jsxs("div", { className: css.usagePanel, children: [_jsxs("section", { className: css.usageGroup, children: [_jsx("h4", { className: css.usageHeading, children: t('usage.thisRequest') }), _jsx(UsageRows, { usage: usage, t: t })] }), _jsxs("section", { className: css.usageGroup, children: [_jsx("h4", { className: css.usageHeading, children: t('usage.sessionCumulative') }), _jsx(UsageRows, { usage: cumulative, t: t })] })] }));
}
function RequestOptions({ options, preview = false, t, }) {
    if (options === undefined) {
        return _jsx("p", { className: css.noPayload, children: t('options.notRecorded') });
    }
    return (_jsx(JsonTree, { data: options, label: t('options.json'), labels: jsonTreeLabels(t), className: preview ? css.jsonPreview : css.jsonPayload }));
}
function messageSourceLabel(source, t) {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) {
        return t('source.unknown');
    }
    const properties = source;
    const kind = properties.kind;
    if (kind === 'user')
        return t('source.user');
    if (kind === 'plugin') {
        const plugin = properties.plugin;
        return typeof plugin === 'string' && plugin !== ''
            ? t('source.pluginNamed', { plugin })
            : t('source.plugin');
    }
    if (kind === 'goal') {
        const round = properties.round;
        return typeof round === 'number' && round > 0
            ? t('source.goalRound', { round })
            : t('source.goal');
    }
    if (typeof kind !== 'string' || kind === '')
        return t('source.unknown');
    return `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}`;
}
function MessageSource({ record, t }) {
    const source = record.cell.messageSource;
    if (source === undefined)
        return _jsx("p", { className: css.noPayload, children: t('source.notRecorded') });
    const data = typeof source === 'object' && source !== null
        ? source
        : { value: source };
    return (_jsx(JsonTree, { data: data, label: t('source.messageJson'), labels: jsonTreeLabels(t), className: css.jsonPayload }));
}
function isMarkdownRecord(record) {
    return record.cell.kind === 'user'
        || record.cell.kind === 'context'
        || record.cell.kind === 'message';
}
function parentRecords(records, record) {
    if (record.cell.kind !== 'tool' && record.cell.kind !== 'subtool')
        return {};
    const at = records.findIndex(candidate => candidate.cell.index === record.cell.index);
    if (at === -1)
        return {};
    let tool;
    if (record.cell.kind === 'subtool') {
        for (let i = at - 1; i >= 0; i--) {
            const candidate = records[i];
            if (candidate === undefined
                || candidate.turn !== record.turn
                || candidate.group !== record.group)
                break;
            if (candidate.cell.kind === 'tool') {
                tool = candidate;
                break;
            }
        }
    }
    const parentCallId = tool?.cell.callId ?? record.cell.callId;
    let message;
    if (parentCallId !== undefined) {
        message = records.find(candidate => candidate.turn === record.turn
            && candidate.cell.kind === 'message'
            && candidate.cell.sourceBlocks?.some(block => block.callId === parentCallId) === true);
    }
    return { ...(message === undefined ? {} : { message }), ...(tool === undefined ? {} : { tool }) };
}
function markdownSource(record) {
    if (record.cell.kind === 'user' || record.cell.kind === 'context') {
        return record.cell.inputDetail;
    }
    if (record.cell.kind === 'message' || record.cell.kind === 'compacted') {
        return record.cell.outputDetail;
    }
    return undefined;
}
function detailTabs(record) {
    if (record.cell.kind === 'system') {
        return record.cell.previousPromptDetail === undefined
            ? SYSTEM_PROMPT_TABS
            : SYSTEM_UPDATE_TABS;
    }
    if (record.cell.kind === 'compacted') {
        return [
            { id: 'overview', labelKey: 'tab.summary' },
            { id: 'raw', labelKey: 'tab.rawOutput' },
        ];
    }
    if (isMarkdownRecord(record)) {
        return [
            { id: 'overview', labelKey: 'tab.summary' },
            { id: 'rendered', labelKey: 'tab.preview' },
            { id: 'raw', labelKey: 'tab.raw' },
            ...(record.cell.messageSource === undefined
                ? []
                : [{ id: 'source', labelKey: 'tab.source' }]),
        ];
    }
    return [
        { id: 'overview', labelKey: 'tab.summary' },
        ...(record.cell.inputDetail ? [{ id: 'input', labelKey: 'tab.payload' }] : []),
        ...(record.cell.outputDetail ? [{ id: 'output', labelKey: 'tab.result' }] : []),
        { id: 'schema', labelKey: 'tab.schema' },
        { id: 'timing', labelKey: 'tab.timing' },
    ];
}
function recordDisplayText(cell, t) {
    if (isToolCallOnly(cell, t))
        return '';
    if (cell.previewMarkdown !== undefined) {
        const preview = trajectoryPreviewText(cell.previewMarkdown);
        if (cell.text === '')
            return preview;
        return preview === '' ? cell.text : `${cell.text} · ${preview}`;
    }
    if (cell.text !== '')
        return cell.text;
    const markdown = cell.kind === 'user' || cell.kind === 'context'
        ? cell.inputDetail
        : cell.kind === 'message'
            ? cell.outputDetail ?? cell.thinkingDetail
            : undefined;
    return markdown === undefined ? '' : trajectoryPreviewText(markdown);
}
function recordResultText(cell) {
    return cell.resultPreviewMarkdown === undefined
        ? cell.result
        : trajectoryPreviewText(cell.resultPreviewMarkdown);
}
function toolCallTextParts(kind, text) {
    if (kind !== 'tool' && kind !== 'subtool')
        return undefined;
    const separator = text.indexOf(' · ');
    if (separator === -1)
        return { name: text };
    return {
        name: text.slice(0, separator),
        args: text.slice(separator + 3),
    };
}
function isToolCallOnly(cell, t) {
    return cell.kind === 'message'
        && !cell.outputDetail
        && !cell.thinkingDetail
        && cell.text === t('layout.toolCallOnly');
}
function RecordPresentation({ cell, children, t, }) {
    const displayText = useMemo(() => recordDisplayText(cell, t), [
        cell.kind, cell.text, cell.previewMarkdown,
        cell.inputDetail, cell.outputDetail, cell.thinkingDetail, t,
    ]);
    const resultText = useMemo(() => recordResultText(cell), [cell.result, cell.resultPreviewMarkdown]);
    const toolCallOnly = isToolCallOnly(cell, t);
    const toolCallText = toolCallTextParts(cell.kind, displayText);
    const listDisplayText = toolCallOnly
        ? t('record.toolCallOnly')
        : toolCallText === undefined
            ? displayText
            : [toolCallText.name, toolCallText.args].filter(Boolean).join(' ');
    return children({
        displayText,
        listDisplayText,
        resultText,
        toolCallOnly,
        toolCallText,
    });
}
function RecordListText({ displayText, toolCallOnly, toolCallText, t, }) {
    if (toolCallOnly) {
        return _jsx("span", { className: css.toolCallOnly, children: t('record.toolCallOnly') });
    }
    if (toolCallText === undefined)
        return displayText || '—';
    return (_jsxs(_Fragment, { children: [_jsx("span", { className: css.toolCallNameTypeface, children: toolCallText.name || '—' }), toolCallText.args !== undefined && (_jsx("span", { className: css.toolCallPayload, children: toolCallText.args }))] }));
}
function MarkdownFragment({ text, rendered, preview, t, }) {
    const labels = useMemo(() => markdownLabels(t), [t]);
    if (rendered) {
        return (_jsx("div", { className: preview ? css.markdownPreview : css.markdownPayload, children: _jsx(MarkdownText, { text: text, labels: labels }) }));
    }
    return (_jsx("pre", { className: `${css.payload} ${preview ? css.payloadPreview : ''}`, children: text }));
}
function SourceBlocks({ blocks, onOpenCall, renderImages, t, }) {
    return (_jsx("div", { className: css.sourceBlocks, children: blocks.map((block, index) => (_jsxs("section", { className: css.sourceBlock, children: [block.callId !== undefined
                    ? (_jsxs("button", { type: "button", className: css.sourceBlockJumpTarget, "aria-label": t('block.openSummary', { index: index + 1 }), title: t('block.openSummaryTitle'), onClick: () => {
                            if (block.callId !== undefined)
                                onOpenCall(block.callId);
                        }, children: [_jsx("span", { className: css.sourceBlockLabel, children: t('block.label', { index: index + 1, type: block.type }) }), _jsx(IconChevronRightOutline14, { className: css.sourceBlockJumpIcon, size: 12 })] }))
                    : (_jsx("div", { className: css.sourceBlockHeader, children: _jsx("span", { className: css.sourceBlockLabel, children: t('block.label', { index: index + 1, type: block.type }) }) })), block.attachment !== undefined
                    ? renderImages({ images: [{ attachment: block.attachment }], align: 'start' })
                    : _jsx("pre", { className: css.sourceBlockContent, children: block.content })] }, index))) }));
}
function recordImages(blocks) {
    return (blocks ?? []).flatMap(block => block.attachment !== undefined ? [{ attachment: block.attachment }] : []);
}
function MessageImages({ blocks, preview, renderImages, }) {
    const images = recordImages(blocks);
    if (images.length === 0)
        return null;
    return (_jsx("div", { className: preview ? `${css.messageImages} ${css.messageImagesPreview}` : css.messageImages, children: renderImages({ images, align: 'start' }) }));
}
function AssistantToolCalls({ blocks, preview, onOpenCall, t, }) {
    const calls = blocks?.filter(block => block.type === 'tool-call') ?? [];
    if (calls.length === 0)
        return null;
    return (_jsx("ul", { className: preview
            ? `${css.assistantToolCalls} ${css.assistantToolCallsPreview}`
            : css.assistantToolCalls, children: calls.map((call, index) => (_jsx("li", { children: _jsxs("button", { type: "button", className: css.assistantToolCallButton, title: t('block.openSummaryTitle'), onClick: () => {
                    if (call.callId !== undefined)
                        onOpenCall(call.callId);
                }, children: [_jsx("svg", { className: css.assistantToolCallIcon, width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }) }), _jsxs("span", { className: css.assistantToolCallText, children: [_jsx("span", { className: css.assistantToolCallName, children: call.toolName ?? t('details.toolCall') }), call.content !== '' && (_jsx("span", { className: css.assistantToolCallArgs, children: call.content }))] })] }) }, call.callId ?? index))) }));
}
function ToolGlyph() {
    return (_jsx("svg", { className: css.toolCatalogIcon, width: "12", height: "12", viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", children: _jsx("path", { d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
function ToolCatalog({ tools, t, }) {
    if (tools.length === 0)
        return _jsx("p", { className: css.noPayload, children: t('record.toolsMissing') });
    return (_jsx("div", { className: css.toolCatalog, children: tools.map((tool, index) => (_jsxs("details", { className: css.toolCatalogItem, children: [_jsxs("summary", { className: css.toolCatalogSummary, children: [_jsx(IconChevronRightOutline14, { className: css.toolCatalogChevron, size: 12 }), _jsx(ToolGlyph, {}), _jsx("span", { className: css.toolCatalogName, children: tool.name }), _jsx("span", { className: css.toolCatalogDescription, children: tool.description })] }), _jsxs("div", { className: css.toolCatalogDefinition, children: [tool.description !== '' && (_jsx("p", { className: css.toolCatalogFullDescription, children: tool.description })), _jsx(JsonTree, { data: tool.parameters, label: t('record.namedParametersJson', { name: tool.name }), labels: jsonTreeLabels(t), className: css.toolCatalogTree })] })] }, `${tool.name}:${index}`))) }));
}
function promptDiffLines(before, after) {
    const patch = structuredPatch('', '', before, after, undefined, undefined, { context: 3 });
    return patch.hunks.flatMap((hunk, hunkIndex) => [
        ...(hunkIndex === 0 ? [] : [{ kind: 'meta', text: '' }]),
        {
            kind: 'meta',
            text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        },
        ...hunk.lines.flatMap((line) => {
            if (line.startsWith('\\'))
                return [];
            if (line.startsWith('+'))
                return [{ kind: 'added', text: line }];
            if (line.startsWith('-'))
                return [{ kind: 'removed', text: line }];
            return [{ kind: 'context', text: line }];
        }),
    ]);
}
function PromptDiffSection({ title, before, after, }) {
    const lines = promptDiffLines(before, after);
    if (lines.length === 0)
        return null;
    return (_jsxs("section", { className: css.promptDiffSection, children: [_jsx("h3", { className: css.promptDiffTitle, children: title }), _jsx("pre", { className: css.promptDiff, children: lines.map((line, index) => (_jsxs("span", { className: css[`promptDiffLine${line.kind}`], children: [line.text || ' ', '\n'] }, index))) })] }));
}
function SystemPromptDiff({ before, after, t, }) {
    const toolsBefore = JSON.stringify(before.tools, null, 2);
    const toolsAfter = JSON.stringify(after.tools, null, 2);
    return (_jsxs("div", { className: css.promptDiffSections, children: [before.system !== after.system && (_jsx(PromptDiffSection, { title: t('record.systemPrompt'), before: before.system, after: after.system })), toolsBefore !== toolsAfter && (_jsx(PromptDiffSection, { title: t('record.tools'), before: toolsBefore, after: toolsAfter }))] }));
}
function ToolOutputBlocks({ blocks, error, errorDetail, preview, renderImages, }) {
    return (_jsxs("div", { className: [
            css.resultBlocks,
            preview ? css.resultBlocksPreview : undefined,
            error ? css.errorPayload : undefined,
        ].filter((value) => value !== undefined).join(' '), children: [error && errorDetail !== undefined && errorDetail !== ''
                && _jsx("pre", { className: css.resultBlockText, children: errorDetail }), blocks.map((block, index) => (block.attachment !== undefined
                ? (_jsx("div", { className: css.messageImages, children: renderImages({ images: [{ attachment: block.attachment }], align: 'start' }) }, index))
                : block.content !== ''
                    ? _jsx("pre", { className: css.resultBlockText, children: block.content }, index)
                    : null))] }));
}
function MarkdownRecordContent({ record, rendered, preview = false, thinkingExpanded, onThinkingExpandedChange, onOpenCall, renderImages, t, }) {
    if (!rendered && record.cell.sourceBlocks && record.cell.sourceBlocks.length > 0) {
        return (_jsx(SourceBlocks, { blocks: record.cell.sourceBlocks, onOpenCall: onOpenCall, renderImages: renderImages, t: t }));
    }
    if (record.cell.thinkingDetail) {
        if (!rendered) {
            const source = [
                record.cell.thinkingDetail,
                record.cell.outputDetail,
            ].filter((value) => value !== undefined && value !== '').join('\n\n');
            return _jsx(MarkdownFragment, { text: source, rendered: false, preview: preview, t: t });
        }
        return (_jsxs("div", { className: `${css.assistantContent} ${css.assistantContentRendered}`, children: [_jsxs("div", { className: preview && !record.cell.outputDetail
                        ? `${css.thinkingQuote} ${css.thinkingQuoteOnlyPreview}`
                        : css.thinkingQuote, children: [_jsxs("button", { type: "button", className: css.thinkingToggle, "aria-expanded": thinkingExpanded, onClick: () => { onThinkingExpandedChange(!thinkingExpanded); }, children: [t('record.thinking'), _jsx(IconChevronRightOutline14, { className: css.thinkingChevron, size: 12 })] }), thinkingExpanded && (_jsx(MarkdownFragment, { text: record.cell.thinkingDetail, rendered: rendered, preview: preview, t: t }))] }), record.cell.outputDetail && (_jsx("div", { className: css.assistantOutput, children: _jsx(MarkdownFragment, { text: record.cell.outputDetail, rendered: rendered, preview: preview, t: t }) })), _jsx(AssistantToolCalls, { blocks: record.cell.sourceBlocks, preview: preview, onOpenCall: onOpenCall, t: t }), _jsx(MessageImages, { blocks: record.cell.sourceBlocks, preview: preview, renderImages: renderImages })] }));
    }
    const source = markdownSource(record);
    const hasImages = record.cell.sourceBlocks?.some(block => block.attachment !== undefined) === true;
    const hasToolCalls = record.cell.kind === 'message'
        && record.cell.sourceBlocks?.some(block => block.type === 'tool-call') === true;
    if (!source && !hasImages && !hasToolCalls) {
        const emptyLabel = isToolCallOnly(record.cell, t)
            ? t('record.toolCallOnly')
            : record.cell.text || t('record.noContent');
        return _jsx("p", { className: css.noPayload, children: emptyLabel });
    }
    if (!rendered || (!hasImages && !hasToolCalls)) {
        return _jsx(MarkdownFragment, { text: source ?? '', rendered: rendered, preview: preview, t: t });
    }
    return (_jsxs("div", { children: [source && _jsx(MarkdownFragment, { text: source, rendered: true, preview: preview, t: t }), record.cell.kind === 'message' && (_jsx(AssistantToolCalls, { blocks: record.cell.sourceBlocks, preview: preview, onOpenCall: onOpenCall, t: t })), _jsx(MessageImages, { blocks: record.cell.sourceBlocks, preview: preview, renderImages: renderImages })] }));
}
function RecordTiming({ record, t }) {
    return record.cell.kind === 'message' && record.cell.assistantMetrics !== undefined
        ? _jsx(AssistantTimingPanel, { metrics: record.cell.assistantMetrics, t: t })
        : (_jsxs("dl", { className: css.overview, children: [_jsxs("div", { children: [_jsx("dt", { children: t('timing.started') }), _jsx(StartedAtValue, { timestamp: record.cell.startedAt ?? null, t: t })] }), _jsxs("div", { children: [_jsx("dt", { children: t('timing.duration') }), _jsx("dd", { children: formatElapsedSeconds(record.cell.timeSeconds, t) })] }), _jsxs("div", { children: [_jsx("dt", { children: t('timing.source') }), _jsx("dd", { children: record.cell.timeSeconds === null ? t('timing.notAvailable') : t('timing.sessionTimestamps') })] })] }));
}
function RequestTiming({ assistant, anchor, request, t, }) {
    if (assistant !== undefined)
        return _jsx(RecordTiming, { record: assistant, t: t });
    if (request?.startedAt !== undefined) {
        const duration = request.completedAt === null || request.completedAt === undefined
            ? null
            : Math.max(0, (request.completedAt - request.startedAt) / 1000);
        return (_jsxs("dl", { className: css.overview, children: [_jsxs("div", { children: [_jsx("dt", { children: t('timing.started') }), _jsx(StartedAtValue, { timestamp: request.startedAt, t: t })] }), _jsxs("div", { children: [_jsx("dt", { children: t('timing.duration') }), _jsx("dd", { children: formatElapsedSeconds(duration, t) })] }), _jsxs("div", { children: [_jsx("dt", { children: t('timing.source') }), _jsx("dd", { children: duration === null ? t('timing.sessionTimestampsRunning') : t('timing.sessionTimestamps') })] })] }));
    }
    return (_jsxs("dl", { className: css.overview, children: [_jsxs("div", { children: [_jsx("dt", { children: t('timing.started') }), _jsx(StartedAtValue, { timestamp: anchor?.cell.startedAt ?? null, t: t })] }), _jsxs("div", { children: [_jsx("dt", { children: t('timing.duration') }), _jsx("dd", { children: formatElapsedSeconds(null, t) })] })] }));
}
function RecordPayload({ record, direction, preview = false, renderImages, t, }) {
    const value = direction === 'input' ? record.cell.inputDetail : record.cell.outputDetail;
    const missing = direction === 'input'
        ? t('record.noPayload')
        : t('record.noResult');
    if (!value)
        return _jsx("p", { className: css.noPayload, children: missing });
    const error = direction === 'output' && record.cell.isError === true;
    const payloadClass = preview ? css.jsonPreview : css.jsonPayload;
    const payloadClassName = error ? `${payloadClass} ${css.errorPayload}` : payloadClass;
    const json = parseJsonContainer(value);
    const singleTextResult = direction === 'output'
        && record.cell.outputBlocks?.length === 1
        && record.cell.outputBlocks[0]?.type === 'text';
    if (singleTextResult && json !== undefined) {
        return (_jsx(JsonTree, { data: json, label: t('record.resultJson'), labels: jsonTreeLabels(t), className: payloadClassName }));
    }
    if (direction === 'output'
        && record.cell.outputBlocks?.some(block => block.attachment !== undefined || block.content !== '') === true) {
        return (_jsx(ToolOutputBlocks, { blocks: record.cell.outputBlocks, error: error, errorDetail: error ? value : undefined, preview: preview, renderImages: renderImages }));
    }
    const markdown = (direction === 'input'
        && (record.cell.kind === 'user' || record.cell.kind === 'context')) || (direction === 'output' && record.cell.kind === 'message');
    if (markdown) {
        return (_jsx("div", { className: [
                preview ? css.markdownPreview : css.markdownPayload,
                error ? css.errorPayload : undefined,
            ].filter((className) => className !== undefined).join(' '), children: _jsx(MarkdownText, { text: value, labels: markdownLabels(t) }) }));
    }
    if (json !== undefined) {
        return (_jsx(JsonTree, { data: json, label: t(direction === 'input' ? 'record.payloadJson' : 'record.outputJson'), labels: jsonTreeLabels(t), className: payloadClassName }));
    }
    return (_jsx("pre", { className: [
            css.payload,
            preview ? css.payloadPreview : undefined,
            error ? css.errorPayload : undefined,
            value === t('record.noOutput') ? css.noOutputText : undefined,
        ].filter((value) => value !== undefined).join(' '), children: value }));
}
function RecordSchema({ record, preview = false, t, }) {
    if (!record.cell.schemaDetail) {
        return _jsx("p", { className: css.noPayload, children: t('record.schemaUnavailable') });
    }
    const schema = parseToolSchema(record.cell.schemaDetail);
    if (schema !== undefined) {
        return (_jsxs("div", { className: preview ? `${css.schema} ${css.schemaPreview}` : css.schema, children: [_jsxs("header", { className: css.schemaIntro, children: [_jsx("h3", { className: css.schemaName, children: schema.name }), _jsx("p", { className: css.schemaDescription, children: schema.description })] }), _jsxs("section", { className: css.schemaParameters, children: [_jsx("h4", { className: css.schemaParametersTitle, children: t('record.parameters') }), _jsx(JsonTree, { data: schema.parameters, label: t('record.namedParametersJson', { name: schema.name }), labels: jsonTreeLabels(t), className: css.schemaTree })] })] }));
    }
    return (_jsx("pre", { className: `${css.payload} ${preview ? css.payloadPreview : ''}`, children: record.cell.schemaDetail }));
}
function parseToolSchema(value) {
    try {
        const parsed = JSON.parse(value);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return undefined;
        const schema = parsed;
        if (typeof schema.name !== 'string'
            || typeof schema.description !== 'string'
            || typeof schema.parameters !== 'object'
            || schema.parameters === null
            || Array.isArray(schema.parameters))
            return undefined;
        return {
            name: schema.name,
            description: schema.description,
            parameters: schema.parameters,
        };
    }
    catch {
        return undefined;
    }
}
function parseJsonContainer(value) {
    try {
        const parsed = JSON.parse(value);
        return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function OverviewSection({ label, onOpen, children, }) {
    return (_jsxs("section", { className: css.overviewSection, children: [_jsx("h3", { className: css.overviewHeading, children: _jsxs("button", { type: "button", className: css.overviewTitle, onClick: onOpen, children: [_jsx("span", { children: label }), _jsx(IconChevronRightOutline14, { className: css.overviewTitleIcon, size: 12 })] }) }), _jsx("div", { className: `${css.overviewPreview} ${css.summaryScrollRegion}`, "data-summary-scroll-region": "", children: children })] }));
}
/**
 * Render trajectory events as a dense ledger with turn and step separators.
 * Clicking ledger whitespace clears the active record or request selection.
 * @param props - Grouped trajectory data and whole-ledger fold state.
 * @returns The ledger and an optional local record inspector.
 */
export function TrajectoryTable({ t, renderImages, requestNumbers: sessionRequestNumbers, turns, streamingCells = [], timelineFocusIndexes = null, searchMatchIndexes = null, onSelectedIndexChange, onRecordSelect, recordSelection = null, recordFocus = null, historyLoading = false, olderHistoryLoading = false, historyStartSeq, hasOlderRecords = false, onLoadOlder, onClearSelection, collapsedTurns, onToggleTurn, collapsedAssistants, onToggleAssistant, inspectCallId = null, onInspectApplied, }) {
    const [selectedRecordId, setSelectedRecordId] = useState(null);
    const [selectedRequest, setSelectedRequest] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');
    const [thinkingExpanded, setThinkingExpanded] = useState(false);
    const [detailsWidth, setDetailsWidth] = useState(null);
    const [toolRequestOffset, setToolRequestOffset] = useState(null);
    const detailsResizeDrag = useRef(null);
    const appliedRecordSelection = useRef(null);
    const appliedRecordFocus = useRef(null);
    const tabHistory = useRef(new Set(['overview']));
    const rootRef = useRef(null);
    const tablePaneRef = useRef(null);
    const followsTableTail = useRef(false);
    const tableScrollInitialized = useRef(false);
    const [tableScrollReady, setTableScrollReady] = useState(false);
    const pendingScrollRecordId = useRef(null);
    const loadingOlder = useRef(false);
    const [olderLoading, setOlderLoading] = useState(false);
    const olderLoadAnchor = useRef(null);
    const allRecords = useMemo(() => flattenRecords(turns), [turns]);
    const streamingCellsByIndex = useMemo(() => new Map(streamingCells.map(cell => [cell.index, cell])), [streamingCells]);
    const currentRecord = useCallback((record) => {
        const cell = streamingCellsByIndex.get(record.cell.index);
        return cell === undefined ? record : { ...record, cell };
    }, [streamingCellsByIndex]);
    const selectedTemplate = useMemo(() => selectedRecordId === null
        ? undefined
        : allRecords.find(record => trajectoryRecordId(record.cell) === selectedRecordId), [allRecords, selectedRecordId]);
    const selected = selectedTemplate === undefined
        ? undefined
        : currentRecord(selectedTemplate);
    const selectedIndex = selected?.cell.index ?? null;
    useEffect(() => {
        onSelectedIndexChange?.(selectedIndex);
    }, [onSelectedIndexChange, selectedIndex]);
    const requestGroups = useMemo(() => new Set((sessionRequestNumbers ?? []).map(request => requestKey(request.turn, request.group))), [sessionRequestNumbers]);
    const requestBoundaries = useMemo(() => indexRequestBoundaries(allRecords, requestGroups), [allRecords, requestGroups]);
    const requestNumbers = useMemo(() => indexRequestNumbers(sessionRequestNumbers), [sessionRequestNumbers]);
    const records = useMemo(() => {
        if (searchMatchIndexes !== null)
            return filterRecords(allRecords, searchMatchIndexes);
        const turnRecords = collapsedTurns.size === 0
            ? allRecords
            : collapseTurnRecords(allRecords, collapsedTurns, requestGroups, t);
        return collapsedAssistants.size === 0
            ? turnRecords
            : collapseAssistantRecords(turnRecords, collapsedAssistants, t);
    }, [allRecords, collapsedAssistants, collapsedTurns, requestGroups, searchMatchIndexes, t]);
    const projectedVirtualRows = useMemo(() => groupTrajectoryVirtualRows(records), [records]);
    const virtualRowStructure = useStableVirtualRowStructure(projectedVirtualRows);
    const virtualizationEnabled = hasOlderRecords
        || records.length > VIRTUALIZATION_THRESHOLD;
    const virtualScrollMargin = hasOlderRecords ? HISTORY_LOAD_ROW_HEIGHT_PX : 0;
    const estimateVirtualRowSize = useCallback((index) => virtualRowStructure[index]?.height ?? 30, [virtualRowStructure]);
    const getVirtualRowKey = useCallback((index) => virtualRowStructure[index]?.key ?? index, [virtualRowStructure]);
    const getTableScrollElement = useCallback(() => tablePaneRef.current, []);
    const rowVirtualizer = useVirtualizer({
        count: virtualizationEnabled ? virtualRowStructure.length : 0,
        enabled: virtualizationEnabled,
        estimateSize: estimateVirtualRowSize,
        getItemKey: getVirtualRowKey,
        getScrollElement: getTableScrollElement,
        initialRect: { width: 0, height: VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX },
        anchorTo: 'end',
        overscan: VIRTUAL_OVERSCAN_ROWS,
        scrollMargin: virtualScrollMargin,
        scrollEndThreshold: BOTTOM_FOLLOW_THRESHOLD_PX,
    });
    const virtualIndexByRecordId = useMemo(() => {
        const indexes = new Map();
        for (const [virtualIndex, row] of projectedVirtualRows.entries()) {
            for (const entry of row.entries) {
                if (entry.record.collapsedSummary === undefined) {
                    indexes.set(trajectoryRecordId(entry.record.cell), virtualIndex);
                }
            }
        }
        return indexes;
    }, [projectedVirtualRows]);
    const virtualItems = virtualizationEnabled ? rowVirtualizer.getVirtualItems() : [];
    const virtualTop = Math.max(0, (virtualItems[0]?.start ?? 0) - virtualScrollMargin);
    const virtualBottom = virtualItems.length === 0
        ? 0
        : Math.max(0, rowVirtualizer.getTotalSize()
            + virtualScrollMargin
            - (virtualItems.at(-1)?.end ?? 0));
    const renderedRecords = virtualizationEnabled
        ? virtualItems.flatMap((item) => {
            const row = projectedVirtualRows[item.index];
            if (row === undefined)
                return [];
            return row.entries.map((entry, entryIndex) => ({
                record: currentRecord(entry.record),
                position: entry.logicalIndex,
                terminalRequestBoundary: entry.record.cell.requestOnly === true
                    && row.entries.at(-1)?.record.cell.requestOnly === true
                    && entryIndex === row.entries.length - 1,
            }));
        })
        : records.map((record, position) => ({
            record: currentRecord(record),
            position,
            terminalRequestBoundary: record.cell.requestOnly === true && position === records.length - 1,
        }));
    const requestBoundaryRuns = useMemo(() => indexRequestBoundaryRuns(records, requestGroups), [records, requestGroups]);
    const selectedPrompt = selected?.cell.kind === 'system'
        ? selected.cell.promptDetail
        : undefined;
    const selectedPreviousPrompt = selected?.cell.kind === 'system'
        ? selected.cell.previousPromptDetail
        : undefined;
    const promptSelected = selectedPrompt !== undefined;
    const selectedState = selected === undefined ? undefined : stateOf(selected);
    const selectedRequestInfo = selectedRequest === null
        ? undefined
        : sessionRequestNumbers?.find(request => requestIdentity(request) === selectedRequest.identity);
    const selectedRequestRecordTemplates = useMemo(() => selectedRequestInfo === undefined
        ? []
        : allRecords.filter(record => record.turn === selectedRequestInfo.turn
            && record.group === selectedRequestInfo.group), [allRecords, selectedRequestInfo]);
    const selectedRequestRecords = selectedRequestRecordTemplates.map(currentRecord);
    const selectedRequestAssistant = selectedRequestRecords.find(record => record.cell.kind === 'message');
    const selectedRequestAnchor = selectedRequestAssistant ?? selectedRequestRecords[0];
    const selectedRequestNumber = selectedRequestInfo?.number;
    const selectedRequestState = selectedRequestInfo === undefined
        ? undefined
        : selectedRequestInfo.status
            ?? (selectedRequestAssistant?.cell.assistantMetrics?.completedTime === null
                ? 'running'
                : selectedRequestAssistant === undefined
                    && selectedRequestRecords.some(record => stateOf(record) === 'running')
                    ? 'running'
                    : 'complete');
    const selectedRequestToolCalls = selectedRequestRecords.filter(record => record.cell.kind === 'tool').length;
    const selectedRequestSubtoolCalls = selectedRequestRecords.filter(record => record.cell.kind === 'subtool').length;
    const selectedRequestResultTemplate = selectedRequestInfo?.resultSeq === undefined
        ? selectedRequestAssistant
        : allRecords.find(record => record.cell.sourceSeq === selectedRequestInfo.resultSeq);
    const selectedRequestResult = selectedRequestResultTemplate === undefined
        ? undefined
        : currentRecord(selectedRequestResultTemplate);
    const selectedRequestUsage = selectedRequestInfo?.usage ?? (selectedRequestAssistant === undefined
        ? undefined
        : {
            ...(selectedRequestAssistant.cell.input === undefined
                ? {}
                : { input: selectedRequestAssistant.cell.input }),
            ...(selectedRequestAssistant.cell.cacheRead === undefined
                ? {}
                : { cacheRead: selectedRequestAssistant.cell.cacheRead }),
            ...(selectedRequestAssistant.cell.cacheWrite === undefined
                ? {}
                : { cacheWrite: selectedRequestAssistant.cell.cacheWrite }),
            ...(selectedRequestAssistant.cell.output === undefined
                ? {}
                : { output: selectedRequestAssistant.cell.output }),
            ...(selectedRequestAssistant.cell.think === undefined
                ? {}
                : { reasoning: selectedRequestAssistant.cell.think }),
        });
    const selectedRequestCumulativeUsage = selectedRequestInfo?.cumulativeUsage ?? selectedRequestUsage;
    const selectedRequestOptions = selectedRequestInfo?.requestConfig;
    const activeTurn = selectedRequestInfo === undefined ? selected?.turn : selectedRequestInfo.turn;
    const activeSection = selectedRequestInfo === undefined
        ? selected?.section
        : selectedRequestRecords[0]?.section;
    const selectedTabs = selectedRequestInfo !== undefined
        ? REQUEST_TABS.filter(tab => tab.id !== 'options' || selectedRequestOptions !== undefined)
        : selected === undefined ? [] : detailTabs(selected);
    const selectedParents = selected === undefined
        ? {}
        : parentRecords(allRecords, selected);
    const selectedParentMessage = selectedParents.message;
    const selectedParentTool = selectedParents.tool;
    const selectedAssistantRequest = selected?.cell.kind === 'message'
        ? requestNumbers.get(requestKey(selected.turn, selected.group))
        : undefined;
    const selectedAssistantRequestInfo = selectedAssistantRequest === undefined
        ? undefined
        : sessionRequestNumbers?.find(request => request.number === selectedAssistantRequest);
    const selectedAssistantRequestTarget = selectedAssistantRequestInfo === undefined
        ? undefined
        : { identity: requestIdentity(selectedAssistantRequestInfo) };
    const hasSelectedHierarchy = selectedAssistantRequestTarget !== undefined
        || selectedParents.message !== undefined
        || selectedParents.tool !== undefined;
    const splitStyle = toolRequestOffset === null
        ? undefined
        : {
            '--trajectory-tool-request-width': `calc(58cqw - ${toolRequestOffset}px)`,
        };
    const activateTab = (tab) => {
        tabHistory.current.delete(tab);
        tabHistory.current.add(tab);
        setActiveTab(tab);
    };
    const clearInspectorSelection = () => {
        setSelectedRecordId(null);
        setSelectedRequest(null);
    };
    const clearAllSelections = () => {
        clearInspectorSelection();
        onClearSelection?.();
    };
    const selectRecord = useCallback((index) => {
        const record = allRecords.find(candidate => candidate.cell.index === index);
        onRecordSelect?.(index);
        setSelectedRequest(null);
        setSelectedRecordId(record === undefined ? null : trajectoryRecordId(record.cell));
        if (record === undefined)
            return;
        const tabs = detailTabs(record);
        const available = new Set(tabs.map(tab => tab.id));
        const recent = [...tabHistory.current].reverse().find(tab => available.has(tab));
        setActiveTab(recent ?? tabs[0]?.id ?? 'overview');
    }, [allRecords, onRecordSelect]);
    useEffect(() => {
        if (recordSelection === null
            || appliedRecordSelection.current === recordSelection)
            return;
        appliedRecordSelection.current = recordSelection;
        selectRecord(recordSelection.index);
        const record = allRecords.find(candidate => candidate.cell.index === recordSelection.index);
        pendingScrollRecordId.current = record === undefined
            ? null
            : trajectoryRecordId(record.cell);
    }, [allRecords, recordSelection, selectRecord]);
    useEffect(() => {
        if (recordFocus === null || appliedRecordFocus.current === recordFocus)
            return;
        appliedRecordFocus.current = recordFocus;
        const record = allRecords.find(candidate => candidate.cell.index === recordFocus.index);
        pendingScrollRecordId.current = record === undefined
            ? null
            : trajectoryRecordId(record.cell);
    }, [allRecords, recordFocus]);
    const selectRequest = (request, tab = 'overview') => {
        setSelectedRecordId(null);
        setSelectedRequest(request);
        activateTab(tab);
    };
    const openRecordSummary = (target) => {
        const targetAt = allRecords.findIndex(record => record.cell.index === target.cell.index);
        if (target.turn !== null && collapsedTurns.has(target.turn))
            onToggleTurn(target.turn);
        if (target.cell.kind === 'tool' || target.cell.kind === 'subtool') {
            for (let i = targetAt - 1; i >= 0; i--) {
                const candidate = allRecords[i];
                if (candidate === undefined || candidate.turn !== target.turn)
                    break;
                if (candidate.cell.kind !== 'message')
                    continue;
                const assistantId = trajectoryRecordId(candidate.cell);
                if (collapsedAssistants.has(assistantId))
                    onToggleAssistant(assistantId);
                break;
            }
        }
        setSelectedRequest(null);
        setSelectedRecordId(trajectoryRecordId(target.cell));
        activateTab('overview');
    };
    const openCallSummary = (callId) => {
        const target = allRecords.find(record => record.cell.callId === callId);
        if (target !== undefined)
            openRecordSummary(target);
    };
    // Cross-view inspect handoff: resolve the requested call to its record,
    // open its summary, and remember the row to scroll once the un-collapsed
    // ledger has rendered. Not-found leaves the request pending (`turns` in the
    // deps retries as history pages in); the ack clears the store field.
    const openRecordSummaryRef = useRef(openRecordSummary);
    openRecordSummaryRef.current = openRecordSummary;
    useEffect(() => {
        if (inspectCallId === null)
            return;
        const target = flattenRecords(turns).find(record => record.cell.callId === inspectCallId);
        if (target === undefined)
            return;
        openRecordSummaryRef.current(target);
        pendingScrollRecordId.current = trajectoryRecordId(target.cell);
        onInspectApplied?.();
    }, [inspectCallId, turns, onInspectApplied]);
    useEffect(() => {
        const id = pendingScrollRecordId.current;
        if (id === null)
            return;
        const position = records.findIndex(record => trajectoryRecordId(record.cell) === id && record.collapsedSummary === undefined);
        if (position === -1)
            return;
        if (virtualizationEnabled) {
            const virtualIndex = virtualIndexByRecordId.get(id);
            if (virtualIndex === undefined)
                return;
            pendingScrollRecordId.current = null;
            followsTableTail.current = false;
            rowVirtualizer.scrollToIndex(virtualIndex, { behavior: 'smooth', align: 'center' });
            return;
        }
        pendingScrollRecordId.current = null;
        followsTableTail.current = false;
        const recordIndex = records[position]?.cell.index;
        const row = recordIndex === undefined
            ? null
            : rootRef.current?.querySelector(`tr[data-record-index="${recordIndex}"]`);
        /* v8 ignore next -- jsdom lacks scrollIntoView; browsers always have it. */
        if (row !== undefined && row !== null && typeof row.scrollIntoView === 'function') {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [records, rowVirtualizer, virtualIndexByRecordId, virtualizationEnabled]);
    useEffect(() => {
        if (timelineFocusIndexes === null || timelineFocusIndexes.size === 0)
            return;
        const focusedPositions = records.flatMap((record, position) => record.collapsedSummary === undefined
            && record.cell.requestOnly !== true
            && timelineFocusIndexes.has(record.cell.index)
            ? [position]
            : []);
        const first = focusedPositions.at(0);
        const last = focusedPositions.at(-1);
        if (first === undefined || last === undefined)
            return;
        if (!virtualizationEnabled) {
            const ledger = rootRef.current;
            if (ledger === null)
                return;
            const focusedRows = [
                ...ledger.querySelectorAll('tr[data-timeline-focus="inside"]'),
            ];
            const firstRow = focusedRows.at(0);
            const lastRow = focusedRows.at(-1);
            if (firstRow === undefined || lastRow === undefined)
                return;
            const focusHeight = lastRow.getBoundingClientRect().bottom - firstRow.getBoundingClientRect().top;
            const target = focusHeight > ledger.clientHeight
                ? firstRow
                : focusedRows[Math.floor((focusedRows.length - 1) / 2)];
            /* v8 ignore next -- jsdom lacks scrollIntoView; browsers always have it. */
            if (target !== undefined && typeof target.scrollIntoView === 'function') {
                followsTableTail.current = false;
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: focusHeight > ledger.clientHeight ? 'start' : 'center',
                });
            }
            return;
        }
        const focusedVirtualIndexes = [...new Set(focusedPositions.flatMap((position) => {
                const record = records[position];
                if (record === undefined)
                    return [];
                const virtualIndex = virtualIndexByRecordId.get(trajectoryRecordId(record.cell));
                return virtualIndex === undefined ? [] : [virtualIndex];
            }))].sort((left, right) => left - right);
        const firstVirtual = focusedVirtualIndexes.at(0);
        const lastVirtual = focusedVirtualIndexes.at(-1);
        if (firstVirtual === undefined || lastVirtual === undefined)
            return;
        const paneHeight = tablePaneRef.current?.clientHeight ?? 0;
        const focusHeight = projectedVirtualRows
            .slice(firstVirtual, lastVirtual + 1)
            .reduce((height, row) => height + row.height, 0);
        followsTableTail.current = false;
        rowVirtualizer.scrollToIndex(focusHeight > paneHeight
            ? firstVirtual
            : focusedVirtualIndexes[Math.floor((focusedVirtualIndexes.length - 1) / 2)]
                ?? firstVirtual, {
            behavior: 'smooth',
            align: focusHeight > paneHeight ? 'start' : 'center',
        });
    }, [
        projectedVirtualRows,
        records,
        rowVirtualizer,
        timelineFocusIndexes,
        virtualIndexByRecordId,
        virtualizationEnabled,
    ]);
    const requestOlder = useCallback((pane, requireTop) => {
        if (!hasOlderRecords
            || onLoadOlder === undefined
            || loadingOlder.current
            || olderHistoryLoading
            || (requireTop && pane.scrollTop > OLDER_LOAD_THRESHOLD_PX))
            return;
        loadingOlder.current = true;
        setOlderLoading(true);
        olderLoadAnchor.current = {
            historyStartSeq,
            scrollHeight: pane.scrollHeight,
            scrollTop: pane.scrollTop,
        };
        void onLoadOlder().then((advanced) => {
            if (!advanced)
                olderLoadAnchor.current = null;
        }).finally(() => {
            loadingOlder.current = false;
            setOlderLoading(false);
        });
    }, [hasOlderRecords, historyStartSeq, olderHistoryLoading, onLoadOlder]);
    useLayoutEffect(() => {
        const pane = tablePaneRef.current;
        if (pane === null)
            return;
        const anchor = olderLoadAnchor.current;
        if (anchor !== null && anchor.historyStartSeq !== historyStartSeq) {
            if (!virtualizationEnabled) {
                pane.scrollTop = anchor.scrollTop + pane.scrollHeight - anchor.scrollHeight;
            }
            olderLoadAnchor.current = null;
            followsTableTail.current = false;
            return;
        }
        if (!tableScrollInitialized.current) {
            if (historyLoading)
                return;
            tableScrollInitialized.current = true;
            followsTableTail.current = true;
            if (virtualizationEnabled)
                rowVirtualizer.scrollToEnd({ behavior: 'auto' });
            else
                pane.scrollTop = pane.scrollHeight;
            setTableScrollReady(true);
            return;
        }
        if (!followsTableTail.current)
            return;
        if (virtualizationEnabled)
            rowVirtualizer.scrollToEnd({ behavior: 'auto' });
        else
            pane.scrollTop = pane.scrollHeight;
    }, [
        historyLoading,
        historyStartSeq,
        rowVirtualizer,
        virtualRowStructure,
        virtualizationEnabled,
    ]);
    const olderBusy = olderHistoryLoading || olderLoading;
    const showInitialLoading = historyLoading || !tableScrollReady;
    const historyRowOffset = hasOlderRecords ? 1 : 0;
    return (_jsxs("div", { ref: rootRef, className: css.split, style: splitStyle, children: [_jsxs("div", { ref: tablePaneRef, className: css.tablePane, "data-trajectory-scroll": "", onScroll: (event) => {
                    const pane = event.currentTarget;
                    followsTableTail.current =
                        pane.scrollHeight - pane.clientHeight - pane.scrollTop
                            <= BOTTOM_FOLLOW_THRESHOLD_PX;
                    requestOlder(pane, true);
                }, onClick: (event) => {
                    if (event.target === event.currentTarget)
                        clearAllSelections();
                }, children: [showInitialLoading && (_jsx("div", { className: css.historyLoading, role: "status", "aria-live": "polite", children: _jsxs("span", { className: css.historyLoadingBar, children: [_jsx("span", { className: css.historyLoadingSpinner, "aria-hidden": "true" }), t('history.loadingTrajectory')] }) })), _jsxs("table", { className: css.table, "data-scroll-ready": tableScrollReady || undefined, "aria-rowcount": records.length + historyRowOffset, children: [_jsxs("colgroup", { children: [_jsx("col", { className: css.eventColumn }), _jsx("col", { className: css.contentColumn })] }), _jsxs("tbody", { children: [hasOlderRecords && (_jsx("tr", { className: css.historyLoadRow, "data-history-load": "", "aria-rowindex": 1, children: _jsx("td", { colSpan: 2, children: _jsxs("button", { type: "button", className: css.historyLoadButton, disabled: olderBusy || onLoadOlder === undefined, "aria-label": olderBusy
                                                    ? t('history.loadingEarlierAria')
                                                    : t('history.loadEarlier'), onClick: () => {
                                                    const pane = tablePaneRef.current;
                                                    if (pane !== null)
                                                        requestOlder(pane, false);
                                                }, children: [olderBusy && (_jsx("span", { className: css.historyLoadingSpinner, "aria-hidden": "true" })), _jsx("span", { "aria-hidden": "true", children: olderBusy ? t('history.loadingEarlier') : t('history.loadEarlier') }), _jsx("span", { className: css.visuallyHidden, role: "status", "aria-live": "polite", children: olderBusy ? t('history.loadingEarlier') : '' })] }) }) })), virtualTop > 0 && (_jsx("tr", { className: css.virtualSpacer, "data-virtual-spacer": "top", "aria-hidden": "true", children: _jsx("td", { colSpan: 2, style: {
                                                '--trajectory-virtual-spacer-height': `${virtualTop}px`,
                                            } }) })), renderedRecords.map(({ record, position, terminalRequestBoundary }) => (_jsx(RecordPresentation, { cell: record.cell, t: t, children: ({ displayText, listDisplayText, resultText, toolCallOnly, toolCallText }) => {
                                            const isCollapsedSummary = record.collapsedSummary !== undefined;
                                            const isRequestOnly = record.cell.requestOnly === true;
                                            const isInitialSystem = record.cell.kind === 'system'
                                                && record.cell.index === allRecords[0]?.cell.index;
                                            const key = requestKey(record.turn, record.group);
                                            const request = requestBoundaries.get(key) === record.cell.index
                                                && !isCollapsedSummary
                                                && (record.turn === null || !collapsedTurns.has(record.turn))
                                                ? requestNumbers.get(key)
                                                : undefined;
                                            const requestInfo = request === undefined
                                                ? undefined
                                                : sessionRequestNumbers?.find(candidate => candidate.number === request);
                                            const requestStatus = requestInfo?.status
                                                ?? (record.cell.isError === true ? 'error' : undefined);
                                            const requestRunIndex = requestBoundaryRuns.get(record.cell.index) ?? 0;
                                            const requestBoundaryStyle = {
                                                '--request-boundary-offset': `${requestRunIndex * 8}px`,
                                            };
                                            const requestLabel = request === undefined
                                                ? undefined
                                                : t(requestInfo?.purpose === 'compaction'
                                                    ? 'request.labelCompaction'
                                                    : 'request.label', { request });
                                            const requestSelected = requestInfo !== undefined
                                                && selectedRequest?.identity === requestIdentity(requestInfo);
                                            const sectionActive = record.turn === null
                                                ? activeSection === record.section
                                                : activeTurn === record.turn;
                                            return (_jsxs("tr", { tabIndex: isRequestOnly ? -1 : 0, "aria-rowindex": position + 1 + historyRowOffset, "aria-label": isCollapsedSummary
                                                    ? t('request.collapsedSummary', {
                                                        kind: t(record.collapsedSummaryKind === 'turn'
                                                            ? 'request.collapsedTurn'
                                                            : 'request.collapsedAssistant'),
                                                        summary: record.collapsedSummary,
                                                    })
                                                    : isRequestOnly
                                                        ? t('request.rowAriaCompaction', { request: request ?? '' })
                                                        : t('request.rowAria', {
                                                            request: request === undefined ? '' : t('request.rowPrefix', { request }),
                                                            kind: t(KIND_LABEL_KEY[record.cell.kind]),
                                                            content: listDisplayText || t('request.noContent'),
                                                        }), "aria-selected": !isCollapsedSummary && !isRequestOnly && selectedIndex === record.cell.index, "data-kind": record.cell.kind, "data-trajectory-row-key": trajectoryVirtualRecordKey(record), "data-virtual-position": virtualizationEnabled ? position : undefined, "data-record-index": !isCollapsedSummary && !isRequestOnly
                                                    ? record.cell.index
                                                    : undefined, "data-request-only": isRequestOnly || undefined, "data-terminal-request-boundary": terminalRequestBoundary || undefined, "data-group-start": record.groupStart || undefined, "data-turn-start": record.turnStart || undefined, "data-error": record.cell.isError || undefined, "data-running": stateOf(record) === 'running' || undefined, "data-turn-end": record.turnEnd || undefined, "data-collapsed-summary": record.collapsedSummaryKind, "data-selected": !isCollapsedSummary && selectedIndex === record.cell.index || undefined, "data-timeline-focus": isCollapsedSummary || timelineFocusIndexes === null
                                                    ? undefined
                                                    : timelineFocusIndexes.has(record.cell.index) ? 'inside' : 'outside', onClick: isRequestOnly
                                                    ? undefined
                                                    : isCollapsedSummary
                                                        ? () => {
                                                            if (record.collapsedSummaryKind === 'turn' && record.turn !== null) {
                                                                onToggleTurn(record.turn);
                                                            }
                                                            else
                                                                onToggleAssistant(trajectoryRecordId(record.cell));
                                                        }
                                                        : () => { selectRecord(record.cell.index); }, onDoubleClick: (event) => {
                                                    if (isCollapsedSummary || isRequestOnly)
                                                        return;
                                                    if (record.turn !== null && collapsedTurns.has(record.turn)) {
                                                        event.preventDefault();
                                                        onToggleTurn(record.turn);
                                                        return;
                                                    }
                                                    if (record.cell.kind === 'message'
                                                        && assistantToolCalls(allRecords, record.cell.index).length > 0) {
                                                        event.preventDefault();
                                                        onToggleAssistant(trajectoryRecordId(record.cell));
                                                        return;
                                                    }
                                                    if (!record.turnStart)
                                                        return;
                                                    if (record.turn === null)
                                                        return;
                                                    if (allRecords.filter(candidate => candidate.turn === record.turn
                                                        && candidate.cell.requestOnly !== true
                                                        && candidate.cell.kind !== 'system').length <= 1)
                                                        return;
                                                    event.preventDefault();
                                                    onToggleTurn(record.turn);
                                                }, onKeyDown: (event) => {
                                                    if (isRequestOnly)
                                                        return;
                                                    if (event.key !== 'Enter' && event.key !== ' ')
                                                        return;
                                                    event.preventDefault();
                                                    if (isCollapsedSummary) {
                                                        if (record.collapsedSummaryKind === 'turn' && record.turn !== null) {
                                                            onToggleTurn(record.turn);
                                                        }
                                                        else
                                                            onToggleAssistant(trajectoryRecordId(record.cell));
                                                        return;
                                                    }
                                                    selectRecord(record.cell.index);
                                                }, children: [_jsxs("td", { className: css.event, children: [request !== undefined && (_jsx("button", { type: "button", className: requestSelected
                                                                    ? `${css.requestBoundaryControl} ${css.requestBoundaryControlActive}`
                                                                    : css.requestBoundaryControl, "aria-label": requestLabel, "aria-pressed": requestSelected, "data-label": requestLabel, "data-request-run-index": requestRunIndex, "data-request-status": requestStatus, style: requestBoundaryStyle, onClick: (event) => {
                                                                    event.stopPropagation();
                                                                    if (requestInfo !== undefined) {
                                                                        selectRequest({ identity: requestIdentity(requestInfo) });
                                                                    }
                                                                }, onDoubleClick: (event) => { event.stopPropagation(); } })), record.turn !== null
                                                                && activeTurn === record.turn
                                                                && !isInitialSystem && (_jsx("span", { className: css.turnRail, "aria-hidden": "true" })), !isCollapsedSummary && selectedIndex === record.cell.index && (_jsx("span", { className: css.selectionRail, "aria-hidden": "true" })), !isCollapsedSummary
                                                                && !isRequestOnly
                                                                && record.turnStart && (_jsx("span", { className: sectionActive
                                                                    ? `${css.turnLabel} ${css.turnLabelActive}`
                                                                    : css.turnLabel, "aria-label": sectionLabel(record.turn, t), children: record.turn === null
                                                                    ? sectionLabel(record.turn, t)
                                                                    : (_jsxs(_Fragment, { children: [_jsx("span", { className: css.turnLabelFull, "aria-hidden": "true", children: sectionLabel(record.turn, t) }), _jsxs("span", { className: css.turnLabelCompact, "aria-hidden": "true", children: ["#", record.turn] })] })) })), _jsx("div", { className: css.eventInner, children: !isCollapsedSummary && !isRequestOnly && (_jsx("span", { className: css.kindSlot, children: _jsxs("span", { className: `${css.kindTag} ${record.cell.kind === 'system'
                                                                            ? css.systemNeutral
                                                                            : record.cell.kind === 'context'
                                                                                ? css.contextGreen
                                                                                : record.cell.kind === 'compacted'
                                                                                    ? css.compacted
                                                                                    : record.cell.kind === 'tool'
                                                                                        ? css.toolAmber
                                                                                        : record.cell.kind === 'message'
                                                                                            ? css.assistantVioletBright
                                                                                            : record.cell.kind === 'subtool'
                                                                                                ? css.subtoolAmber
                                                                                                : css[record.cell.kind]}`, "data-role-kind": record.cell.kind, children: [_jsx(Tooltip, { label: t(KIND_LABEL_KEY[record.cell.kind]), side: "right", children: _jsx("span", { className: css.kindTagIcon, "aria-hidden": "true", children: KIND_ICON[record.cell.kind] }) }), _jsx("span", { className: css.kindTagLabel, children: t(KIND_LABEL_KEY[record.cell.kind]) })] }) })) })] }), _jsx("td", { className: css.content, children: isRequestOnly
                                                            ? null
                                                            : record.collapsedSummary !== undefined
                                                                ? (_jsxs("span", { className: css.collapsedTurnContent, title: record.collapsedSummary, children: [_jsx("span", { className: css.collapsedTurnEllipsis, children: "\u2026" }), _jsx("span", { className: css.collapsedTurnText, children: record.collapsedSummary })] }))
                                                                : (_jsxs("span", { className: resultText === undefined ? css.contentText : css.resultPreview, title: resultText === undefined
                                                                        ? listDisplayText
                                                                        : `${listDisplayText} → ${resultText}`, children: [_jsx("span", { className: resultText === undefined ? undefined : css.resultRequest, children: _jsx(RecordListText, { displayText: displayText, toolCallOnly: toolCallOnly, toolCallText: toolCallText, t: t }) }), resultText !== undefined && (_jsxs("span", { className: record.cell.isError ? `${css.inlineResult} ${css.error}` : css.inlineResult, children: [_jsx("span", { className: css.arrow, children: "\u2192" }), _jsx("span", { className: resultText === t('record.noOutput')
                                                                                        ? `${css.inlineResultText} ${css.noOutputText}`
                                                                                        : css.inlineResultText, children: resultText })] }))] })) })] }));
                                        } }, trajectoryVirtualRecordKey(record)))), virtualBottom > 0 && (_jsx("tr", { className: css.virtualSpacer, "data-virtual-spacer": "bottom", "aria-hidden": "true", children: _jsx("td", { colSpan: 2, style: {
                                                '--trajectory-virtual-spacer-height': `${virtualBottom}px`,
                                            } }) }))] })] })] }), (selectedRequestInfo !== undefined
                || promptSelected
                || (selected !== undefined && selectedState !== undefined)) && (_jsxs("aside", { className: css.details, "aria-label": t('details.event'), style: detailsWidth === null ? undefined : { width: detailsWidth }, children: [_jsx("div", { className: css.detailsResizeHandle, role: "separator", "aria-label": t('details.resize'), "aria-controls": "trajectory-detail-panel", "aria-orientation": "vertical", tabIndex: 0, title: t('details.resizeTitle'), onDoubleClick: () => {
                            setDetailsWidth(null);
                            setToolRequestOffset(null);
                        }, onPointerDown: (event) => {
                            if (event.button !== 0)
                                return;
                            const details = event.currentTarget.parentElement;
                            if (details === null)
                                return;
                            const split = details.parentElement;
                            if (split === null)
                                return;
                            const splitWidth = split.getBoundingClientRect().width;
                            detailsResizeDrag.current = {
                                pointerId: event.pointerId,
                                startX: event.clientX,
                                startWidth: details.getBoundingClientRect().width,
                                splitWidth,
                                startToolRequestOffset: toolRequestOffset ?? (splitWidth * TOOL_REQUEST_SHARE - defaultToolRequestWidth(splitWidth)),
                            };
                            event.currentTarget.setPointerCapture(event.pointerId);
                            event.preventDefault();
                        }, onPointerMove: (event) => {
                            const drag = detailsResizeDrag.current;
                            if (drag === null || drag.pointerId !== event.pointerId)
                                return;
                            const nextDetailsWidth = clampDetailsWidth(drag.startWidth + drag.startX - event.clientX, drag.splitWidth);
                            setDetailsWidth(nextDetailsWidth);
                            setToolRequestOffset(drag.startToolRequestOffset
                                + (nextDetailsWidth - drag.startWidth) * TOOL_REQUEST_SHARE);
                        }, onPointerUp: (event) => {
                            if (detailsResizeDrag.current?.pointerId !== event.pointerId)
                                return;
                            detailsResizeDrag.current = null;
                            event.currentTarget.releasePointerCapture(event.pointerId);
                        }, onPointerCancel: () => {
                            detailsResizeDrag.current = null;
                        }, onKeyDown: (event) => {
                            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                                return;
                            const details = event.currentTarget.parentElement;
                            if (details === null)
                                return;
                            const split = details.parentElement;
                            if (split === null)
                                return;
                            const direction = event.key === 'ArrowLeft' ? 1 : -1;
                            const currentDetailsWidth = details.getBoundingClientRect().width;
                            const splitWidth = split.getBoundingClientRect().width;
                            const nextDetailsWidth = clampDetailsWidth(currentDetailsWidth + direction * DETAILS_RESIZE_STEP, splitWidth);
                            const currentToolRequestOffset = toolRequestOffset ?? (splitWidth * TOOL_REQUEST_SHARE - defaultToolRequestWidth(splitWidth));
                            setDetailsWidth(nextDetailsWidth);
                            setToolRequestOffset(currentToolRequestOffset
                                + (nextDetailsWidth - currentDetailsWidth) * TOOL_REQUEST_SHARE);
                            event.preventDefault();
                        } }), _jsxs("div", { className: css.detailsHeader, children: [_jsx("div", { className: css.detailsTitle, children: selectedRequestInfo !== undefined
                                    ? (_jsxs(_Fragment, { children: [_jsx("span", { className: css.requestDetailsDot, "aria-hidden": "true" }), _jsx("span", { className: css.requestDetailsName, children: t('request.label', { request: selectedRequestNumber ?? '—' }) }), _jsx("span", { className: css.detailsLocation, children: selectedRequestInfo.purpose === 'compaction'
                                                    ? t('request.compaction', { section: sectionLabel(selectedRequestInfo.turn, t) })
                                                    : sectionLabel(selectedRequestInfo.turn, t) })] }))
                                    : promptSelected
                                        ? (_jsxs(_Fragment, { children: [_jsx("span", { className: `${css.kindTag} ${css.systemNeutral}`, children: t('kind.system') }), _jsx("span", { className: css.detailsLocation, children: selected?.cell.text })] }))
                                        : selected !== undefined && (_jsxs(_Fragment, { children: [_jsx("span", { className: `${css.kindTag} ${selected.cell.kind === 'context'
                                                        ? css.contextGreen
                                                        : selected.cell.kind === 'compacted'
                                                            ? css.compacted
                                                            : selected.cell.kind === 'tool'
                                                                ? css.toolAmber
                                                                : selected.cell.kind === 'message'
                                                                    ? css.assistantVioletBright
                                                                    : selected.cell.kind === 'subtool'
                                                                        ? css.subtoolAmber
                                                                        : css[selected.cell.kind]}`, children: t(KIND_LABEL_KEY[selected.cell.kind]) }), _jsx("span", { className: css.detailsLocation, children: selected.cell.kind === 'compacted'
                                                        ? sectionLabel(selected.turn, t)
                                                        : `${sectionLabel(selected.turn, t)} · ${selected.group}` })] })) }), _jsx("button", { type: "button", className: css.close, "aria-label": t('details.close'), onClick: clearInspectorSelection, children: _jsx("span", { "aria-hidden": "true", children: "\u00D7" }) })] }), _jsx("div", { className: css.detailTabs, role: "tablist", "aria-label": t('details.event'), children: selectedTabs.map(tab => (_jsx("button", { id: `trajectory-detail-${tab.id}`, type: "button", role: "tab", "aria-controls": "trajectory-detail-panel", "aria-selected": activeTab === tab.id, className: activeTab === tab.id ? `${css.detailTab} ${css.detailTabActive}` : css.detailTab, onClick: () => { activateTab(tab.id); }, children: t(tab.labelKey) }, tab.id))) }), _jsxs("div", { id: "trajectory-detail-panel", className: activeTab === 'overview'
                            ? `${css.detailBody} ${css.detailBodySummary}`
                            : css.detailBody, role: "tabpanel", "aria-labelledby": `trajectory-detail-${activeTab}`, children: [selectedRequestInfo !== undefined
                                && selectedRequestState !== undefined
                                && activeTab === 'overview' && (_jsxs(_Fragment, { children: [_jsxs("dl", { className: `${css.overview} ${css.summaryScrollRegion}`, "data-summary-scroll-region": "", children: [_jsxs("div", { children: [_jsx("dt", { children: t('details.status') }), _jsx("dd", { className: selectedRequestState === 'error' ? css.error : undefined, children: statusLabel(selectedRequestState, t) })] }), selectedRequestInfo.purpose === 'compaction' && (_jsxs("div", { children: [_jsx("dt", { children: t('details.purpose') }), _jsx("dd", { children: t('request.compactionPurpose') })] })), (selectedRequestInfo.provider
                                                ?? selectedRequestInfo.requestConfig?.provider) !== undefined && (_jsxs("div", { children: [_jsx("dt", { children: t('details.provider') }), _jsx("dd", { children: selectedRequestInfo.provider
                                                            ?? selectedRequestInfo.requestConfig?.provider })] })), (selectedRequestInfo.model
                                                ?? selectedRequestInfo.requestConfig?.model) !== undefined && (_jsxs("div", { children: [_jsx("dt", { children: t('details.model') }), _jsx("dd", { children: selectedRequestInfo.model
                                                            ?? selectedRequestInfo.requestConfig?.model })] })), _jsxs("div", { children: [_jsx("dt", { children: t('details.toolCalls') }), _jsx("dd", { children: selectedRequestToolCalls })] }), selectedRequestSubtoolCalls > 0 && (_jsxs("div", { children: [_jsx("dt", { children: t('details.subtoolCalls') }), _jsx("dd", { children: selectedRequestSubtoolCalls })] })), selectedRequestInfo.error !== undefined && (_jsxs("div", { children: [_jsx("dt", { children: t('details.error') }), _jsx("dd", { className: css.error, children: requestErrorMessage(selectedRequestInfo, t) })] })), selectedRequestInfo.retry !== undefined && (_jsxs("div", { children: [_jsx("dt", { children: t('details.retry') }), _jsxs("dd", { children: [t('details.scheduled'), " ", selectedRequestInfo.maxRetries === undefined
                                                                ? selectedRequestInfo.retry
                                                                : t('request.retryProgress', {
                                                                    retry: selectedRequestInfo.retry,
                                                                    maximum: selectedRequestInfo.maxRetries,
                                                                })] })] })), selectedRequestInfo.retryDelayMs !== undefined && (_jsxs("div", { children: [_jsx("dt", { children: t('details.retryDelay') }), _jsx("dd", { children: formatDurationMs(selectedRequestInfo.retryDelayMs, t) })] })), selectedRequestResult !== undefined && (_jsxs("div", { children: [_jsx("dt", { children: t('details.result') }), _jsx("dd", { className: css.overviewParentLinks, children: _jsxs("button", { type: "button", className: css.overviewHierarchyNavLink, onClick: () => {
                                                                openRecordSummary(selectedRequestResult);
                                                            }, children: [_jsx("span", { children: selectedRequestInfo.purpose === 'compaction'
                                                                        ? t('details.compacted')
                                                                        : t('details.assistantMessage') }), _jsx(IconChevronRightOutline14, { className: css.overviewHierarchyJumpIconTight, size: 11 })] }) })] }))] }), _jsxs("div", { className: css.overviewSections, children: [selectedRequestOptions !== undefined && (_jsx(OverviewSection, { label: t('tab.options'), onOpen: () => { activateTab('options'); }, children: _jsx(RequestOptions, { options: selectedRequestOptions, preview: true, t: t }) })), _jsx(OverviewSection, { label: t('tab.usage'), onOpen: () => { activateTab('usage'); }, children: _jsx(UsageRows, { usage: selectedRequestUsage, t: t }) }), _jsx(OverviewSection, { label: t('tab.timing'), onOpen: () => { activateTab('timing'); }, children: _jsx(RequestTiming, { assistant: selectedRequestAssistant, anchor: selectedRequestAnchor, request: selectedRequestInfo, t: t }) })] })] })), selectedRequestInfo !== undefined && activeTab === 'options' && (_jsx(RequestOptions, { options: selectedRequestOptions, t: t })), selectedRequestInfo !== undefined && activeTab === 'usage' && (_jsx(RequestUsagePanel, { usage: selectedRequestUsage, cumulative: selectedRequestCumulativeUsage, t: t })), selectedRequestInfo !== undefined && activeTab === 'timing' && (_jsx(RequestTiming, { assistant: selectedRequestAssistant, anchor: selectedRequestAnchor, request: selectedRequestInfo, t: t })), promptSelected
                                && selectedPreviousPrompt !== undefined
                                && activeTab === 'diff' && (_jsx(SystemPromptDiff, { before: selectedPreviousPrompt, after: selectedPrompt, t: t })), promptSelected && activeTab === 'system-prompt' && (selectedPrompt.system === ''
                                ? _jsx("p", { className: css.noPayload, children: t('record.systemPromptMissing') })
                                : (_jsx("div", { className: `${css.markdownPayload} ${css.systemPrompt}`, children: _jsx(MarkdownText, { text: selectedPrompt.system, labels: markdownLabels(t) }) }))), promptSelected && activeTab === 'tools' && (_jsx(ToolCatalog, { tools: selectedPrompt.tools, t: t })), !promptSelected
                                && selected?.cell.kind === 'compacted'
                                && selectedState !== undefined
                                && activeTab === 'overview' && (_jsxs(_Fragment, { children: [_jsxs("dl", { className: `${css.overview} ${css.summaryScrollRegion}`, "data-summary-scroll-region": "", children: [_jsxs("div", { children: [_jsx("dt", { children: t('details.status') }), _jsx("dd", { className: selectedState === 'error' ? css.error : undefined, children: statusLabel(selectedState, t) })] }), _jsxs("div", { children: [_jsx("dt", { children: t('timing.duration') }), _jsx("dd", { children: formatElapsedSeconds(selected.cell.timeSeconds, t) })] }), _jsxs("div", { children: [_jsx("dt", { children: t('usage.tokens') }), _jsx("dd", { children: "\u2014" })] })] }), selected.cell.outputDetail !== undefined && (_jsx("div", { className: `${css.compactedSummary} ${css.summaryScrollRegion}`, "data-summary-scroll-region": "", children: _jsx(MarkdownRecordContent, { record: selected, renderImages: renderImages, rendered: true, thinkingExpanded: thinkingExpanded, onThinkingExpandedChange: setThinkingExpanded, onOpenCall: openCallSummary, t: t }) }))] })), !promptSelected
                                && selected !== undefined
                                && selected.cell.kind !== 'compacted'
                                && selectedState !== undefined
                                && activeTab === 'overview' && (_jsxs(_Fragment, { children: [_jsxs("dl", { className: `${css.overview} ${css.summaryScrollRegion}`, "data-summary-scroll-region": "", children: [selected.cell.messageSource !== undefined && (_jsxs("div", { children: [_jsx("dt", { children: t('details.source') }), _jsx("dd", { className: css.overviewParentLinks, children: _jsxs("button", { type: "button", className: css.overviewHierarchyNavLink, onClick: () => { activateTab('source'); }, children: [_jsx("span", { children: messageSourceLabel(selected.cell.messageSource, t) }), _jsx(IconChevronRightOutline14, { className: css.overviewHierarchyJumpIconTight, size: 11 })] }) })] })), hasSelectedHierarchy && (_jsxs("div", { children: [_jsx("dt", { children: selectedAssistantRequestTarget !== undefined
                                                            ? t('details.source')
                                                            : t('details.hierarchy') }), _jsxs("dd", { className: css.overviewParentLinks, children: [selectedAssistantRequestTarget !== undefined && (_jsxs("button", { type: "button", className: css.overviewHierarchyNavLink, onClick: () => {
                                                                    selectRequest(selectedAssistantRequestTarget);
                                                                }, children: [_jsx("span", { children: t('request.label', { request: selectedAssistantRequest ?? '—' }) }), _jsx(IconChevronRightOutline14, { className: css.overviewHierarchyJumpIconTight, size: 11 })] })), selectedParentMessage !== undefined && (_jsxs("button", { type: "button", className: css.overviewHierarchyNavLink, onClick: () => { openRecordSummary(selectedParentMessage); }, children: [_jsx("span", { children: t('details.assistantMessage') }), _jsx(IconChevronRightOutline14, { className: css.overviewHierarchyJumpIconTight, size: 11 })] })), selectedParentTool !== undefined && (_jsxs("button", { type: "button", className: css.overviewHierarchyNavLink, onClick: () => { openRecordSummary(selectedParentTool); }, children: [_jsx("span", { children: t('details.toolCall') }), _jsx(IconChevronRightOutline14, { className: css.overviewHierarchyJumpIconTight, size: 11 })] }))] })] })), _jsxs("div", { children: [_jsx("dt", { children: t('details.status') }), _jsx("dd", { className: selectedState === 'error' ? css.error : undefined, children: statusLabel(selectedState, t) })] }), selected.cell.kind === 'message' && (_jsx(TokenRows, { cell: selected.cell, t: t })), (selected.cell.kind === 'user' || selected.cell.kind === 'context') && (_jsxs("div", { children: [_jsx("dt", { children: t('timing.duration') }), _jsx("dd", { children: formatElapsedSeconds(selected.cell.timeSeconds, t) })] }))] }), _jsxs("div", { className: css.overviewSections, children: [isMarkdownRecord(selected)
                                                ? (_jsx(_Fragment, { children: _jsx(OverviewSection, { label: t('tab.preview'), onOpen: () => { activateTab('rendered'); }, children: _jsx(MarkdownRecordContent, { record: selected, renderImages: renderImages, rendered: true, preview: true, thinkingExpanded: thinkingExpanded, onThinkingExpandedChange: setThinkingExpanded, onOpenCall: openCallSummary, t: t }) }) }))
                                                : (_jsxs(_Fragment, { children: [selected.cell.inputDetail && (_jsx(OverviewSection, { label: t('tab.payload'), onOpen: () => { activateTab('input'); }, children: _jsx(RecordPayload, { record: selected, direction: "input", preview: true, renderImages: renderImages, t: t }) })), selected.cell.outputDetail && (_jsx(OverviewSection, { label: t('tab.result'), onOpen: () => { activateTab('output'); }, children: _jsx(RecordPayload, { record: selected, direction: "output", preview: true, renderImages: renderImages, t: t }) })), _jsx(OverviewSection, { label: t('tab.schema'), onOpen: () => { activateTab('schema'); }, children: _jsx(RecordSchema, { record: selected, preview: true, t: t }) })] })), selectedAssistantRequestTarget !== undefined && (_jsx(OverviewSection, { label: t('timing.request'), onOpen: () => {
                                                    selectRequest(selectedAssistantRequestTarget, 'timing');
                                                }, children: _jsx(RecordTiming, { record: selected, t: t }) })), (selected.cell.kind === 'tool' || selected.cell.kind === 'subtool') && (_jsx(OverviewSection, { label: t('tab.timing'), onOpen: () => { activateTab('timing'); }, children: _jsx(RecordTiming, { record: selected, t: t }) }))] })] })), !promptSelected && selected !== undefined && activeTab === 'rendered' && (_jsx(MarkdownRecordContent, { record: selected, renderImages: renderImages, rendered: true, thinkingExpanded: thinkingExpanded, onThinkingExpandedChange: setThinkingExpanded, onOpenCall: openCallSummary, t: t })), !promptSelected && selected !== undefined && activeTab === 'raw' && (_jsx(MarkdownRecordContent, { record: selected, renderImages: renderImages, rendered: false, thinkingExpanded: thinkingExpanded, onThinkingExpandedChange: setThinkingExpanded, onOpenCall: openCallSummary, t: t })), !promptSelected && selected !== undefined && activeTab === 'source' && (_jsx(MessageSource, { record: selected, t: t })), !promptSelected && selected !== undefined && activeTab === 'input' && (_jsx(RecordPayload, { record: selected, direction: "input", renderImages: renderImages, t: t })), !promptSelected && selected !== undefined && activeTab === 'output' && (_jsx(RecordPayload, { record: selected, direction: "output", renderImages: renderImages, t: t })), !promptSelected && selected !== undefined && activeTab === 'schema' && (_jsx(RecordSchema, { record: selected, t: t })), !promptSelected && selected !== undefined && activeTab === 'timing' && (_jsx(RecordTiming, { record: selected, t: t }))] })] }))] }));
}
