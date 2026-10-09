/** Chat transcript preferences stored in the Host user-settings document. */
import z from '@deepseek-ai/schemastery';
/** Settings namespace owned by the Chat target. */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat';
/** Field carrying the completed-Turn transcript presentation mode. */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView';
/** Transcript presentation modes accepted at settings boundaries. */
export const TRANSCRIPT_VIEW_MODES = ['normal', 'compact'];
/** Default preserves the compact process disclosure introduced by Chat. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE = 'compact';
/** Durable Chat schema; also the wire envelope the browser scope validates against. */
export const ChatSettingsSchema = z.object({
    [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_MODES]).default(DEFAULT_TRANSCRIPT_VIEW_MODE),
});
