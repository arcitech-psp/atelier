/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import clsx from 'clsx'
import {
  IconCloseOutline16, IconBranchOutline16, IconChecklistOutline14, IconPanelLeftOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import type { ViewTab } from '../contract/views.ts'
import {
  setTrajectoryPanelOpen, setTrajectoryPanelWidth, useTrajectoryPanelOpen,
  useTrajectoryPanelWidth,
} from './trajectory-panel-preference.ts'
import {
  ACTIVITY_PANEL_DEFAULT_WIDTH, ACTIVITY_PANEL_MIN_WIDTH,
  setActivityPanelOpen, setActivityPanelWidth, useActivityPanelOpen, useActivityPanelWidth,
} from './activity-panel-preference.ts'
import { captureTranscriptAnchor, restoreTranscriptAnchor } from './transcript-anchor.ts'
import { ActivityPanel } from './ActivityPanel.tsx'
import { KnowledgeGraphPanel } from './KnowledgeGraphPanel.tsx'
import { PanelHost } from './PanelHost.tsx'
import {
  addPanelTile, readPanelDockState, removePanelTile, soloPanelId, writePanelDockState,
} from './panel-dock.ts'
import type { PanelDockId } from './panel-dock.ts'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps & PropsLocale<'conversation'>

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

const DEFAULT_VIEW_ID = 'chat'
const TRAJECTORY_VIEW_ID = 'trajectory'
const TRAJECTORY_PANEL_ID = 'dsh-trajectory-panel'
const TRAJECTORY_PANEL_MIN = 280
const TRAJECTORY_MAIN_MIN = 360
const TRAJECTORY_RESIZE_GUTTER = 12
const TRAJECTORY_STACK_MAIN_MIN = 240
const TRAJECTORY_STACK_PANEL_MIN = 260
const KNOWLEDGE_GRAPH_PANEL_ID = 'dsh-knowledge-graph-panel'
const KNOWLEDGE_GRAPH_PANEL_MIN = 300
const SIDE_PANEL_MIN = 300

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function panelWidthBounds(containerWidth: number, min = TRAJECTORY_PANEL_MIN, occupied = 0): { min: number; max: number } {
  return {
    min,
    max: Math.max(min, containerWidth - TRAJECTORY_MAIN_MIN - TRAJECTORY_RESIZE_GUTTER - occupied),
  }
}

function panelHeightBounds(containerHeight: number): { min: number; max: number } {
  return {
    min: TRAJECTORY_STACK_PANEL_MIN,
    max: Math.min(
      520,
      Math.max(TRAJECTORY_STACK_PANEL_MIN,
        containerHeight - TRAJECTORY_STACK_MAIN_MIN - TRAJECTORY_RESIZE_GUTTER),
    ),
  }
}

function TrajectoryResizeHandle(props: {
  panel: 'trajectory' | 'knowledge-graph' | 'side-panel' | 'activity'
  axis: 'width' | 'height'
  value: number
  min: number
  max: number
  getRect: () => DOMRect | undefined
  onPreview: (value: number) => void
  onCommit: (value: number) => void
  onCancel: () => void
  onReset: () => void
  label: string
}) {
  const [dragging, setDragging] = useState(false)
  const active = useRef(false)
  const pointerId = useRef<number | null>(null)
  const latest = useRef(props.value)
  const callbacks = useRef(props)
  callbacks.current = props

  const finish = useCallback((cancelled: boolean) => {
    if (!active.current) return
    active.current = false
    pointerId.current = null
    setDragging(false)
    if (cancelled) callbacks.current.onCancel()
    else callbacks.current.onCommit(latest.current)
  }, [])

  useEffect(() => () => {
    if (active.current) callbacks.current.onCancel()
    active.current = false
    pointerId.current = null
  }, [])

  const measure = useCallback((event: PointerEvent<HTMLDivElement>): number => {
    const rect = callbacks.current.getRect()
    if (rect === undefined) return callbacks.current.value
    const raw = callbacks.current.axis === 'width'
      ? rect.right - event.clientX
      : rect.bottom - event.clientY
    return clamp(raw, callbacks.current.min, callbacks.current.max)
  }, [])

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    active.current = true
    pointerId.current = event.pointerId
    latest.current = callbacks.current.value
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }, [])

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!active.current || pointerId.current !== event.pointerId) return
    latest.current = measure(event)
    callbacks.current.onPreview(latest.current)
  }, [measure])

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!active.current || pointerId.current !== event.pointerId) return
    latest.current = measure(event)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finish(false)
  }, [finish, measure])

  const onPointerCancel = useCallback(() => { finish(true) }, [finish])
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 24
    let next: number | undefined
    if (event.key === 'Home') next = callbacks.current.min
    else if (event.key === 'End') next = callbacks.current.max
    else if (callbacks.current.axis === 'width' && event.key === 'ArrowLeft') next = callbacks.current.value + step
    else if (callbacks.current.axis === 'width' && event.key === 'ArrowRight') next = callbacks.current.value - step
    else if (callbacks.current.axis === 'height' && event.key === 'ArrowUp') next = callbacks.current.value + step
    else if (callbacks.current.axis === 'height' && event.key === 'ArrowDown') next = callbacks.current.value - step
    if (next === undefined) return
    event.preventDefault()
    next = clamp(next, callbacks.current.min, callbacks.current.max)
    latest.current = next
    callbacks.current.onPreview(next)
    callbacks.current.onCommit(next)
  }, [])

  return (
    <div
      className={clsx(
        css.trajectoryResizeHandle,
        props.axis === 'width' ? css.trajectoryResizeHandleWidth : css.trajectoryResizeHandleHeight,
      )}
      role="separator"
      tabIndex={0}
      aria-orientation={props.axis === 'width' ? 'vertical' : 'horizontal'}
      aria-label={props.label}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={Math.round(props.value)}
      data-trajectory-resize={props.panel === 'trajectory' ? props.axis : undefined}
      data-knowledge-graph-resize={props.panel === 'knowledge-graph' ? props.axis : undefined}
      data-side-panel-resize={props.panel === 'side-panel' ? props.axis : undefined}
      data-activity-resize={props.panel === 'activity' ? props.axis : undefined}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onKeyDown={onKeyDown}
      onDoubleClick={props.onReset}
    />
  )
}

