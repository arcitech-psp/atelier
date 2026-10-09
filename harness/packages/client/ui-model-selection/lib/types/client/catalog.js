/** One Host-generation model catalog shared by every Session selector. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
/** Loads at most one model catalog for the current Host generation. */
export class ModelCatalogDirectory {
    session;
    /** Current shared catalog value and load lifecycle. */
    store = createSnapshotStore({
        value: null,
        status: 'idle',
        error: null,
    });
    generation = 0;
    inflight;
    /** @param session - Session Remote namespace carrying the Host-generation catalog. */
    constructor(session) {
        this.session = session;
    }
    /**
     * Return the current generation's catalog, sharing its one in-flight load.
     * @returns the loaded global catalog.
     */
    load() {
        const state = this.store.getSnapshot();
        if (state.status === 'ready' && state.value !== null)
            return Promise.resolve(state.value);
        if (this.inflight !== undefined)
            return this.inflight;
        const generation = this.generation;
        this.store.update((draft) => {
            draft.status = 'loading';
            draft.error = null;
        });
        const operation = this.session.modelCatalog().then((response) => {
            if (!response.ok) {
                throw new Error(`${response.error.code}: ${response.error.message}`);
            }
            if (generation === this.generation) {
                this.store.set({ value: response.value, status: 'ready', error: null });
            }
            return response.value;
        }).catch((error) => {
            if (generation === this.generation) {
                this.store.update((draft) => {
                    draft.status = 'error';
                    draft.error = error instanceof Error ? error.message : String(error);
                });
            }
            throw error;
        }).finally(() => {
            if (generation === this.generation && this.inflight === operation)
                this.inflight = undefined;
        });
        this.inflight = operation;
        return operation;
    }
    /**
     * Invalidate the loaded catalog; the next explicit menu read reloads it.
     * @param clear - whether values from the previous Host generation must be hidden.
     */
    invalidate(clear = false) {
        this.generation += 1;
        this.inflight = undefined;
        const value = clear ? null : this.store.getSnapshot().value;
        this.store.set({ value, status: 'idle', error: null });
    }
    /** Invalidate and reload the catalog after a Host-side model input changes. */
    refresh() {
        this.invalidate();
        void this.load().catch(() => { });
    }
    /** Clear Host-specific values and load the replacement Host generation. */
    resetGeneration() {
        this.invalidate(true);
        void this.load().catch(() => { });
    }
}
