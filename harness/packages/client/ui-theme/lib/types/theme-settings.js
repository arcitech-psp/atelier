/** Theme preferences stored in the Host user-settings document. */
import z from '@deepseek-ai/schemastery';
/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'];
/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme';
/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference';
/** Field carrying the conversation content font size. */
export const FONT_SIZE_FIELD = 'fontSize';
/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE = 'system';
/** Smallest accepted content font size (px). */
export const FONT_SIZE_MIN = 12;
/** Largest accepted content font size (px). */
export const FONT_SIZE_MAX = 17;
/** Content font size when the user-settings document has no override (px). */
export const DEFAULT_FONT_SIZE = 14;
/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema = z.object({
    [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
    [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
});
/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value) {
    return THEME_PREFERENCES.some(preference => preference === value);
}
