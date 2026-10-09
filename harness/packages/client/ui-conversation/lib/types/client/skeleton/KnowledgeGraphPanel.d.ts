/** Optional reference-only Knowledge Graph side panel. The old preview looked bad; reuse the settled graph view here. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { KnowledgeGraphTransport } from '../contract/knowledge-graph.ts';
export interface KnowledgeGraphPanelProps extends PropsLocale<'conversation'> {
    /** Whether the panel is in the side rail. */
    open: boolean;
    /** Close the panel and return focus to its header toggle. */
    onClose: () => void;
    /** Apply-layer loader and cancellation capability. */
    transport: KnowledgeGraphTransport | undefined;
    /** Bounded shell width in pixels. */
    width: number;
}
/**
  * Keep the compact shell in React and let the shared graphify renderer own graph interaction.
 * @param props - transport, close action, and locale shares.
 * @returns the mounted Knowledge Graph side panel.
 */
export declare function KnowledgeGraphPanel({ open, onClose, transport, width, t }: KnowledgeGraphPanelProps): import("react").JSX.Element;
