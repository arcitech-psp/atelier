import { ModelsSection } from "./ModelsSection.js";
import { DeepSeekOnboardingDialog } from "./DeepSeekOnboardingDialog.js";
import { WelcomeNotice } from "./WelcomeNotice.js";
import { decodeWelcomeSection, WelcomeNoticeStore } from "./welcome-store.js";
import { ModelsSettingsStore } from "./store.js";
import { createSettingsSchemaOperations } from "./schema-operations.js";
import { en, zh } from "./locales.js";
import { WELCOME_NOTICE_SETTINGS_NAMESPACE } from "../onboarding-copy.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'settings.models';
/**
 * Refetch the page snapshot only after its first load: an unopened Models
 * page must not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller) {
    if (controller.store.getSnapshot().status === 'idle')
        return;
    void controller.load();
}
/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = [
    'slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.settings',
    'settingsScope', 'settingsSchema',
];
/**
 * Register the Models section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation (settings, credentials, or provider topology).
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-models: copy dictionaries');
    const schema = createSettingsSchemaOperations(ctx.settingsSchema);
    // Every configuration operation rides its owning Remote namespace.
    const wire = {
        credentials: ctx.remote.credentials,
        llm: ctx.remote.llm,
        settings: ctx.remote.settings,
    };
    const controller = new ModelsSettingsStore(wire, schema, ctx.settingsScope.describe());
    // Registration-time text (the nav label thunk) and the inject faces share
    // one bound translate; copy freshness rides the locale revision.
    const t = ctx.locale.bind(NS);
    const injected = () => ({
        controller,
        hooks: { snapshot: controller.store },
        api: wire,
        schema,
        t,
    });
    const deepSeekOnboardingInjected = () => ({
        controller,
        hooks: { models: controller.store },
        api: wire,
        schema,
        t,
    });
    // The scope's own memory mode is what keeps a remote browser process-local,
    // so the store needs no isLoopback branch of its own.
    const welcomeController = new WelcomeNoticeStore(ctx.settingsScope.bind({
        namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE,
        decode: decodeWelcomeSection,
    }));
    const welcomeInjected = () => ({
        controller: welcomeController,
        hooks: { welcome: welcomeController.store },
        t,
    });
    // Pushed invalidations converge every open surface without polling. The
    // settingsScope injection makes ui-settings activate first, and remote
    // dispatch preserves listener order; its listener therefore starts the
    // mirror refresh before this store joins that refresh. The welcome notice
    // follows its settings scope, so it needs no subscription here.
    ctx.effect(() => {
        const refreshModels = () => { refreshIfLoaded(controller); };
        const disposers = [
            ctx.remote.$on('settings/document-updated', () => { refreshModels(); }),
            ctx.remote.$on('credentials/reference-updated', refreshModels),
            ctx.remote.$on('llm/adapters-updated', refreshModels),
            ctx.on('connection/reset', refreshModels),
        ];
        return () => {
            welcomeController.dispose();
            for (const dispose of disposers)
                dispose();
        };
    }, 'ui-settings-models: pushed invalidations');
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'models',
        order: 10,
        label: () => t('nav'),
        inject: injected,
        children: {
            'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
            'settings.models.footer': { kind: 'list', scope: 'root' },
        },
    }, ModelsSection));
    ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
        name: 'settings.onboarding',
        id: 'welcome-notice',
        order: -100,
        inject: welcomeInjected,
    }, WelcomeNotice));
    ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
        name: 'settings.onboarding',
        id: 'deepseek-official',
        order: 0,
        inject: deepSeekOnboardingInjected,
    }, DeepSeekOnboardingDialog));
}
