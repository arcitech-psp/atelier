/**
 * Atelier workspace chooser: the in-app replacement for the OS "Select
 * Workspace Directory" dialog. One card, no native window, works on a phone:
 *
 *  - Recent workspaces (most recent first, with the time they were last used)
 *    and pinned favourites: click one to open it at once.
 *  - A type-a-path box with autocomplete: the host lists the folders of the
 *    directory being typed, the last segment filters them, Tab completes,
 *    clicking a folder steps into it (Desktop / Documents / OneDrive shortcuts
 *    jump straight to a known place).
 *  - "New folder..." creates a folder under the folder being shown.
 *  - "Browse with Windows..." (small link, local browsers only) still reaches
 *    the host's native folder dialog for the rare case it is wanted.
 *
 * Pure consumer of the injected browse calls; the owning flow decides what
 * "Open" means. Favourites and the local last-used list live in this browser's
 * localStorage (never on the host), so they never touch the workspace registry.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronRightOutline14, IconCloseOutline16, IconFolderClose16, IconPlusOutline16, Modal, relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import css from './WorkspaceChooser.module.css'

/** The slice of a Workspace row the chooser reads (structural; avoids a package dependency). */
export interface ChooserWorkspaceRow {
  readonly path: string
  readonly title: string
  readonly updatedAt: string
  readonly markers?: readonly string[] | undefined
}

/** Bare observable over the workspace registry (the controller's `list` source). */
export interface ChooserWorkspaceSource {
  getSnapshot(): { readonly items: readonly ChooserWorkspaceRow[] }
  subscribe(listener: () => void): () => void
}

/** Owner-supplied chooser props. */
export interface WorkspaceChooserProps {
  open: boolean
  busy: boolean
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  createDirectory: (path: string, name: string) => Promise<string>
  /** Open the host's native folder dialog; null when cancelled. */
  pickNative: () => Promise<string | null>
  /** Registry of existing workspaces (for the Recent list). */
  workspaces?: ChooserWorkspaceSource | undefined
  onOpen: (path: string) => void
  onClose: () => void
  t: Translate
}

const PINS_KEY = 'atelier.workspaceChooser.pins.v1'
const RECENT_KEY = 'atelier.workspaceChooser.recent.v1'
const MAX_RECENT_SHOWN = 8
const MAX_RECENT_STORED = 30

interface StoredRecent { path: string, at: number }

const EMPTY_SNAPSHOT = { items: [] as readonly ChooserWorkspaceRow[] }
const EMPTY_SOURCE: ChooserWorkspaceSource = {
  getSnapshot: () => EMPTY_SNAPSHOT,
  subscribe: () => () => {},
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode / quota: favourites simply do not persist.
  }
}

/** Case/separator-insensitive identity of a path (Windows paths compare case-insensitively). */
function pathKey(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  const name = index < 0 ? trimmed : trimmed.slice(index + 1)
  return name === '' ? path : name
}

function failureText(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'rpcError' in error) {
    const rpcError = (error as { rpcError: unknown }).rpcError
    if (rpcError !== null && typeof rpcError === 'object' && 'message' in rpcError
      && typeof (rpcError as { message: unknown }).message === 'string') return (rpcError as { message: string }).message
  }
  return error instanceof Error ? error.message : String(error)
}

