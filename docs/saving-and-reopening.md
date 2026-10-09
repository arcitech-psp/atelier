# Saving and reopening work

The short version: **the geometry lives in your IngeTrazo file, not in the chat.** A chat can end, a model can change, your computer can restart; the drawing you saved is still a normal file you own.

## Where each thing is kept

| What | Where | How to reopen |
|---|---|---|
| Chats | Your Atelier home folder (`user-home`, or `ATELIER_HOME`) | They are listed in the app's sidebar; click one to carry on. |
| Canvas plans and moodboards | Your Atelier home folder, with the chat they belong to | Open the chat. |
| Files Vitruvius writes | Your workspace folder | Any file browser. |
| 3D geometry | The IngeTrazo drawing (`.igz` file) | IngeTrazo, **File > Open**. |
| Your model settings | `settings.yaml` and `cordis.patch.yml` in your home folder | Read at every start. |

## Save the geometry

In IngeTrazo use **File > Save** (Ctrl+S) or **File > Save As** and give the drawing a clear name. A habit that works well in practice is one folder per kind of drawing:

```
Documents\IngeTrazo\
  Resources\     reusable assets: a pergola, a stair, a canopy
  Projects\      one drawing per project
  Experiments\   tries you may throw away
```

A saved asset is reusable: open it later, change it, export it again.

## Pick up where you left off

1. Open the drawing in IngeTrazo, with the bridge on.
2. Open a **new** Vitruvius chat (or the old one from the sidebar).
3. Ask it to look first:

   > What is in this drawing? List the groups and their sizes.

The assistant reads the drawing as it is now, including anything you changed by hand. It does not rely on its memory of an older chat.

## Back up

Everything that matters is in three places: your **workspace folders**, your **IngeTrazo drawings**, and your **Atelier home folder**. Copy those and you have it all. Atelier keeps nothing in the cloud.

Next: [Exporting to Unreal Engine](export-to-unreal.md).
