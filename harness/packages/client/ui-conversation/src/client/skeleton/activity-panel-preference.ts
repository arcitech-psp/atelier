/** Browser-local preference for the optional Activity side panel. */
import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'dsh.conversation.activityPanelOpen'
const WIDTH_KEY = 'dsh.conversation.activityPanelWidth'
const DEFAULT_OPEN = false
/** Matches the panel's CSS basis, so an unset preference changes nothing. */
export const ACTIVITY_PANEL_DEFAULT_WIDTH = 300
export const ACTIVITY_PANEL_MIN_WIDTH = 264
const listeners = new Set<() => void>()
const widthListeners = new Set<() => void>()
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

function readStoredWidth(): number | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(WIDTH_KEY)
    if (raw === null) return null
    const value = Number(raw)
    // A stored width from a wider window is clamped by the caller against the room available now.
    return Number.isFinite(value) && value >= ACTIVITY_PANEL_MIN_WIDTH ? value : null
  } catch {
    return null
  }
}

function widthSnapshot(): number | null {
  if (cachedWidth === undefined) cachedWidth = readStoredWidth()
  return cachedWidth
}

function notifyWidth(): void {
  for (const listener of widthListeners) listener()
}

function onStorage(event: StorageEvent): void {
  if (event.key === WIDTH_KEY) {
    cachedWidth = readStoredWidth()
    notifyWidth()
    return
  }
  if (event.key !== STORAGE_KEY) return
  cached = readStored()
  notify()
}

function subscribeWidth(listener: () => void): () => void {
  widthListeners.add(listener)
  if (widthListeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    widthListeners.delete(listener)
    if (widthListeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
    }
  }
}

/** The width the user dragged this panel to, or null when they have not set one. */
export function useActivityPanelWidth(): number | null {
  return useSyncExternalStore(subscribeWidth, widthSnapshot, () => null)
}

/** Persist a dragged width; null restores the default. */
export function setActivityPanelWidth(width: number | null): void {
  cachedWidth = width
  try {
    if (typeof localStorage !== 'undefined') {
      if (width === null) localStorage.removeItem(WIDTH_KEY)
      else localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
    }
  } catch {
    // Browser storage failures keep the in-memory preference usable.
  }
  notifyWidth()
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

/** Read the current Activity panel preference in a React component. */
export function useActivityPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_OPEN)
}

/** Persist and publish the Activity panel preference. */
export function setActivityPanelOpen(open: boolean): void {
  cached = open
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(open))
  } catch {
    // Browser storage failures keep the in-memory preference usable.
  }
  notify()
}
