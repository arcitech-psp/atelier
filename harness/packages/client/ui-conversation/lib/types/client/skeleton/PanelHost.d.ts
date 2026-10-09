/** Shared side-panel chrome: pop-out, tile, and close stay consistent across every panel slot. */
import type { ReactNode } from 'react';
import type { PanelDockId } from './panel-dock.ts';
export interface PanelHostProps {
    readonly id: PanelDockId;
    readonly title: string;
    readonly open: boolean;
    readonly tiled: boolean;
    readonly solo: boolean;
    readonly onToggleTile: () => void;
    readonly onClose: () => void;
    readonly children: ReactNode;
}
export declare function PanelHost({ id, title, open, tiled, solo, onToggleTile, onClose, children }: PanelHostProps): import("react").JSX.Element;
