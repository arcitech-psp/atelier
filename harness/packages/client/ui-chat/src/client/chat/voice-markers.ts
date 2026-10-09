/**
 * Live (voice) turns carry two machine hints in their text: a trailing `[[think:off]]` for the model proxy and a
 * leading `[You were interrupted while saying: "..."]` line after a barge-in. The agent needs both; the person
 * reading the transcript does not want them as part of what they said.
 */
const THINK_MARKER = /\s*\[\[think:off\]\]\s*$/i
const INTERRUPTED = /^\s*\[You were interrupted while saying: "([^\n]*)"\]\s*\n?/

export interface SplitVoiceText { readonly text: string; readonly note: string | null }

/** Remove the machine hints from a user message's text; the interruption becomes a short muted note. */
export function splitVoiceMarkers(raw: string): SplitVoiceText {
  let text = raw
  let note: string | null = null
  const interrupted = INTERRUPTED.exec(text)
  if (interrupted) { note = `Interrupted after: "${interrupted[1]}"`; text = text.slice(interrupted[0].length) }
  text = text.replace(THINK_MARKER, '')
  return { text, note }
}
