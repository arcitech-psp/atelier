/** Staged editor for the Host-owned subagent model allowlist. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
/** Namespace of the Host-owned subagent model-selection preference. */
export const SUBAGENT_MODEL_SELECTION_NS = 'subagent-model-selection';
/**
 * Stable identity for one exact route; callers resolve it by lookup and never parse it.
 * @param route - Provider/model route to identify.
 * @returns Opaque key for lookup within the card.
 */
export function subagentModelKey(route) {
    return `${route.provider}\0${route.model}`;
}
/**
 * Join live adapter metadata with stored routes that remain removable after disappearance.
 * @param groups - Current model directory grouped by provider.
 * @param stored - Routes in the effective settings value.
 * @param selected - Opaque route keys selected in the current draft.
 * @returns Candidate rows for the card.
 */
export function subagentModelCandidates(groups, stored, selected) {
    const storedByKey = new Map(stored.map(route => [subagentModelKey(route), route]));
    const candidates = groups.flatMap(group => group.models.map((model) => {
        const route = { provider: group.id, model: model.id };
        const key = subagentModelKey(route);
        storedByKey.delete(key);
        return {
            ...route,
            key,
            providerName: group.name,
            modelName: model.name,
            available: true,
            selected: selected.has(key),
        };
    }));
    for (const route of storedByKey.values()) {
        const key = subagentModelKey(route);
        candidates.push({
            ...route,
            key,
            providerName: route.provider,
            modelName: route.model,
            available: false,
            selected: selected.has(key),
        });
    }
    return candidates;
}
function sameRoutes(left, right) {
    if (left.length !== right.length)
        return false;
    const rightKeys = new Set(right.map(subagentModelKey));
    return left.every(route => rightKeys.has(subagentModelKey(route)));
}
/** Bridges one settings scope and the live adapter directory onto a staged card. */
export class SubagentModelSelectionCardController {
    scope;
    session;
    catalogGroups = [];
    catalogPartial = false;
    catalogStatus = 'idle';
    draftEnabled;
    draftRoutes;
    draftRevision;
    saving = false;
    failed = false;
    conflicted = false;
    disposed = false;
    saveGeneration = 0;
    catalogGeneration = 0;
    store;
    unsubscribe;
    /**
     * @param scope - bound `subagent-model-selection` settings scope.
     * @param session - Host Session model-catalog face.
     */
    constructor(scope, session) {
        this.scope = scope;
        this.session = session;
        this.store = createSnapshotStore(this.projection());
        this.unsubscribe = scope.subscribe(() => {
            if (!this.saving && this.draftRoutes !== undefined
                && this.scope.getSnapshot().revision !== this.draftRevision) {
                if (this.currentEnabled() === this.enabled()
                    && sameRoutes(this.currentRoutes(), this.desiredRoutes()))
                    this.clearDraft();
                else
                    this.conflicted = true;
            }
            if (this.enabled() && this.catalogStatus === 'idle')
                void this.loadCatalog();
            this.publish();
        });
        if (this.enabled() && this.catalogStatus === 'idle')
            void this.loadCatalog();
    }
    /** Stop observing settings and suppress late directory/write settlements. */
    dispose() {
        this.disposed = true;
        this.saveGeneration += 1;
        this.catalogGeneration += 1;
        this.unsubscribe();
    }
    /**
     * Build the renderer face for this card.
     * @returns The snapshot and staged card actions injected into the renderer.
     */
    inject() {
        return {
            hooks: { subagentModelSelectionCard: this.store },
            toggleEnabled: () => { this.toggleEnabled(); },
            toggleModel: (key) => { this.toggleModel(key); },
            retryCatalog: () => { void this.loadCatalog(); },
            save: () => { void this.save(); },
            discard: () => { this.discard(); },
        };
    }
    currentRoutes() {
        return this.scope.getSnapshot().value?.allowedModels.map(route => ({ ...route })) ?? [];
    }
    currentEnabled() {
        return this.scope.getSnapshot().value?.enabled ?? false;
    }
    selected() {
        return new Set(this.draftRoutes?.keys() ?? this.currentRoutes().map(subagentModelKey));
    }
    enabled() {
        return this.draftEnabled ?? this.currentEnabled();
    }
    beginDraft() {
        if (this.draftRoutes === undefined) {
            const snapshot = this.scope.getSnapshot();
            this.draftEnabled = snapshot.value?.enabled ?? false;
            this.draftRoutes = new Map(snapshot.value?.allowedModels.map(route => [subagentModelKey(route), { ...route }]) ?? []);
            this.draftRevision = snapshot.revision;
        }
        return this.draftRoutes;
    }
    toggleEnabled() {
        const snapshot = this.scope.getSnapshot();
        if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving)
            return;
        this.beginDraft();
        this.draftEnabled = !this.draftEnabled;
        this.failed = false;
        if (this.draftEnabled && this.catalogStatus === 'idle')
            void this.loadCatalog();
        this.publish();
    }
    toggleModel(key) {
        if (!this.enabled() || this.saving || !this.scope.getSnapshot().writable)
            return;
        const candidate = this.candidates().find(candidate => candidate.key === key);
        if (candidate === undefined)
            return;
        const routes = this.beginDraft();
        if (routes.has(key))
            routes.delete(key);
        else
            routes.set(key, { provider: candidate.provider, model: candidate.model });
        this.failed = false;
        this.publish();
    }
    clearDraft() {
        this.draftEnabled = undefined;
        this.draftRoutes = undefined;
        this.draftRevision = undefined;
        this.failed = false;
        this.conflicted = false;
    }
    discard() {
        if (this.saving)
            return;
        this.clearDraft();
        this.publish();
    }
    candidates() {
        const retained = new Map(this.currentRoutes().map(route => [subagentModelKey(route), route]));
        for (const [key, route] of this.draftRoutes ?? [])
            retained.set(key, route);
        return subagentModelCandidates(this.catalogGroups, [...retained.values()], this.selected());
    }
    desiredRoutes() {
        return [...this.draftRoutes?.values() ?? this.currentRoutes()].map(route => ({ ...route }));
    }
    async save() {
        const snapshot = this.scope.getSnapshot();
        const desiredEnabled = this.enabled();
        const desired = this.desiredRoutes();
        if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving
            || (this.currentEnabled() === desiredEnabled && sameRoutes(this.currentRoutes(), desired))
            || (desiredEnabled && desired.length === 0))
            return;
        if (this.draftRoutes !== undefined && snapshot.revision !== this.draftRevision) {
            this.conflicted = true;
            this.publish();
            return;
        }
        const generation = this.saveGeneration;
        this.saving = true;
        this.failed = false;
        this.conflicted = false;
        this.publish();
        await this.scope.mutate([
            { op: 'set', path: ['enabled'], value: desiredEnabled },
            {
                op: 'set',
                path: ['allowedModels'],
                value: desired.map(route => ({ provider: route.provider, model: route.model })),
            },
        ], this.draftRevision);
        if (generation !== this.saveGeneration)
            return;
        const landed = this.currentEnabled() === desiredEnabled && sameRoutes(this.currentRoutes(), desired);
        this.saving = false;
        this.failed = !landed;
        if (landed)
            this.clearDraft();
        this.publish();
    }
    /** Invalidate and reload model candidates after a Host model input changes. */
    refreshCatalog() {
        if (this.disposed)
            return;
        this.catalogGeneration += 1;
        this.catalogStatus = 'idle';
        this.catalogPartial = false;
        if (this.enabled())
            void this.loadCatalog();
        else
            this.publish();
    }
    /** Drop Host-specific candidates and drafts, then reload after reconnecting. */
    resetConnection() {
        if (this.disposed)
            return;
        this.saveGeneration += 1;
        this.saving = false;
        this.clearDraft();
        this.catalogGroups = [];
        this.refreshCatalog();
    }
    async loadCatalog() {
        if (this.disposed || this.catalogStatus === 'loading')
            return;
        const generation = this.catalogGeneration;
        this.catalogStatus = 'loading';
        this.catalogPartial = false;
        this.publish();
        try {
            const response = await this.session.modelCatalog();
            if (generation !== this.catalogGeneration)
                return;
            if (!response.ok)
                throw new Error(response.error.message);
            this.catalogGroups = response.value.groups;
            this.catalogPartial = response.value.failures.length > 0;
            this.catalogStatus = 'ready';
        }
        catch {
            if (generation !== this.catalogGeneration)
                return;
            this.catalogStatus = 'error';
        }
        this.publish();
    }
    projection() {
        const snapshot = this.scope.getSnapshot();
        const current = this.currentRoutes();
        const desired = this.desiredRoutes();
        const enabled = this.enabled();
        return {
            available: snapshot.status === 'ready',
            writable: snapshot.writable,
            dirty: this.currentEnabled() !== enabled || !sameRoutes(current, desired),
            invalid: enabled && desired.length === 0,
            saving: this.saving,
            failed: this.failed,
            enabled,
            candidates: this.candidates(),
            catalogStatus: this.catalogStatus,
            catalogPartial: this.catalogPartial,
            conflicted: this.conflicted,
        };
    }
    publish() {
        this.store.set(this.projection());
    }
}
