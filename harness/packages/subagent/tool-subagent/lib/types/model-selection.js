/** Child LLM route selection for the subagent tool. */
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
/** Schema shared by the Host setting and its deployment base. */
export const AllowedModelRouteSchema = z.object({
    provider: z.string().min(1).required(),
    model: z.string().min(1).required(),
});
/**
 * Stable identity for one provider/model pair.
 * @param route - Exact provider/model route.
 * @returns Opaque key for equality checks.
 */
export function modelRouteKey(route) {
    return `${route.provider}\0${route.model}`;
}
/**
 * Reject malformed or duplicate route policy entries at a durable or configuration boundary.
 * @param routes - Candidate exact routes to validate.
 * @returns an assertion that the candidate is a validated exact-route array.
 */
export function assertAllowedModelRoutes(routes) {
    if (!Array.isArray(routes)) {
        throw new Error('subagent model selection requires an array of routes');
    }
    const seen = new Set();
    const candidates = routes;
    for (const candidate of candidates) {
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)
            || !('provider' in candidate) || typeof candidate.provider !== 'string'
            || !('model' in candidate) || typeof candidate.model !== 'string'
            || candidate.provider.length === 0 || candidate.model.length === 0) {
            throw new Error('subagent model selection requires non-empty provider and model ids');
        }
        const route = { provider: candidate.provider, model: candidate.model };
        const key = modelRouteKey(route);
        if (seen.has(key)) {
            throw new Error(`subagent model selection repeats route "${route.provider}/${route.model}"`);
        }
        seen.add(key);
    }
}
/**
 * Whether a call explicitly selects any child LLM value.
 * @param request - Model-facing route fields from the tool call.
 * @returns Whether at least one route or effort field is present.
 */
export function hasDelegationModelRequest(request) {
    return request.provider !== undefined
        || request.model !== undefined
        || request.reasoning_effort !== undefined;
}
/** Reject an empty model-facing route value at the tool JSON boundary. */
function assertNonEmpty(value, field) {
    if (value !== undefined && value.length === 0) {
        throw new Error(`child LLM \`${field}\` must be non-empty`);
    }
}
/**
 * Merge model-supplied selection fields over configured child defaults.
 * Provider and model form one route and must be supplied together. Changing
 * that route without an effort clears the configured route-owned effort.
 * @param parentOptions - Current parent values that supply missing child values.
 * @param configured - Tool-instance child defaults.
 * @param request - Model-facing route override.
 * @param enabled - Whether this tool instance permits model-facing selection.
 * @returns Child Agent options, preserving omission when no layer contributes one.
 */
export function requestedAgentOptions(parentOptions, configured, request, enabled) {
    if (!hasDelegationModelRequest(request))
        return configured;
    if (!enabled) {
        throw new Error('child model selection is disabled for this tool instance');
    }
    assertNonEmpty(request.provider, 'provider');
    assertNonEmpty(request.model, 'model');
    assertNonEmpty(request.reasoning_effort, 'reasoning_effort');
    if ((request.provider === undefined) !== (request.model === undefined)) {
        throw new Error('child LLM `provider` and `model` must be supplied together');
    }
    const baselineProvider = configured?.provider ?? parentOptions.provider;
    const baselineModel = configured?.model ?? parentOptions.model;
    const routeChanged = request.provider !== undefined
        && (request.provider !== baselineProvider || request.model !== baselineModel);
    const { reasoningEffort: _configuredReasoningEffort, ...configuredWithoutReasoning } = configured ?? {};
    return {
        ...routeChanged && request.reasoning_effort === undefined ? configuredWithoutReasoning : configured,
        ...request.provider === undefined ? {} : { provider: request.provider, model: request.model },
        ...request.reasoning_effort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(request.reasoning_effort) },
    };
}
/**
 * Enforce a settings-owned route list at the operation that creates the child.
 * Pure inheritance remains outside this policy because no model-facing choice
 * occurred; any explicit route or effort field must resolve to an allowed route.
 * @param policy - Selection authority captured for this Session.
 * @param parentOptions - Current parent values that supply missing child values.
 * @param requested - Effective child options after request/config merging.
 * @param request - Model-facing selection fields from the tool call.
 */
export function assertAllowedModelSelection(policy, parentOptions, requested, request) {
    if (policy === undefined || !hasDelegationModelRequest(request))
        return;
    const provider = requested?.provider ?? parentOptions.provider;
    const model = requested?.model ?? parentOptions.model;
    if (provider === undefined || model === undefined) {
        throw new Error('cannot select child LLM values without an effective provider and model');
    }
    if (policy.routes.some(route => route.provider === provider && route.model === model))
        return;
    throw new Error(`child LLM route "${provider}/${model}" is not allowed for this Session`);
}
/**
 * Whether configured Agent options require route validation before delegation.
 * @param options - Tool-instance child defaults.
 * @returns Whether configured provider, model, or effort values must be resolved.
 */
export function hasConfiguredLlmSelection(options) {
    return options?.provider !== undefined
        || options?.model !== undefined
        || options?.reasoningEffort !== undefined;
}
/**
 * Resolve an effective child route through its live adapter before the child is
 * created. The LLM runtime owns provider lookup, exact-model metadata, effort
 * validation, and adapter defaults.
 * @param llm - Live LLM runtime.
 * @param parentOptions - Current parent values whose compatible fields the child inherits.
 * @param requested - Per-child options after request/config merging.
 * @param signal - Tool-call cancellation signal.
 * @param inheritParentReasoningEffort - Whether an omitted effort may inherit from the parent route.
 */
export async function preflightChildLlmRoute(llm, parentOptions, requested, signal, inheritParentReasoningEffort = true) {
    const provider = requested?.provider ?? parentOptions.provider;
    const model = requested?.model ?? parentOptions.model;
    if (provider === undefined || model === undefined) {
        throw new Error('cannot select child LLM values without an effective provider and model');
    }
    const routeChanged = provider !== parentOptions.provider || model !== parentOptions.model;
    const reasoningEffort = requested?.reasoningEffort
        ?? (inheritParentReasoningEffort && !routeChanged ? parentOptions.reasoningEffort : undefined);
    await llm.resolveCallConfig({
        provider,
        model,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
    }, signal);
}
