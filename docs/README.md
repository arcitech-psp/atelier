# Atelier documentation

Atelier is a studio assistant for architects, interior designers and students. You describe the project; it works through it with you one visible step at a time, on your own computer. This is the documentation for the **public preview (0.1.0-preview)**, now available free for Windows, Linux and WSL from the [Releases page](https://github.com/arcitech-psp/atelier/releases).

Read in this order the first time:

1. [Installing Atelier](INSTALL.md): Windows installer, Linux and WSL, updates, uninstalling. ([Getting started](getting-started.md) is the short version.)
2. [Add your endpoint](add-your-endpoint.md): connect Ollama, LM Studio, llama.cpp, vLLM, a URL with a key, free cloud tiers or your ChatGPT plan; which model for which graphics card. More in [Choosing a model](choosing-a-model.md).
   Then [Model roles](ROLES_SETUP.md): which model does what (brain, vision, speech, embeddings, images, helper), bring your own for each, or the one-click Set me up.
   Only one 16 GB graphics card? The models take turns: each loads when its job comes up, and Atelier waits for it and shows what is loading ([One graphics card, several models](ONE_GPU.md)). More cards, a bigger card or a model server keep them loaded side by side, so everything is faster. No GPU? Point the roles at a cloud endpoint.
   Start your own model servers (llama.cpp, vLLM)? [Brains](brains.md): see what is really loaded and Load, Unload or Reload it from Settings.
3. [Your first chat](first-chat.md): workspace, Vitruvius, the canvas and moodboards.
   [Public assistant profiles](profiles.md): Einsteinium for research, Picaso for visual direction and Hydra for coding.
4. [Connecting IngeTrazo](ingetrazo.md): live modelling in a real 3D drawing.
5. [Saving and reopening work](saving-and-reopening.md): where chats, boards and geometry are kept.
6. [Exporting to Unreal Engine](export-to-unreal.md): IngeTrazo to GLB to Unreal, at real scale.
7. [Skills on demand](skills.md): how Vitruvius (and Vitruvius Zero) stays light, and how to write your own skill.
8. [Bottega: team mode](BOTTEGA.md): share one Atelier with colleagues on your office network, paired once with a code. Off by default.
9. [Troubleshooting](troubleshooting.md) and the [FAQ](FAQ.md)
10. [Licence in plain words](licence.md)
11. [Credits](credits.md): the projects Atelier is built on.
12. For maintainers: [Following DSH releases](UPSTREAM_SYNC.md).

## What is in this preview, honestly

| Part | State in 0.1.0-preview |
|---|---|
| Atelier app and the Vitruvius profile | Ready. Fresh install and a first chat tested on Windows 11. |
| Vitruvius Zero (light profile for small models) | New. About half the startup text of Vitruvius. Tested on a 27B model; small-model runs still to come. |
| Canvas: concept plans, alternatives, moodboards | Ready. Schematic design aids, not drawings. |
| Local model, model on your network, any OpenAI-compatible API | Ready. Atelier ships no model; you bring one. |
| Cloud profile (OmniRoute free tiers and your own keys) | Ready. Tested with free tiers. |
| ChatGPT plan sign-in | Included. Starts and lists models; a full answer has not been timed yet. |
| IngeTrazo connection | Experimental. The connection works; how well geometry comes out depends on your model. Check every result. |
| Export to Unreal Engine | Done in IngeTrazo and Unreal themselves (GLB). Atelier does not drive Unreal in this preview. |
| Model roles and Set me up | New. One endpoint per role with Test; dictation, Read aloud and project search appear when their role is connected. Set me up tested with small stand-in files; see [Model roles](ROLES_SETUP.md). |
| Bottega (team mode) | New. Other devices on your private network use one Atelier after a pairing code; off by default. LAN only, plain HTTP; Tailscale support is planned and coming soon. See [Bottega](BOTTEGA.md). |
| Mission Control and one-GPU model swapping | New. Chip in the session header and a panel: loaded model (LM Studio, Ollama, llama-swap), graphics card use (NVIDIA), tokens and speed, energy cost at your own price, stopwatch. Checked against a real LM Studio's answers and stand-in Ollama and llama-swap servers; see [Mission Control](mission-control.md) and [One graphics card](ONE_GPU.md). |
| Brains (Settings > General) | New. A compact row per computer shows the model that is really loaded now (read from the server) and its speed; Change opens Load, Unload and Reload with a confirm step. Only the actions you list in `brains.json` can run. Tested with a real stand-in model server on Windows; see [Brains](brains.md). |
| Atelier guardrails (Settings > Safety) | New. On by default: chats stay in their project folder and ask before anything wider. Off (after a warning): full file access and no approval prompts, with a **Guardrails off** chip in the session header. See the [FAQ](FAQ.md#what-are-atelier-guardrails). |
| Not in this preview | The drawing-first workflow (draw on layers, check, then build from the drawings), the drawing checker, wind studies, presentation boards (the full brief-to-board workflow) and the tablet app. |

Atelier is **source-available** under the PolyForm Shield 1.0.0 licence: free to use, read, change and share, but not to build a competing product. See [Licence in plain words](licence.md).
