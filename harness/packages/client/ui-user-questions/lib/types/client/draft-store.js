/**
 * Session-scoped draft state for the generic question composer. The Slot
 * registry owns store instances; this module exports only the factory so a
 * plugin reload cannot reuse a module-global handle.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store';
const emptyProgress = () => ({ index: 0, drafts: [] });
/**
 * Declare the question composer's transient Session store.
 * @returns a non-persisted store handle whose instance is owned by the Slot registry.
 */
export function createQuestionDraftStore() {
    return defineStore({
        init: () => ({ progress: emptyProgress() }),
        actions: {
            replace: (draft, requestKey, progress) => {
                draft.requestKey = requestKey;
                draft.progress = progress;
            },
            clear: (draft, requestKey) => {
                if (draft.requestKey !== requestKey)
                    return;
                delete draft.requestKey;
                draft.progress = emptyProgress();
            },
        },
    });
}
