import { ConversationDefinitionRegistry } from "./definition-registry.js";
/** Runtime registry of per-target Conversation snapshot builders. */
export class ConversationViewRegistry extends ConversationDefinitionRegistry {
    /**
     * Register a uniquely named view builder factory for the caller's lifetime.
     * @param definition - target builder contribution.
     * @returns idempotent disposer.
     */
    register(definition) {
        return this.registerDefinition(definition.target, definition, `conversation view target "${definition.target}" is already registered`, `uiConversation.views.register(${JSON.stringify(definition.target)})`);
    }
}