/** Resolve a persisted selection, then registered Chat, without choosing another View. */
function resolveActiveView(tabs: readonly ViewTab[], selectedId: string | null): ViewTab | undefined {
  const selected = selectedId === null ? undefined : tabs.find(view => view.id === selectedId)
  return selected ?? tabs.find(view => view.id === DEFAULT_VIEW_ID)
}

function mainViews(tabs: readonly ViewTab[]): readonly ViewTab[] {
  return tabs.filter(view => view.id !== TRAJECTORY_VIEW_ID)
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useConversation, useConversationViews, useStore, actions,
  renderSlot, open, t, useSidePanelAvailable,
}: ConversationSessionHeaderProps) {
  const headerRef = useRef<HTMLElement>(null)
  const [compactHeader, setCompactHeader] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return
    const observer = new ResizeObserver(([entry]) => setCompactHeader(entry.contentRect.width < 1100))
    observer.observe(header)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!overflowOpen) return
    const dismiss = (event: Event) => {
      if (event.type === 'keydown' && (event as globalThis.KeyboardEvent).key !== 'Escape') return
      if (event.type === 'pointerdown' && headerRef.current?.contains(event.target as Node)) return
      setOverflowOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss) }
  }, [overflowOpen])
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(mainViews(tabs), selectedId)
  const trajectory = tabs.find(view => view.id === TRAJECTORY_VIEW_ID)
  const trajectoryOpen = useTrajectoryPanelOpen()
  const activityOpen = useActivityPanelOpen()
  const knowledgeGraphOpen = useStore(s => s.knowledgeGraphOpen ?? false)
  const sidePanelOpen = useStore(s => s.sidePanelOpen ?? false)
  const sidePanelAvailable = useSidePanelAvailable(value => value)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const blankSession = session.blank && conversationPhase(session, conversation) === 'blank'
  const hideChrome = blankSession && !sidePanelAvailable
  const toggleSidePanel = useCallback((): void => {
    captureTranscriptAnchor()
    actions.setSidePanelOpen(!sidePanelOpen)
  }, [actions, sidePanelOpen])
  const sidePanelUtilityOwner = {
    sidePanelOpen,
    onToggleSidePanel: sidePanelAvailable ? toggleSidePanel : undefined,
  }

  return (
    <header
      ref={headerRef}
      data-header-compact={compactHeader}
      className={clsx(css.header, hideChrome && css.headerHidden)}
      aria-hidden={hideChrome || undefined}
    >
      {hideChrome ? null : blankSession ? (
        <div className={clsx(css.headerUtilities, css.headerBlankUtilities)}>
          {renderSlot('conversation.session.header.utilities', sidePanelUtilityOwner)}
        </div>
      ) : (
        <>
          <div className={css.titleRow}>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  const title = (
                    <button
                      type="button"
                      className={clsx(
                        css.crumb,
                        summary.subagent && css.crumbSubagent,
                        last && css.crumbCurrent,
                      )}
                      disabled={last}
                      onClick={() => { open(summary.id) }}
                    >
                      {summary.displayTitle}
                    </button>
                  )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <button type="button" className={css.overflowToggle} data-header-overflow="" hidden={!compactHeader}
              aria-label={t('header.more')} title={t('header.more')} aria-expanded={overflowOpen}
              aria-controls="atelier-header-utilities" onClick={() => setOverflowOpen(value => !value)}>⋯</button>
            <div id="atelier-header-utilities" className={clsx(css.headerUtilities, compactHeader && css.overflowUtilities)}
              data-header-menu="" hidden={compactHeader && !overflowOpen}>
              {renderSlot('conversation.session.header.utilities', sidePanelUtilityOwner)}
              <button
                type="button"
                className={css.panelToggle}
                data-activity-panel-toggle=""
                aria-controls="dsh-activity-panel"
                aria-expanded={activityOpen}
                aria-label={t(activityOpen ? 'activity.close' : 'activity.open')}
                title={t(activityOpen ? 'activity.close' : 'activity.open')}
                onClick={() => { captureTranscriptAnchor(); setActivityPanelOpen(!activityOpen) }}
              >
                {/* Activity and the knowledge graph both drew IconDataOutline16, so on a tablet (no hover titles)
                    the two could not be told apart (2026-09-19): activity is now a checklist, the graph a branch. */}
                <IconChecklistOutline14 size={16} />
              </button>
              {trajectory !== undefined && (
                <button
                  type="button"
                  className={css.panelToggle}
                  data-trajectory-panel-toggle=""
                  aria-controls={TRAJECTORY_PANEL_ID}
                  aria-expanded={trajectoryOpen}
                  aria-label={t(trajectoryOpen ? 'trajectory.close' : 'trajectory.open')}
                  title={t(trajectoryOpen ? 'trajectory.close' : 'trajectory.open')}
                  onClick={() => { captureTranscriptAnchor(); setTrajectoryPanelOpen(!trajectoryOpen) }}
                >
                  <IconPanelLeftOutline16 className={css.panelToggleIcon} size={16} />
                </button>
              )}
              <button
                type="button"
                className={css.panelToggle}
                data-knowledge-graph-panel-toggle=""
                aria-controls={KNOWLEDGE_GRAPH_PANEL_ID}
                aria-expanded={knowledgeGraphOpen}
                aria-label={t(knowledgeGraphOpen ? 'graph.close' : 'graph.open')}
                title={t(knowledgeGraphOpen ? 'graph.close' : 'graph.open')}
                onClick={() => { captureTranscriptAnchor(); actions.setKnowledgeGraphOpen(!knowledgeGraphOpen) }}
              >
                <IconBranchOutline16 size={16} />
              </button>
            </div>
          </div>
          {mainViews(tabs).length > 1 && (
            <div className={css.tabs} role="tablist">
              {mainViews(tabs).map(viewTab => (
                <button
                  key={viewTab.id}
                  type="button"
                  role="tab"
                  aria-selected={viewTab.id === active?.id}
                  className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
                  onClick={() => { actions.setView(viewTab.id) }}
                >
                  {viewTab.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession({
  sessionId, useSession, useSessions, useConversation, useConversationViews,
  useInput, inputActions, useStore, actions, renderSlot, bindDraftMirror,
  knowledgeGraph, releaseKnowledgeGraphStorage, stageAttachment, t, useSidePanelAvailable,
}: ConversationSessionProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const mainTabs = mainViews(tabs)
  const active = resolveActiveView(mainTabs, selectedId)
  const trajectory = tabs.find(view => view.id === TRAJECTORY_VIEW_ID)
  const trajectoryOpen = useTrajectoryPanelOpen()
  const trajectoryPanelWidth = useTrajectoryPanelWidth()
  const activityOpen = useActivityPanelOpen()
  const knowledgeGraphOpen = useStore(s => s.knowledgeGraphOpen ?? false)
  const knowledgeGraphPanelWidth = useStore(s => s.knowledgeGraphWidth ?? null)
  const sidePanelOpenStored = useStore(s => s.sidePanelOpen ?? false)
  const sidePanelAvailable = useSidePanelAvailable(value => value)
  const sidePanelOpen = sidePanelOpenStored && sidePanelAvailable
  const sidePanelWidth = useStore(s => s.sidePanelWidth ?? null)
  const soloPanel = soloPanelId()
  const [panelDockState, setPanelDockState] = useState(readPanelDockState)
  const sessions = useSessions(s => s)
  const viewAreaRef = useRef<HTMLDivElement | null>(null)
  const [viewAreaSize, setViewAreaSize] = useState({ width: 0, height: 0 })
  const [livePanelWidth, setLivePanelWidth] = useState<number | null>(null)
  const [panelHeight, setPanelHeight] = useState<number | null>(null)
  const [livePanelHeight, setLivePanelHeight] = useState<number | null>(null)
  const [liveKnowledgeGraphWidth, setLiveKnowledgeGraphWidth] = useState<number | null>(null)
  const [liveSidePanelWidth, setLiveSidePanelWidth] = useState<number | null>(null)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  const viewRequest = useStore(s => s.viewRequest ?? null)
  const openView = useCallback((view: string, focus: string): void => {
    if (view === TRAJECTORY_VIEW_ID) setTrajectoryPanelOpen(true)
    actions.openView(view, focus)
  }, [actions])

  const bodyVisible = !(session.blank && conversationPhase(session, conversation) === 'blank')
  const trajectoryShown = trajectory !== undefined && (trajectoryOpen || soloPanel === 'trajectory')
  const activityShown = activityOpen || soloPanel === 'activity'
  const knowledgeGraphShown = knowledgeGraphOpen || soloPanel === 'knowledge-graph'
  const sidePanelShown = sidePanelOpen || soloPanel === 'side-panel'
  const sessionSurfaceVisible = bodyVisible || sidePanelOpen || soloPanel !== undefined
  // Opening or closing a side panel moves transcript scrolling between the
  // outer scrollport and Chat's own scroller, so the incoming element starts
  // at zero. Put the reader back before paint.
  const sideBySide = trajectoryShown || activityShown || knowledgeGraphShown || sidePanelShown
  useLayoutEffect(() => { restoreTranscriptAnchor() }, [sideBySide])

  useEffect(() => { writePanelDockState(panelDockState) }, [panelDockState])
  const togglePanelTile = useCallback((id: PanelDockId): void => {
    setPanelDockState(current => current.tiles.includes(id)
      ? removePanelTile(current, id)
      : addPanelTile(current, id))
  }, [])


  useEffect(() => {
    const area = viewAreaRef.current
    if (!sessionSurfaceVisible || area === null || typeof ResizeObserver === 'undefined') return
    const publish = (): void => {
      setViewAreaSize({ width: area.clientWidth, height: area.clientHeight })
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(area)
    return () => { observer.disconnect() }
  }, [sessionSurfaceVisible])

  const widthBounds = panelWidthBounds(viewAreaSize.width)
  const defaultPanelWidth = clamp(
    viewAreaSize.width > 0 ? viewAreaSize.width * 0.36 : TRAJECTORY_PANEL_MIN,
    widthBounds.min,
    widthBounds.max,
  )
  const resolvedPanelWidth = clamp(
    livePanelWidth ?? trajectoryPanelWidth ?? defaultPanelWidth,
    widthBounds.min,
    widthBounds.max,
  )
  const heightBounds = panelHeightBounds(viewAreaSize.height)
  const defaultPanelHeight = clamp(
    viewAreaSize.height > 0 ? viewAreaSize.height * 0.45 : 320,
    heightBounds.min,
    heightBounds.max,
  )
  const resolvedPanelHeight = clamp(
    livePanelHeight ?? panelHeight ?? defaultPanelHeight,
    heightBounds.min,
    heightBounds.max,
  )
  const storedActivityWidth = useActivityPanelWidth()
  const [liveActivityWidth, setLiveActivityWidth] = useState<number | null>(null)
  const activityOccupied = trajectoryShown
    ? resolvedPanelWidth + TRAJECTORY_RESIZE_GUTTER
    : 0
  const activityWidthBounds = panelWidthBounds(viewAreaSize.width, ACTIVITY_PANEL_MIN_WIDTH, activityOccupied)
  const resolvedActivityWidth = clamp(
    liveActivityWidth ?? storedActivityWidth ?? ACTIVITY_PANEL_DEFAULT_WIDTH,
    activityWidthBounds.min,
    activityWidthBounds.max,
  )
  const previewActivityWidth = useCallback((value: number): void => {
    setLiveActivityWidth(clamp(value, activityWidthBounds.min, activityWidthBounds.max))
  }, [activityWidthBounds.max, activityWidthBounds.min])
  const commitActivityWidth = useCallback((value: number): void => {
    const bounded = clamp(value, activityWidthBounds.min, activityWidthBounds.max)
    setLiveActivityWidth(null)
    setActivityPanelWidth(bounded)
  }, [activityWidthBounds.max, activityWidthBounds.min])
  const cancelActivityWidth = useCallback((): void => { setLiveActivityWidth(null) }, [])
  const resetActivityWidth = useCallback((): void => {
    setLiveActivityWidth(null)
    setActivityPanelWidth(null)
  }, [])

  const knowledgeGraphOccupied = (trajectoryShown ? resolvedPanelWidth + TRAJECTORY_RESIZE_GUTTER : 0)
    + (activityShown ? resolvedActivityWidth : 0)
  const knowledgeGraphWidthBounds = panelWidthBounds(
    viewAreaSize.width,
    KNOWLEDGE_GRAPH_PANEL_MIN,
    knowledgeGraphOccupied,
  )
  const defaultKnowledgeGraphWidth = clamp(
    viewAreaSize.width > 0 ? viewAreaSize.width * 0.38 : KNOWLEDGE_GRAPH_PANEL_MIN,
    knowledgeGraphWidthBounds.min,
    knowledgeGraphWidthBounds.max,
  )
  const resolvedKnowledgeGraphWidth = clamp(
    liveKnowledgeGraphWidth ?? knowledgeGraphPanelWidth ?? defaultKnowledgeGraphWidth,
    knowledgeGraphWidthBounds.min,
    knowledgeGraphWidthBounds.max,
  )
  const sidePanelOccupied = (trajectory !== undefined && trajectoryOpen ? resolvedPanelWidth + TRAJECTORY_RESIZE_GUTTER : 0)
    + (activityOpen ? resolvedActivityWidth : 0)
    + (knowledgeGraphShown ? resolvedKnowledgeGraphWidth + TRAJECTORY_RESIZE_GUTTER : 0)
  const sidePanelWidthBounds = panelWidthBounds(viewAreaSize.width, SIDE_PANEL_MIN, sidePanelOccupied)
  const defaultSidePanelWidth = clamp(
    viewAreaSize.width > 0 ? viewAreaSize.width * 0.38 : SIDE_PANEL_MIN,
    sidePanelWidthBounds.min,
    sidePanelWidthBounds.max,
  )
  const resolvedSidePanelWidth = clamp(
    liveSidePanelWidth ?? sidePanelWidth ?? defaultSidePanelWidth,
    sidePanelWidthBounds.min,
    sidePanelWidthBounds.max,
  )
  // The composer card and its ambient dock (model line, live counters, turn
  // stats) are siblings of this body, so they span the whole scrollport and
  // would sit under an open side panel. Publish the panels' measured width to
  // the scrollport, which insets the seat so the composer and its telemetry
  // stay on the transcript column and move with it. Measured from the main
  // view's right edge rather than summed from constants, so resize handles and
  // any future panel are included without restating their widths here.
  useLayoutEffect(() => {
    const area = viewAreaRef.current
    const host = area?.closest<HTMLElement>('[data-conversation-scroll]') ?? null
    if (area === null || host === null) return
    const main = area.querySelector<HTMLElement>('[data-conversation-main-view]')
    const inset = main === null
      ? 0
      : Math.max(0, area.getBoundingClientRect().right - main.getBoundingClientRect().right)
    host.style.setProperty('--dsh-side-panel-inset', `${Math.round(inset)}px`)
    return () => { host.style.removeProperty('--dsh-side-panel-inset') }
  }, [
    sideBySide, trajectory, trajectoryOpen, activityOpen, knowledgeGraphOpen, sidePanelOpen,
    resolvedPanelWidth, resolvedKnowledgeGraphWidth, resolvedSidePanelWidth, viewAreaSize.width,
  ])

  const areaRect = useCallback(() => viewAreaRef.current?.getBoundingClientRect(), [])
  const panelRect = useCallback((panel: 'trajectory' | 'knowledge-graph' | 'side-panel' | 'activity') => (
    viewAreaRef.current?.querySelector<HTMLElement>(`[data-conversation-panel="${panel}"]`)?.getBoundingClientRect()
  ), [])
  const previewPanelWidth = useCallback((value: number): void => {
    setLivePanelWidth(clamp(value, widthBounds.min, widthBounds.max))
  }, [widthBounds.max, widthBounds.min])
  const commitPanelWidth = useCallback((value: number): void => {
    const bounded = clamp(value, widthBounds.min, widthBounds.max)
    setLivePanelWidth(null)
    setTrajectoryPanelWidth(bounded)
  }, [widthBounds.max, widthBounds.min])
  const cancelPanelWidth = useCallback((): void => { setLivePanelWidth(null) }, [])
  const resetPanelWidth = useCallback((): void => {
    setLivePanelWidth(null)
    setTrajectoryPanelWidth(null)
  }, [])
  const previewPanelHeight = useCallback((value: number): void => {
    setLivePanelHeight(clamp(value, heightBounds.min, heightBounds.max))
  }, [heightBounds.max, heightBounds.min])
  const commitPanelHeight = useCallback((value: number): void => {
    setPanelHeight(clamp(value, heightBounds.min, heightBounds.max))
    setLivePanelHeight(null)
  }, [heightBounds.max, heightBounds.min])
  const cancelPanelHeight = useCallback((): void => { setLivePanelHeight(null) }, [])
  const previewKnowledgeGraphWidth = useCallback((value: number): void => {
    setLiveKnowledgeGraphWidth(clamp(value, knowledgeGraphWidthBounds.min, knowledgeGraphWidthBounds.max))
  }, [knowledgeGraphWidthBounds.max, knowledgeGraphWidthBounds.min])
  const commitKnowledgeGraphWidth = useCallback((value: number): void => {
    const bounded = clamp(value, knowledgeGraphWidthBounds.min, knowledgeGraphWidthBounds.max)
    setLiveKnowledgeGraphWidth(null)
    actions.setKnowledgeGraphWidth(bounded)
  }, [knowledgeGraphWidthBounds.max, knowledgeGraphWidthBounds.min])
  const cancelKnowledgeGraphWidth = useCallback((): void => { setLiveKnowledgeGraphWidth(null) }, [])
  const resetKnowledgeGraphWidth = useCallback((): void => {
    setLiveKnowledgeGraphWidth(null)
    actions.setKnowledgeGraphWidth(null)
  }, [])
  const previewSidePanelWidth = useCallback((value: number): void => {
    setLiveSidePanelWidth(clamp(value, sidePanelWidthBounds.min, sidePanelWidthBounds.max))
  }, [sidePanelWidthBounds.max, sidePanelWidthBounds.min])
  const commitSidePanelWidth = useCallback((value: number): void => {
    const bounded = clamp(value, sidePanelWidthBounds.min, sidePanelWidthBounds.max)
    setLiveSidePanelWidth(null)
    actions.setSidePanelWidth(bounded)
  }, [actions, sidePanelWidthBounds.max, sidePanelWidthBounds.min])
  const cancelSidePanelWidth = useCallback((): void => { setLiveSidePanelWidth(null) }, [])
  const resetSidePanelWidth = useCallback((): void => {
    setLiveSidePanelWidth(null)
    actions.setSidePanelWidth(null)
  }, [actions])

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => {
      unmirror()
      releaseKnowledgeGraphStorage?.()
    }
    // Mount-only for one Session binding: later store writes come from the
    // machine mirror, not this seed effect.
  }, [inputActions, releaseKnowledgeGraphStorage])

  if (!sessionSurfaceVisible) return null
  const viewOwner = {
    viewRequest,
    openView,
    completeViewRequest: actions.completeViewRequest,
  }
  const closeActivity = (): void => {
    captureTranscriptAnchor()
    setActivityPanelOpen(false)
    document.querySelector<HTMLElement>('[data-activity-panel-toggle]')?.focus()
  }
  const closeTrajectory = (): void => {
    captureTranscriptAnchor()
    setTrajectoryPanelOpen(false)
    document.querySelector<HTMLElement>('[data-trajectory-panel-toggle]')?.focus()
  }
  const closeKnowledgeGraph = (): void => {
    knowledgeGraph?.abort()
    captureTranscriptAnchor()
    actions.setKnowledgeGraphOpen(false)
    document.querySelector<HTMLElement>('[data-knowledge-graph-panel-toggle]')?.focus()
  }
  const closeSidePanel = (): void => {
    captureTranscriptAnchor()
    actions.setSidePanelOpen(false)
    document.querySelector<HTMLElement>('[data-side-panel-toggle]')?.focus()
  }
  return (
    <div
      ref={viewAreaRef}
      className={clsx(
        css.viewArea,
        sideBySide && css.viewAreaSideBySide,
      )}
      data-conversation-side-by-side={
        sideBySide ? '' : undefined
      }
      // Below this the conversation cannot stay readable beside two docked panels, so the
      // subagents panel floats instead of taking the width out of the chat.
      data-conversation-solo={soloPanel ?? undefined}
      data-conversation-crowded={
        sideBySide && viewAreaSize.width > 0 && viewAreaSize.width < 1000 ? '' : undefined
      }
    >
      {active !== undefined && soloPanel === undefined && (
        <div className={css.mainView} data-conversation-main-view="">
          {renderSlot('conversation.view', { ...viewOwner, surface: 'main' }, { only: active.id })}
        </div>
      )}
      <div
        className={clsx(css.panelDock, panelDockState.tiles.length > 1 && css.panelDockTiled)}
        data-panel-dock=""
        data-panel-dock-count={panelDockState.tiles.length}
      >
        {trajectory !== undefined && (trajectoryShown || soloPanel === undefined) && (
          <PanelHost
            id="trajectory"
            title={trajectory.label}
            open={trajectoryOpen}
            tiled={panelDockState.tiles.includes('trajectory')}
            solo={soloPanel === 'trajectory'}
            onToggleTile={() => { togglePanelTile('trajectory') }}
            onClose={closeTrajectory}
          >
            <TrajectoryResizeHandle
              panel="trajectory"
              axis="width"
              value={resolvedPanelWidth}
              min={widthBounds.min}
              max={widthBounds.max}
              getRect={() => panelRect('trajectory') ?? areaRect()}
              onPreview={previewPanelWidth}
              onCommit={commitPanelWidth}
              onCancel={cancelPanelWidth}
              onReset={resetPanelWidth}
              label={t('trajectory.resize')}
            />
            <TrajectoryResizeHandle
              panel="trajectory"
              axis="height"
              value={resolvedPanelHeight}
              min={heightBounds.min}
              max={heightBounds.max}
              getRect={() => panelRect('trajectory') ?? areaRect()}
              onPreview={previewPanelHeight}
              onCommit={commitPanelHeight}
              onCancel={cancelPanelHeight}
              onReset={() => { setPanelHeight(null); setLivePanelHeight(null) }}
              label={t('trajectory.resize')}
            />
            <section
              id={TRAJECTORY_PANEL_ID}
              data-conversation-panel="trajectory"
              className={css.trajectoryPanel}
              style={{
                '--dsh-trajectory-panel-width': `${resolvedPanelWidth}px`,
                '--dsh-trajectory-panel-height': `${resolvedPanelHeight}px`,
              } as CSSProperties}
              aria-label={t('trajectory.panel')}
              hidden={!trajectoryOpen && soloPanel !== 'trajectory'}
            >
              <div className={css.trajectoryPanelHeader}>
                <span className={css.trajectoryPanelTitle}>{trajectory.label}</span>
                <button type="button" className={css.panelClose} aria-label={t('trajectory.close')} title={t('trajectory.close')} onClick={closeTrajectory}>
                  <IconCloseOutline16 size={14} />
                </button>
              </div>
              <div className={css.trajectoryPanelBody}>
                {renderSlot('conversation.view', { ...viewOwner, surface: 'side-panel' }, { only: trajectory.id })}
              </div>
            </section>
          </PanelHost>
        )}
        {(knowledgeGraphShown || soloPanel === undefined) && (
          <PanelHost
            id="knowledge-graph"
            title={t('graph.panel')}
            open={knowledgeGraphOpen}
            tiled={panelDockState.tiles.includes('knowledge-graph')}
            solo={soloPanel === 'knowledge-graph'}
            onToggleTile={() => { togglePanelTile('knowledge-graph') }}
            onClose={closeKnowledgeGraph}
          >
            <TrajectoryResizeHandle
              panel="knowledge-graph"
              axis="width"
              value={resolvedKnowledgeGraphWidth}
              min={knowledgeGraphWidthBounds.min}
              max={knowledgeGraphWidthBounds.max}
              getRect={() => panelRect('knowledge-graph') ?? areaRect()}
              onPreview={previewKnowledgeGraphWidth}
              onCommit={commitKnowledgeGraphWidth}
              onCancel={cancelKnowledgeGraphWidth}
              onReset={resetKnowledgeGraphWidth}
              label={t('graph.resize')}
            />
            <KnowledgeGraphPanel open={knowledgeGraphOpen || soloPanel === 'knowledge-graph'} onClose={closeKnowledgeGraph} transport={knowledgeGraph} t={t} width={resolvedKnowledgeGraphWidth} />
          </PanelHost>
        )}
        {sidePanelShown && (
          <PanelHost
            id="side-panel"
            title="Panel"
            open={sidePanelOpen}
            tiled={panelDockState.tiles.includes('side-panel')}
            solo={soloPanel === 'side-panel'}
            onToggleTile={() => { togglePanelTile('side-panel') }}
            onClose={closeSidePanel}
          >
            <TrajectoryResizeHandle
              panel="side-panel"
              axis="width"
              value={resolvedSidePanelWidth}
              min={sidePanelWidthBounds.min}
              max={sidePanelWidthBounds.max}
              getRect={() => panelRect('side-panel') ?? areaRect()}
              onPreview={previewSidePanelWidth}
              onCommit={commitSidePanelWidth}
              onCancel={cancelSidePanelWidth}
              onReset={resetSidePanelWidth}
              label={t('sidePanel.resize')}
            />
            <section id="dsh-conversation-side-panel" data-conversation-panel="side-panel" className={css.trajectoryPanel} style={{ '--dsh-trajectory-panel-width': `${resolvedSidePanelWidth}px` } as CSSProperties}>
              <div className={css.trajectoryPanelBody}>
                {renderSlot('conversation.session.side-panel', { open: true, width: resolvedSidePanelWidth, onClose: closeSidePanel, onAttach: stageAttachment })}
              </div>
            </section>
          </PanelHost>
        )}
        {(activityShown || soloPanel === undefined) && (
          <PanelHost
            id="activity"
            title={t('activity.panel')}
            open={activityOpen}
            tiled={panelDockState.tiles.includes('activity')}
            solo={soloPanel === 'activity'}
            onToggleTile={() => { togglePanelTile('activity') }}
            onClose={closeActivity}
          >
            <TrajectoryResizeHandle
              panel="activity"
              axis="width"
              value={resolvedActivityWidth}
              min={activityWidthBounds.min}
              max={activityWidthBounds.max}
              getRect={() => panelRect('activity') ?? areaRect()}
              onPreview={previewActivityWidth}
              onCommit={commitActivityWidth}
              onCancel={cancelActivityWidth}
              onReset={resetActivityWidth}
              label={t('activity.resize')}
            />
            <ActivityPanel sessionId={sessionId} sessions={sessions} open={activityOpen || soloPanel === 'activity'} onClose={closeActivity} t={t} width={resolvedActivityWidth} helpers={renderSlot('conversation.activity.helpers', {}, { fallback: null })} />
          </PanelHost>
        )}
      </div>
    </div>
  )
}
