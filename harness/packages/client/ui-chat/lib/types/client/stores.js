/** Per-Session Chat selection store shared by the transcript and details panel. */
import { defineStore } from '@deepseek-ai/dsh-client-store';
/**
 * Resolve any stored generation for one Turn.
 * @param state - Chat store snapshot.
 * @param turn - owning Turn.
 * @returns the Turn's stored entry, when present.
 */
export function storedTurnProcessEntry(state, turn) {
    return state.turnProcesses.find(entry => entry.turn === turn);
}
/**
 * Create the Chat selection store handle.
 * @returns a handle instantiated once per rendered Session scope.
 */
export function createChatStore() {
    return defineStore({
        init: () => ({ selection: null, turnProcesses: [] }),
        actions: {
            select: (draft, target) => { draft.selection = target; },
            setTurnProcessOpen: (draft, turn, generation, open) => {
                const index = draft.turnProcesses.findIndex(entry => entry.turn === turn);
                if (!open) {
                    if (index >= 0)
                        draft.turnProcesses.splice(index, 1);
                    return;
                }
                const next = { turn, generation };
                if (index < 0)
                    draft.turnProcesses.push(next);
                else
                    draft.turnProcesses[index] = next;
            },
        },
    });
}
