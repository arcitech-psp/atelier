/**
 * Activity panel: the subagents this chat creates and uses, one card each,
 * with measurable per-worker state.
 *
 * Scope: workers only. The lead's own state already has the composer context
 * ring and the status line, so repeating it here would be a summary the panel
 * does not need.
 *
 * Honesty rules this panel keeps:
 * - Decode counters are server-wide for that worker's resolved model route,
 *   not attributed to one chat. They resolve while the worker is resident,
 *   which is exactly while it runs.
 * - Unavailable is never drawn as zero. A missing reading shows an em dash and
 *   leaves the meter at rest.
 * - Context occupancy appears only when the session store already carries that
 *   child's projection; it is never estimated.
 */
import type { ReactNode } from 'react';
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ComposerBarProps } from '../contract/slots.ts';
import { contextOccupancy } from '../context-occupancy.ts';
/** One subagent the panel draws. */
interface WorkerRow {
    readonly id: SessionId;
    readonly name: string;
    readonly mode: 'one-shot' | 'continuable';
    readonly status: 'running' | 'done' | 'idle';
    readonly updatedAt: number | undefined;
    readonly context: ReturnType<typeof contextOccupancy>;
}
export interface ActivityPanelProps {
    sessionId: SessionId;
    sessions: SessionListState;
    open: boolean;
    onClose: () => void;
    t: ComposerBarProps['t'];
    /** Helper availability supplied by the session shell, where the slot renderer lives. */
    helpers?: ReactNode;
    /** The width the user dragged this panel to. */
    width?: number;
}
/**
 * Build one row per direct subagent of this chat, in durable catalog order.
 * @param sessionId - the lead session whose catalog is read.
 * @param sessions - session list state carrying the durable subagent catalog.
 * @returns the worker rows, empty until the lead delegates.
 */
export declare function workerRows(sessionId: SessionId, sessions: SessionListState): readonly WorkerRow[];
/**
 * Renders the Activity side panel listing this chat's subagents.
 * @param props - lead identity, session store, open state, close action, locale.
 * @returns the panel section, kept mounted and hidden while closed.
 */
export declare function ActivityPanel({ sessionId, sessions, open, onClose, t, helpers, width }: ActivityPanelProps): import("react").JSX.Element;
export {};
