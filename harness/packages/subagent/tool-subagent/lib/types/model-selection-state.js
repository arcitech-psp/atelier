/** Durable per-session state for the user-controlled model-selection opt-in. */
import { assertAllowedModelRoutes } from "./model-selection.js";
/**
 * Read the exact route list captured for a model-selectable definition.
 * @param session - session whose durable decision is read.
 * @returns a detached route list, or undefined for the fixed-route definition.
 */
export function subagentModelSelectionPolicy(session) {
    const event = session.events.find(candidate => candidate.type === 'subagent/model-selection-policy');
    if (event?.type !== 'subagent/model-selection-policy')
        return undefined;
    const { allowedModels } = event.data;
    assertAllowedModelRoutes(allowedModels);
    const routes = allowedModels.map(route => ({ ...route }));
    if (routes.length === 0)
        throw new Error('subagent/model-selection-policy requires at least one route');
    return routes;
}
/**
 * Append the route policy once, before its definition can reach a model request.
 * @param session - session receiving the model-selectable definition.
 * @param allowedModels - exact routes the definition may select explicitly.
 */
export function recordSubagentModelSelection(session, allowedModels) {
    if (subagentModelSelectionPolicy(session) !== undefined)
        return;
    session.append('subagent/model-selection-policy', {
        allowedModels: allowedModels.map(route => ({ ...route })),
    });
}
