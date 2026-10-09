import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
/** One session's shared directory controller; disposed with the session scope. */
export class ModelDirectory {
    sessions;
    sessionId;
    available;
    catalog;
    projected;
    /** The shared snapshot both entries render from (uSES-safe store). */
    store = createSnapshotStore({
        current: null, routable: null, groups: [], failures: [], status: 'idle', error: null,
    });
    /** Latest selection operation wins; an older response never overwrites a newer one. */
    generation = 0;
    disposed = false;
    resolved = false;
    unsubscribeCatalog;
    unsubscribeSelection;
    /**
     * @param sessions - the session wire face (captured from the plugin's root connection).
     * @param sessionId - the owning session.
     * @param available - whether this session may use Agent-bound model RPCs.
     * @param catalog - Host-generation catalog shared by every Session.
     * @param projected - durable model selection projected from Session history.
     */
    constructor(sessions, sessionId, available, catalog, projected) {
        this.sessions = sessions;
        this.sessionId = sessionId;
        this.available = available;
        this.catalog = catalog;
        this.projected = projected;
        this.unsubscribeCatalog = catalog.store.subscribe(() => { this.syncInputs(); });
        this.unsubscribeSelection = projected.subscribe(() => { this.syncInputs(); });
        this.syncInputs();
    }
    /**
     * Ensure the Host generation's shared advisory catalog is loaded.
     * @returns the fresh directory value.
     */
    async load() {
        this.assertAvailable();
        await this.catalog.load();
        this.syncInputs();
        return this.store.getSnapshot();
    }
    /**
     * Select the complete provider/model/reasoning selection. The durable
     * projection frame updates the shared current; failures surface on the store
     * and throw so each entry's own retry surface engages.
     * @param selection - provider, provider-owned model id, and optional adapter-owned effort.
   */
    async select(selection) {
        this.assertAvailable();
        const generation = ++this.generation;
        this.store.update((s) => { s.status = 'selecting'; s.error = null; });
        const result = await this.sessions.selectModel({
            sessionId: this.sessionId,
            provider: selection.provider,
            model: selection.model,
            ...selection.reasoningEffort === undefined
                ? {}
                : { reasoningEffort: selection.reasoningEffort },
        });
        if (this.disposed || generation !== this.generation) {
            if (!result.ok)
                throw new Error(`${result.error.code}: ${result.error.message}`);
            return;
        }
        if (!result.ok) {
            this.store.update((s) => { s.status = 'error'; s.error = `${result.error.code}: ${result.error.message}`; });
            throw new Error(`session.selectModel failed: ${result.error.code}: ${result.error.message}`);
        }
        this.store.update((s) => { s.status = 'ready'; s.error = null; });
        this.syncInputs();
    }
    /**
     * Invalidate an in-flight selection response from the previous Host generation.
     */
    resetConnected() {
        if (this.disposed)
            return;
        ++this.generation;
        this.store.update((state) => {
            if (state.status === 'selecting')
                state.status = 'idle';
            state.error = null;
        });
        this.syncInputs();
    }
    /** Scope teardown: late settlements lose write access to the store. */
    dispose() {
        this.disposed = true;
        this.unsubscribeSelection();
        this.unsubscribeCatalog();
    }
    assertAvailable() {
        if (!this.available()) {
            throw new Error('model selection is unavailable for addressed subagent sessions');
        }
    }
    syncInputs() {
        if (this.disposed)
            return;
        const catalog = this.catalog.store.getSnapshot();
        const projected = modelSelectionProjection(this.projected.getSnapshot());
        if (catalog.status !== 'ready' || catalog.value === null || projected === undefined) {
            if (this.resolved) {
                if (catalog.status === 'error') {
                    this.store.update((state) => {
                        state.status = 'error';
                        state.error = catalog.error;
                    });
                }
                return;
            }
            this.store.set({
                current: null,
                routable: null,
                groups: [],
                failures: [],
                status: catalog.status === 'error' ? 'error' : 'loading',
                error: catalog.error,
            });
            return;
        }
        const current = projected.next ?? catalog.value.default;
        this.resolved = true;
        this.store.set({
            current,
            routable: catalog.value.routableProviders.includes(current.provider),
            groups: catalog.value.groups,
            failures: catalog.value.failures,
            status: this.store.getSnapshot().status === 'selecting'
                ? 'selecting'
                : 'ready',
            error: null,
        });
    }
}
function modelSelectionProjection(value) {
    return value === undefined ? undefined : value;
}
