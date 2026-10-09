/** Shared side-panel chrome: pop-out, tile, and close stay consistent across every panel slot. */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PanelDockId } from './panel-dock.ts'
import css from './PanelHost.module.css'

export interface PanelHostProps {
  readonly id: PanelDockId
  readonly title: string
  readonly open: boolean
  readonly tiled: boolean
  readonly solo: boolean
  readonly onToggleTile: () => void
  readonly onClose: () => void
  readonly children: ReactNode
}

function popoutUrl(id: PanelDockId): string {
  return `/?panel=${encodeURIComponent(id)}&solo=1`
}

export function PanelHost({ id, title, open, tiled, solo, onToggleTile, onClose, children }: PanelHostProps) {
  const popup = useRef<Window | null>(null)
  const [detached, setDetached] = useState(false)

  useEffect(() => {
    if (solo || !detached) return
    const timer = window.setInterval(() => {
      if (popup.current?.closed !== false) {
        popup.current = null
        setDetached(false)
      }
    }, 500)
    return () => { window.clearInterval(timer) }
  }, [detached, solo])

  useEffect(() => {
    if (solo) return
    const receive = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: unknown; id?: unknown } | null
      if (data?.type === 'dsh-panel-dock' && data.id === id) {
        popup.current = null
        setDetached(false)
      }
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive) }
  }, [id, solo])

  const popOut = (): void => {
    if (typeof window === 'undefined') return
    const next = window.open(popoutUrl(id), `dsh-panel-${id}`, 'popup,width=900,height=700,resizable=yes,scrollbars=yes')
    if (next === null) return
    popup.current = next
    setDetached(true)
    next.focus()
  }

  const dock = (): void => {
    const opener: unknown = window.opener
    if (opener !== null && typeof opener === 'object' && 'postMessage' in opener && typeof opener.postMessage === 'function') {
      (opener as Pick<Window, 'postMessage'>).postMessage({ type: 'dsh-panel-dock', id }, window.location.origin)
    }
    window.close()
  }

  return (
    <section
      className={css.host}
      data-panel-host={id}
      data-panel-tiled={tiled ? '' : undefined}
      data-panel-detached={detached ? '' : undefined}
      hidden={!open && !solo}
    >
      <header className={css.header}>
        <span className={css.title}>{title}</span>
        <div className={css.actions}>
          {solo ? (
            <button type="button" className={css.button} onClick={dock}>Dock</button>
          ) : (
            <>
              <button type="button" className={css.button} onClick={popOut} disabled={detached}>Pop out</button>
              <button type="button" className={css.button} aria-pressed={tiled} onClick={onToggleTile}>Tile</button>
              <button type="button" className={css.button} onClick={onClose}>Close</button>
            </>
          )}
        </div>
      </header>
      <div className={css.body} aria-busy={detached || undefined}>{children}</div>
    </section>
  )
}
