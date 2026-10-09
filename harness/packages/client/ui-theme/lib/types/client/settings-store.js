/**
 * Appearance and font-size row slot stores: mirrors of the theme service
 * snapshot. The plugin's apply-world change listener is the only writer; the
 * row components read via props.useStore.
 */
import { defineStore } from '@deepseek-ai/dsh-client-store';
import { DEFAULT_FONT_SIZE } from "../theme-settings.js";
/**
 * Declares the Appearance row state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore() {
    return defineStore({
        init: () => ({ preference: 'system', revision: -1 }),
        actions: {
            sync: (d, preference, revision) => {
                if (revision <= d.revision)
                    return;
                d.preference = preference;
                d.revision = revision;
            },
        },
    });
}
/**
 * Declares the font-size row state and write surface.
 * @returns the store handle.
 */
export function createFontSizeRowStore() {
    return defineStore({
        init: () => ({ fontSize: DEFAULT_FONT_SIZE, revision: -1 }),
        actions: {
            sync: (d, fontSize, revision) => {
                if (revision <= d.revision)
                    return;
                d.fontSize = fontSize;
                d.revision = revision;
            },
        },
    });
}
