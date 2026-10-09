/** Pure panel tiling state. Kept separate so persistence never decides layout during render. */
export declare const PANEL_DOCK_STORAGE_KEY = "dsh.conversation.panelDock";
export declare const PANEL_DOCK_MIN_SPLIT = 0.2;
export declare const PANEL_DOCK_MAX_SPLIT = 0.8;
export type PanelDockId = 'trajectory' | 'knowledge-graph' | 'side-panel' | 'activity';
export type PanelDockDirection = 'row' | 'column';
export interface PanelDockState {
    readonly tiles: readonly PanelDockId[];
    readonly split: number;
    readonly direction: PanelDockDirection;
}
export declare const DEFAULT_PANEL_DOCK_STATE: PanelDockState;
export declare function clampPanelDockSplit(value: number): number;
export declare function addPanelTile(state: PanelDockState, id: PanelDockId): PanelDockState;
export declare function removePanelTile(state: PanelDockState, id: PanelDockId): PanelDockState;
export declare function setPanelDockSplit(state: PanelDockState, value: number): PanelDockState;
export declare function parsePanelDockState(value: unknown): PanelDockState;
export declare function readPanelDockState(storage?: Pick<Storage, 'getItem'> | undefined): PanelDockState;
export declare function writePanelDockState(state: PanelDockState, storage?: Pick<Storage, 'setItem'> | undefined): void;
export declare function soloPanelId(search?: string): PanelDockId | undefined;
