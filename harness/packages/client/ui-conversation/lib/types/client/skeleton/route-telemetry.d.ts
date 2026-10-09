/** One agent's sampled serving state. */
export interface RouteTelemetry {
    /** Live generated-token rate, or null while unknown. Includes reasoning tokens. */
    tokensPerSecond: number | null;
    /** Trailing ~3s generated-token rate, or null while unknown. */
    rollingTokensPerSecond: number | null;
    /** Requests the resolved route reports as running. */
    running: number;
    /** Requests the resolved route reports as queued. */
    waiting: number;
    /** Human label for the resolved route, when the endpoint supplies one. */
    scope: string | undefined;
    /** False while the endpoint is unreachable or the counters are unsupported. */
    available: boolean;
}
/**
 * Poll one session's resolved model route while `enabled`.
 * @param sessionId - session whose recorded route is sampled.
 * @param enabled - false suspends polling entirely (panel closed).
 * @param intervalMs - sampling period; the server caches each route for 750ms.
 * @returns the latest reading, or an unavailable reading.
 */
export declare function useRouteTelemetry(sessionId: string | undefined, enabled: boolean, intervalMs?: number): RouteTelemetry;
