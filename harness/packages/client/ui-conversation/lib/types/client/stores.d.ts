/** Per-session Conversation store shared by the shell body and header. */
import { type EngineStoreHandle } from '@deepseek-ai/dsh-client-store';
import type { ConversationStoreState } from './contract/views.ts';
/** Declared write set for the Conversation shell. */
type ConversationActions = {
    setDraft: (draft: ConversationStoreState, text: string) => void;
    setView: (draft: ConversationStoreState, view: string) => void;
    openView: (draft: ConversationStoreState, view: string, focus: string) => void;
    completeViewRequest: (draft: ConversationStoreState) => void;
    setKnowledgeGraphOpen: (draft: ConversationStoreState, open: boolean) => void;
    setKnowledgeGraphWidth: (draft: ConversationStoreState, width: number | null) => void;
    setSidePanelOpen: (draft: ConversationStoreState, open: boolean) => void;
    setSidePanelWidth: (draft: ConversationStoreState, width: number | null) => void;
};
/**
 * Declare per-session draft persistence and View selection.
 * @returns the store handle.
 */
export declare function createConversationStore(): EngineStoreHandle<ConversationStoreState, ConversationActions>;
export {};
