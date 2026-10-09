/** Host-owned opt-in setting for model-selectable subagent delegation. */
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings';
import { AllowedModelRouteSchema, assertAllowedModelRoutes, } from "./model-selection.js";
/** User-settings section for model-selectable subagent delegation. */
export const SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE = settingsNamespace('subagent-model-selection');
/** Schema served to settings clients for the opt-in preference. */
export const SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA = z.object({
    enabled: z.boolean().default(false),
    allowedModels: z.array(AllowedModelRouteSchema).default([]),
});
/** Singleton settings owner read by delegation tools when an Agent is published. */
export class SubagentModelSelectionConfig extends Service {
    static Config = z.object({
        enabled: z.boolean().default(false),
        allowedModels: z.array(AllowedModelRouteSchema).default([]),
    });
    source;
    constructor(ctx, config = {}) {
        super(ctx, 'subagentModelSelection');
        // Cordis supplies the schema default; the fallback also covers direct construction.
        /* v8 ignore next */
        const entry = {
            enabled: config.enabled ?? false,
            allowedModels: config.allowedModels ?? [],
        };
        this.validate(entry);
        this.source = () => entry;
        installSettingsSection(ctx, SUBAGENT_MODEL_SELECTION_SETTINGS_NAMESPACE, SUBAGENT_MODEL_SELECTION_SETTINGS_SCHEMA, entry, {
            setSource: (source) => { this.source = source; },
            validate: (value) => { this.validate(value); },
            // Consumers sample at Agent publication, so a settings update never
            // rebuilds the tool definitions of an Agent that is already running.
            onChange: () => { },
        });
    }
    /**
     * Read a detached selection preference for the next eligible Agent publication.
     * @returns the enabled state and exact allowed routes.
     */
    current() {
        const current = this.source();
        return {
            enabled: current.enabled,
            allowedModels: current.allowedModels.map(route => ({ ...route })),
        };
    }
    validate(value) {
        assertAllowedModelRoutes(value.allowedModels);
        if (value.enabled && value.allowedModels.length === 0) {
            throw new Error('enabled subagent model selection requires at least one allowed model');
        }
    }
}
export const name = 'subagent-model-selection-settings';
export default SubagentModelSelectionConfig;
