/**
 * Shared, non-plugin hook protocol library: matching, command execution and
 * decoding, restrictive outcome merging, durable event helpers, and detached
 * run quiescence. Claude Code and Codex bridges own their distinct payloads,
 * environment rules, matcher mode, and typed extension-point mappings.
 * @module @deepseek-ai/dsh-hook-protocol
 */
export { matcherDiagnostic, matchesMatcher } from "./matcher.js";
export { parseHookOutput } from "./codec.js";
export { DEFAULT_HOOK_TIMEOUT_MS, runHook } from "./runner.js";
export { mergeHookOutputs } from "./merge.js";
export { appendHookInvoked, appendHookResult, DEFAULT_STDERR_SUMMARY_MAX_CHARS, summarizeStderr } from "./events.js";
export { createDetachedRuns } from "./detached.js";
