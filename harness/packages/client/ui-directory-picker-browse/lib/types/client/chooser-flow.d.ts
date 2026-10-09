import type { ReactElement } from 'react';
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client';
import type { Translate } from '@deepseek-ai/dsh-client-locale/client';
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { ChooserWorkspaceSource } from './WorkspaceChooser.tsx';
/** Injected face: the wire calls, workspace registry, and copy the chooser drives. */
export interface ChooserFlowInjected {
    listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>;
    createDirectory: (path: string, name: string) => Promise<string>;
    /** Open the host's native folder dialog (the small "Browse with Windows..." link). */
    pickNative: () => Promise<string | null>;
    /** Workspace registry source for the Recent list (absent: only local picks are listed). */
    workspaces?: ChooserWorkspaceSource | undefined;
    t: Translate;
}
/**
 * Flow occupant adapting the owner's conversation onto the chooser dialog.
 * @param props - owner conversation plus the injected chooser face.
 * @returns the dialog element (renders nothing while closed).
 */
export declare function ChooserDirectoryFlow(props: DirectoryFlowOwnerProps & ChooserFlowInjected): ReactElement;
