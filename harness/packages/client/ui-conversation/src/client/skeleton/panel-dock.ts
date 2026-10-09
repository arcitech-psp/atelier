/** Pure panel tiling state. Kept separate so persistence never decides layout during render. */

export const PANEL_DOCK_STORAGE_KEY = 'dsh.conversation.panelDock'
export const PANEL_DOCK_MIN_SPLIT = 0.2
export const PANEL_DOCK_MAX_SPLIT = 0.8

export type PanelDockId = 'trajectory' | 'knowledge-graph' | 'side-panel' | 'activity'
export type PanelDockDirection = 'row' | 'column'

export interface PanelDockState {
  readonly tiles: readonly PanelDockId[]
  readonly split: number
  readonly direction: PanelDockDirection
}

export const DEFAULT_PANEL_DOCK_STATE: PanelDockState = {
  tiles: [], split: 0.5, direction: 'row',
}

function isPanelId(value: unknown): value is PanelDockId {
  return value === 'trajectory' || value === 'knowledge-graph' || value === 'side-panel' || value === 'activity'
}

export function clampPanelDockSplit(value: number): number {
  return Math.min(PANEL_DOCK_MAX_SPLIT, Math.max(PANEL_DOCK_MIN_SPLIT, value))
}

export function addPanelTile(state: PanelDockState, id: PanelDockId): PanelDockState {
  return state.tiles.includes(id) ? state : { ...state, tiles: [...state.tiles, id] }
}

export function removePanelTile(state: PanelDockState, id: PanelDockId): PanelDockState {
  return state.tiles.includes(id)
    ? { ...state, tiles: state.tiles.filter(tile => tile !== id) }
    : state
}

export function setPanelDockSplit(state: PanelDockState, value: number): PanelDockState {
  return { ...state, split: clampPanelDockSplit(value) }
}

export function parsePanelDockState(value: unknown): PanelDockState {
  if (typeof value !== 'object' || value === null) return DEFAULT_PANEL_DOCK_STATE
  const record = value as Record<string, unknown>
  const tiles = Array.isArray(record.tiles)
    ? [...new Set(record.tiles.filter(isPanelId))]
    : []
  const split = typeof record.split === 'number' && Number.isFinite(record.split)
    ? clampPanelDockSplit(record.split)
    : DEFAULT_PANEL_DOCK_STATE.split
  const direction = record.direction === 'column' ? 'column' : 'row'
  return { tiles, split, direction }
}

export function readPanelDockState(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): PanelDockState {
  if (storage === undefined) return DEFAULT_PANEL_DOCK_STATE
  try {
    const raw = storage.getItem(PANEL_DOCK_STORAGE_KEY)
    return raw === null ? DEFAULT_PANEL_DOCK_STATE : parsePanelDockState(JSON.parse(raw))
  } catch {
    return DEFAULT_PANEL_DOCK_STATE
  }
}

export function writePanelDockState(
  state: PanelDockState,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): void {
  try { storage?.setItem(PANEL_DOCK_STORAGE_KEY, JSON.stringify(state)) } catch { /* private browsing can refuse storage */ }
}

export function soloPanelId(search = typeof location === 'undefined' ? '' : location.search): PanelDockId | undefined {
  const value = new URLSearchParams(search).get('panel')
  return new URLSearchParams(search).get('solo') === '1' && isPanelId(value) ? value : undefined
}
