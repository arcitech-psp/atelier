/**
 * Default executor-less, UI-less agent spine. It bundles the common services,
 * background-job registry and controls, optional persisted goals, concrete loop, local skill and
 * agent-instructions providers, and model-facing shell/skill consumers;
 * deployments still choose the LLM adapter, bash executor, and presentation.
 * The plugin intentionally exposes named exports only because Loader default
 * unwrapping would discard its `Config` schema (see docs/postmortem/0001).
 * @module @deepseek-ai/dsh-agent-spine-demo
 */
import Timer from '@deepseek-ai/cordis-plugin-timer';
import z from '@deepseek-ai/schemastery';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SessionStore from '@deepseek-ai/dsh-session';
import SessionTitleService from '@deepseek-ai/dsh-session-title';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import GoalService from '@deepseek-ai/dsh-goal';
import * as goalSession from '@deepseek-ai/dsh-goal-round-driver';
import * as toolGoal from '@deepseek-ai/dsh-tool-goal';
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local';
import InvariantRegistry from '@deepseek-ai/dsh-invariants';
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant';
import * as agentInvariant from '@deepseek-ai/dsh-agent/invariant';
import * as scopeInvariant from '@deepseek-ai/dsh-scope/invariant';
import * as agentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant';
import * as toolBash from '@deepseek-ai/dsh-tool-bash';
import * as bashEnv from '@deepseek-ai/dsh-shell-env';
import * as workspaceContext from '@deepseek-ai/dsh-agent-instructions';
import * as toolSkill from '@deepseek-ai/dsh-tool-skill';
import * as toolJobs from '@deepseek-ai/dsh-tool-jobs';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import * as llmRetry from '@deepseek-ai/dsh-llm-retry';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
export const name = 'agent-spine-demo';
/** Overridable example policy used when a bundle consumer omits `sessionTitle`. */
const EXAMPLE_SESSION_TITLE_CONFIG = {
    fallbackMaxWords: 5,
    fallbackMaxBytes: 40,
    maxTitleBytes: 80,
};
/** The skill config schema exported for app packages that forward `skills`. */
export const SkillConfigSchema = z.object({
    enabled: z.boolean().default(true),
    registry: SkillRegistry.Config,
    filesystem: SkillFileSystem.Config,
    tool: toolSkill.Config,
});
/** The session-title config schema with the shared bundle's overridable example limits. */
export const SessionTitleConfigSchema = SessionTitleService.Config
    .default(EXAMPLE_SESSION_TITLE_CONFIG);
/** The bash-tool config schema exported for app packages that forward `toolBash`. */
export const ToolBashConfigSchema = z.union([z.const(false), toolBash.Config]);
/** The process-local job registry schema exported for app packages that forward `jobs`. */
export const JobsConfigSchema = LocalJobRegistry.Config;
/** The job-control-tool config schema exported for app packages that forward `toolJobs`. */
export const ToolJobsConfigSchema = toolJobs.Config;
/** The persisted-goal config schema exported for app packages that opt in. */
export const GoalConfigSchema = z.object({
    domain: GoalService.Config,
    tool: toolGoal.Config,
});
/** Intersect the owners' schemas so validation + defaulting stay identical. */
export const Config = z.intersect([
    AgentLoop.Config,
    SystemPrompt.Config,
    z.object({
        tools: ToolRuntime.Config,
        dshHome: z.string(),
        sessionTitle: SessionTitleConfigSchema,
        skills: SkillConfigSchema,
        workspaceContext: z.union([z.const(false), workspaceContext.Config]).required(),
        toolBash: ToolBashConfigSchema,
        jobs: JobsConfigSchema,
        toolJobs: z.union([z.const(false), ToolJobsConfigSchema]),
        invariants: InvariantRegistry.Config,
        goals: z.union([z.const(false), GoalConfigSchema]),
    }),
]);
/**
 * Copy the bundle-owned fields from an app config without leaking entry-point settings.
 * @param config - App config containing the shared spine fields.
 * @returns The fields accepted by this bundle, preserving optional absence.
 */
