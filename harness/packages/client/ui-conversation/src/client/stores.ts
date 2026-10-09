/** Per-session Conversation store shared by the shell body and header. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { ConversationStoreState } from './contract/views.ts'

/** Declared write set for the Conversation shell. */
type ConversationActions = {
  setDraft: (draft: ConversationStoreState, text: string) => void
  setView: (draft: ConversationStoreState, view: string) => void
  openView: (draft: ConversationStoreState, view: string, focus: string) => void
  completeViewRequest: (draft: ConversationStoreState) => void
  setKnowledgeGraphOpen: (draft: ConversationStoreState, open: boolean) => void
  setKnowledgeGraphWidth: (draft: ConversationStoreState, width: number | null) => void
  setSidePanelOpen: (draft: ConversationStoreState, open: boolean) => void
  setSidePanelWidth: (draft: ConversationStoreState, width: number | null) => void
}

/**
 * Declare per-session draft persistence and View selection.
 * @returns the store handle.
 */
export function createConversationStore(): EngineStoreHandle<ConversationStoreState, ConversationActions> {
  return defineStore({
    init: (): ConversationStoreState => ({ draft: '', view: null, viewRequest: null }),
    persist: 'dsh.conversation',
    actions: {
      setDraft: (d, text: string) => { d.draft = text },
      setView: (d, view: string) => { d.view = view },
      openView: (d, view: string, focus: string) => {
        d.view = view
        d.viewRequest = { view, focus }
      },
      completeViewRequest: (d) => { d.viewRequest = null },
      setKnowledgeGraphOpen: (d, open: boolean) => { d.knowledgeGraphOpen = open },
      setKnowledgeGraphWidth: (d, width: number | null) => {
        if (width === null) delete d.knowledgeGraphWidth
        else d.knowledgeGraphWidth = width
      },
      setSidePanelOpen: (d, open: boolean) => { d.sidePanelOpen = open },
      setSidePanelWidth: (d, width: number | null) => {
        if (width === null) delete d.sidePanelWidth
        else d.sidePanelWidth = width
      },
    },
  })
}
