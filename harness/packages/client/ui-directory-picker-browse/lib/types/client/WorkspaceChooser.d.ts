import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client';
import type { Translate } from '@deepseek-ai/dsh-client-locale/client';
/** The slice of a Workspace row the chooser reads (structural; avoids a package dependency). */
export interface ChooserWorkspaceRow {
    readonly path: string;
    readonly title: string;
    readonly updatedAt: string;
    readonly markers?: readonly string[] | undefined;
}
/** Bare observable over the workspace registry (the controller's `list` source). */
export interface ChooserWorkspaceSource {
    getSnapshot(): {
        readonly items: readonly ChooserWorkspaceRow[];
    };
    subscribe(listener: () => void): () => void;
}
/** Owner-supplied chooser props. */
export interface WorkspaceChooserProps {
    open: boolean;
    busy: boolean;
    listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>;
    createDirectory: (path: string, name: string) => Promise<string>;
    /** Open the host's native folder dialog; null when cancelled. */
    pickNative: () => Promise<string | null>;
    /** Registry of existing workspaces (for the Recent list). */
    workspaces?: ChooserWorkspaceSource | undefined;
    onOpen: (path: string) => void;
    onClose: () => void;
    t: Translate;
}
/**
 * The chooser dialog.
 * @param props - owner conversation, browse calls, and copy.
 * @returns the dialog element (renders nothing while closed).
 */
export declare function WorkspaceChooser(props: WorkspaceChooserProps): import("react").JSX.Element;
