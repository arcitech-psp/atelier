/**
 * Bridge for unmodified Codex command hooks on harness interception points. It
 * supports five points (SessionStart, prompt/tool pre/post, Stop), regex-only
 * matchers, snake_case payloads without a trailing newline, no hook environment
 * or command substitution, and no pre-tool approval or rewrite path; only
 * blocking decisions are honored. Shared execution and parsing live in
 * `dsh-hook-protocol`; see the
 * [hook-bridges Agent Note](../../../../.agents/notes/implemented/feature/2026-06-30-hook-bridges.md).
 * @module @deepseek-ai/dsh-hooks-codex
 */
// Each dialect bridge keeps its complete dependency list visible at the entry
// point; a cross-package facade for imports alone would add indirection.
/* jscpd:ignore-start */
import { readFileSync } from 'node:fs';
import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { appendHookInvoked, appendHookResult, createDetachedRuns, DEFAULT_HOOK_TIMEOUT_MS, DEFAULT_STDERR_SUMMARY_MAX_CHARS, matchesMatcher, mergeHookOutputs, runHook, } from '@deepseek-ai/dsh-hook-protocol';
import { parseCodexConfig } from "./config.js";
/* jscpd:ignore-end */
export const name = 'hooks-codex';
export const inject = ['shell'];
export const Config = z.object({
    configPath: z.string().required(),
    model: z.string().default(''),
    defaultTimeoutMs: z.number().default(DEFAULT_HOOK_TIMEOUT_MS),
    stderrSummaryMaxChars: z.number().default(DEFAULT_STDERR_SUMMARY_MAX_CHARS),
});
let handlerCounter = 0;
function nextHandlerId(point) {
    return `codex:${point}:${++handlerCounter}`;
}
const PLUGIN_SOURCE = { kind: 'plugin', plugin: 'hooks-codex' };
/** The summary cap bounds a persisted event field — a positive integer or the slice misbehaves silently. */
function assertPositiveInteger(name, value) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`hooks-codex: ${name} must be a positive integer`);
    }
}
export function apply(ctx, config) {
    // Validate before config parsing so a bad value cannot be hidden by its early return.
    const stderrSummaryMaxChars = config.stderrSummaryMaxChars ?? DEFAULT_STDERR_SUMMARY_MAX_CHARS;
    assertPositiveInteger('stderrSummaryMaxChars', stderrSummaryMaxChars);
    const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
    let parsed = {};
    try {
        const raw = JSON.parse(readFileSync(config.configPath, 'utf8'));
        const result = parseCodexConfig(raw);
        parsed = result.config;
        for (const s of result.skipped) {
            ctx.logger.warn(`hooks-codex: skipping ${s.reason} on ${s.event} (only sync command hooks run)`);
        }
    }
    catch (error) {
        ctx.logger.warn(`hooks-codex: could not load hook config "${config.configPath}": ${String(error)} — no hooks registered`);
        return;
    }
    const model = config.model ?? '';
    // SessionStart is the one emit-shaped (detached) point Codex has: track its
    // run chains so disposal aborts a still-running hook process and drains the
    // continuation (docs/defensive-patterns.md: dispose must reach quiescence).
    const detached = createDetachedRuns();
    ctx.effect(() => () => detached.drain(), 'hooks-codex: drain detached hook runs');
    /**
     * Run and fold one configured Codex hook point.
     *
     * A supplied turn records the hook invocation/result pair inside that open turn.
     * Detached lifecycle points omit it.
     */
    async function runPoint(point, matchQuery, payload, opts) {
        const groups = parsed[point] ?? [];
        const outputs = [];
        // Run hooks in the agent's session workspace so relative paths address the
        // user's project rather than the server launch directory.
        const workdir = opts.agent?.session.header.cwd;
        for (const group of groups) {
            // Codex always interprets matchers as regexes; it has no literal fast path.
            if (!matchesMatcher(group.matcher, matchQuery, 'codex'))
                continue;
            for (const hook of group.hooks) {
                const handlerId = nextHandlerId(point);
                const session = opts.agent?.session;
                if (session && opts.turn !== undefined) {
                    appendHookInvoked(session, {
                        turn: opts.turn, point, dialect: 'codex', handlerId,
                        ...group.matcher !== undefined ? { matcher: group.matcher } : {},
                    });
                }
                const { output, durationMs } = await runHook(ctx.shell, hook, {
                    payload,
                    defaultTimeoutMs,
                    ...workdir !== undefined ? { cwd: workdir } : {},
                    signal: opts.signal,
                    trailingNewline: false, // Codex writes stdin without a trailing newline.
                    // Discard a `hookSpecificOutput` block naming a different event.
                    expectedEventName: point,
                }, () => performance.now());
                // Clean plain stdout becomes context only when no structured context
                // exists; nonzero output and raw JSON never leak as prose.
                if (opts.plainStdoutAsContext === true && output.exitCode === 0
                    && output.additionalContext === undefined
                    && output.stdout.length > 0 && !output.stdout.startsWith('{')) {
                    output.additionalContext = output.stdout;
                }
                outputs.push(output);
                // Execution and decision mapping remain in each bridge so dialect
                // differences stay explicit at their owning extension point.
                /* jscpd:ignore-start */
                if (output.systemMessage !== undefined) {
                    ctx.logger.warn(`hooks-codex: ${point} hook emitted a systemMessage, which is not yet surfaced (ignored)`);
                }
                if (session && opts.turn !== undefined) {
                    appendHookResult(session, { turn: opts.turn, point, handlerId, output, stderrSummaryMaxChars, durationMs });
                }
            }
        }
        return mergeHookOutputs(outputs);
    }
    // TODO(hook-continue-false): `merged.stop` is logged but needs a run-level halt mechanism.
    function contextFrom(merged) {
        if (merged.additionalContext.length === 0)
            return undefined;
        const content = merged.additionalContext.map(text => ({ type: 'text', text }));
        return createUserMessage({ content, source: PLUGIN_SOURCE });
    }
    /** Prepend one context without flattening source fields or other downstream metadata. */
    function prependContext(ours, theirs) {
        return [ours, ...theirs ?? []];
    }
    // SessionStart injects plain stdout when its detached hook resolves; a slow
    // hook may miss the first request.
    // TODO(session-start-gating): add a startup gate before promising first-turn delivery.
    ctx.on('agent/session-start', ({ agent, source }) => {
        detached.track(runPoint('SessionStart', source, { ...base(ctx, agent, 'SessionStart', model), source }, { agent, plainStdoutAsContext: true, signal: detached.signal })
            .then((merged) => {
            const context = contextFrom(merged);
            if (context)
                agent.inject(context);
        })
            .catch((error) => { ctx.logger.warn(`hooks-codex: SessionStart hook failed: ${String(error)}`); }));
        /* jscpd:ignore-end */
    });
    // UserPromptSubmit → PreStepDecision. Codex supports reject, not rewrite or ask.
    ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next) => {
        if (messages.length === 0)
            return next();
        const payload = {
            ...base(ctx, agent, 'UserPromptSubmit', model),
            turn_id: String(turn),
            prompt: blocksToText(messages.flatMap(message => message.content)),
        };
        const merged = await runPoint('UserPromptSubmit', '', payload, {
            agent, turn, plainStdoutAsContext: true, signal,
        });
        /* jscpd:ignore-start */
        if (merged.decision === 'deny') {
            return { kind: 'reject' };
        }
        // Context alone is not a veto: DELEGATE so a later pre-step listener can
        // still reject/rewrite, then fold our context onto its decision.
        const downstream = await next();
        const ours = contextFrom(merged);
        if (!ours || downstream.kind !== 'enter')
            return downstream;
        return {
            ...downstream,
            messages: [...downstream.messages, ours],
        };
    });
    // PreToolUse → PreToolDecision. Codex blocks only (no allow/ask honored).
    ctx.on('tools/pre-execute', async (exec, next) => {
        const turn = lastTurn(exec.agent);
        const merged = await runPoint('PreToolUse', exec.name, preToolPayload(ctx, exec, model), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal });
        /* jscpd:ignore-end */
        if (merged.decision === 'deny')
            return { kind: 'deny', reason: merged.reason ?? 'blocked by PreToolUse hook' };
        return next();
    });
    // PostToolUse → PostToolDecision (block with feedback, or attach context).
    ctx.on('tools/post-execute', async (exec, result, next) => {
        const turn = lastTurn(exec.agent);
        /* jscpd:ignore-start */
        const merged = await runPoint('PostToolUse', exec.name, postToolPayload(ctx, exec, result, model), { ...exec.agent ? { agent: exec.agent } : {}, turn, signal: exec.signal });
        const context = contextFrom(merged);
        if (merged.decision === 'deny') {
            return { kind: 'block', feedback: [{ type: 'text', text: merged.reason ?? 'blocked by PostToolUse hook' }], ...context ? { additionalContexts: [context] } : {} };
        }
        // Context alone is not a veto: DELEGATE, then fold our context onto the
        // downstream decision (a downstream block carries it too).
        const downstream = await next();
        if (!context)
            return downstream;
        if (downstream.kind === 'block') {
            return { ...downstream, additionalContexts: prependContext(context, downstream.additionalContexts) };
        }
        return {
            ...downstream,
            additionalContexts: prependContext(context, downstream.additionalContexts),
        };
    });
    // A blocking Stop hook steers at the stopping boundary, which makes the
    // machine observe pending input and run another step.
    // TODO(stop-loop-guard): Codex supplies `stop_hook_active` so a Stop hook can
    // avoid continuing the same turn indefinitely. It is always false here, so an
    // unconditionally blocking hook force-continues every step until it self-limits.
    ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
        const merged = await runPoint('Stop', '', { ...turnBase(ctx, agent, 'Stop', model), stop_hook_active: false, last_assistant_message: null }, { agent, turn, signal });
        /* jscpd:ignore-end */
        if (merged.decision === 'deny') {
            // A blocking Stop hook forces continuation; a block with no reason (exit 2,
            // empty stderr) still forces it — fall back to a generic steering line
            // rather than letting the turn stop.
            const text = merged.reason ?? 'continue: blocked by Stop hook';
            agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }));
        }
    });
}
// --- Codex DIALECT payloads: snake_case, model on every event, turn_id on
// turn-scoped events. ---
// These small payload helpers intentionally remain next to the dialect shape;
// sharing them would pull bridge-only agent/LLM dependencies into hook-protocol.
/* jscpd:ignore-start */
function lastTurn(agent) {
    if (!agent)
        return 0;
    const last = [...agent.session.events].findLast(e => e.type === 'turn/start');
    /* v8 ignore next -- agent-present turnBase callers are tool/stop extension points inside an open turn. */
    return last?.type === 'turn/start' ? last.data.turn : 0;
}
function blocksToText(content) {
    return content.filter((b) => b.type === 'text').map(b => b.text).join('');
}
/* jscpd:ignore-end */
/** Base fields on every Codex payload (no turn_id). */
function base(ctx, agent, event, model) {
    return {
        session_id: agent?.session.header.id ?? '',
        transcript_path: agent === undefined
            ? null
            : ctx.get('sessionPersistence')?.locate(agent.session.header)?.path ?? null,
        cwd: agent?.session.header.cwd ?? process.cwd(),
        hook_event_name: event,
        model,
        permission_mode: 'default',
    };
}
/** Base + turn_id, for the turn-scoped events (PreToolUse/PostToolUse/UserPromptSubmit/Stop). */
function turnBase(ctx, agent, event, model) {
    return { ...base(ctx, agent, event, model), turn_id: String(lastTurn(agent)) };
}
/** Extract a `command` string from a tool call's parsed arguments, else ''. */
function commandOf(args) {
    if (typeof args === 'object' && args !== null && 'command' in args) {
        const command = args.command;
        if (typeof command === 'string')
            return command;
    }
    return '';
}
function preToolPayload(ctx, exec, model) {
    // `tool_name` is the REAL tool name (matching the `exec.name` matcher subject);
    // a hardcoded constant would disagree with what the matcher tests and make a
    // config's tool matcher never fire. `tool_input` keeps Codex's `{ command }`
    // shape (its shell payload), derived from the call's `command` arg when present.
    return { ...turnBase(ctx, exec.agent, 'PreToolUse', model), tool_name: exec.name, tool_input: { command: commandOf(exec.arguments) }, tool_use_id: exec.callId };
}
function postToolPayload(ctx, exec, result, model) {
    return { ...turnBase(ctx, exec.agent, 'PostToolUse', model), tool_name: exec.name, tool_input: { command: commandOf(exec.arguments) }, tool_use_id: exec.callId, tool_response: blocksToText(result.content) };
}
