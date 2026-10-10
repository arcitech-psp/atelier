# Atelier documentation

Atelier is a studio assistant for architects, interior designers and students. You describe the project; it works through it with you one visible step at a time, on your own computer. This is the documentation for the **public preview (0.1.0-preview)**.

Read in this order the first time:

1. [Installing Atelier](INSTALL.md): Windows installer, Linux and WSL, updates, uninstalling. ([Getting started](getting-started.md) is the short version.)
2. [Add your endpoint](add-your-endpoint.md): connect Ollama, LM Studio, llama.cpp, vLLM, a URL with a key, free cloud tiers or your ChatGPT plan; which model for which graphics card. More in [Choosing a model](choosing-a-model.md).
3. [Your first chat](first-chat.md): workspace, Vitruvius, the canvas and moodboards.
4. [Connecting IngeTrazo](ingetrazo.md): live modelling in a real 3D drawing.
5. [Saving and reopening work](saving-and-reopening.md): where chats, boards and geometry are kept.
6. [Exporting to Unreal Engine](export-to-unreal.md): IngeTrazo to GLB to Unreal, at real scale.
7. [Skills on demand](skills.md): how Vitruvius (and Vitruvius Zero) stays light, and how to write your own skill.
8. [Troubleshooting](troubleshooting.md) and the [FAQ](FAQ.md)
9. [Licence in plain words](licence.md)
10. [Credits](credits.md): the projects Atelier is built on.
11. For maintainers: [Following DSH releases](UPSTREAM_SYNC.md).

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
| Not in this preview | Voice, search over your own files, wind studies, the tablet app, the full brief-to-board workflow. |

Atelier is **source-available** under the PolyForm Shield 1.0.0 licence: free to use, read, change and share, but not to build a competing product. See [Licence in plain words](licence.md).
