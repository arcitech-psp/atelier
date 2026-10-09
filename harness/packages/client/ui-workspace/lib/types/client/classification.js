/**
 * Browser-local mirror of the declarative automated-workspace rules.
 *
 * The Host reports marker names in WorkspaceView; the client must classify
 * those wire values without importing a Host source module into its bundle.
 */
const PATH_RULES = [
    /(?:^|[\\/])\.dsh-helper-smoke-[^\\/]+$/i,
    /(?:^|[\\/])dsh-assist-bench(?:[\\/]|$)/i,
    /(?:^|[\\/])(?:lab|scratch|temp|jobs?|workers?)(?:[\\/]|$)/i,
];
const AUTOMATED_MARKER = '.dsh-automated-workspace.json';
export function isAutomatedWorkspace(path, markers = []) {
    return PATH_RULES.some(rule => rule.test(path)) || markers.includes(AUTOMATED_MARKER);
}
