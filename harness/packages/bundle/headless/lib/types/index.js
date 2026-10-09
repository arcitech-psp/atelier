/**
 * @deepseek-ai/dsh-headless — one-shot direct Agent driver. The bundle patch
 * rides over dsh-base without Host, HTTP, or browser plugins; this runner
 * creates one Agent through the core registry, drives the task to quiescence,
 * streams provider reasoning to stderr, flushes its Session, prints the final
 * assistant text to stdout, and exits.
 *
 * @module @deepseek-ai/dsh-headless
 */
import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { assertNever, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
/** Stable Cordis plugin name. */
export const name = 'headless-runner';
/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions'];
export const Config = z.object({
    task: z.string().required(),
    maxTokens: z.number().step(1).min(1),
});
/** The process streams the runner writes to; tests substitute captures. */
export const internals = {
    stdout: process.stdout,
    stderr: process.stderr,
};
/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(events, firstSeq) {
    let started = false;
    let text = '';
    let reason;
    for (const event of events) {
        if (event.seq < firstSeq)
            continue;
        if (event.type === 'turn/start') {
            started = true;
            continue;
        }
        if (!started)
            continue;
        if (event.type === 'assistant/message') {
            const joined = event.data.message.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('');
            if (joined !== '')
                text = joined;
        }
        if (event.type === 'turn/end')
            reason = event.data.reason;
    }
    return { text, reason };
}
/**
 * Project provider-reported reasoning from one owned run to stderr as it is
 * appended, while keeping final outcome derivation on the durable log.
 * @param ctx - plugin context carrying the Session event feed.
 * @param agent - the exact Agent whose reasoning belongs to this invocation.
 * @param stderr - progress output sink.
 * @returns a disposer that also terminates an unterminated reasoning line.
 */
function streamReasoning(ctx, agent, stderr) {
    let started = false;
    let open = false;
    let endsWithNewline = true;
    const close = () => {
        if (!open)
            return;
        if (!endsWithNewline)
            stderr.write('\n');
        open = false;
        endsWithNewline = true;
    };
    const dispose = ctx.on('session/event', (session, event) => {
        if (session !== agent.session)
            return;
        if (event.type === 'turn/start') {
            close();
            started = true;
            return;
        }
        if (!started || event.type !== 'assistant/chunk')
            return;
        const chunk = event.data.chunk;
        switch (chunk.type) {
            case 'reasoning-delta':
                if (chunk.text === '')
                    return;
                if (!open) {
                    stderr.write('dsh: reasoning:\n');
                    open = true;
                }
                stderr.write(chunk.text);
                endsWithNewline = chunk.text.endsWith('\n');
                return;
            case 'block-start':
                if (chunk.blockType !== 'reasoning')
                    close();
                return;
            case 'block-end':
                if (chunk.block.type !== 'reasoning')
                    close();
                return;
            case 'usage':
                return;
            case 'text-delta':
            case 'tool-call-delta':
            case 'finish':
                close();
                return;
            /* v8 ignore next -- closed-union exhaustiveness guard */
            default:
                return assertNever(chunk, 'headless reasoning stream');
        }
    });
    return () => {
        dispose();
        close();
    };
}
/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io, error) {
    io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
    io.exit(1);
}
/**
 * Run one task through a freshly created Agent and request process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param task - one-shot task text.
 * @param io - process-facing effects.
 */
async function run(ctx, task, maxTokens, io) {
    // Loader siblings mount concurrently. Await the complete application before
    // creating an Agent so its scoped tools and adapters are not half-composed.
    await ctx.get('loader')?.await();
    const agents = ctx.get('agents');
    const defaultModel = ctx.get('agentDefaultModel');
    const sessions = ctx.get('sessions');
    // Early process shutdown can dispose the tree while settlement is pending.
    if (agents === undefined || defaultModel === undefined || sessions === undefined)
        return;
    const selection = defaultModel.currentSelection();
    // Headless uses the same per-session preset contract as Web. The optional
    // lookup keeps this bundle embeddable for compositions that intentionally do
    // not mount the roster; the standard DSH profile mounts it below.
    const presets = ctx.get('agentPresets');
    const preset = presets === undefined ? undefined : await presets.resolve();
    const { agent } = await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: {
            cwd: process.cwd(),
            ...preset === undefined ? {} : { agentPreset: preset.id },
        },
        agentOptions: {
            provider: selection.provider,
            model: selection.model,
            ...(maxTokens === undefined ? {} : { maxTokens }),
        },
        setup: async (agentCtx) => {
            const selected = { current: selection, assembled: undefined };
            installModelSelection(agentCtx, selected);
            if (presets !== undefined)
                await presets.mount(agentCtx, preset?.id);
        },
    });
    await agent.whenIdle();
    const firstSeq = agent.session.seq;
    const stopReasoning = streamReasoning(ctx, agent, io.stderr);
    try {
        agent.followup(createUserMessage({
            content: [{ type: 'text', text: task }],
            source: { kind: 'user' },
        }));
        await agent.whenIdle();
    }
    finally {
        stopReasoning();
    }
    await sessions.flush(agent.session);
    const outcome = summarize(agent.session.events, firstSeq);
    io.stdout.write(outcome.text + '\n');
    if (outcome.reason?.kind === 'error') {
        io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`);
    }
    io.exit(outcome.reason?.kind === 'completed' ? 0 : 1);
}
/**
 * Mount the one-shot direct driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task config.
 */
export function apply(ctx, config) {
    // Read through the global service store, not the property proxy: appExit is
    // an optional host value, never an injected dependency.
    const exit = ctx.get('appExit');
    if (exit === undefined) {
        throw new Error('headless-runner: the launcher must provide ctx.appExit before the tree mounts');
    }
    const io = { stdout: internals.stdout, stderr: internals.stderr, exit };
    void run(ctx, config.task, config.maxTokens, io).catch((error) => { fail(io, error); });
}
