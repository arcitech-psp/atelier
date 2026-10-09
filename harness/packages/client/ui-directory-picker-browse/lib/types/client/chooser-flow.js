/**
 * The Atelier workspace-chooser occupant: the same directory-flow hole the
 * Miller browser fills, with the recent / pinned / type-a-path chooser inside.
 * A confirmed folder is the picked path; dismissal is the cancellation; browse
 * failures stay inside the dialog, so the owner's `onError` arm is never driven.
 */
import { createElement } from 'react';
import { WorkspaceChooser } from "./WorkspaceChooser.js";
/**
 * Flow occupant adapting the owner's conversation onto the chooser dialog.
 * @param props - owner conversation plus the injected chooser face.
 * @returns the dialog element (renders nothing while closed).
 */
export function ChooserDirectoryFlow(props) {
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
    });
}
