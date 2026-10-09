/**
 * Keeps the reader's place when a side panel opens or closes.
 *
 * Opening or closing a side panel flips `data-conversation-side-by-side`, and
 * that attribute moves transcript scrolling between two different elements:
 * the outer conversation scrollport when no panel is open, and Chat's own
 * inner scroller when one is. A scroll offset belongs to whichever element
 * owns it, so the incoming scroller starts at zero and the reader is thrown
 * back to the top of the conversation.
 *
 * The panel toggles capture a row-anchored reading position before the flip;
 * the session body restores it in a layout effect, before paint. The panel
 * also changes the content column's width, so rows reflow and a raw offset
 * would not survive. Anchoring to a row keeps the same message under the
 * reader's eye at whatever height it lands.
 */

/** Slack, in pixels, for treating a scroller as parked at the floor. */
const BOTTOM_SLACK = 8

interface TranscriptAnchor {
  /** The transcript was at the floor, which restores exactly. */
  readonly atBottom: boolean
  /** Stable row identity published by Chat, when one was visible. */
  readonly key: string | undefined
  /** Distance from the scrollport's top edge to that row's top edge. */
  readonly offset: number
}

let pending: TranscriptAnchor | null = null

/**
 * Find the element currently scrolling the transcript.
 * @param from - a node inside the transcript flow.
 * @returns the live scroll container, or null when nothing scrolls yet.
 */
function liveScroller(from: Element | null): HTMLElement | null {
  for (let el = from?.parentElement ?? null; el !== null; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      return el
    }
  }
  return null
}

/** The transcript flow Chat renders, used as the search root in either layout. */
function transcriptFlow(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-chat-flow]')
}

/**
 * Record where the reader is, immediately before a panel toggle changes layout.
 * Safe to call when no transcript is on screen; it simply records nothing.
 */
export function captureTranscriptAnchor(): void {
  pending = null
  const scroller = liveScroller(transcriptFlow())
  if (scroller === null) return
  const portTop = scroller.getBoundingClientRect().top
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_SLACK
  let key: string | undefined
  let offset = 0
  if (!atBottom) {
    for (const row of document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]:not([hidden])')) {
      const rect = row.getBoundingClientRect()
      // The first row still crossing the top edge is the one being read.
      if (rect.bottom > portTop) {
        key = row.dataset.chatAnchorKey
        offset = rect.top - portTop
        break
      }
    }
  }
  pending = { atBottom, key, offset }
}

/**
 * Put the reader back after the layout flip. Consumes the captured anchor, so
 * a later unrelated re-render never re-applies a stale position.
 */
export function restoreTranscriptAnchor(): void {
  const anchor = pending
  pending = null
  if (anchor === null) return
  const scroller = liveScroller(transcriptFlow())
  if (scroller === null) return
  if (anchor.atBottom) {
    scroller.scrollTop = scroller.scrollHeight
    return
  }
  if (anchor.key === undefined) return
  const row = document.querySelector<HTMLElement>(
    `[data-chat-anchor-key="${CSS.escape(anchor.key)}"]:not([hidden])`,
  )
  if (row === null) return
  const portTop = scroller.getBoundingClientRect().top
  scroller.scrollTop += row.getBoundingClientRect().top - portTop - anchor.offset
}
