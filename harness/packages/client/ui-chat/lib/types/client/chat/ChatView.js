import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// An enclosing `[data-conversation-scroll]` owns scrolling when present;
// otherwise this view owns it. Each row subscribes to one stable node key.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, IconChevronDownOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { PendingSteeringBubble, PendingSubmissionBubble } from "./MessageItem.js";
import { ChatNodeSeat } from "./ChatNodeSeat.js";
import { TurnNavigator } from "./TurnNavigator.js";
import { formatRunDuration } from "./message-chrome.js";
import css from './ChatView.module.css';
/** A reader within this many px of the floor is "at the bottom": stuck. */
const FOLLOW_THRESHOLD = 120;
/** Sub-pixel/rubber-band slack: this close to the floor always counts as the floor. */
const BOTTOM_EPSILON = 2;
/** Safety net: a smooth jump never keeps the reader-intent guard past this. */
const SMOOTH_GUARD_MS = 3000;
/**
 * The element that is scrolling the transcript right now. An enclosing
 * `[data-conversation-scroll]` owns scrolling — except while a side panel is
 * docked beside Chat (the default in Atelier: Trajectory + Activity), when the
 * shell gives Chat's own `.scroll` box `overflow-y: auto` and the host stops
 * scrolling. The answer therefore follows the live computed overflow rather
 * than the DOM shape, and is re-resolved on every use because a panel toggle
 * moves transcript scrolling between the two elements while Chat stays mounted.
 */
function scrollerOf(from) {
    const host = from.closest('[data-conversation-scroll]');
    if (host === null)
        return from;
    const overflow = getComputedStyle(from).overflowY;
    return overflow === 'auto' || overflow === 'scroll' ? from : host;
}
/** The outermost element that can ever scroll this transcript (stable per mount). */
function scrollHostOf(from) {
    return from.closest('[data-conversation-scroll]') ?? from;
}
/** Reduced motion, or an engine without smooth programmatic scrolling. */
function prefersInstantScroll(el) {
    if (typeof el.scrollTo !== 'function' || typeof window.matchMedia !== 'function')
        return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
/** Find an already-rendered row without interpolating a selector. */
function anchorElement(list, key) {
    for (const row of list.querySelectorAll('[data-chat-anchor-key]:not([hidden])')) {
        if (row.dataset.chatAnchorKey === key)
            return row;
    }
    return null;
}
/**
 * Turn owning the row at a scrollport line. Scroll frames are hot, so this
 * hit-tests the line first and falls back to one row scan when layout cannot
 * answer (jsdom, pre-paint); neither path queries per navigation item.
 * @param list - the ChatView list element.
 * @param line - viewport y of the reading line.
 * @returns the Turn number, or null when no loaded row covers the line.
 */
function turnAtLine(list, line) {
    const content = list.getBoundingClientRect();
    if (typeof document.elementsFromPoint === 'function' && content.width > 0) {
        for (const element of document.elementsFromPoint(content.left + content.width / 2, line)) {
            const row = element instanceof HTMLElement ? element.closest('[data-chat-turn]') : null;
            const turn = Number(row?.dataset.chatTurn);
            if (row !== null && list.contains(row) && Number.isSafeInteger(turn))
                return turn;
        }
    }
    let found = null;
    for (const row of list.querySelectorAll('[data-chat-turn]')) {
        if (row.getBoundingClientRect().top > line)
            break;
        const turn = Number(row.dataset.chatTurn);
        if (Number.isSafeInteger(turn))
            found = turn;
    }
    return found;
}
/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row, scrollport) {
    return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;
}
/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
function pagingAnchor(list, scrollport) {
    const viewport = scrollport.getBoundingClientRect();
    const composer = scrollport.querySelector('[data-composer-seat]');
    const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom;
    // The leading edge preserves nested call identity when it hits a row.
    // Chrome/gap misses use logarithmic layout reads over the ordered flex rows.
    if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
        const content = list.getBoundingClientRect();
        const left = Math.max(viewport.left, content.left);
        const right = Math.min(viewport.right, content.right);
        const x = left + Math.max(0, right - left) / 2;
        for (const element of document.elementsFromPoint(x, viewport.top + 1)) {
            const row = element instanceof HTMLElement
                ? element.closest('[data-chat-anchor-key]')
                : null;
            if (row !== null && list.contains(row))
                return row;
        }
    }
    const rows = list.querySelectorAll('[data-chat-flow] > [data-chat-flow-key]:not(:empty):not([hidden])');
    let low = 0;
    let high = rows.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (rows.item(middle).getBoundingClientRect().bottom > viewport.top)
            high = middle;
        else
            low = middle + 1;
    }
    const row = rows[low];
    return row !== undefined && row.getBoundingClientRect().top < visibleBottom ? row : rows[0] ?? null;
}
/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list, scrollport) {
    const row = pagingAnchor(list, scrollport);
    const anchorKey = row?.dataset.chatAnchorKey;
    if (row === null || anchorKey === undefined)
        return null;
    return {
        anchorKey,
        anchorTop: flowTop(row, scrollport),
        scrollTop: scrollport.scrollTop,
    };
}
/** Host/OS refusal text for the file-open dialog; empty throws keep a locale fallback. */
function openFailureMessage(error, fallback) {
    const message = error instanceof Error ? error.message : String(error);
    return message === '' ? fallback : message;
}
/** ProducedFiles opens the session workspace as `.`. */
function isFolderOpenPath(path) {
    return path === '.';
}
/**
 * Prompt-RPC identities already rendered by durable material: user/steering
 * node sources plus queue occurrences. A submission echo whose identity
 * appears here is hidden in the same render, so the echo→durable swap is
 * atomic — no duplicate, no gap — regardless of when the echo leaves the
 * session snapshot.
 */
