/** Per-session Conversation store shared by the shell body and header. */
import { defineStore } from '@deepseek-ai/dsh-client-store';
/**
 * Declare per-session draft persistence and View selection.
 * @returns the store handle.
 */
export function createConversationStore() {
    return defineStore({
        init: () => ({ draft: '', view: null, viewRequest: null }),
        persist: 'dsh.conversation',
        actions: {
            setDraft: (d, text) => { d.draft = text; },
            setView: (d, view) => { d.view = view; },
            openView: (d, view, focus) => {
                d.view = view;
                d.viewRequest = { view, focus };
            },
            completeViewRequest: (d) => { d.viewRequest = null; },
            setKnowledgeGraphOpen: (d, open) => { d.knowledgeGraphOpen = open; },
            setKnowledgeGraphWidth: (d, width) => {
                if (width === null)
                    delete d.knowledgeGraphWidth;
                else
                    d.knowledgeGraphWidth = width;
            },
            setSidePanelOpen: (d, open) => { d.sidePanelOpen = open; },
            setSidePanelWidth: (d, width) => {
                if (width === null)
                    delete d.sidePanelWidth;
                else
                    d.sidePanelWidth = width;
            },
        },
    });
}