function isLoopbackPage(): boolean {
  try {
    const host = window.location.hostname
    return host === 'localhost' || host === 'localhost' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

/** Split what the operator typed into the directory to list and the prefix to filter by. */
function splitDraft(raw: string, sep: string): { dir: string | null, prefix: string } {
  const draft = raw.replace(/^"+|"+$/g, '')
  const index = Math.max(draft.lastIndexOf('\\'), draft.lastIndexOf('/'))
  if (index < 0) {
    if (/^[A-Za-z]:$/.test(draft)) return { dir: draft + sep, prefix: '' }
    return { dir: null, prefix: draft }
  }
  return { dir: draft.slice(0, index + 1), prefix: draft.slice(index + 1) }
}

function RelTime({ at, t }: { at: number, t: Translate }) {
  const rel = relativeTime(at, Date.now())
  return <span className={css.when}>{t(`chooser.time.${rel.unit}`, { n: String(rel.n) })}</span>
}

function PinGlyph({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.8l1.9 4 4.3.6-3.1 3 .8 4.3L8 11.6l-3.9 2.1.8-4.3-3.1-3 4.3-.6z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface ListingView { dir: string, listing: DirectoryListing | null, error: string | null }
interface Shortcut { key: 'desktop' | 'documents' | 'onedrive', path: string }

/**
 * The chooser dialog.
 * @param props - owner conversation, browse calls, and copy.
 * @returns the dialog element (renders nothing while closed).
 */
export function WorkspaceChooser(props: WorkspaceChooserProps) {
  const { open, busy, listDirectory, createDirectory, pickNative, onOpen, onClose, t } = props
  const source = props.workspaces ?? EMPTY_SOURCE
  // The registry is a class instance: bind its methods so React can call them detached.
  const store = useMemo(() => ({ subscribe: (listener: () => void) => source.subscribe(listener), getSnapshot: () => source.getSnapshot() }), [source])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  const [draft, setDraft] = useState('')
  const [home, setHome] = useState<string | null>(null)
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([])
  const [view, setView] = useState<ListingView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(-1)
  const [pins, setPins] = useState<string[]>(() => readJson<string[]>(PINS_KEY, []))
  const [recents, setRecents] = useState<StoredRecent[]>(() => readJson<StoredRecent[]>(RECENT_KEY, []))
  const [folderDraft, setFolderDraft] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [nativeBusy, setNativeBusy] = useState(false)
  const [committing, setCommitting] = useState(false)
  const cache = useRef(new Map<string, DirectoryListing>())
  const inputRef = useRef<HTMLInputElement>(null)
  const showNative = useMemo(isLoopbackPage, [])

  const sep = home !== null && (home.includes('\\') || /^[A-Za-z]:/.test(home)) ? '\\' : '/'

  // Reset on each open, then learn the host's home and probe the shortcuts.
  useEffect(() => {
    if (!open) return undefined
    setDraft('')
    setView(null)
    setError(null)
    setHighlight(-1)
    setFolderDraft(null)
    setPins(readJson<string[]>(PINS_KEY, []))
    setRecents(readJson<StoredRecent[]>(RECENT_KEY, []))
    cache.current.clear()
    const abort = new AbortController()
    void (async () => {
      try {
        const base = await listDirectory(undefined, abort.signal)
        if (abort.signal.aborted) return
        setHome(base.home)
        const s = base.home.includes('\\') || /^[A-Za-z]:/.test(base.home) ? '\\' : '/'
        const join = (...parts: string[]): string => base.home + s + parts.join(s)
        const candidates: Record<Shortcut['key'], string[]> = {
          desktop: [join('Desktop'), join('OneDrive', 'Desktop')],
          documents: [join('Documents'), join('OneDrive', 'Documents')],
          onedrive: [join('OneDrive')],
        }
        const found: Shortcut[] = []
        for (const key of ['desktop', 'documents', 'onedrive'] as const) {
          for (const candidate of candidates[key]) {
            try {
              const listing = await listDirectory(candidate, abort.signal)
              cache.current.set(pathKey(listing.path), listing)
              found.push({ key, path: listing.path })
              break
            } catch {
              if (abort.signal.aborted) return
            }
          }
        }
        if (!abort.signal.aborted) setShortcuts(found)
      } catch (reason: unknown) {
        if (!abort.signal.aborted) setError(failureText(reason))
      }
    })()
    return () => { abort.abort() }
  }, [open, listDirectory])

  const { dir, prefix } = useMemo(() => splitDraft(draft, sep), [draft, sep])

  // Autocomplete: list the directory the draft names (cached; debounced).
  useEffect(() => {
    if (!open || dir === null) {
      setView(null)
      setLoading(false)
      return undefined
    }
    const cached = cache.current.get(pathKey(dir))
    if (cached !== undefined) {
      setView({ dir, listing: cached, error: null })
      setLoading(false)
      return undefined
    }
    setLoading(true)
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      listDirectory(dir, abort.signal).then(
        (listing) => {
          if (abort.signal.aborted) return
          cache.current.set(pathKey(dir), listing)
          cache.current.set(pathKey(listing.path), listing)
          setView({ dir, listing, error: null })
          setLoading(false)
        },
        (reason: unknown) => {
          if (abort.signal.aborted) return
          setView({ dir, listing: null, error: failureText(reason) })
          setLoading(false)
        },
      )
    }, 90)
    return () => {
      window.clearTimeout(timer)
      abort.abort()
    }
  }, [open, dir, listDirectory])

  const suggestions: DirectoryEntry[] = useMemo(() => {
    if (view === null || view.listing === null || dir === null || pathKey(view.dir) !== pathKey(dir)) return []
    const needle = prefix.toLowerCase()
    const showHidden = needle.startsWith('.')
    return view.listing.entries.filter(entry =>
      (showHidden || !entry.hidden) && entry.name.toLowerCase().startsWith(needle))
  }, [view, dir, prefix])

  useEffect(() => { setHighlight(-1) }, [draft])

  const currentListing = view !== null && dir !== null && pathKey(view.dir) === pathKey(dir) ? view.listing : null
  const currentPath = currentListing?.path ?? null
  const parentPath = currentListing !== null && currentListing.crumbs.length > 1
    ? currentListing.crumbs[currentListing.crumbs.length - 2]?.path ?? null
    : null

  const remember = useCallback((path: string) => {
    const next = [{ path, at: Date.now() }, ...readJson<StoredRecent[]>(RECENT_KEY, []).filter(r => pathKey(r.path) !== pathKey(path))]
      .slice(0, MAX_RECENT_STORED)
    writeJson(RECENT_KEY, next)
    setRecents(next)
  }, [])

  const adopt = useCallback((path: string) => {
    remember(path)
    onOpen(path)
  }, [onOpen, remember])

  const togglePin = useCallback((path: string) => {
    setPins((prev) => {
      const exists = prev.some(p => pathKey(p) === pathKey(path))
      const next = exists ? prev.filter(p => pathKey(p) !== pathKey(path)) : [...prev, path]
      writeJson(PINS_KEY, next)
      return next
    })
  }, [])

  const isPinned = useCallback((path: string) => pins.some(p => pathKey(p) === pathKey(path)), [pins])

  const goTo = useCallback((path: string) => {
    setError(null)
    setDraft(/[\\/]$/.test(path) ? path : path + sep)
    inputRef.current?.focus()
  }, [sep])

  // Open whatever the box names: verify it is a real folder first.
  const commitDraft = useCallback(async () => {
    const typed = draft.replace(/^"+|"+$/g, '').trim()
    if (typed === '') return
    setCommitting(true)
    setError(null)
    try {
      const listing = await listDirectory(typed)
      adopt(listing.path)
    } catch (reason: unknown) {
      setError(failureText(reason))
    } finally {
      setCommitting(false)
    }
  }, [draft, listDirectory, adopt])

  const runNative = useCallback(async () => {
    setNativeBusy(true)
    setError(null)
    try {
      const picked = await pickNative()
      if (picked !== null) adopt(picked)
    } catch (reason: unknown) {
      setError(failureText(reason))
    } finally {
      setNativeBusy(false)
    }
  }, [pickNative, adopt])

  const newFolderParent = currentPath ?? home
  const confirmCreate = useCallback(async () => {
    if (folderDraft === null || newFolderParent === null) return
    const name = folderDraft.trim()
    if (name === '') return
    setCreating(true)
    setError(null)
    try {
      const created = await createDirectory(newFolderParent, name)
      cache.current.delete(pathKey(newFolderParent))
      setFolderDraft(null)
      goTo(created)
    } catch (reason: unknown) {
      setError(failureText(reason))
    } finally {
      setCreating(false)
    }
  }, [folderDraft, newFolderParent, createDirectory, goTo])

  // Home view rows: pinned first, then recents (registry + local picks), newest first.
  const recentRows = useMemo(() => {
    const byKey = new Map<string, { path: string, title: string, at: number }>()
    for (const item of snapshot.items) {
      if (item.markers !== undefined && item.markers.length > 0) continue
      const at = Date.parse(item.updatedAt)
      byKey.set(pathKey(item.path), { path: item.path, title: item.title, at: Number.isNaN(at) ? 0 : at })
    }
    for (const local of recents) {
      const key = pathKey(local.path)
      const existing = byKey.get(key)
      if (existing === undefined) byKey.set(key, { path: local.path, title: baseName(local.path), at: local.at })
      else if (local.at > existing.at) existing.at = local.at
    }
    const pinnedKeys = new Set(pins.map(pathKey))
    return [...byKey.values()]
      .filter(row => !pinnedKeys.has(pathKey(row.path)))
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_RECENT_SHOWN)
  }, [snapshot, recents, pins])

  const pinnedRows = useMemo(() => pins.map((path) => {
    const match = snapshot.items.find(item => pathKey(item.path) === pathKey(path))
    return { path, title: match?.title ?? baseName(path) }
  }), [pins, snapshot])

  const parentInert = busy || committing || nativeBusy
  const browsing = dir !== null
  const canOpen = draft.trim() !== '' && !parentInert

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault()
      setHighlight(i => Math.min(suggestions.length - 1, i + 1))
    } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault()
      setHighlight(i => Math.max(-1, i - 1))
    } else if (event.key === 'Tab' && prefix !== '' && suggestions.length > 0) {
      event.preventDefault()
      const pick = suggestions[highlight >= 0 ? highlight : 0]
      if (pick !== undefined) goTo(pick.path)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const pick = highlight >= 0 ? suggestions[highlight] : undefined
      if (pick !== undefined) goTo(pick.path)
      else void commitDraft()
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!parentInert && folderDraft === null) onClose() }}
      title={t('chooser.title')}
      className={clsx(css.dialog)}
      headless
    >
      <div className={css.card}>
        <div className={css.header}>
          <h2 className={css.title}>{t('chooser.title')}</h2>
          <div className={css.pathBox}>
            <input
              ref={inputRef}
              className={css.pathInput}
              value={draft}
              autoFocus
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label={t('chooser.pathLabel')}
              placeholder={t('chooser.pathPlaceholder')}
              disabled={parentInert}
              onChange={(event) => { setError(null); setDraft(event.target.value) }}
              onKeyDown={onKeyDown}
            />
            {draft !== '' && (
              <button
                type="button"
                className={css.clear}
                aria-label={t('chooser.clear')}
                onClick={() => { setDraft(''); setError(null); inputRef.current?.focus() }}
              >
                <IconCloseOutline16 size={14} />
              </button>
            )}
          </div>
          <div className={css.shortcuts}>
            {shortcuts.map(shortcut => (
              <button
                key={shortcut.key}
                type="button"
                className={css.shortcut}
                disabled={parentInert}
                onClick={() => { goTo(shortcut.path) }}
              >
                {t(`chooser.${shortcut.key}`)}
              </button>
            ))}
          </div>
        </div>

        <div className={css.body}>
          {!browsing && (
            <>
              {pinnedRows.length > 0 && (
                <section className={css.section}>
                  <h3 className={css.sectionTitle}>{t('chooser.pinned')}</h3>
                  {pinnedRows.map(row => (
                    <div key={row.path} className={css.rowWrap}>
                      <button type="button" className={css.row} disabled={parentInert} onClick={() => { adopt(row.path) }} title={row.path}>
                        <IconFolderClose16 size={16} className={css.rowIcon} />
                        <span className={css.rowText}>
                          <span className={css.rowName}>{row.title}</span>
                          <span className={css.rowPath}>{row.path}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={clsx(css.pin, css.pinOn)}
                        aria-label={t('chooser.unpin')}
                        aria-pressed
                        onClick={() => { togglePin(row.path) }}
                      >
                        <PinGlyph filled />
                      </button>
                    </div>
                  ))}
                </section>
              )}
              <section className={css.section}>
                <h3 className={css.sectionTitle}>{t('chooser.recent')}</h3>
                {recentRows.length === 0 && <p className={css.empty}>{t('chooser.empty')}</p>}
                {recentRows.map(row => (
                  <div key={row.path} className={css.rowWrap}>
                    <button type="button" className={css.row} disabled={parentInert} onClick={() => { adopt(row.path) }} title={row.path}>
                      <IconFolderClose16 size={16} className={css.rowIcon} />
                      <span className={css.rowText}>
                        <span className={css.rowName}>{row.title}</span>
                        <span className={css.rowPath}>{row.path}</span>
                      </span>
                      {row.at > 0 && <RelTime at={row.at} t={t} />}
                    </button>
                    <button
                      type="button"
                      className={css.pin}
                      aria-label={t('chooser.pin')}
                      aria-pressed={false}
                      onClick={() => { togglePin(row.path) }}
                    >
                      <PinGlyph filled={false} />
                    </button>
                  </div>
                ))}
              </section>
            </>
          )}

          {browsing && (
            <section className={css.section}>
              {currentListing !== null && (
                <div className={css.crumbRow}>
                  <div className={css.crumbs}>
                    {currentListing.crumbs.map((crumb, index) => (
                      <span key={crumb.path} className={css.crumbItem}>
                        {index > 0 && <IconChevronRightOutline14 size={12} className={css.crumbChevron} />}
                        <button type="button" className={css.crumb} disabled={parentInert} onClick={() => { goTo(crumb.path) }}>
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={clsx(css.pin, isPinned(currentListing.path) && css.pinOn)}
                    aria-label={t(isPinned(currentListing.path) ? 'chooser.unpin' : 'chooser.pin')}
                    aria-pressed={isPinned(currentListing.path)}
                    onClick={() => { togglePin(currentListing.path) }}
                  >
                    <PinGlyph filled={isPinned(currentListing.path)} />
                  </button>
                </div>
              )}
              <div role="listbox" aria-label={t('chooser.pathLabel')} className={css.list}>
                {parentPath !== null && prefix === '' && (
                  <button type="button" className={css.row} disabled={parentInert} onClick={() => { goTo(parentPath) }}>
                    <IconFolderClose16 size={16} className={css.rowIcon} />
                    <span className={css.rowText}>
                      <span className={css.rowName}>..</span>
                      <span className={css.rowPath}>{t('chooser.up')}</span>
                    </span>
                  </button>
                )}
                {suggestions.map((entry, index) => (
                  <button
                    key={entry.path}
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    className={clsx(css.row, index === highlight && css.rowActive)}
                    disabled={parentInert}
                    onMouseEnter={() => { setHighlight(index) }}
                    onClick={() => { goTo(entry.path) }}
                    title={entry.path}
                  >
                    <IconFolderClose16 size={16} className={css.rowIcon} />
                    <span className={css.rowText}><span className={css.rowName}>{entry.name}</span></span>
                    <IconChevronRightOutline14 size={12} className={css.crumbChevron} />
                  </button>
                ))}
                {loading && <p className={css.empty}>{t('chooser.loading')}</p>}
                {!loading && view !== null && view.error === null && suggestions.length === 0 && (
                  <p className={css.empty}>{t('chooser.noMatch')}</p>
                )}
                {!loading && view !== null && view.error !== null && <p className={css.errorInline}>{view.error}</p>}
                {currentListing?.truncated === true && <p className={css.empty}>{t('chooser.truncated')}</p>}
              </div>
            </section>
          )}
          {error !== null && <div className={css.error} role="alert">{error}</div>}
        </div>

        {folderDraft !== null && (
          <div className={css.newFolderRow}>
            <input
              className={css.newFolderInput}
              value={folderDraft}
              autoFocus
              spellCheck={false}
              disabled={creating}
              aria-label={t('chooser.folderName')}
              placeholder={t('chooser.folderName')}
              onChange={(event) => { setFolderDraft(event.target.value) }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') { event.preventDefault(); void confirmCreate() }
                if (event.key === 'Escape') { event.stopPropagation(); setFolderDraft(null) }
              }}
            />
            <Button variant="outline" size="sm" disabled={creating} onClick={() => { setFolderDraft(null) }}>{t('chooser.cancel')}</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={creating || folderDraft.trim() === '' || newFolderParent === null}
              onClick={() => { void confirmCreate() }}
            >
              {t('chooser.create')}
            </Button>
          </div>
        )}

        <div className={css.footer}>
          <Button
            variant="outline"
            icon={<IconPlusOutline16 size={14} />}
            disabled={parentInert || newFolderParent === null || folderDraft !== null}
            onClick={() => { setFolderDraft(''); setError(null) }}
          >
            {t('chooser.newFolder')}
          </Button>
          {showNative && (
            <button type="button" className={css.nativeLink} disabled={parentInert} onClick={() => { void runNative() }}>
              {t('chooser.native')}
            </button>
          )}
          <span className={css.gap} />
          <Button variant="outline" disabled={busy} onClick={onClose}>{t('chooser.cancel')}</Button>
          <Button variant="primary" disabled={!canOpen} onClick={() => { void commitDraft() }}>{t('chooser.open')}</Button>
        </div>
      </div>
    </Modal>
  )
}
