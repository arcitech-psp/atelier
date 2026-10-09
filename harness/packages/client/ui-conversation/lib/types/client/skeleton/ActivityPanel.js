import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Activity panel: the subagents this chat creates and uses, one card each,
 * with measurable per-worker state.
 *
 * Scope: workers only. The lead's own state already has the composer context
 * ring and the status line, so repeating it here would be a summary the panel
 * does not need.
 *
 * Honesty rules this panel keeps:
 * - Decode counters are server-wide for that worker's resolved model route,
 *   not attributed to one chat. They resolve while the worker is resident,
 *   which is exactly while it runs.
 * - Unavailable is never drawn as zero. A missing reading shows an em dash and
 *   leaves the meter at rest.
 * - Context occupancy appears only when the session store already carries that
 *   child's projection; it is never estimated.
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { contextOccupancy } from "../context-occupancy.js";
import { useRouteTelemetry } from "./route-telemetry.js";
import css from './ActivityPanel.module.css';
/** Idle hue (green) through working hue (red) on the decode meter. */
const IDLE_HUE = 146;
const WORKING_HUE = 4;
/** Slowest peak the meter normalizes against, so a trickle is not full scale. */
const MIN_PEAK_TOKENS_PER_SECOND = 8;
/** Peak decays while a worker is quiet, so an old burst stops compressing the scale. */
const PEAK_DECAY_PER_SAMPLE = 0.985;
/**
 * Blend the idle-to-working tint for a normalized activity level.
 * @param level - 0 at rest through 1 at this worker's observed peak.
 * @returns an hsl color string.
 */
function activityTint(level) {
    const bounded = Math.min(1, Math.max(0, level));
    const hue = IDLE_HUE + (WORKING_HUE - IDLE_HUE) * bounded;
    return `hsl(${hue.toFixed(0)} ${(58 + 14 * bounded).toFixed(0)}% ${(52 - 6 * bounded).toFixed(0)}%)`;
}
/**
 * Track a worker's own observed peak decode rate so its meter spans its range.
 * @param rate - latest tokens-per-second reading, or null while unknown.
 * @returns the normalized 0..1 level for the meter.
 */
function useActivityLevel(rate) {
    const peak = useRef(MIN_PEAK_TOKENS_PER_SECOND);
    const [level, setLevel] = useState(0);
    useEffect(() => {
        if (rate === null || !Number.isFinite(rate) || rate <= 0) {
            peak.current = Math.max(MIN_PEAK_TOKENS_PER_SECOND, peak.current * PEAK_DECAY_PER_SAMPLE);
            setLevel(0);
            return;
        }
        peak.current = Math.max(peak.current, rate);
        setLevel(Math.min(1, rate / peak.current));
    }, [rate]);
    return level;
}
const formatRate = (value) => value === null || !Number.isFinite(value) ? '—' : value.toFixed(1);
/**
 * Compact elapsed label for a worker's last durable update.
 * @param at - epoch milliseconds, or undefined when the store has none.
 * @param t - conversation locale seat.
 * @returns a short relative string, or undefined when unknown.
 */
