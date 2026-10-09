/**
 * The Atelier workspace-chooser occupant: the same directory-flow hole the
 * Miller browser fills, with the recent / pinned / type-a-path chooser inside.
 * A confirmed folder is the picked path; dismissal is the cancellation; browse
 * failures stay inside the dialog, so the owner's `onError` arm is never driven.
 */
import { createElement } from 'react'
import type { ReactElement } from 'react'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { WorkspaceChooser } from './WorkspaceChooser.tsx'
import type { ChooserWorkspaceSource } from './WorkspaceChooser.tsx'

/** Injected face: the wire calls, workspace registry, and copy the chooser drives. */
export interface ChooserFlowInjected {
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  createDirectory: (path: string, name: string) => Promise<string>
  /** Open the host's native folder dialog (the small "Browse with Windows..." link). */
  pickNative: () => Promise<string | null>
  /** Workspace registry source for the Recent list (absent: only local picks are listed). */
  workspaces?: ChooserWorkspaceSource | undefined
  t: Translate
}

/**
 * Flow occupant adapting the owner's conversation onto the chooser dialog.
 * @param props - owner conversation plus the injected chooser face.
 * @returns the dialog element (renders nothing while closed).
 */
export function ChooserDirectoryFlow(props: DirectoryFlowOwnerProps & ChooserFlowInjected): ReactElement {
  return createElement(WorkspaceChooser, {
    open: props.open,
    busy: props.busy,
    listDirectory: props.listDirectory,
    createDirectory: props.createDirectory,
    pickNative: props.pickNative,
    workspaces: props.workspaces,
    t: props.t,
    onOpen: props.onPicked,
    onClose: props.onCancel,
  })
}
