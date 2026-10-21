# Undo a turn

Atelier adds **Undo turn** to each assistant message. It restores the files recorded before the tools in that turn ran and keeps the post-turn copies in the Atelier home folder under `atelier-undo/archive/`.

The host records a checkpoint before each tool runs. It skips symbolic links, `.git`, and `node_modules`, and caps snapshots at 2,000 files, 64 MB total, and 20 MB per file. If a file changed again after the turn, undo refuses to overwrite that later work. The button reports what happened; a finished turn is selected by its session and assistant-message IDs.

The `@arcitech/atelier-undo` package also exports `createTurnUndo()` for hosts that need a custom store. Its `store` option can point to an isolated folder. Undo records contain file contents and should be kept private like the files they protect.

## Run the package tests

From the repository root:

```sh
pnpm --filter @arcitech/atelier-undo test
```

## Roll back

Remove the `@arcitech/atelier-undo` dependency and the `applyUndo` calls from `public/atelier-start`; then remove `public/atelier-undo` and this page. Existing checkpoints can be deleted from the configured Atelier home folder when no longer needed.
