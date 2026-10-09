/**
 * The configurable-plugins tab's card list.
 *
 * The tab dispatches its slot by settings namespace, so what it renders is
 * the intersection of two ledgers: the namespaces the Host serves and the
 * cards registered into `settings.plugin.item`. A served namespace no card
 * claims renders nothing — another surface owns it, or this deployment ships
 * no browser half for it — and a card whose namespace the Host does not serve
 * is never dispatched, so a plugin this deployment did not compose leaves no
 * trace and does not count toward the empty line.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
/** Derives the served namespaces from the shared describe mirror and pairs them with the cards that claim them. */
export class ConfigurablePluginsTabController {
    describeFace;
    entries;
    store = createSnapshotStore({ loaded: false, namespaces: [] });
    disposed = false;
    unsubscribe;
    /**
     * @param describeFace - the shared mirror's describe face; its refreshes
     * (document commits, reconnects) are what keep the served set current.
     * @param entries - reads the cards currently registered into the section's slot.
     */
    constructor(describeFace, entries) {
        this.describeFace = describeFace;
        this.entries = entries;
        this.unsubscribe = describeFace.subscribe(() => { this.publish(); });
        void describeFace.ensure();
        this.publish();
    }
    /** Republish after the slot ledger changed; a card registered late joins here. */
    refresh() {
        if (this.disposed)
            return;
        this.publish();
    }
    /** Stop publishing and stop following the mirror. */
    dispose() {
        this.disposed = true;
        this.unsubscribe();
    }
    /**
     * Build the face the tab's slot registration injects.
     * @returns the tab's snapshot source.
     */
    inject() {
        return { hooks: { configurablePlugins: this.store } };
    }
    publish() {
        if (this.disposed)
            return;
        const mirrored = this.describeFace.getSnapshot();
        const loaded = mirrored.view !== undefined;
        const served = new Set(mirrored.view?.namespaces.map(view => view.ns) ?? []);
        const namespaces = this.entries().flatMap(entry => entry.options.key !== undefined && served.has(entry.options.key) ? [entry.options.key] : []);
        const previous = this.store.getSnapshot();
        // Every settings-document commit refreshes the mirror, and most commits
        // change nothing this section shows. An observable source must keep its
        // snapshot reference until the fact moves, or each unrelated save
        // re-renders the whole card list (packages/client/AGENTS.md reactive rule 5).
        if (previous.loaded === loaded
            && previous.namespaces.length === namespaces.length
            && previous.namespaces.every((ns, index) => ns === namespaces[index]))
            return;
        this.store.set({ loaded, namespaces });
    }
}
