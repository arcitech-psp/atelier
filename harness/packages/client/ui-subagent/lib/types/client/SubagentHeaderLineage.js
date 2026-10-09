import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState, } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronDownOutline14, IconChevronRightOutline14, IconRefreshOutline14, StateDot, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './SubagentHeaderLineage.module.css';
import { indexSubagentDescendants } from "./subagent-lineage.js";
function diagnosticReason(entry, t) {
    switch (entry.reason) {
        case 'corrupt': return t('diagnostic.corrupt');
        case 'unsupported': return t('diagnostic.unsupported');
        case 'unavailable': return t('diagnostic.unavailable');
    }
}
function treeItems(root) {
    return root === null
        ? []
        : Array.from(root.querySelectorAll('[role="treeitem"]:not([aria-disabled="true"])'));
}
/** Compact token count shared in shape with the conversation stats strip. */
function formatTokens(value, t) {
    const scaled = (next) => next >= 100
        ? String(Math.round(next))
        : String(Math.round(next * 10) / 10);
    if (value < 1_000)
        return String(value);
    if (value < 1_000_000)
        return t('tokens.thousand', { value: scaled(value / 1_000) });
    return t('tokens.million', { value: scaled(value / 1_000_000) });
}
/** Sum the four disjoint durable provider-usage buckets. */
function tokenTotal(usage) {
    return usage === undefined
        ? undefined
        : usage.uncachedInputTokens + usage.outputTokens
            + usage.cacheReadTokens + usage.cacheWriteTokens;
}
/** Exact whole-second active-turn duration for one catalog row. */
function activityDuration(summary, activity, now) {
    if (summary === undefined)
        return undefined;
    const timing = summary.projectionValues?.subagentTiming;
    if (timing === undefined)
        return undefined;
    if (timing.active === undefined)
        return timing.settledMs;
    const end = activity === 'running'
        ? now
        : timing.active.through;
    return timing.settledMs + Math.max(0, end - timing.active.since);
}
function splitDuration(ms) {
    const totalSeconds = Math.floor(Math.max(0, ms) / 1_000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    return {
        seconds: totalSeconds % 60,
        minutes: totalMinutes % 60,
        hours: totalHours % 24,
        days: Math.floor(totalHours / 24),
        totalMinutes,
        totalHours,
    };
}
/** Format a duration with decreasing visual precision at larger scales. */
function formatDuration(ms, t) {
    const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms);
    if (days >= 365) {
        const years = Math.floor(days / 365);
        const months = Math.floor((days % 365) / 30);
        return months === 0
            ? t('duration.years', { years })
            : t('duration.yearsMonths', { years, months });
    }
    if (days >= 30) {
        const months = Math.floor(days / 30);
        const remainingDays = days % 30;
        return remainingDays === 0
            ? t('duration.months', { months })
            : t('duration.monthsDays', { months, days: remainingDays });
    }
    if (days > 0) {
        return hours === 0
            ? t('duration.days', { days })
            : t('duration.daysHours', { days, hours });
    }
    if (totalHours > 0) {
        return t('duration.hours', {
            hours: totalHours,
            minutes: String(minutes).padStart(2, '0'),
            seconds: String(seconds).padStart(2, '0'),
        });
    }
    if (totalMinutes > 0) {
        return t('duration.minutes', {
            minutes: totalMinutes,
            seconds: String(seconds).padStart(2, '0'),
        });
    }
    return t('duration.seconds', { seconds });
}
/** Preserve exact whole seconds for hover and accessible naming. */
function formatExactDuration(ms, t) {
    const { seconds, minutes, hours, days } = splitDuration(ms);
    return days === 0
        ? formatDuration(ms, t)
        : t('duration.exactDays', {
            days,
            hours: String(hours).padStart(2, '0'),
            minutes: String(minutes).padStart(2, '0'),
            seconds: String(seconds).padStart(2, '0'),
        });
}
const NO_DESCENDANTS = { count: 0, runningCount: 0 };
function SubagentSwitcherIcon() {
    return (_jsxs("svg", { width: "16", height: "16", viewBox: "0 0 20 20", fill: "none", "aria-hidden": "true", children: [_jsx("path", { d: "M5.99951 12.7L8.95546 14.9478C9.40011 15.2859 9.62244 15.455 9.87526 15.488C9.95774 15.4988 10.0413 15.4988 10.1238 15.488C10.3766 15.455 10.5989 15.2859 11.0436 14.9478L13.9995 12.7", stroke: "currentColor", strokeWidth: "1.5" }), _jsx("path", { d: "M13.9995 7.7417L11.0436 5.49387C10.5989 5.15574 10.3766 4.98668 10.1238 4.95362C10.0413 4.94283 9.95775 4.94283 9.87527 4.95362C9.62245 4.98668 9.40012 5.15574 8.95547 5.49387L5.99952 7.7417", stroke: "currentColor", strokeWidth: "1.5" })] }));
}
/** Render the known direct-child shape while its authoritative catalog hydrates. */
function CatalogLoadingRows({ parentSessionId, summaries, level, t, }) {
    const children = Object.values(summaries).filter(summary => (summary.origin === 'subagent' && summary.parentId === parentSessionId));
    if (children.length === 0)
        return _jsx("div", { className: css.notice, children: t('loading.label') });
    return children.map(summary => (_jsx("div", { className: css.node, children: _jsxs("div", { role: "treeitem", "aria-disabled": "true", "aria-level": level, "aria-label": t('loading.aria'), className: `${css.row} ${css.disabled} ${css.loadingRow}`, children: [_jsx("span", { className: css.disclosureSpace }), _jsx(StateDot, { state: summary.running ? 'ongoing' : 'done' }), _jsx("span", { className: css.content, children: _jsx("span", { className: css.label, children: t('loading.label') }) })] }) }, summary.id)));
}
/** Render one catalog level and recurse only through explicitly expanded rows. */
function CatalogRows({ parentSessionId, currentSessionId, catalog, catalogs, summaries, expanded, level, now, openChild, refresh, toggleBranch, closeCatalog, t, }) {
    const emptyLoading = catalog.state === 'loading' && catalog.entries.length === 0;
    const reserveDisclosure = catalog.entries.some(entry => entry.kind === 'child' && entry.hasChildren);
    return (_jsxs(_Fragment, { children: [emptyLoading && (_jsx(CatalogLoadingRows, { parentSessionId: parentSessionId, summaries: summaries, level: level, t: t })), catalog.state === 'error' && (_jsxs("div", { className: css.error, children: [_jsx("span", { children: catalog.error?.message ?? t('load.error') }), _jsxs("button", { type: "button", className: css.refresh, onClick: () => { refresh(parentSessionId); }, children: [_jsx(IconRefreshOutline14, {}), t('retry')] })] })), catalog.entries.map((entry) => {
                if (entry.kind === 'diagnostic') {
                    const reason = diagnosticReason(entry, t);
                    return (_jsx("div", { className: css.node, children: _jsxs("div", { role: "treeitem", "aria-disabled": "true", "aria-level": level, "aria-label": `${entry.id} ${reason}`, className: `${css.row} ${css.disabled}`, title: reason, children: [reserveDisclosure && _jsx("span", { className: css.disclosureSpace }), _jsx(StateDot, { state: "error" }), _jsxs("span", { className: css.content, children: [_jsx("span", { className: css.label, children: entry.id }), _jsx("span", { className: css.summary, children: reason })] })] }) }, entry.id));
                }
                const childCatalog = catalogs[entry.id];
                const isCurrent = entry.id === currentSessionId;
                const isExpanded = expanded.has(entry.id);
                const knownLeaf = !entry.hasChildren;
                const childLoading = childCatalog === undefined
                    || (childCatalog.state === 'loading' && childCatalog.entries.length === 0);
                const summary = summaries[entry.id];
                const label = entry.label ?? entry.id;
                const mode = entry.mode === 'one-shot' ? t('mode.oneShot') : t('mode.continuable');
                const activity = entry.activity === 'running' ? t('activity.running') : t('activity.inactive');
                const secondary = [summary?.title, mode, activity]
                    .filter(value => value !== undefined)
                    .join(' · ');
                const totalTokens = tokenTotal(summary?.projectionValues?.tokenUsage);
                const durationMs = activityDuration(summary, entry.activity, now);
                const tokenMetric = totalTokens === undefined
                    ? undefined
                    : t('tokens.total', { value: formatTokens(totalTokens, t) });
                const durationMetric = durationMs === undefined
                    ? undefined
                    : {
                        compact: formatDuration(durationMs, t),
                        exact: formatExactDuration(durationMs, t),
                    };
                const metrics = [tokenMetric, durationMetric?.exact]
                    .filter(value => value !== undefined)
                    .join(' · ');
                const open = () => {
                    openChild({ parentSessionId, childSessionId: entry.id, mode: entry.mode });
                    closeCatalog();
                };
                const handleKey = (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        open();
                    }
                    else if ((event.key === 'ArrowRight' && !knownLeaf && !isExpanded)
                        || (event.key === 'ArrowLeft' && isExpanded)) {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleBranch(entry.id);
                    }
                };
                const toggle = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleBranch(entry.id);
                };
                return (_jsxs("div", { className: css.node, children: [_jsxs("div", { role: "treeitem", tabIndex: 0, "aria-level": level, "aria-current": isCurrent || undefined, "aria-label": [label, secondary, metrics].filter(value => value !== '').join(' '), ...knownLeaf ? {} : { 'aria-expanded': isExpanded }, className: css.row, onClick: open, onKeyDown: handleKey, children: [knownLeaf
                                    ? reserveDisclosure && _jsx("span", { className: css.disclosureSpace })
                                    : (_jsx("button", { type: "button", tabIndex: -1, className: `${css.disclosure} ${isExpanded ? css.disclosureOpen : ''}`, "aria-label": t(isExpanded ? 'branch.collapse' : 'branch.expand', { label }), onClick: toggle, children: _jsx(IconChevronRightOutline14, {}) })), _jsxs("div", { className: css.clickarea, children: [_jsx(StateDot, { state: entry.activity === 'running' ? 'ongoing' : 'done' }), _jsxs("span", { className: css.content, children: [_jsx("span", { className: `${css.label} ${isCurrent ? css.currentLabel : ''}`, children: label }), _jsx("span", { className: css.summary, children: secondary })] }), metrics !== '' && (_jsxs("span", { className: css.metrics, children: [tokenMetric !== undefined && _jsx("span", { className: css.metricToken, children: tokenMetric }), durationMetric !== undefined && (_jsx("span", { className: css.metricDuration, title: t('duration.exactTitle', { duration: durationMetric.exact }), children: durationMetric.compact }))] }))] })] }), isExpanded && !knownLeaf && (_jsx("div", { role: "group", className: css.children, "aria-busy": childLoading || undefined, children: childCatalog === undefined
                                ? (_jsx(CatalogLoadingRows, { parentSessionId: entry.id, summaries: summaries, level: level + 1, t: t }))
                                : (_jsx(CatalogRows, { parentSessionId: entry.id, currentSessionId: currentSessionId, catalog: childCatalog, catalogs: catalogs, summaries: summaries, expanded: expanded, level: level + 1, now: now, openChild: openChild, refresh: refresh, toggleBranch: toggleBranch, closeCatalog: closeCatalog, t: t })) }))] }, entry.id));
            })] }));
}
const MENU_VIEWPORT_MARGIN = 16;
/** Place a portaled catalog below its trigger without crossing the viewport edge. */
function catalogMenuPosition(trigger) {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(336, window.innerWidth - MENU_VIEWPORT_MARGIN * 2);
    return {
        top: rect.bottom + 5,
        left: Math.min(Math.max(MENU_VIEWPORT_MARGIN, rect.left), window.innerWidth - width - MENU_VIEWPORT_MARGIN),
    };
}
/** One trigger-plus-tree dropdown over the catalog rooted at `rootSessionId`. */
function CatalogDropdown({ rootSessionId, currentSessionId, displayTitle, openTitle, variant, separator = false, useSessions, openChild, refresh, setCatalogOpen, t, }) {
    const ancestorSwitcher = variant === 'switcher' && openTitle !== undefined;
    const catalogs = useSessions(state => state.subagentsByParent);
    const summaries = useSessions(state => state.byId);
    const catalog = catalogs[rootSessionId];
    const [open, setOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState();
    const [now, setNow] = useState(() => Date.now());
    const [expanded, setExpanded] = useState(() => new Set());
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const hoverOpenTimer = useRef(undefined);
    const hoverCloseTimer = useRef(undefined);
    const observedCatalogs = useRef(new Set());
    const setCatalogOpenRef = useRef(setCatalogOpen);
    setCatalogOpenRef.current = setCatalogOpen;
    const currentEntry = currentSessionId === undefined
        ? undefined
        : catalog?.entries.find(entry => entry.kind === 'child' && entry.id === currentSessionId);
    const switcherDisplayTitle = currentEntry?.kind === 'child'
        ? currentEntry.label ?? currentEntry.id
        : displayTitle;
    const healthy = catalog?.entries.filter(entry => entry.kind === 'child') ?? [];
    const descendants = useMemo(() => indexSubagentDescendants(summaries).get(rootSessionId) ?? NO_DESCENDANTS, [rootSessionId, summaries]);
    // The catalog can arrive before the session-list baseline; never undercount
    // the already-visible direct rows during that short bootstrap window.
    const descendantCount = Math.max(healthy.length, descendants.count);
    const totalCountKey = descendantCount === 1 ? 'count.total.one' : 'count.total.other';
    const runningCountKey = descendants.runningCount === 1 ? 'count.running.one' : 'count.running.other';
    // Session summaries can announce membership before the descriptor-backed catalog catches up.
    // Keep that entry point visible through disabled loading rows; only catalog rows are navigable.
    const summaryBackedLoading = (descendants.count > 0 || variant === 'switcher')
        && (catalog === undefined || (catalog.state === 'ready' && catalog.entries.length === 0));
    const presentedCatalog = summaryBackedLoading
        ? {
            entries: [],
            parentAvailable: catalog?.parentAvailable ?? false,
            state: 'loading',
            error: null,
        }
        : catalog;
    const observeCatalog = (parentSessionId, next) => {
        if (next)
            observedCatalogs.current.add(parentSessionId);
        else
            observedCatalogs.current.delete(parentSessionId);
        setCatalogOpen(parentSessionId, next);
    };
    const closeAllCatalogs = () => {
        for (const parentSessionId of observedCatalogs.current) {
            setCatalogOpen(parentSessionId, false);
        }
        observedCatalogs.current.clear();
        setExpanded(new Set());
    };
    const cancelHoverClose = () => {
        if (hoverCloseTimer.current === undefined)
            return;
        clearTimeout(hoverCloseTimer.current);
        hoverCloseTimer.current = undefined;
    };
    const cancelHoverOpen = () => {
        if (hoverOpenTimer.current === undefined)
            return;
        clearTimeout(hoverOpenTimer.current);
        hoverOpenTimer.current = undefined;
    };
    const changeOpen = (next, restoreFocus = false) => {
        cancelHoverOpen();
        cancelHoverClose();
        if (next) {
            const trigger = triggerRef.current;
            /* v8 ignore next -- a queued callback can outlive the trigger */
            if (trigger === null)
                return;
            setOpen(true);
            setMenuPosition(catalogMenuPosition(trigger));
            setNow(Date.now());
            observeCatalog(rootSessionId, true);
        }
        else {
            setOpen(false);
            setMenuPosition(undefined);
            closeAllCatalogs();
        }
        if (restoreFocus)
            queueMicrotask(() => { triggerRef.current?.focus(); });
    };
    const scheduleHoverOpen = () => {
        cancelHoverOpen();
        cancelHoverClose();
        if (open)
            return;
        hoverOpenTimer.current = setTimeout(() => {
            hoverOpenTimer.current = undefined;
            changeOpen(true);
        }, 150);
    };
    const scheduleHoverClose = () => {
        cancelHoverOpen();
        cancelHoverClose();
        hoverCloseTimer.current = setTimeout(() => {
            hoverCloseTimer.current = undefined;
            changeOpen(false);
        }, 120);
    };
    const closeBranch = (root) => {
        const closing = new Set();
        const visit = (parentSessionId) => {
            if (closing.has(parentSessionId) || !expanded.has(parentSessionId))
                return;
            closing.add(parentSessionId);
            const branch = catalogs[parentSessionId];
            for (const entry of branch?.entries ?? []) {
                if (entry.kind === 'child')
                    visit(entry.id);
            }
        };
        visit(root);
        for (const parentSessionId of closing)
            observeCatalog(parentSessionId, false);
        setExpanded(current => new Set([...current].filter(id => !closing.has(id))));
    };
    const toggleBranch = (childSessionId) => {
        if (expanded.has(childSessionId)) {
            closeBranch(childSessionId);
            return;
        }
        setExpanded(current => new Set(current).add(childSessionId));
        observeCatalog(childSessionId, true);
    };
    useEffect(() => {
        if (!open)
            return;
        const closeOutside = (event) => {
            if (event.target instanceof Node
                && !rootRef.current?.contains(event.target)
                && !menuRef.current?.contains(event.target)) {
                changeOpen(false);
            }
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => { document.removeEventListener('pointerdown', closeOutside); };
    }, [open]);
    useEffect(() => {
        if (!open)
            return;
        const placeMenu = () => {
            const trigger = triggerRef.current;
            /* v8 ignore next -- native resize or scroll can outlive the trigger */
            if (trigger === null)
                return;
            setMenuPosition(catalogMenuPosition(trigger));
        };
        window.addEventListener('resize', placeMenu);
        document.addEventListener('scroll', placeMenu, true);
        return () => {
            window.removeEventListener('resize', placeMenu);
            document.removeEventListener('scroll', placeMenu, true);
        };
    }, [open]);
    useEffect(() => {
        if (!open || descendants.runningCount === 0)
            return;
        const timer = setInterval(() => { setNow(Date.now()); }, 1_000);
        return () => { clearInterval(timer); };
    }, [open, descendants.runningCount]);
    useEffect(() => () => {
        cancelHoverOpen();
        cancelHoverClose();
        for (const parentSessionId of observedCatalogs.current) {
            setCatalogOpenRef.current(parentSessionId, false);
        }
        observedCatalogs.current.clear();
    }, []);
    // Visibility needs evidence of children (entries, summary-known descendants,
    // or a failed load worth retrying). A bare loading catalog is not evidence:
    // selecting any session schedules a refresh whose loading snapshot would
    // otherwise flash the action in and out on childless sessions.
    const visible = presentedCatalog !== undefined
        && (variant === 'switcher'
            || presentedCatalog.state === 'error'
            || presentedCatalog.entries.length > 0
            || descendantCount > 0);
    useEffect(() => {
        if (visible)
            return;
        cancelHoverOpen();
        cancelHoverClose();
        if (!open)
            return;
        setOpen(false);
        closeAllCatalogs();
    }, [visible, open]);
    if (!visible)
        return null;
    const focusAt = (index) => {
        const items = treeItems(menuRef.current);
        if (items.length === 0)
            return;
        items[(index + items.length) % items.length]?.focus();
    };
    const navigate = (event) => {
        const items = treeItems(menuRef.current);
        const index = items.indexOf(document.activeElement);
        if (event.key === 'Escape') {
            event.preventDefault();
            changeOpen(false, true);
        }
        else if (event.key === 'Home') {
            event.preventDefault();
            focusAt(0);
        }
        else if (event.key === 'End') {
            event.preventDefault();
            focusAt(items.length - 1);
        }
        else if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusAt(index + 1);
        }
        else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusAt(index < 0 ? items.length - 1 : index - 1);
        }
    };
    return (_jsxs("div", { className: `${css.root} ${variant === 'switcher' ? css.switcherRoot : ''}`, ref: rootRef, onKeyDown: navigate, onMouseEnter: scheduleHoverOpen, onMouseLeave: scheduleHoverClose, children: [separator && _jsx("span", { className: css.separator, children: "/" }), _jsxs("button", { ref: triggerRef, type: "button", className: variant === 'switcher'
                    ? `${css.switcherTrigger} ${ancestorSwitcher ? css.ancestorSwitcherTrigger : ''}`
                    : css.trigger, "aria-haspopup": "tree", "aria-expanded": open, "aria-label": variant === 'switcher'
                    ? t('switcher.aria', { title: switcherDisplayTitle })
                    : t(descendants.runningCount > 0 ? runningCountKey : totalCountKey, { count: descendants.runningCount > 0 ? descendants.runningCount : descendantCount }), onClick: openTitle === undefined
                    ? undefined
                    : () => {
                        cancelHoverOpen();
                        if (open)
                            changeOpen(false);
                        openTitle();
                    }, onKeyDown: (event) => {
                    if (event.key !== 'ArrowDown')
                        return;
                    event.preventDefault();
                    if (!open)
                        changeOpen(true);
                    queueMicrotask(() => { focusAt(0); });
                }, children: [variant === 'switcher'
                        ? _jsx("span", { className: css.switcherTitle, children: switcherDisplayTitle })
                        : (_jsxs(_Fragment, { children: [descendants.runningCount > 0 && (_jsx("span", { className: css.activitySlot, children: _jsx(StateDot, { state: "ongoing" }) })), _jsx("span", { className: css.count, children: t(totalCountKey, { count: descendantCount }) })] })), variant === 'switcher'
                        ? _jsx(SubagentSwitcherIcon, {})
                        : _jsx(IconChevronDownOutline14, { className: open ? css.triggerOpen : undefined })] }), open && createPortal((_jsx("div", { ref: menuRef, className: css.menu, style: menuPosition, role: "tree", "aria-label": t('tree.aria'), onMouseEnter: cancelHoverClose, onMouseLeave: scheduleHoverClose, children: _jsx(CatalogRows, { parentSessionId: rootSessionId, currentSessionId: currentSessionId, catalog: presentedCatalog, catalogs: catalogs, summaries: summaries, expanded: expanded, level: 1, now: now, openChild: openChild, refresh: refresh, toggleBranch: toggleBranch, closeCatalog: () => { changeOpen(false); }, t: t }) })), document.body)] }));
}
/**
 * Render one breadcrumb title together with its subagent navigation.
 * @param props - Breadcrumb title, session standard props, and catalog actions.
 * @returns An ordinary-title descendant count, or a title-and-chevron sibling switcher.
 */
export function SubagentHeaderLineage({ lineageSessionId, displayTitle, openTitle, useSessions, openChild, refresh, setCatalogOpen, t, }) {
    const parentId = useSessions((state) => {
        const summary = state.byId[lineageSessionId];
        return summary?.origin === 'subagent' ? summary.parentId : undefined;
    });
    const shared = { useSessions, openChild, refresh, setCatalogOpen, t };
    if (parentId === undefined) {
        return (_jsx(CatalogDropdown, { rootSessionId: lineageSessionId, variant: "count", separator: true, ...shared }, lineageSessionId));
    }
    return (_jsxs(_Fragment, { children: [_jsx(CatalogDropdown, { rootSessionId: parentId, currentSessionId: lineageSessionId, variant: "switcher", displayTitle: displayTitle, ...openTitle === undefined ? {} : { openTitle }, ...shared }, lineageSessionId), openTitle === undefined && (_jsx(CatalogDropdown, { rootSessionId: lineageSessionId, variant: "count", ...shared }, lineageSessionId))] }));
}
