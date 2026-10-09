/** Optional reference-only Knowledge Graph side panel. The old preview looked bad; reuse the settled graph view here. */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { IconCloseOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { KnowledgeGraphSuccess, KnowledgeGraphTransport } from '../contract/knowledge-graph.ts'
import css from './KnowledgeGraphPanel.module.css'

// The panel draws the knowledge graph it reports (the ~230 cards), not the whole 5,800-node Neuro Graph: at panel width
// that was one solid ball (2026-09-26). The full Neuro Graph stays one click away in the session header.
const GRAPH_VIEW_URL = '/api/neuro-graph/cards?panel=1'

export interface KnowledgeGraphPanelProps extends PropsLocale<'conversation'> {
  /** Whether the panel is in the side rail. */
  open: boolean
  /** Close the panel and return focus to its header toggle. */
  onClose: () => void
  /** Apply-layer loader and cancellation capability. */
  transport: KnowledgeGraphTransport | undefined
  /** Bounded shell width in pixels. */
  width: number
}

interface LoadState {
  readonly kind: 'idle' | 'loading' | 'ready' | 'error'
  readonly graph?: KnowledgeGraphSuccess
  readonly error?: string
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
  * Keep the compact shell in React and let the shared graphify renderer own graph interaction.
 * @param props - transport, close action, and locale shares.
 * @returns the mounted Knowledge Graph side panel.
 */
export function KnowledgeGraphPanel({ open, onClose, transport, width, t }: KnowledgeGraphPanelProps) {
  const [state, setState] = useState<LoadState>({ kind: 'idle' })

  const load = useCallback(async (): Promise<void> => {
    if (transport === undefined) {
      setState({ kind: 'error', error: t('graph.unavailable') })
      return
    }
    setState({ kind: 'loading' })
    try {
      const response = await transport.load()
      if (response.ok) {
        setState({ kind: 'ready', graph: response })
      } else {
        setState({ kind: 'error', error: response.error })
      }
    } catch (error: unknown) {
      if (isAbortError(error)) return
      setState({ kind: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }, [t, transport])

  useEffect(() => {
    if (open) {
      void load()
    } else {
      transport?.abort()
    }
    return () => { transport?.abort() }
  }, [load, open, transport])

  const graph = state.graph

  const close = (): void => {
    transport?.abort()
    onClose()
  }

  return (
    <section
      id="dsh-knowledge-graph-panel"
      className={css.panel}
      aria-label={t('graph.panel')}
      hidden={!open}
      data-knowledge-graph-panel=""
      style={{ '--dsh-knowledge-graph-panel-width': `${width}px` } as CSSProperties}
    >
      <div className={css.header}>
        <span className={css.title}>{t('graph.panel')}</span>
        <div className={css.headerActions}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('graph.refresh')}
            title={t('graph.refresh')}
            disabled={state.kind === 'loading'}
            onClick={() => { void load() }}
          >
            <IconRefreshOutline16 size={14} />
          </button>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('graph.close')}
            title={t('graph.close')}
            onClick={close}
          >
            <IconCloseOutline16 size={14} />
          </button>
        </div>
      </div>

      <div className={css.body}>
        {state.kind === 'loading' && <p className={css.status}>{t('graph.loading')}</p>}
        {state.kind === 'error' && (
          <p className={css.status} role="alert">
            {t('graph.unavailable')}: {state.error}
          </p>
        )}
        {graph !== undefined && (
          <>
            <div className={css.meta}>
              <span>{t('graph.referenceOnly')}</span>
              <span>{t('graph.revision', { revision: graph.revision })}</span>
              <span>{t('graph.builtAt', { builtAt: graph.builtAt })}</span>
              <span>{t('graph.coverage', {
                shown: graph.totalNodes,
                totalNodes: graph.totalNodes,
                edges: graph.totalEdges,
                totalEdges: graph.totalEdges,
              })}</span>
              {graph.truncated && <span className={css.warning}>{t('graph.truncated')}</span>}
            </div>
            <div className={css.graphFrame}>
              <iframe
                className={css.graphFrameView}
                src={GRAPH_VIEW_URL}
                title={t('graph.graphLabel')}
                loading="eager"
              />
            </div>
          </>
        )}
      </div>
    </section>
  )
}
