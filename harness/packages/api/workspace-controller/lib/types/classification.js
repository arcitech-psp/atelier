/**
 * User-facing workspace presentation rules. The Host reports marker files so
 * the browser can classify automated folders without reading the filesystem.
 * Keep this list declarative: deployments can review the rules without
 * changing the ordering or pinning code.
 */
export const WORKSPACE_CLASSIFICATION_RULES = {
    pathPatterns: [
        String.raw `(?:^|[\\/])\.dsh-helper-smoke-[^\\/]+$`,
        String.raw `(?:^|[\\/])dsh-assist-bench(?:[\\/]|$)`,
        String.raw `(?:^|[\\/])(?:lab|scratch|temp|jobs?|workers?)(?:[\\/]|$)`,
    ],
    markerFiles: ['.dsh-automated-workspace.json'],
};
const PATH_RULES = WORKSPACE_CLASSIFICATION_RULES.pathPatterns.map(pattern => new RegExp(pattern, 'i'));
/** Return the marker files present in one Workspace directory. */
export function workspaceMarkerFiles(path, exists, join) {
    return WORKSPACE_CLASSIFICATION_RULES.markerFiles.filter(marker => exists(join(path, marker)));
}
/** Pure path/marker classification shared by Host tests and the browser. */
export function isAutomatedWorkspace(path, markers = []) {
    return PATH_RULES.some(rule => rule.test(path))
        || markers.some(marker => WORKSPACE_CLASSIFICATION_RULES.markerFiles.some(known => known === marker));
}