export function pickSpineConfig(config) {
    return {
        ...config.maxParallelToolCalls !== undefined ? { maxParallelToolCalls: config.maxParallelToolCalls } : {},
        ...config.includeHarnessIdentity !== undefined ? { includeHarnessIdentity: config.includeHarnessIdentity } : {},
        ...config.includeRuntimeContext !== undefined ? { includeRuntimeContext: config.includeRuntimeContext } : {},
        ...config.persona !== undefined ? { persona: config.persona } : {},
        ...config.toolOrder !== undefined ? { toolOrder: config.toolOrder } : {},
        ...config.tools !== undefined ? { tools: config.tools } : {},
        ...config.dshHome !== undefined ? { dshHome: config.dshHome } : {},
        ...config.sessionTitle !== undefined ? { sessionTitle: config.sessionTitle } : {},
        workspaceContext: config.workspaceContext,
        ...config.skills !== undefined ? { skills: config.skills } : {},
        ...config.toolBash !== undefined ? { toolBash: config.toolBash } : {},
        ...config.jobs !== undefined ? { jobs: config.jobs } : {},
        ...config.toolJobs !== undefined ? { toolJobs: config.toolJobs } : {},
        ...config.invariants !== undefined ? { invariants: config.invariants } : {},
        ...config.goals !== undefined ? { goals: config.goals } : {},
    };
}
/**
 * Load the spine. Each `ctx.plugin(...)` mounts one child of the bundle fiber;
 * `agent-loop` receives the forwarded `agents` list and `system-prompt` the
 * forwarded persona fields and `toolOrder`. Workspace-context receives its own
 * explicitly forwarded config. Load order is irrelevant (cordis
 * pends each fiber on its `inject` until the services it needs exist), but the
 * listing mirrors the dependency layering for readability: the LLM vocabulary
 * and core registries first, then extension plugins that wrap request/tool
 * seams, then the loop that drives them.
 */
export function apply(ctx, config) {
    const nestedDshHome = config.skills?.filesystem?.dshHome;
    if (config.dshHome !== undefined && nestedDshHome !== undefined
        && resolveDshHome(config.dshHome) !== resolveDshHome(nestedDshHome)) {
        throw new Error('agent-spine-demo: dshHome and skills.filesystem.dshHome must resolve to the same directory');
    }
    const dshHome = resolveDshHome(config.dshHome ?? nestedDshHome);
    ctx.plugin(Timer);
    ctx.plugin(LlmRuntime);
    ctx.plugin(SessionStore);
    ctx.plugin(SessionTitleService, config.sessionTitle ?? EXAMPLE_SESSION_TITLE_CONFIG);
    // Owner schemas resolve defaults; forward toolOrder only when explicitly set.
    ctx.plugin(SystemPrompt, {
        includeHarnessIdentity: config.includeHarnessIdentity ?? true,
        includeRuntimeContext: config.includeRuntimeContext ?? true,
        persona: config.persona ?? '',
        ...config.toolOrder !== undefined ? { toolOrder: config.toolOrder } : {},
    });
    ctx.plugin(ToolRuntime, config.tools ?? {});
    const skillsEnabled = config.skills?.enabled ?? true;
    if (skillsEnabled) {
        ctx.plugin(SkillRegistry, config.skills?.registry ?? {});
        ctx.plugin(SkillFileSystem, Object.assign({}, config.skills?.filesystem, { dshHome }));
    }
    ctx.plugin(AgentRegistry);
    ctx.plugin(llmRetry);
    if (config.goals !== undefined && config.goals !== false) {
        ctx.plugin(GoalService, config.goals.domain ?? {});
        ctx.plugin(toolGoal, config.goals.tool ?? {});
        ctx.plugin(goalSession);
    }
    ctx.plugin(LocalJobRegistry, config.jobs ?? {});
    ctx.plugin(InvariantRegistry, config.invariants ?? {});
    ctx.plugin(sessionInvariant);
    ctx.plugin(agentInvariant);
    ctx.plugin(scopeInvariant);
    ctx.plugin(agentLoopInvariant);
    if (config.toolBash !== false) {
        ctx.plugin(bashEnv, { dshHome });
        ctx.plugin(toolBash, config.toolBash ?? {});
    }
    if (config.workspaceContext !== false) {
        ctx.plugin(workspaceContext, config.workspaceContext);
    }
    // Both plugins prepend session-prefix messages. Registration order is the
    // rendered order, so workspace instructions must precede the skill catalog.
    if (skillsEnabled)
        ctx.plugin(toolSkill, config.skills?.tool ?? {});
    if (config.toolJobs !== false)
        ctx.plugin(toolJobs, config.toolJobs ?? {});
    ctx.plugin(AgentLoop, {
        agents: config.agents ?? [],
        ...config.maxParallelToolCalls !== undefined ? { maxParallelToolCalls: config.maxParallelToolCalls } : {},
    });
}
