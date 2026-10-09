import { Service } from '@deepseek-ai/cordis';
import { notifySubscribers } from '@deepseek-ai/dsh-client-store';
/** Shared lifecycle and stable-entry storage for one Conversation Definition registry. */
export class ConversationDefinitionRegistry {
    ctx;
    definitions = new Map();
    listeners = new Set();
    cached = [];
    /** @param ctx - Context whose effects own contributed Definitions. */
    constructor(ctx) {
        this.ctx = ctx;
        Object.defineProperty(this, Service.tracker, {
            value: { property: 'ctx' },
        });
    }
    /**
     * Return reference-stable Definitions in registration order.
     * @returns current Definitions.
     */
    entries() {
        return this.cached;
    }
    /**
     * Observe low-frequency registry changes.
     * @param listener - synchronous invalidation callback.
     * @returns unsubscribe callback.
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    /**
     * Register one uniquely keyed Definition for the caller's lifetime.
     * @param key - registry-local unique key.
     * @param definition - contributed Definition.
     * @param duplicateMessage - error raised when the key is already owned.
     * @param effectName - Cordis effect diagnostic label.
     * @returns idempotent disposer.
     */
    registerDefinition(key, definition, duplicateMessage, effectName) {
        if (this.definitions.has(key))
            throw new Error(duplicateMessage);
        const owner = this.ctx;
        const dispose = owner.effect(() => {
            this.definitions.set(key, definition);
            this.refresh();
            return () => {
                if (this.definitions.get(key) !== definition)
                    return;
                this.definitions.delete(key);
                this.refresh();
            };
        }, effectName);
        return () => { void dispose(); };
    }
    /** Refresh cached entries and synchronously invalidate subscribers. */
    refresh() {
        this.cached = [...this.definitions.values()];
        notifySubscribers(this.listeners, '[ui-conversation] definition registry');
    }
}
