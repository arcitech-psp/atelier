# Atelier by ArciTech

**A local AI studio assistant for architects, interior designers and students.**

You describe the project; Atelier works through it with you, one visible step at a time, on your own computer. You can stop it, change the plan or take over at any time.

> **Status: public preview (0.1.0-preview).** Expect rough edges, and please tell us what breaks.

Atelier is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) by DeepSeek-AI (MIT licence). We added **Vitruvius**, a design-assistant profile built on the classic triad *Venustas* (beauty), *Firmitas* (soundness) and *Utilitas* (usefulness), a design canvas with material and colour moodboards, and an optional bridge to [IngeTrazo](https://github.com/ingelibre/ingetrazo) for live modelling.

## What is in this preview

- **Vitruvius**: general design help, editable concept plans on a canvas, and material/colour moodboards.
- **Vitruvius Zero**: the same assistant with the lightest start (about half the startup text), for small local models and modest computers. Chosen automatically for small models.
- The four stock DeepSeek Harness agent presets (Standard, PTC, Minimal and Creator modes) and its launcher profiles (web, headless, acp, sdk, sdk-minimal).
- Works with **any OpenAI-compatible model endpoint**, on your computer or elsewhere.
- Optional: generated moodboard images through your own image endpoint (for example ComfyUI).
- Optional: live modelling in IngeTrazo, which you install separately.

New and optional: dictation, "Read aloud" and meaning-based search over your project folder, each switched on when you connect the model for it (see below). Not in this preview: wind studies, the tablet app and the full brief-to-board workflow. They follow as each piece is proven.

## Bring your own models

Atelier does not include or require any particular model. It uses a few models, each for one job, and you choose every one of them under **Settings > Model roles**:

| Role | What it does | Needed? |
|---|---|---|
| Brain | Talks with you, plans and uses the tools. Vision-capable is best. | Yes |
| Vision | Looks at images, only if your brain cannot. | Optional |
| Speech to text / Text to speech | Dictation and "Read aloud". | Optional |
| Embeddings | Finds the right notes and documents in your project by meaning. | Optional |
| Image generation | Concept images for moodboards (for example through ComfyUI). | Optional |
| Small helper | A fast small model for quick side jobs. | Optional |

Each role takes any OpenAI-compatible address (Ollama, LM Studio, llama.cpp, vLLM, OmniRoute for cloud models, whisper.cpp, Kokoro and others), shows whether it is connected, and has a **Test** button. Keys stay on your computer. A role you leave empty just switches its feature off.

No model server yet? **Set me up** downloads a small working set (official llama.cpp servers, a Qwen3-VL brain sized for your graphics card and EmbeddingGemma 2, from 1.9 GB) into a folder you choose, after showing the sizes and checking your disk space, verifies every file and connects the roles. It is opt-in and nothing downloads until you press the button. Atelier is tuned for the ARCITECH recommended brain on Hugging Face, but every model works through the same path. Each model keeps its own licence; check it fits how you work. Full guide: [docs/ROLES_SETUP.md](docs/ROLES_SETUP.md).

## Quick start

You need [Node.js 24](https://nodejs.org/) and pnpm 10 or newer (`npm install -g pnpm`).

```sh
pnpm install --frozen-lockfile
# Point Atelier at your model (first run only; local servers need no API key):
ATELIER_BASE_URL=http://localhost:8000/v1 ATELIER_MODEL=your-model-id pnpm start
```

On Windows PowerShell, set the variables first: `$env:ATELIER_BASE_URL="http://localhost:8000/v1"; $env:ATELIER_MODEL="your-model-id"; pnpm start`.

Atelier checks that your endpoint answers, then prints a local address. Open it in your browser (add `-- --open` to `pnpm start` to open it for you), choose a workspace folder, and ask Vitruvius a design question. Full details, settings and the optional extras are in [QUICKSTART.md](QUICKSTART.md), and the step-by-step guides (models, IngeTrazo, saving your work, exporting to Unreal Engine, skills, troubleshooting) are in [docs/](docs/README.md).

## What runs where

| Part | Where it runs | Needed? | Notes |
|---|---|---|---|
| Atelier | Your computer | Yes | Binds to localhost only. |
| Language model | Your computer, or any OpenAI-compatible endpoint | Yes, your choice | Not included. If you use a remote endpoint, what you send goes there. |
| Image endpoint (e.g. ComfyUI) | Your choice | Optional | Concept images only; not included. |
| IngeTrazo + its official MCP bridge | Your computer | Optional | Separate install, GPL-3.0-or-later. Never bundled. |

## Privacy

Atelier sends no telemetry. The upstream DeepSeek Harness telemetry and session-title plugins are switched off in the shipped defaults, and the launcher sets `DSH_TELEMETRY_DISABLED=1`. Atelier talks only to the model and image endpoints you configure, to IngeTrazo on your own computer, and to web pages the agent fetches when you ask it to. The stock web-search tool calls DeepSeek's search API only if you set your own `DEEPSEEK_API_KEY`.

## Honest limits

- Concept plans and moodboards are schematic design aids. Check dimensions and clearances as you would a junior's drawing.
- Generated images are concept images and a work in progress.
- Wind studies are not in this preview. When they arrive they are early design guidance only, not engineering.
- Vitruvius never certifies code compliance. Get qualified local review for structure, life safety, accessibility and permits.
- The model can be wrong, and how well Vitruvius works depends on the model you connect.

## Licences and credits

Atelier's own additions are licensed under the [PolyForm Shield License 1.0.0](LICENSE) (source-available: free to use, change and share, but not to build a competing product). DeepSeek Harness under `harness/` stays MIT, and `ingetrazo-plugin/` stays GPL-3.0-or-later. Third-party notices are in [NOTICE.md](NOTICE.md) and `licenses/`.

| Project | By | Licence | How Atelier uses it |
|---|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek-AI | MIT | Atelier is a fork of it |
| [IngeTrazo](https://github.com/ingelibre/ingetrazo) | Marco Sumari Tellez and contributors | GPL-3.0-or-later | Installed separately; Atelier starts its official MCP server only if you have installed it. Never bundled. |
| npm dependencies | Their authors | See `licenses/` | Installed by pnpm |

The optional IngeTrazo panel in `ingetrazo-plugin/atelier_panel` is a separate GPL-3.0-or-later download with its own README and LICENSE.

## Community

Issues and ideas: GitHub Issues. Email: arcitech.team@outlook.com.