function observedRpcIds(order, nodes, queue) {
    const observed = new Set();
    for (const key of order) {
        const node = nodes.get(key);
        if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering'))
            continue;
        const source = node.data.source;
        if (source?.kind === 'user' && typeof source.rpcId === 'string')
            observed.add(source.rpcId);
    }
    for (const item of queue) {
        if (item.rpcId !== undefined)
            observed.add(item.rpcId);
    }
    return observed;
}
function runningTurnStartTime(timeline) {
    let latest = null;
    for (const turn of timeline.turns.values()) {
        if (turn.status === 'open')
            latest = turn.start?.time ?? null;
    }
    return latest;
}
/** Turn-level model activity label retained across first-token, tool, and streaming phases. */
function TurnStatus({ startTime, t }) {
    const [mountedAt] = useState(() => Date.now());
    // Anchored to turn/start so a mid-turn reload keeps the real
    // elapsed time and the final footer's Ran-for label matches this clock.
    const anchor = startTime ?? mountedAt;
    const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor));
    useEffect(() => {
        const tick = () => {
            setElapsedMs(Math.max(0, Date.now() - anchor));
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => { clearInterval(id); };
    }, [anchor]);
    // Short turns keep the plain label; the clock only appears once the turn
    // has clearly been running for a while.
    const showClock = elapsedMs >= 15_000;
    return (_jsxs("div", { className: css.turnStatus, role: "status", "aria-live": "polite", children: [t('chat.deepDiving'), showClock && (_jsx("span", { className: css.turnStatusClock, "aria-hidden": true, children: formatRunDuration(elapsedMs, t) }))] }));
}
/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({ useSession, useChat, useSessions, useStore, actions, renderSlot, sessionId, openFile, loadOlder, loadImage, openView, chatScroll, forkAt, fileMentions, useTranscriptView, surface = 'main', t, }) {
    const order = useChat(s => s.order);
    const nodeStore = useChat(s => s.nodes);
    // The rail's items are accumulated in the Chat snapshot, so this selector is
    // both the data and its change signal: the array identity moves only when a
    // Turn enters, leaves, or changes its preview.
    const turnNavigationItems = useChat(s => s.navigation.items());
    const timeline = useChat(s => s.timeline);
    const inbox = useSession(s => s.queue);
    // Workspace root off the session list row: path summaries display relative to it.
    const cwd = useSessions(s => s.byId[sessionId]?.cwd);
    const running = useSession(s => s.running);
    const openState = useSession(s => s.openState);
    const openError = useSession(s => s.openError);
    const hasMore = useSession(s => s.hasMore);
    const loadingOlder = useSession(s => s.loadingOlder);
    const selectedCallId = useStore(s => s.selection?.callId);
    const compactTranscript = useTranscriptView(mode => mode === 'compact');
    const inspectCall = useCallback((callId) => {
        openView('trajectory', callId);
    }, [openView]);
    const [fileOpenError, setFileOpenError] = useState(null);
    const [fileOpenBusy, setFileOpenBusy] = useState(false);
    // Close/retry must ignore a settlement that started before the latest
    // gesture; otherwise a cancelled in-flight refusal reopens the dialog.
    const fileOpenRequest = useRef(0);
    const requestOpenFile = useCallback((path) => {
        const id = ++fileOpenRequest.current;
        setFileOpenBusy(true);
        void openFile(path).then(() => {
            if (id !== fileOpenRequest.current)
                return;
            setFileOpenError(null);
            setFileOpenBusy(false);
        }, (error) => {
            if (id !== fileOpenRequest.current)
                return;
            setFileOpenError({
                path,
                message: openFailureMessage(error, t(isFolderOpenPath(path) ? 'fileOpen.folderUnknown' : 'fileOpen.unknown')),
            });
            setFileOpenBusy(false);
        });
    }, [openFile, t]);
    const closeFileOpenError = useCallback(() => {
        fileOpenRequest.current += 1;
        setFileOpenError(null);
        setFileOpenBusy(false);
    }, []);
    const pendingSteering = useMemo(() => inbox.filter(item => item.placement === 'steering'), [inbox]);
    const pendingSubmissions = useSession(s => s.pendingSubmissions);
    // Submission echoes still awaiting their durable counterpart. `order` is the
    // recompute trigger: durable user material always arrives as an append, and
    // every append replaces the order array.
    const visibleSubmissions = useMemo(() => {
        if (pendingSubmissions.length === 0)
            return pendingSubmissions;
        const observed = observedRpcIds(order, nodeStore, inbox);
        return pendingSubmissions.filter(submission => !observed.has(submission.requestId));
    }, [pendingSubmissions, order, nodeStore, inbox]);
    const renderMessageImages = useCallback(owner => renderSlot('conversation.message.images', { ...owner, loadImage }), [loadImage, renderSlot]);
    const runningTurnStart = useMemo(() => runningTurnStartTime(timeline), [timeline]);
    const listRef = useRef(null);
    const columnRef = useRef(null);
    // A saved position starts disarmed; the first layout effect synchronously
    // restores it and normalizes a floor-clamped position back to following.
    const [atBottom, setAtBottom] = useState(() => chatScroll.read() === null);
    const atBottomRef = useRef(atBottom);
    const [activeTurn, setActiveTurn] = useState(() => turnNavigationItems.at(-1)?.turn ?? null);
    /** Last position delivered or written on the main thread. */
    const observedTopRef = useRef(0);
    /** Paging anchor: semantic row/position at click, updated by reader scrolls
     * while the request is pending and restored after the prepend lands. */
    const anchorRef = useRef(null);
    const firstSeqRef = useRef(null);
    const openedRef = useRef(false);
    const lastKeyRef = useRef(null);
    const lastSteeringIdRef = useRef(null);
    const lastSubmissionIdRef = useRef(null);
    /** Flow tip signature — follow-scroll only when this moves, never on a
     *  scroll-driven at-bottom chrome re-render (which would snap inertial
     *  scrolls the rest of the way to the floor). */
    const followSigRef = useRef(null);
    const firstKey = order[0];
    const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null;
    const lastKey = order.at(-1) ?? null;
    const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey);
    const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null;
    const lastSubmissionId = visibleSubmissions[visibleSubmissions.length - 1]?.requestId ?? null;
    const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}:${lastSubmissionId ?? ''}`;
    const syncActiveTurn = useCallback(() => {
        const local = listRef.current;
        const first = turnNavigationItems[0];
        if (local === null || first === undefined) {
            setActiveTurn(null);
            return;
        }
        const el = scrollerOf(local);
        const readingLine = el.getBoundingClientRect().top + Math.min(96, el.clientHeight * 0.2);
        const reading = turnAtLine(local, readingLine);
        // No row reaches the line yet: the flow head still owns the mark. Otherwise
        // the row's Turn may be one the rail does not offer (all its nodes hidden),
        // so the newest offered Turn at or above it owns the mark.
        let next = first.turn;
        if (reading !== null) {
            for (const item of turnNavigationItems) {
                if (item.turn > reading)
                    break;
                next = item.turn;
            }
        }
        if (el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1) {
            next = turnNavigationItems.at(-1)?.turn ?? next;
        }
        setActiveTurn(current => current === next ? current : next);
    }, [turnNavigationItems]);
    const activeTurnRef = useRef(null);
    const activeFrameRef = useRef(null);
    const scheduleActiveTurn = useCallback(() => {
        if (activeFrameRef.current !== null)
            return;
        if (typeof requestAnimationFrame === 'undefined') {
            syncActiveTurn();
            return;
        }
        activeFrameRef.current = requestAnimationFrame(() => {
            activeFrameRef.current = null;
            syncActiveTurn();
        });
    }, [syncActiveTurn]);
    useEffect(() => () => {
        if (activeFrameRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(activeFrameRef.current);
        }
    }, []);
    activeTurnRef.current = scheduleActiveTurn;
    useLayoutEffect(() => {
        scheduleActiveTurn();
    }, [scheduleActiveTurn]);
    /** A smooth jump is in flight: its intermediate frames are not reader input. */
    const smoothingRef = useRef(false);
    const smoothTimerRef = useRef(null);
    const endSmoothing = useCallback(() => {
        smoothingRef.current = false;
        if (smoothTimerRef.current !== null) {
            clearTimeout(smoothTimerRef.current);
            smoothTimerRef.current = null;
        }
    }, []);
    useEffect(() => endSmoothing, [endSmoothing]);
    const toBottom = (el) => {
        endSmoothing();
        anchorRef.current = null;
        el.scrollTop = el.scrollHeight;
        observedTopRef.current = el.scrollTop;
        atBottomRef.current = true;
        setAtBottom(true);
        chatScroll.save(null);
        setActiveTurn(turnNavigationItems.at(-1)?.turn ?? null);
    };
    /** "Jump to latest": resume sticking at once, glide there unless motion is reduced. */
    const jumpToLatest = (el) => {
        if (prefersInstantScroll(el)) {
            toBottom(el);
            return;
        }
        anchorRef.current = null;
        atBottomRef.current = true;
        setAtBottom(true);
        chatScroll.save(null);
        setActiveTurn(turnNavigationItems.at(-1)?.turn ?? null);
        endSmoothing();
        smoothingRef.current = true;
        smoothTimerRef.current = setTimeout(endSmoothing, SMOOTH_GUARD_MS);
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    };
    useLayoutEffect(() => {
        const local = listRef.current;
        /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
        if (local === null)
            return;
        const el = scrollerOf(local);
        // Open completed: jump to the bottom once — unless a scroll position
        // survives from a previous mount (view-tab switch away and back), which
        // is restored instead of snapping the reader back to the floor.
        if (openState === 'open' && !openedRef.current) {
            openedRef.current = true;
            const saved = chatScroll.read();
            if (saved === null) {
                toBottom(el);
            }
            else {
                el.scrollTop = saved.scrollTop;
                const row = anchorElement(local, saved.anchorKey);
                if (row !== null)
                    el.scrollTop += flowTop(row, el) - saved.anchorTop;
                observedTopRef.current = el.scrollTop;
                const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1;
                atBottomRef.current = isAtBottom;
                setAtBottom(isAtBottom);
                const normalized = isAtBottom ? null : scrollPosition(local, el);
                if (isAtBottom)
                    chatScroll.save(null);
                else if (normalized !== null)
                    chatScroll.save(normalized);
            }
            firstSeqRef.current = firstSeq;
            lastKeyRef.current = lastKey;
            lastSteeringIdRef.current = lastSteeringId;
            lastSubmissionIdRef.current = lastSubmissionId;
            followSigRef.current = followSig;
            return;
        }
        // Prepend (head seq decreased): preserve the same settled row at the
        // position established by the reader's latest scroll. This excludes
        // unrelated tail/composer growth while the request was in flight.
        if (anchorRef.current !== null && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
            const anchor = anchorRef.current;
            anchorRef.current = null;
            const row = anchorElement(local, anchor.key);
            if (row !== null)
                el.scrollTop += flowTop(row, el) - anchor.top;
            observedTopRef.current = el.scrollTop;
            firstSeqRef.current = firstSeq;
            /* v8 ignore next -- ?? arm: a prepend adds nodes, so the flow list here is never empty. */
            lastKeyRef.current = lastKey;
            lastSteeringIdRef.current = lastSteeringId;
            lastSubmissionIdRef.current = lastSubmissionId;
            followSigRef.current = followSig;
            return;
        }
        firstSeqRef.current = firstSeq;
        // Own words must be visible: a new trailing user node force-scrolls
        // (send lives in the composer, so arrival is detected here, not armed there).
        const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === 'user';
        const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current;
        const appendedSubmission = lastSubmissionId !== null && lastSubmissionId !== lastSubmissionIdRef.current;
        const tipMoved = followSigRef.current !== followSig;
        lastKeyRef.current = lastKey;
        lastSteeringIdRef.current = lastSteeringId;
        lastSubmissionIdRef.current = lastSubmissionId;
        followSigRef.current = followSig;
        // Follow new flow content while pinned; do NOT re-pin on every render
        // merely because atBottomRef is true (scroll threshold → setState → snap).
        if (appendedUser || appendedSteering || appendedSubmission || (tipMoved && atBottomRef.current))
            toBottom(el);
    });
    const onScrollRef = useRef(() => { });
    onScrollRef.current = () => {
        const local = listRef.current;
        /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
        if (local === null)
            return;
        const el = scrollerOf(local);
        // Only reader input may make raw scroll geometry change follow ownership:
        // a delivered position that deviates from the observed-top ledger (every
        // programmatic write records itself there synchronously). This covers
        // wheel, touch, scrollbar, and keyboard alike without naming devices.
        // Browser shrink-clamps land exactly on the floor min and delayed
        // programmatic deliveries land on the ledger itself, so both preserve
        // the current ownership state.
        const floor = Math.max(0, el.scrollHeight - el.clientHeight);
        if (smoothingRef.current) {
            // Frames of our own smooth jump: follow ownership was already taken, so
            // they must not read as the reader leaving the floor.
            if (floor - el.scrollTop <= BOTTOM_EPSILON)
                endSmoothing();
            observedTopRef.current = el.scrollTop;
            return;
        }
        const ledgerTop = Math.min(observedTopRef.current, floor);
        const movedByReader = Math.abs(el.scrollTop - ledgerTop) > 0.5;
        // Scrolling UP is the reader taking over: the very first upward frame
        // unsticks (beyond the sub-pixel slack), so a streaming tail cannot drag
        // them back down while they are still inside the follow zone. Scrolling
        // down re-sticks once within FOLLOW_THRESHOLD of the floor.
        const movedUp = el.scrollTop < ledgerTop - 0.5;
        const distance = floor - el.scrollTop;
        const isAtBottom = movedByReader
            ? distance <= BOTTOM_EPSILON || (!movedUp && distance <= FOLLOW_THRESHOLD + 1)
            : atBottomRef.current;
        if (!movedByReader && isAtBottom) {
            toBottom(el);
            return;
        }
        atBottomRef.current = isAtBottom;
        setAtBottom(isAtBottom);
        const position = isAtBottom ? null : scrollPosition(local, el);
        if (isAtBottom) {
            anchorRef.current = null;
        }
        else if (anchorRef.current !== null && position !== null) {
            anchorRef.current = { key: position.anchorKey, top: position.anchorTop };
        }
        // Continuous save (unmount happens after ref detach, so saving there is
        // too late); pinned-to-bottom clears so a remount keeps following.
        if (isAtBottom)
            chatScroll.save(null);
        else if (position !== null)
            chatScroll.save(position);
        observedTopRef.current = el.scrollTop;
        scheduleActiveTurn();
    };
    // Bind the scroll listener once per mount, on the STABLE outer host in the
    // capture phase: scroll events do not bubble, but a capture listener on an
    // ancestor still sees them, and the host outlives every panel toggle that
    // moves transcript scrolling between the host and Chat's own .scroll box
    // (see scrollerOf). Only the live scroller's own events count — nested
    // scrollers (wide code blocks, tables) are ignored. Reader-input attribution
    // rides the observed-top ledger, not per-device input listeners; wheel,
    // touch and key input only cancel an in-flight smooth jump.
    useEffect(() => {
        const local = listRef.current;
        /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
        if (local === null)
            return;
        const host = scrollHostOf(local);
        const onScroll = (event) => {
            const target = event.target;
            if (target !== local && target !== host)
                return;
            if (target !== scrollerOf(local))
                return;
            onScrollRef.current();
        };
        host.addEventListener('scroll', onScroll, { passive: true, capture: true });
        const readerInput = () => { endSmoothing(); };
        const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
        for (const name of inputEvents)
            host.addEventListener(name, readerInput, { passive: true, capture: true });
        return () => {
            host.removeEventListener('scroll', onScroll, { capture: true });
            for (const name of inputEvents)
                host.removeEventListener(name, readerInput, { capture: true });
        };
    }, [endSmoothing]);
    // The ref starts null and is assigned every render, so the placeholder
    // initializer a function initial value would need never exists.
    const followRef = useRef(null);
    followRef.current = () => {
        const local = listRef.current;
        if (local !== null && atBottomRef.current) {
            const el = scrollerOf(local);
            // Skip the no-op write: it would deliver a pointless scroll event.
            if (Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) > 0.5) {
                el.scrollTop = el.scrollHeight;
            }
            observedTopRef.current = el.scrollTop;
            chatScroll.save(null);
        }
    };
    // Streaming, tool disclosures, image loads and other flow changes resize the
    // column; the sticky composer and the side panels resize the scrollport from
    // outside it. This observer owns ChatView's dynamic-height follow decisions
    // and writes only while the reader is pinned. It runs between layout and
    // paint, so a growing tail is pinned in the same frame (no jitter).
    useEffect(() => {
        const column = columnRef.current;
        const local = listRef.current;
        if (column === null || local === null || typeof ResizeObserver === 'undefined')
            return;
        const host = scrollHostOf(local);
        let composer = null;
        // Flow-height changes (image loads, tool disclosures) move rows across the
        // reading line without a scroll event, so the active mark resyncs here too.
        const observer = new ResizeObserver(() => {
            if (composer === null) {
                composer = host.querySelector('[data-composer-seat]');
                if (composer !== null)
                    observer.observe(composer);
            }
            followRef.current?.();
            activeTurnRef.current?.();
        });
        observer.observe(column);
        // Both candidate scrollports: the host (single-view layout) and Chat's own
        // box (side-by-side layout, where a growing composer or a panel resize
        // shrinks it without touching the column).
        observer.observe(local);
        if (host !== local)
            observer.observe(host);
        composer = host.querySelector('[data-composer-seat]');
        if (composer !== null)
            observer.observe(composer);
        return () => { observer.disconnect(); };
    }, []);
    // A failed/empty page leaves the head unchanged. Once the request leaves
    // its busy state there is no future prepend for the saved anchor to own.
    useEffect(() => {
        if (!loadingOlder)
            anchorRef.current = null;
    }, [loadingOlder]);
    const loadOlderAnchored = () => {
        const local = listRef.current;
        /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
        if (local !== null) {
            const el = scrollerOf(local);
            const row = pagingAnchor(local, el);
            if (row !== null && row.dataset.chatAnchorKey !== undefined) {
                anchorRef.current = {
                    key: row.dataset.chatAnchorKey,
                    top: flowTop(row, el),
                };
            }
        }
        loadOlder();
    };
    // Identity feeds the memoized rail; a fresh closure per render would defeat it.
    const navigateToTurn = useCallback((item) => {
        const local = listRef.current;
        if (local === null)
            return;
        const row = anchorElement(local, item.anchorKey);
        if (row === null)
            return;
        const el = scrollerOf(local);
        el.scrollTop += flowTop(row, el) - 24;
        observedTopRef.current = el.scrollTop;
        // A pending older page still has to compensate the prepended height, so
        // navigation moves that anchor to the new position instead of dropping it.
        const landed = loadingOlder ? pagingAnchor(local, el) : null;
        anchorRef.current = landed === null || landed.dataset.chatAnchorKey === undefined
            ? null
            : { key: landed.dataset.chatAnchorKey, top: flowTop(landed, el) };
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1;
        atBottomRef.current = isAtBottom;
        setAtBottom(isAtBottom);
        setActiveTurn(item.turn);
        const position = isAtBottom ? null : scrollPosition(local, el);
        if (isAtBottom)
            chatScroll.save(null);
        else if (position !== null)
            chatScroll.save(position);
    }, [loadingOlder, chatScroll]);
    return (_jsxs("div", { className: css.root, "data-conversation-view-surface": surface, children: [_jsxs("div", { ref: listRef, className: css.scroll, children: [_jsx(TurnNavigator, { items: turnNavigationItems, activeTurn: activeTurn, onNavigate: navigateToTurn, t: t }), _jsxs("div", { ref: columnRef, className: css.column, "data-chat-flow": "", children: [openState === 'loading' && _jsx("div", { className: css.hint, children: t('chat.loadingHistory') }), openState === 'error' && openError !== null && (_jsx("div", { className: css.openError, children: t('chat.loadError', { message: openError.message, code: openError.code }) })), hasMore && (_jsx("div", { className: css.older, children: _jsx("button", { type: "button", disabled: loadingOlder, onClick: loadOlderAnchored, children: loadingOlder ? t('loading') : t('chat.loadOlder') }) })), order.map(nodeKey => (_jsx(ChatNodeSeat, { nodeKey: nodeKey, historyIncomplete: hasMore, compactTranscript: compactTranscript, useChat: useChat, useStore: useStore, actions: actions, selectedCallId: selectedCallId, cwd: cwd, openFile: requestOpenFile, inspectCall: inspectCall, forkAt: forkAt, renderMessageImages: renderMessageImages, fileMentions: fileMentions, renderSlot: renderSlot, t: t }, nodeKey))), running && _jsx(TurnStatus, { startTime: runningTurnStart, t: t }), pendingSteering.map(item => (_jsx(PendingSteeringBubble, { content: item.content, renderMessageImages: renderMessageImages, t: t }, item.id))), visibleSubmissions.map(submission => (_jsx(PendingSubmissionBubble, { submission: submission, renderMessageImages: renderMessageImages, t: t }, submission.requestId)))] }), !atBottom && (_jsx("div", { className: css.toBottomSlot, children: _jsxs("button", { type: "button", className: css.toBottom, "aria-label": t('chat.jumpToLatest'), onClick: () => {
                                const local = listRef.current;
                                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                                if (local !== null)
                                    jumpToLatest(scrollerOf(local));
                            }, children: [_jsx("span", { className: css.toBottomLabel, children: t('chat.jumpToLatest') }), _jsx(IconChevronDownOutline14, {})] }) }))] }), fileOpenError !== null && (_jsx(FileOpenErrorDialog, { path: fileOpenError.path, message: fileOpenError.message, busy: fileOpenBusy, onClose: closeFileOpenError, onRetry: () => { requestOpenFile(fileOpenError.path); }, t: t }))] }));
}
/** In-page Host open-path refusal: the wire reason plus a retry of the same path. */
function FileOpenErrorDialog({ path, message, busy, onClose, onRetry, t, }) {
    return (_jsx(Modal, { open: true, onClose: onClose, closeLabel: t('close'), title: t(isFolderOpenPath(path) ? 'fileOpen.folderTitle' : 'fileOpen.title'), description: message, footer: (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", className: css.modalAction, onClick: onClose, children: t('cancel') }), _jsx(Button, { variant: "primary", className: css.modalAction, disabled: busy, onClick: onRetry, children: t('retry') })] })) }));
}
