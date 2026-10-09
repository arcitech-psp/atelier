/**
 * Execute command hooks through `ctx.shell`, using its credential scrub,
 * process-group cancellation, and timeout machinery. The bridge supplies the
 * trusted stdin payload and dialect environment, then this module decodes the
 * captured outcome.
 * @module @deepseek-ai/dsh-hook-protocol/runner
 */
import { parseHookOutput } from "./codec.js";
/**
 * The reference default per-hook timeout, in ms (10 minutes) — the value both
 * Claude Code and Codex apply to a hook whose config sets no `timeout`. It
 * lives here, once, as the protocol's default; the bridges' `defaultTimeoutMs`
 * config defaults to it, and a per-hook {@link CommandHook.timeoutSec} is the
 * override API.
 */
export const DEFAULT_HOOK_TIMEOUT_MS = 600_000;
/**
 * Run `hook` with serialized stdin and decode its outcome. A hook-specific
 * timeout in seconds overrides the default; trusted environment entries merge
 * after the executor scrub. Infrastructure rejection becomes an outcome with
 * no exit code, so this function never throws or crashes the calling turn.
 * @param bash - The executor service the command runs through.
 * @param hook - the configured command; its `timeoutSec` (wire unit: seconds) overrides the default timeout.
 * @param options - the invocation's payload, env, cwd, signal, stdin framing, and default timeout.
 * @param now - millisecond clock used for the reported duration.
 * @returns the decoded output plus the run's wall-clock duration.
 */
export async function runHook(bash, hook, options, now) {
    const started = now();
    const timeoutMs = hook.timeoutSec !== undefined ? hook.timeoutSec * 1000 : options.defaultTimeoutMs;
    const stdin = JSON.stringify(options.payload) + (options.trailingNewline ? '\n' : '');
    const request = {
        command: hook.command,
        timeoutMs,
        stdin,
        signal: options.signal,
        ...options.cwd !== undefined ? { workdir: options.cwd } : {},
        ...options.env !== undefined ? { env: options.env } : {},
    };
    try {
        const result = await bash.run(bash.resolve(request));
        // ShellRunResult.exitCode is `number | null` (null = died by signal); the
        // protocol's exit-code contract is numeric, so a signal death maps to
        // `undefined` (a non-blocking error — no clean exit code to act on).
        const exitCode = result.exitCode ?? undefined;
        return {
            output: parseHookOutput(exitCode, result.stdout.text, result.stderr.text, options.expectedEventName),
            durationMs: now() - started,
        };
    }
    catch (error) {
        // The executor rejects only on infrastructure faults (unusable workdir,
        // missing shell). A hook that cannot run is a non-blocking error: no exit
        // code, the failure on stderr for the record. The turn proceeds.
        const message = error instanceof Error ? error.message : String(error);
        return {
            output: parseHookOutput(undefined, '', message),
            durationMs: now() - started,
        };
    }
}
