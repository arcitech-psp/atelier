/**
 * User-facing workspace presentation rules. The Host reports marker files so
 * the browser can classify automated folders without reading the filesystem.
 * Keep this list declarative: deployments can review the rules without
 * changing the ordering or pinning code.
 */
export declare const WORKSPACE_CLASSIFICATION_RULES: {
    readonly pathPatterns: readonly [string, string, string];
    readonly markerFiles: readonly [".dsh-automated-workspace.json"];
};
/** Return the marker files present in one Workspace directory. */
export declare function workspaceMarkerFiles(path: string, exists: (path: string) => boolean, join: (left: string, right: string) => string): string[];
/** Pure path/marker classification shared by Host tests and the browser. */
export declare function isAutomatedWorkspace(path: string, markers?: readonly string[]): boolean;
