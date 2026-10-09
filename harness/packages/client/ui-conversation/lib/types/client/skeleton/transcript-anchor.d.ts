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
/**
 * Record where the reader is, immediately before a panel toggle changes layout.
 * Safe to call when no transcript is on screen; it simply records nothing.
 */
export declare function captureTranscriptAnchor(): void;
/**
 * Put the reader back after the layout flip. Consumes the captured anchor, so
 * a later unrelated re-render never re-applies a stale position.
 */
export declare function restoreTranscriptAnchor(): void;
