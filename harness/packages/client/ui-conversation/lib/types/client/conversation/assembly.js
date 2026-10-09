/** Per-Session target-neutral Conversation assembly. */
import { Service } from '@deepseek-ai/cordis';
import { createSnapshotStore, } from '@deepseek-ai/dsh-client-store';
import { inspectRequestPrompt } from "../contract/request-inspection.js";
import { ConversationNodeAssembler } from "./assembler.js";
import { ConversationEventRegistry } from "./event-registry.js";
import { HistoricalImageCache } from "./historical-images.js";
import { ConversationViewRegistry } from "./view-registry.js";
class BoundConversation {
    assembler;
    snapshot;
    viewStore;
    targetSources = new Map();
    revision = -1;
    frame;
    disposeFeed = () => { };
    constructor(feed, assembler) {
        this.assembler = assembler;
        this.viewStore = assembler;
        this.snapshot = createSnapshotStore(this.currentSnapshot());
        this.replace(feed.getSnapshot());
        this.disposeFeed = feed.subscribe(() => {
            this.accept(feed.getSnapshot());
        });
    }
    target(target) {
        let source = this.targetSources.get(target);
        if (source === undefined) {
            const views = this.viewStore;
            source = {
                getSnapshot: () => views.get(target),
                subscribe: (listener) => { return this.snapshot.subscribe(listener); },
            };
            this.targetSources.set(target, source);
        }
        return source;
    }
    rebuild() { this.publish(this.assembler.rebuildRegistry()); }
    dispose() {
        if (this.frame !== undefined && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.frame);
        }
        this.frame = undefined;
        this.disposeFeed();
    }
    replace(window) {
        this.revision = window.revision;
        this.publish(this.assembler.replaceWindow(window.entries, window.hasMore));
    }
    accept(window) {
        if (window.revision === this.revision)
            return;
        if (window.revision !== this.revision + 1 || window.change.kind === 'replace') {
            this.replace(window);
            return;
        }
        this.revision = window.revision;
        switch (window.change.kind) {
            case 'prepend':
                this.publish(this.assembler.prepend(window.change.entries, window.hasMore));
                return;
            case 'append': {
                let publication = 'none';
                for (const event of window.change.entries) {
                    const next = this.assembler.append(event);
                    if (next === 'immediate' || publication === 'none')
                        publication = next;
                }
                this.publish(publication);
            }
        }
    }
    publish(publication) {
        if (publication === 'none')
            return;
        if (publication === 'animation-frame' && typeof requestAnimationFrame === 'function') {
            if (this.frame !== undefined)
                return;
            this.frame = requestAnimationFrame(() => {
                this.frame = undefined;
                this.flush();
            });
            return;
        }
        this.flush();
    }
    flush() {
        if (this.assembler.flush())
            this.snapshot.set(this.currentSnapshot());
    }
    currentSnapshot() {
        return {
            views: this.viewStore,
            activeTargets: this.assembler.activeTargets(),
        };
    }
}
/** Root service owning Conversation registries and per-Session bindings. */
export class UiConversation extends Service {
    sessions;
    /** Registry of event matchers and target snapshot builders. */
    events;
    /** Registry of target View definitions. */
    views;
    bindings = new Map();
    images;
    /**
     * @param ctx - owning Client context.
     * @param sessions - Session Controller object layer.
     */
    constructor(ctx, sessions) {
        super(ctx, 'uiConversation');
        this.sessions = sessions;
        this.events = new ConversationEventRegistry(ctx);
        this.views = new ConversationViewRegistry(ctx);
        this.images = new HistoricalImageCache(ctx, sessions);
        const rebuild = () => {
            for (const record of this.bindings.values())
                record.binding.rebuild();
        };
        let rebuildQueued = false;
        const scheduleRebuild = () => {
            if (rebuildQueued)
                return;
            rebuildQueued = true;
            queueMicrotask(() => {
                rebuildQueued = false;
                rebuild();
            });
        };
        ctx.effect(() => {
            const disposeEvents = this.events.subscribe(scheduleRebuild);
            const disposeViews = this.views.subscribe(scheduleRebuild);
            return () => {
                disposeViews();
                disposeEvents();
                for (const record of [...this.bindings.values()])
                    this.drop(record, true);
            };
        }, 'ui-conversation assembly');
    }
    /**
     * Resolve the Conversation binding for one Controller binding or Session id.
     * @param source - Session binding or identity.
     * @returns stable Conversation binding.
     */
    binding(source) {
        const sessionId = typeof source === 'string' ? source : source.sessionId;
        const owner = typeof source === 'string' ? this.sessions.binding(source) : source;
        if (owner === undefined)
            throw new Error(`uiConversation.binding: unknown session "${sessionId}"`);
        const current = this.bindings.get(owner.sessionId);
        if (current?.source === owner)
            return current.binding;
        if (current !== undefined)
            this.drop(current, true);
        const binding = new BoundConversation(owner.eventSource, new ConversationNodeAssembler(this.events, this.views));
        const record = { source: owner, binding, disposeScope: () => { } };
        this.bindings.set(owner.sessionId, record);
        const disposeScope = owner.ctx.effect(() => () => { this.drop(record, false); }, 'ui-conversation binding');
        record.disposeScope = () => { void disposeScope(); };
        return binding;
    }
    /**
     * Resolve one session-authorized durable image URL, cached per Session so
     * every Conversation target shares one read and one browser URL.
     * @param sessionId - Session authorization and lifetime scope.
     * @param attachment - Durable image reference from a session event.
     * @returns browser URL valid until the Session binding is released.
     */
    imageUrl(sessionId, attachment) {
        return this.images.resolve(sessionId, attachment);
    }
    /**
     * Read a cached durable image URL synchronously when one is available.
     * @param sessionId - Session authorization and lifetime scope.
     * @param attachment - Durable image reference from a session event.
     * @returns current preview or canonical URL, if cached.
     */
    peekImageUrl(sessionId, attachment) {
        return this.images.peek(sessionId, attachment);
    }
    /**
     * Adopt an already-displayable URL for one durable reference (see
     * HistoricalImageCache.seed): the transcript node then renders it without a
     * byte round-trip.
     * @param sessionId - Session authorization and lifetime scope.
     * @param attachment - Durable image reference the URL displays.
     * @param url - browser URL to adopt.
     * @returns whether the cache took URL ownership.
     */
    seedImageUrl(sessionId, attachment, url) {
        return this.images.seed(sessionId, attachment, url);
    }
    /**
     * Canonicalize one `request/header` event against the previous prompt state.
     *
     * A pure interpretation shared by the Chat and Trajectory Definitions, exposed
     * as a service method because cross-plugin value imports are forbidden in
     * client bundles.
     * @param previous - prompt recorded by the preceding loaded header, if any.
     * @param event - the `request/header` session event to interpret.
     * @returns the canonical prompt snapshot and any model-visible change.
     */
    inspectRequestPrompt(previous, event) {
        return inspectRequestPrompt(previous, event);
    }
    drop(record, releaseScope) {
        if (this.bindings.get(record.source.sessionId) !== record)
            return;
        this.bindings.delete(record.source.sessionId);
        record.binding.dispose();
        if (releaseScope)
            record.disposeScope();
    }
}
