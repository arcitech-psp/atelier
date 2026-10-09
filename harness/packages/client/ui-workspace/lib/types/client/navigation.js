/** Workspace archive and directory UI capability. */
import { Service } from '@deepseek-ai/cordis';
/** Browser-local workspace preference; it never replaces Host workspace data. */
// v2 intentionally ignores the preference written by the earlier buggy build,
// which could persist the Hermes test Workspace during startup.
const LAST_WORKSPACE_PATH_KEY = 'dsh.workspace.lastActivePath.v2';
/** The DSH deployment's project root; used only when no prior choice exists. */
const DEPLOYMENT_DEFAULT_WORKSPACE_PATH = "";
/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
    rpcError;
    name = 'DirectoryBrowseError';
    /** @param rpcError - Host directory business failure. */
    constructor(rpcError) {
        super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`);
        this.rpcError = rpcError;
    }
}
/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service {
    directoryPicker;
    workspaces;
    sessions;
    connecting = new Map();
    /**
     * @param ctx - Client root Context.
     * @param directoryPicker - the directory-picking Remote namespace.
     * @param workspaces - pure Workspace Controller.
     * @param sessions - pure Session Controller.
     */
    constructor(ctx, directoryPicker, workspaces, sessions) {
        super(ctx, 'uiWorkspace');
        this.directoryPicker = directoryPicker;
        this.workspaces = workspaces;
        this.sessions = sessions;
        ctx.effect(() => this.watchNavigation(), 'ui-workspace: Workspace navigation policy');
    }
    async connectWorkspace(workspaceId) {
        const workspace = this.workspaces.list.getSnapshot().items
            .find(item => item.workspaceId === workspaceId);
        if (workspace === undefined) {
            throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`);
        }
        const inflight = this.connecting.get(workspaceId);
        if (inflight !== undefined)
            return inflight;
        const archived = this.workspaces.list.getSnapshot().archivedSessionIds;
        const sessions = this.sessions.list.getSnapshot();
        for (const id of sessions.ids) {
            const summary = sessions.byId[id];
            if (summary !== undefined && summary.blank && summary.cwd === workspace.path
                && workspace.sessionIds.includes(summary.id)
                && !archived.includes(summary.id))
                return summary.id;
        }
        const attempt = this.sessions.create({ workspaceId })
            .finally(() => { this.connecting.delete(workspaceId); });
        this.connecting.set(workspaceId, attempt);
        return attempt;
    }
    startSession(workspaceId) {
        const workspace = this.workspaces.list.getSnapshot();
        const sessions = this.sessions.list.getSnapshot();
        const current = sessions.current;
        const currentWorkspaceId = current === undefined
            ? undefined
            : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId;
        const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
            ? recentWorkspace(workspace.items, sessions.byId)
            : undefined;
        const target = workspaceId
            ?? currentWorkspaceId
            ?? preferredWorkspace(workspace.items)
            ?? recent;
        if (target === undefined) {
            this.sessions.clear();
            return;
        }
        rememberWorkspace(workspace.items.find(item => item.workspaceId === target));
        void this.connectWorkspace(target).then((sessionId) => { this.sessions.open(sessionId); }, (reason) => { console.warn('new session failed:', reason); });
    }
    async archiveSession(sessionId) {
        await this.workspaces.archiveSession(sessionId);
    }
    async pickDirectory() {
        const result = await this.directoryPicker.pick();
        if (!result.ok)
            throw new Error(`directory picker failed: ${result.error.message}`);
        return result.value;
    }
    async listDirectory(path, signal) {
        const result = await this.directoryPicker.list(path, signal);
        if (!result.ok)
            throw new DirectoryBrowseError(result.error);
        return result.value;
    }
    async createDirectory(path, name) {
        const result = await this.directoryPicker.createDirectory(path, name);
        if (!result.ok)
            throw new DirectoryBrowseError(result.error);
        return result.value;
    }
    watchNavigation() {
        let initial = 'waiting';
        let disposed = false;
        let observedCurrent;
        const reconcile = () => {
            if (disposed)
                return;
            if (this.clearArchivedCurrent())
                return;
            const workspace = this.workspaces.list.getSnapshot();
            const sessions = this.sessions.list.getSnapshot();
            if (workspace.phase !== 'ready' || sessions.phase !== 'ready')
                return;
            const current = sessions.current;
            const currentWorkspace = current === undefined
                ? undefined
                : workspace.items.find(item => item.sessionIds.includes(current));
            if (initial === 'done') {
                // Keep the browser-local pointer in sync with an existing Session that
                // the user selected. Workspace records themselves remain Host-owned and
                // are never filtered, reordered, or replaced by this preference.
                if (current !== observedCurrent)
                    rememberWorkspace(currentWorkspace);
                observedCurrent = current;
                return;
            }
            if (initial !== 'waiting')
                return;
            // Session Controller owns the durable current-session selection. Once
            // both baselines are ready, preserve that selection even when its
            // Workspace differs from the browser's preferred/default Workspace.
            // This also lets an explicit route selection survive the first boot
            // reconciliation instead of being replaced by an arbitrary fallback.
            if (current !== undefined) {
                rememberWorkspace(currentWorkspace);
                observedCurrent = current;
                initial = 'done';
                return;
            }
            const preferred = preferredWorkspace(workspace.items);
            const target = preferred
                ?? recentWorkspace(workspace.items, sessions.byId);
            if (target === undefined) {
                initial = 'done';
                return;
            }
            initial = 'connecting';
            void this.connectWorkspace(target).then((sessionId) => {
                if (disposed)
                    return;
                // The automatic attach may have been waiting while the user or a
                // route selected another Session. Preserve that later selection.
                if (this.sessions.list.getSnapshot().current === undefined) {
                    this.sessions.open(sessionId);
                }
                const selected = this.sessions.list.getSnapshot().current;
                const latestWorkspace = this.workspaces.list.getSnapshot();
                const selectedWorkspace = selected === undefined
                    ? undefined
                    : latestWorkspace.items.find(item => item.sessionIds.includes(selected));
                if (selectedWorkspace !== undefined) {
                    rememberWorkspace(selectedWorkspace);
                }
                else if (selected === sessionId) {
                    rememberWorkspace(latestWorkspace.items.find(item => item.workspaceId === target));
                }
                observedCurrent = selected;
                initial = 'done';
            }, (reason) => {
                if (disposed)
                    return;
                initial = 'waiting';
                console.warn('initial workspace selection failed:', reason);
            });
        };
        const disposeWorkspaces = this.workspaces.list.subscribe(reconcile);
        const disposeSessions = this.sessions.list.subscribe(reconcile);
        reconcile();
        return () => {
            disposed = true;
            disposeSessions();
            disposeWorkspaces();
        };
    }
    /** @returns true when an archived current selection was cleared. */
    clearArchivedCurrent() {
        const current = this.sessions.list.getSnapshot().current;
        if (current === undefined
            || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current))
            return false;
        this.sessions.clear();
        return true;
    }
}
/** Read the last workspace path without allowing browser storage failures to affect boot. */
function lastWorkspacePath() {
    if (typeof localStorage === 'undefined')
        return undefined;
    try {
        const value = localStorage.getItem(LAST_WORKSPACE_PATH_KEY)?.trim();
        return value === undefined || value.length === 0 ? undefined : value;
    }
    catch {
        return undefined;
    }
}
/** Persist only a canonical Host path; workspace records remain authoritative. */
function rememberWorkspace(workspace) {
    if (workspace === undefined || typeof localStorage === 'undefined')
        return;
    try {
        localStorage.setItem(LAST_WORKSPACE_PATH_KEY, workspace.path);
    }
    catch {
        // Private browsing or quota failures must not break workspace navigation.
    }
}
/** Resolve the last active workspace, case-insensitively for Windows paths. */
function preferredWorkspace(workspaces) {
    const remembered = lastWorkspacePath();
    if (remembered !== undefined) {
        const normalized = remembered.toLocaleLowerCase();
        const rememberedWorkspace = workspaces.find(workspace => workspace.path.toLocaleLowerCase() === normalized);
        if (rememberedWorkspace !== undefined)
            return rememberedWorkspace.workspaceId;
    }
    return workspaces.find(workspace => workspace.path.toLocaleLowerCase()
        === DEPLOYMENT_DEFAULT_WORKSPACE_PATH.toLocaleLowerCase())?.workspaceId;
}
/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(workspaces, sessions) {
    let selected;
    let selectedTime = Number.NEGATIVE_INFINITY;
    for (const workspace of workspaces) {
        let latest = Number.NEGATIVE_INFINITY;
        for (const sessionId of workspace.sessionIds) {
            const session = sessions[sessionId];
            if (session !== undefined)
                latest = Math.max(latest, session.updatedAt);
        }
        if (latest === Number.NEGATIVE_INFINITY)
            latest = Date.parse(workspace.createdAt);
        if (selected === undefined || latest > selectedTime) {
            selected = workspace.workspaceId;
            selectedTime = latest;
        }
    }
    return selected;
}
export { UiWorkspaceService };
