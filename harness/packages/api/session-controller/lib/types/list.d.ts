/** Cold-safe Session list and search projection. */
import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { SessionListMetadata, SessionSearchValue, SessionSummary } from './types.ts';
/** Default maximum artifact size eligible for one cold projection observation. */
export declare const DEFAULT_COLD_BLANK_PROBE_MAX_BYTES = 1024;
/**
 * Advance the Session-list metadata projection by one committed event.
 * @param state - metadata before the event.
 * @param event - next committed Session event.
 * @returns the original or advanced metadata value.
 */
export declare function applySessionListMetadata(state: SessionListMetadata, event: SessionEvent): SessionListMetadata;
/**
 * Return the longest prefix containing at most `maximum` Unicode code points.
 * @param value - source text.
 * @param maximum - maximum number of Unicode code points.
 * @returns the source text or its longest allowed prefix.
 */
export declare function truncateUnicodeCodePoints(value: string, maximum: number): string;
/** Owns list projection registration, bounded cold summaries, and authorized search. */
export declare class ApiSessionList {
    private readonly ctx;
    private readonly coldBlankProbeMaxBytes;
    private cachedItems;
    private readonly coldSummaryCache;
    /**
     * @param ctx - Host context carrying Session, query, persistence, and projection services.
     * @param coldBlankProbeMaxBytes - maximum physical artifact size eligible for a full observation.
     */
    constructor(ctx: Context, coldBlankProbeMaxBytes: number);
    /**
     * Build one current attached-Session summary.
     * @param session - attached Session to summarize.
     * @returns current list metadata and available projections.
     */
    summaryFor(session: Session): SessionSummary;
    /**
     * Read renderable attached and persisted Sessions without activating an Agent.
     * Blank and archived rows are omitted except for the selected Session;
     * subagent rows use their parent's catalog and are never top-level rows.
     * Stable results are reused until a Session or Agent event changes a summary.
     * @param currentSessionId - optional selected blank row to retain.
     * @param signal - optional cancellation for persistence reads.
     * @returns visible Session summaries ordered by activity.
     */
    list(currentSessionId?: SessionId, signal?: AbortSignal): Promise<SessionSummary[]>;
    private summarizeCold;
    private coldSummary;
    private probeSmallCold;
    /**
     * Search current visible message content without activating any matching Session.
     * @param query - literal message-content query.
     * @param signal - cancellation for list and search reads.
     * @returns authorized bounded Session search results.
     */
    search(query: string, signal: AbortSignal): Promise<SessionSearchValue>;
    private projectionsFor;
}
