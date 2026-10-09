/** Browser-local preference for the optional Trajectory side panel. */
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'dsh.conversation.trajectoryPanelOpen'
const WIDTH_STORAGE_KEY = 'dsh.conversation.trajectoryPanelWidth'
const DEFAULT_OPEN = true
const listeners = new Set<() => void>()
let cached: boolean | undefined
let cachedWidth: number | null | undefined

function readStored(): boolean {
  if (typeof localStorage === 'undefined') return DEFAULT_OPEN
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {
    // Browser storage failures keep the in-memory preference usable.
  }
  return DEFAULT_OPEN
}

function snapshot(): boolean {
  cached ??= readStored()
  return cached
}

function notify(): void {
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent): void {
  if (event.key === STORAGE_KEY) cached = readStored()
  if (event.key === WIDTH_STORAGE_KEY) cachedWidth = readWidthStored()
  if (event.key !== STORAGE_KEY && event.key !== WIDTH_STORAGE_KEY) return
  notify()
}

function readWidthStored(): number | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    if (raw === null) return null
    const width = Number(raw)
    return Number.isFinite(width) && width > 0 ? width : null
  } catch {
    return null
  }
}

function widthSnapshot(): number | null {
  cachedWidth ??= readWidthStored()
  return cachedWidth
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
    }
  }
}

/** Read the current Trajectory panel preference in a React component. */
export function useTrajectoryPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_OPEN)
}

/** Persist and publish the Trajectory panel preference. */
export function setTrajectoryPanelOpen(open: boolean): void {
  cached = open
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(open))
  } catch {
    // Browser storage failures keep the in-memory preference usable.
  }
  notify()
}

/** Read the persisted Trajectory panel width, or null for adaptive sizing. */
export function useTrajectoryPanelWidth(): number | null {
  return useSyncExternalStore(subscribe, widthSnapshot, () => null)
}

/** Persist a Trajectory panel width, or clear it to return to adaptive sizing. */
export function setTrajectoryPanelWidth(width: number | null): void {
  cachedWidth = width
  try {
    if (typeof localStorage !== 'undefined') {
      if (width === null) localStorage.removeItem(WIDTH_STORAGE_KEY)
      else localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
    }
  } catch {
    // Browser storage failures keep the in-memory preference usable.
  }
  notify()
}
