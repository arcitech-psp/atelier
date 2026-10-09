/** Conversation view and session-local presentation state. */

/**
 * One conversation view tab, projected from a 'conversation.view' slot
 * entry's registration options (label falls back to the entry id).
 */
export interface ViewTab { id: string; label: string }

/** Placement used when a Conversation View is rendered by the shell. */
export type ConversationViewSurface = 'main' | 'side-panel'

/** One-shot focus request addressed to a Conversation View. */
export interface ConversationViewRequest {
  /** Target `conversation.view` entry id. */
  readonly view: string
  /** Target-owned opaque focus identity. */
  readonly focus: string
}

/** Per-session state owned by the target-neutral Conversation shell. */
export interface ConversationStoreState {
  /** Composer draft (persisted; survives session switches and reloads). */
  draft: string
  /** Preferred `conversation.view` entry id; null resolves to Chat when registered. */
  view: string | null
  /** Focus request consumed and acknowledged by the addressed View. */
  viewRequest: ConversationViewRequest | null
  /** User-owned Knowledge Graph panel state; absent preserves old persisted sessions. */
  knowledgeGraphOpen?: boolean
  /** User-owned Knowledge Graph width in pixels; absent uses adaptive sizing. */
  knowledgeGraphWidth?: number | null
  /** User-owned external side-panel open state; absent keeps the panel closed. */
  sidePanelOpen?: boolean
  /** User-owned external side-panel width in pixels; absent uses adaptive sizing. */
  sidePanelWidth?: number | null
}
