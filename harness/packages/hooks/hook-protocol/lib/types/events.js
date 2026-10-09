/**
 * Append helpers for durable, log-only hook events. They carry no surface
 * intent and must remain turn-enclosed and invoked/result paired. Mid-turn hook
 * points satisfy that boundary; SessionStart records injected context instead
 * and does not append `hook/*` outside a turn.
 * @module @deepseek-ai/dsh-hook-protocol/events
 */
/**
 * The reference default for {@link HookResultRecord.stderrSummaryMaxChars}
 * (both bridges' config default). It lives here, once, next to the truncation
 * rule it bounds, so the bridges cannot drift apart on the shared event's
 * default cap.
 */
export const DEFAULT_STDERR_SUMMARY_MAX_CHARS = 500;
/**
 * Truncate a hook's stderr for {@link HookResultRecord.stderrSummary}: trimmed,
 * `undefined` when empty, cut at `maxChars` with an ellipsis when over. The
 * bound is a parameter — like `runHook`'s `defaultTimeoutMs`, each bridge owns
 * the config default and passes it in.
 * @param stderr - the hook's raw captured stderr.
 * @param maxChars - the character cap for the summary (the bridge's config value).
 * @returns the trimmed, capped summary, or `undefined` when stderr is blank.
 */
export function summarizeStderr(stderr, maxChars) {
    const t = stderr.trim();
    if (t.length === 0)
        return undefined;
    return t.length > maxChars ? t.slice(0, maxChars) + '…' : t;
}
/**
 * Append a `hook/invoked` event naming the handler and hook point to `session`.
 * @param session - the session whose open turn records the event.
 * @param invocation - the invocation identity; an absent `matcher` is omitted from the payload.
 */
export function appendHookInvoked(session, invocation) {
    session.append('hook/invoked', {
        turn: invocation.turn,
        point: invocation.point,
        dialect: invocation.dialect,
        handlerId: invocation.handlerId,
        ...invocation.matcher !== undefined ? { matcher: invocation.matcher } : {},
    });
}
/**
 * Append the durable result paired with `hook/invoked`. The recorded decision
 * is the parsed decision, then `stop` for `continue:false`, else `pass`; stderr
 * is trimmed and capped, and an absent process exit stays omitted.
 * @param session - the session whose open turn records the event.
 * @param record - the outcome to record: the decoded output plus the summary cap and duration.
 */
export function appendHookResult(session, record) {
    const { output } = record;
    const stderrSummary = summarizeStderr(output.stderr, record.stderrSummaryMaxChars);
    session.append('hook/result', {
        turn: record.turn,
        point: record.point,
        handlerId: record.handlerId,
        decision: output.decision ?? (output.continue === false ? 'stop' : 'pass'),
        ...output.exitCode !== undefined ? { exitCode: output.exitCode } : {},
        ...stderrSummary !== undefined ? { stderrSummary } : {},
        durationMs: record.durationMs,
    });
}
