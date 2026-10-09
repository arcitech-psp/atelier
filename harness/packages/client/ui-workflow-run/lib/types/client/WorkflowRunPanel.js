import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useLayoutEffect, useMemo, useRef, useState, } from 'react';
import { DisclosureRow, IconChevronRightOutline14, StateDot, } from '@deepseek-ai/dsh-client-ui-primitives';
import { shallowEqual } from '@deepseek-ai/dsh-client-store';
import css from './WorkflowRunPanel.module.css';
const STATUS_KEYS = {
    running: 'status.running',
    completed: 'status.completed',
    failed: 'status.failed',
    cancelled: 'status.cancelled',
    interrupted: 'status.interrupted',
};
function dotState(status) {
    switch (status) {
        case 'running': return 'ongoing';
        case 'completed': return 'done';
        case 'failed': return 'error';
        case 'cancelled':
        case 'interrupted': return 'warning';
        /* v8 ignore next -- WorkflowRunStatus is closed and every variant is handled above. */
        default: return status;
    }
}
function readablePhase(phase, t) {
    if (phase === null)
        return t('phase.unassigned');
    return phase === '' ? t('phase.empty') : phase;
}
function readableMember(label, t) {
    return label === '' ? t('member.empty') : label;
}
function statusCount(status, count, t) {
    return t(`statusCount.${status}`, { count });
}
function memberCount(count, t) {
    return t(count === 1 ? 'run.members.one' : 'run.members.other', { count });
}
function StatusDisclosure(props) {
    return _jsx(DisclosureRow, { ...props, expandable: true });
}
function abnormal(status) {
    return status === 'failed' || status === 'cancelled' || status === 'interrupted';
}
function phaseDisclosureFacts(phase) {
    const mode = phase.members.some(member => abnormal(member.status))
        ? 'abnormal'
        : phase.members.some(member => member.status === 'running') ? 'running' : 'clean';
    return { mode, activityCount: phase.members.length };
}
function runDisclosureFacts(status, phases) {
    const mode = abnormal(status) || phases.some(([, facts]) => facts.mode === 'abnormal')
        ? 'abnormal'
        : status === 'running' || phases.some(([, facts]) => facts.mode === 'running')
            ? 'running'
            : 'clean';
    const activityCount = phases.reduce((count, [, facts]) => count + facts.activityCount, 0);
    return { mode, activityCount };
}
function initialDisclosureState(facts) {
    return { ...facts, open: facts.mode !== 'clean', pendingCleanCollapse: false };
}
function advanceDisclosureState(current, facts, focusWithin) {
    const sameFacts = current.mode === facts.mode && current.activityCount === facts.activityCount;
    if (sameFacts) {
        if (!current.pendingCleanCollapse || focusWithin)
            return current;
        return { ...current, open: false, pendingCleanCollapse: false };
    }
    if (facts.mode === 'clean') {
        const deferCollapse = current.open && focusWithin;
        return { ...facts, open: deferCollapse, pendingCleanCollapse: deferCollapse };
    }
    if (current.mode === 'clean' || (facts.mode === 'abnormal' && current.mode !== 'abnormal')) {
        return { ...facts, open: true, pendingCleanCollapse: false };
    }
    return { ...facts, open: current.open, pendingCleanCollapse: false };
}
function focusIsWithin(element) {
    if (element === null || element === undefined)
        return false;
    return element.contains(element.ownerDocument.activeElement);
}
function collapsePending(state) {
    if (!state.pendingCleanCollapse)
        return state;
    return { ...state, open: false, pendingCleanCollapse: false };
}
function existingPhaseState(phases, key) {
    const phase = phases.get(key);
    /* v8 ignore next -- mounted phase callbacks are created from this owner map. */
    if (phase === undefined)
        throw new Error(`Missing disclosure state for phase ${key}`);
    return phase;
}
function preventPendingHeaderFocus(event) {
    const header = event.currentTarget.querySelector('[data-disclosure-row]');
    /* v8 ignore next -- DisclosureRow always renders its header before the content. */
    if (header === null)
        throw new Error('Missing disclosure header');
    if (header.contains(event.target))
        event.preventDefault();
}
function phaseStatusSummary(members, t) {
    const counts = new Map();
    for (const member of members)
        counts.set(member.status, (counts.get(member.status) ?? 0) + 1);
    const count = (status) => counts.get(status) ?? 0;
    const active = ['running', 'failed', 'cancelled', 'interrupted']
        .filter(status => count(status) > 0);
    if (active.length === 0)
        return statusCount('completed', count('completed'), t);
    const visible = active.includes('interrupted') && count('completed') > 0
        ? ['completed', ...active]
        : active;
    return visible.map(status => statusCount(status, count(status), t)).join(' · ');
}
function navigableMembers(sessions, phases, parentId) {
    const ordinary = new Set(sessions.ids);
    const result = [];
    for (const phase of phases) {
        for (const member of phase.members) {
            const summary = sessions.byId[member.childId];
            if (member.status === 'running'
                && ordinary.has(member.childId)
                && summary?.origin === 'subagent'
                && summary.parentId === parentId
                && summary.running) {
                result.push(member.childId);
            }
        }
    }
    return result;
}
function RunHeader({ children, count, name, onToggle, open, status, t }) {
    return (_jsx(StatusDisclosure, { icon: _jsx(IconChevronRightOutline14, {}), title: t('run.title', { name }), open: open, onToggle: onToggle, expandOnRowClick: true, previewChevron: false, keepContentWhenOpen: true, rowClassName: css.runHeader, leadingClassName: css.runLeading, titleClassName: css.runTitle, collapsedContent: (_jsxs(_Fragment, { children: [_jsx("span", { className: css.separator, "aria-hidden": true }), _jsx("span", { className: css.runSummary, children: memberCount(count, t) }), _jsxs("span", { className: css.statusTail, "data-status": status, children: [_jsx(StateDot, { state: dotState(status) }), _jsx("span", { children: t(STATUS_KEYS[status]) })] })] })), children: children }));
}
function MemberRow({ member, navigable, openSession, t }) {
    const name = readableMember(member.label, t);
    const [focused, setFocused] = useState(false);
    const renderButton = navigable || focused;
    const content = (_jsxs(_Fragment, { children: [_jsx("span", { className: css.dotSlot, children: _jsx(StateDot, { state: dotState(member.status) }) }), _jsx("span", { className: css.memberLabelWrap, "data-member-label-wrap": true, children: _jsx("span", { className: css.memberLabel, "data-member-label": true, children: name }) }), _jsx("span", { className: css.memberStatus, "data-member-status-text": true, children: t(STATUS_KEYS[member.status]) })] }));
    if (!renderButton) {
        return _jsx("div", { className: css.memberRow, "data-member-status": member.status, children: content });
    }
    return (_jsx("button", { type: "button", className: navigable ? css.memberButton : css.memberRow, "data-member-status": member.status, "aria-disabled": navigable ? undefined : true, "aria-label": navigable ? t('member.open', { name }) : name, tabIndex: navigable ? undefined : -1, onFocus: () => { setFocused(true); }, onBlur: () => { setFocused(false); }, onClick: navigable ? () => { openSession(member.childId); } : undefined, children: content }));
}
function PhaseSection({ contentRef, onContentBlur, onToggle, open, pendingCleanCollapse, phase, navigable, openSession, t, }) {
    return (_jsx("div", { className: css.phase, onMouseDownCapture: pendingCleanCollapse ? preventPendingHeaderFocus : undefined, children: _jsx(StatusDisclosure, { icon: _jsx(IconChevronRightOutline14, {}), title: readablePhase(phase.phase, t), open: open, onToggle: onToggle, expandOnRowClick: true, previewChevron: false, keepContentWhenOpen: true, rowClassName: css.phaseHeader, leadingClassName: css.phaseLeading, titleClassName: css.phaseTitle, collapsedContent: (_jsxs(_Fragment, { children: [_jsx("span", { className: css.separator, "aria-hidden": true }), _jsx("span", { className: css.phaseCount, "data-phase-count": true, children: memberCount(phase.members.length, t) }), _jsx("span", { className: css.phaseStatus, "data-phase-status-text": true, children: phaseStatusSummary(phase.members, t) })] })), children: _jsx("div", { ref: contentRef, className: css.members, onBlur: onContentBlur, children: phase.members.map(member => (_jsx(MemberRow, { member: member, navigable: navigable.includes(member.childId), openSession: openSession, t: t }, member.seq))) }) }) }));
}
/** Render one durable workflow run with status-driven run and phase disclosure. */
export function WorkflowRunPanel({ node, sessionId, useSessions, openSession, t }) {
    const phaseFacts = useMemo(() => node.data.phases.map(phase => [phase.key, phaseDisclosureFacts(phase)]), [node.data.phases]);
    const runFacts = useMemo(() => runDisclosureFacts(node.data.status, phaseFacts), [node.data.status, phaseFacts]);
    const totalMembers = runFacts.activityCount;
    const [disclosures, setDisclosures] = useState(() => ({
        run: initialDisclosureState(runFacts),
        phases: new Map(phaseFacts.map(([key, facts]) => [key, initialDisclosureState(facts)])),
    }));
    const runContentRef = useRef(null);
    const phaseContentRefs = useRef(new Map());
    const navigable = useSessions(sessions => navigableMembers(sessions, node.data.phases, sessionId), shallowEqual);
    // Outer hiding unmounts Phase content without a dependable blur event, so this edge settles deferred closes.
    useLayoutEffect(() => {
        setDisclosures((current) => {
            const phases = new Map();
            let phasesChanged = current.phases.size !== phaseFacts.length;
            let phaseStartedCycle = false;
            for (const [key, facts] of phaseFacts) {
                const previous = current.phases.get(key);
                const next = previous === undefined
                    ? initialDisclosureState(facts)
                    : advanceDisclosureState(previous, facts, focusIsWithin(phaseContentRefs.current.get(key)));
                phases.set(key, next);
                if (next !== previous)
                    phasesChanged = true;
                if (previous?.mode === 'clean'
                    && (facts.mode !== 'clean' || facts.activityCount !== previous.activityCount)) {
                    phaseStartedCycle = true;
                }
            }
            const advancedRun = advanceDisclosureState(current.run, runFacts, focusIsWithin(runContentRef.current));
            const run = phaseStartedCycle && runFacts.mode !== 'clean' && !advancedRun.open
                ? { ...advancedRun, open: true, pendingCleanCollapse: false }
                : advancedRun;
            return run !== current.run || phasesChanged ? { run, phases } : current;
        });
    }, [disclosures.run.open, phaseFacts, runFacts]);
    const toggleRun = () => {
        setDisclosures(current => ({
            ...current,
            run: {
                ...current.run,
                open: !current.run.open,
                pendingCleanCollapse: false,
            },
        }));
    };
    const togglePhase = (key) => {
        setDisclosures((current) => {
            const phases = new Map(current.phases);
            const phase = existingPhaseState(phases, key);
            phases.set(key, {
                ...phase,
                open: !phase.open,
                pendingCleanCollapse: false,
            });
            return { ...current, phases };
        });
    };
    const settleRunBlur = (event) => {
        if (event.currentTarget.contains(event.relatedTarget))
            return;
        setDisclosures((current) => {
            const run = collapsePending(current.run);
            return run === current.run ? current : { ...current, run };
        });
    };
    const settlePhaseBlur = (key, event) => {
        if (event.currentTarget.contains(event.relatedTarget))
            return;
        setDisclosures((current) => {
            const phase = existingPhaseState(current.phases, key);
            const next = collapsePending(phase);
            if (next === phase)
                return current;
            const phases = new Map(current.phases);
            phases.set(key, next);
            return { ...current, phases };
        });
    };
    return (_jsx("section", { className: css.root, "data-workflow-run": true, "data-run-status": node.data.status, onMouseDownCapture: disclosures.run.pendingCleanCollapse
            ? preventPendingHeaderFocus
            : undefined, children: _jsx(RunHeader, { count: totalMembers, name: node.data.name, open: disclosures.run.open, onToggle: toggleRun, status: node.data.status, t: t, children: _jsx("div", { ref: runContentRef, className: css.phaseList, onBlur: settleRunBlur, children: node.data.phases.length === 0
                    ? _jsx("span", { className: css.empty, children: t('run.empty') })
                    : node.data.phases.map((phase) => {
                        const facts = phaseDisclosureFacts(phase);
                        const disclosure = disclosures.phases.get(phase.key) ?? initialDisclosureState(facts);
                        return (_jsx(PhaseSection, { contentRef: (element) => {
                                if (element === null)
                                    phaseContentRefs.current.delete(phase.key);
                                else
                                    phaseContentRefs.current.set(phase.key, element);
                            }, onContentBlur: (event) => { settlePhaseBlur(phase.key, event); }, onToggle: () => { togglePhase(phase.key); }, open: disclosure.open, pendingCleanCollapse: disclosure.pendingCleanCollapse, phase: phase, navigable: navigable, openSession: openSession, t: t }, phase.key));
                    }) }) }) }));
}
