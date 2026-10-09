/**
 * Plugins settings surface, browser half — one section whose feature-owned
 * tabs include configurable Host plugin cards and read-only inventory.
 *
 * The section declares `settings.plugins.tab`; its own `configurable` tab then
 * declares `settings.plugin.item` and renders whatever cards were registered
 * into it. The cards this package ships are the host-plane sections the
 * deployment already exposes; each binds its namespace through the client
 * settings scope, which keeps them unaware of one another and of other tabs.
 */
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots';
import { AgentLoopCard } from "./AgentLoopCard.js";
import { BashCard } from "./BashCard.js";
import { ConfigurablePluginsTab } from "./ConfigurablePluginsTab.js";
import { PluginsSettingsSection } from "./PluginsSettingsSection.js";
import { SubagentModelSelectionCard } from "./SubagentModelSelectionCard.js";
import { WebSearchCard } from "./WebSearchCard.js";
import { AGENT_LOOP_NS, AgentLoopCardController } from "./agent-loop-card-controller.js";
import { SHELL_NS, BashCardController } from "./bash-card-controller.js";
import { ConfigurablePluginsTabController } from "./tab-store.js";
import { SUBAGENT_MODEL_SELECTION_NS, SubagentModelSelectionCardController, } from "./subagent-model-selection-card-controller.js";
import { WEB_SEARCH_NS, WebSearchCardController } from "./web-search-card-controller.js";
import { en, zh } from "./locales.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'settings.plugins';
/** Required services (cordis fiber inject). */
export const inject = [
    'slots', 'locale', 'connection', 'remote', 'remote.credentials', 'remote.session', 'settingsScope',
];
/**
 * Mount the plugin configuration section and the cards this package ships.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx) {
    const t = ctx.locale.bind(NS);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugins: section dictionaries');
    const bash = new BashCardController(ctx.settingsScope.bind({ namespace: SHELL_NS }));
    const agentLoop = new AgentLoopCardController(ctx.settingsScope.bind({ namespace: AGENT_LOOP_NS }));
    const webSearch = new WebSearchCardController(ctx.settingsScope.bind({ namespace: WEB_SEARCH_NS }), ctx.remote.credentials);
    const subagentModelSelection = new SubagentModelSelectionCardController(ctx.settingsScope.bind({ namespace: SUBAGENT_MODEL_SELECTION_NS }), ctx.remote.session);
    // The credential a card reports is not part of any settings section, so its
    // scope publishes nothing when one is written. This is the only signal that
    // a key written on another surface reached the Host.
    ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => { webSearch.refreshCredential(ref); }), 'ui-settings-plugins: credential invalidations');
    ctx.effect(() => ctx.remote.$on('llm/adapters-updated', () => { subagentModelSelection.refreshCatalog(); }), 'ui-settings-plugins: subagent adapter invalidations');
    ctx.effect(() => ctx.remote.$on('settings/document-updated', () => { subagentModelSelection.refreshCatalog(); }), 'ui-settings-plugins: subagent settings invalidations');
    ctx.effect(() => ctx.on('connection/reset', () => { subagentModelSelection.resetConnection(); }), 'ui-settings-plugins: subagent connection generation');
    ctx.effect(() => () => { subagentModelSelection.dispose(); }, 'ui-settings-plugins: subagent preference');
    // The shared SettingsScope mirror updates after document commits and reconnects.
    const configurable = new ConfigurablePluginsTabController(ctx.settingsScope.describe(), () => ctx.slots.entries('settings.plugin.item'));
    ctx.effect(() => () => { configurable.dispose(); }, 'ui-settings-plugins: tab directory');
    // A card registered after the first read joins the list without a wire call.
    ctx.effect(() => ctx.slots.subscribe('settings.plugin.item', () => { configurable.refresh(); }), 'ui-settings-plugins: card ledger');
    let tabsVersion = -1;
    let tabsRevision = -1;
    let tabs = [];
    const sectionInjected = () => ({
        hooks: {
            tabs: {
                getSnapshot: () => {
                    const version = ctx.slots.getVersion('settings.plugins.tab');
                    const revision = ctx.locale.getSnapshot().revision;
                    if (version !== tabsVersion || revision !== tabsRevision) {
                        tabsVersion = version;
                        tabsRevision = revision;
                        tabs = ctx.slots.entries('settings.plugins.tab')
                            .map(entry => ({
                            /* v8 ignore next -- list-slot registration requires id */
                            id: entry.options.id ?? '',
                            order: entry.options.order ?? 0,
                            label: resolveSlotLabel(entry.options.label) ?? '',
                        }))
                            .sort((a, b) => a.order - b.order);
                    }
                    return tabs;
                },
                subscribe: (listener) => {
                    const offLedger = ctx.slots.subscribe('settings.plugins.tab', listener);
                    const offLocale = ctx.locale.subscribe(listener);
                    return () => {
                        offLedger();
                        offLocale();
                    };
                },
            },
        },
    });
    // This package owns the one Plugins navigation entry and the tab chrome;
    // feature plugins contribute pages without competing for Settings nav rows.
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'plugins',
        order: 15,
        label: () => t('nav'),
        locale: NS,
        inject: sectionInjected,
        children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
    }, PluginsSettingsSection));
    // The existing configuration page is one ordinary tab. It keeps ownership
    // of the card slot and the shipped card contributions below.
    ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'configurable',
        order: 0,
        label: () => t('configurableTab'),
        locale: NS,
        inject: () => configurable.inject(),
        children: { 'settings.plugin.item': { kind: 'keyed', scope: 'root' } },
    }, ConfigurablePluginsTab));
    ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register({
            name: 'settings.plugin.item',
            key: SHELL_NS,
            locale: NS,
            inject: () => bash.inject(),
        }, BashCard);
        yield ctx.slots.register({
            name: 'settings.plugin.item',
            key: AGENT_LOOP_NS,
            locale: NS,
            inject: () => agentLoop.inject(),
        }, AgentLoopCard);
        yield ctx.slots.register({
            name: 'settings.plugin.item',
            key: SUBAGENT_MODEL_SELECTION_NS,
            locale: NS,
            inject: () => subagentModelSelection.inject(),
        }, SubagentModelSelectionCard);
        yield ctx.slots.register({
            name: 'settings.plugin.item',
            key: WEB_SEARCH_NS,
            locale: NS,
            inject: () => webSearch.inject(),
        }, WebSearchCard);
    });
}
