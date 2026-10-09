/** Matches the panel's CSS basis, so an unset preference changes nothing. */
export declare const ACTIVITY_PANEL_DEFAULT_WIDTH = 300;
export declare const ACTIVITY_PANEL_MIN_WIDTH = 264;
/** The width the user dragged this panel to, or null when they have not set one. */
export declare function useActivityPanelWidth(): number | null;
/** Persist a dragged width; null restores the default. */
export declare function setActivityPanelWidth(width: number | null): void;
/** Read the current Activity panel preference in a React component. */
export declare function useActivityPanelOpen(): boolean;
/** Persist and publish the Activity panel preference. */
export declare function setActivityPanelOpen(open: boolean): void;