function elapsedLabel(at, t) {
    if (at === undefined || !Number.isFinite(at))
        return undefined;
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 60)
        return t('activity.agoSeconds', { value: seconds });
    if (seconds < 3600)
        return t('activity.agoMinutes', { value: Math.round(seconds / 60) });
    return t('activity.agoHours', { value: Math.round(seconds / 3600) });
}
/** One subagent card: identity, live decode meter, context occupancy, provenance. */
function WorkerCard({ row, enabled, t }) {
    const telemetry = useRouteTelemetry(row.id, enabled);
    const rate = telemetry.rollingTokensPerSecond ?? telemetry.tokensPerSecond;
    const level = useActivityLevel(rate);
    const running = row.status === 'running';
    // Queue and running counters mark work before a rate can be differenced.
    const working = running && (telemetry.running > 0 || level > 0.02);
    const tint = activityTint(working ? Math.max(level, 0.35) : 0);
    const percent = row.context?.percent ?? null;
    const elapsed = elapsedLabel(row.updatedAt, t);
    const statusClass = row.status === 'running'
        ? css.statusRunning
        : row.status === 'done' ? css.statusDone : css.statusIdle;
    return (_jsxs("section", { className: clsx(css.card, working && css.cardWorking), style: { '--activity-tint': tint }, "data-activity-agent": row.id, "data-activity-working": working ? '' : undefined, children: [_jsxs("div", { className: css.identity, children: [_jsx("span", { className: clsx(css.dot, working && css.dotWorking), "aria-hidden": true }), _jsx("span", { className: css.name, title: row.name, children: row.name }), _jsx("span", { className: clsx(css.status, statusClass), children: t(row.status === 'running'
                            ? 'activity.statusRunning'
                            : row.status === 'done' ? 'activity.statusDone' : 'activity.statusIdle') })] }), _jsxs("div", { className: css.meter, children: [_jsxs("div", { className: css.meterHead, children: [_jsx("span", { children: telemetry.available ? t('activity.decode') : t('activity.unavailable') }), _jsx("span", { className: clsx(css.reading, !working && css.readingIdle), children: `${formatRate(rate)} ${t('activity.rateUnit')}` })] }), _jsxs("div", { className: css.track, role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(level * 100), "aria-valuetext": `${formatRate(rate)} ${t('activity.rateUnit')}`, "aria-label": t('activity.meterLabel', { name: row.name }), title: t('activity.meterHint'), children: [_jsx("div", { className: css.fill, style: { width: `${(level * 100).toFixed(1)}%` } }), _jsx("div", { className: css.thumb, style: { left: `${(level * 100).toFixed(1)}%` } })] })] }), _jsxs("div", { className: css.meter, children: [_jsxs("div", { className: css.meterHead, children: [_jsx("span", { children: t('activity.context') }), _jsx("span", { className: clsx(css.contextValue, percent === null && css.readingIdle), children: percent === null ? '—' : `${percent}%` })] }), _jsx("div", { className: css.contextTrack, role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, ...percent === null ? {} : { 'aria-valuenow': percent }, "aria-label": t('activity.contextLabel', { name: row.name }), children: _jsx("div", { className: clsx(css.contextFill, percent !== null && percent >= 90 && css.contextFillCritical, percent !== null && percent >= 75 && percent < 90 && css.contextFillHigh), style: { width: `${percent ?? 0}%` } }) })] }), _jsxs("dl", { className: css.facts, children: [_jsxs("div", { className: css.fact, children: [_jsx("dt", { children: t('activity.route') }), _jsx("dd", { title: telemetry.scope, children: telemetry.scope ?? '—' })] }), _jsxs("div", { className: css.fact, children: [_jsx("dt", { children: t('activity.mode') }), _jsx("dd", { children: t(row.mode === 'one-shot' ? 'activity.modeOneShot' : 'activity.modeContinuable') })] }), telemetry.waiting > 0 && (_jsxs("div", { className: css.fact, children: [_jsx("dt", { children: t('activity.queue') }), _jsx("dd", { children: telemetry.waiting })] })), elapsed !== undefined && (_jsxs("div", { className: css.fact, children: [_jsx("dt", { children: t('activity.lastActive') }), _jsx("dd", { children: elapsed })] }))] })] }));
}
/**
 * Build one row per direct subagent of this chat, in durable catalog order.
 * @param sessionId - the lead session whose catalog is read.
 * @param sessions - session list state carrying the durable subagent catalog.
 * @returns the worker rows, empty until the lead delegates.
 */
export function workerRows(sessionId, sessions) {
    const rows = [];
    for (const entry of sessions.subagentsByParent[sessionId]?.entries ?? []) {
        if (entry.kind !== 'child')
            continue;
        const summary = sessions.byId[entry.id];
        const running = entry.activity === 'running' || (summary?.running ?? false);
        rows.push({
            id: entry.id,
            name: entry.label ?? summary?.displayTitle ?? String(entry.id),
            mode: entry.mode,
            status: running ? 'running' : summary?.completed === true ? 'done' : 'idle',
            updatedAt: summary?.updatedAt,
            context: contextOccupancy(summary?.projectionValues?.contextPressure),
        });
    }
    return rows;
}
/**
 * Renders the Activity side panel listing this chat's subagents.
 * @param props - lead identity, session store, open state, close action, locale.
 * @returns the panel section, kept mounted and hidden while closed.
 */
export function ActivityPanel({ sessionId, sessions, open, onClose, t, helpers, width }) {
    const rows = workerRows(sessionId, sessions);
    return (_jsxs("section", { id: "dsh-activity-panel", "data-conversation-panel": "activity", className: css.panel, "aria-label": t('activity.panel'), hidden: !open, style: width === undefined ? undefined : { '--dsh-activity-panel-width': `${width}px` }, children: [_jsxs("div", { className: css.header, children: [_jsxs("span", { className: css.title, children: [t('activity.panel'), rows.length > 0 && _jsx("span", { className: css.count, children: rows.length })] }), _jsx("button", { type: "button", className: css.closeButton, "aria-label": t('activity.close'), title: t('activity.close'), onClick: onClose, children: _jsx(IconCloseOutline16, { size: 14 }) })] }), _jsxs("div", { className: css.body, children: [helpers, rows.length === 0
                        ? _jsx("p", { className: css.empty, children: t('activity.noWorkers') })
                        : rows.map(row => _jsx(WorkerCard, { row: row, enabled: open, t: t }, row.id))] })] }));
}
