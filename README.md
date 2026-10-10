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

Not in this preview: voice, search over your own files (RAG), wind studies, the tablet app and the full brief-to-board workflow. They follow as each piece is proven.

## Bring your own model

Atelier does not include or require any particular model. Run whichever LLM you like behind an OpenAI-compatible endpoint (vLLM, llama.cpp, Ollama, LM Studio, a hosted API) and point Atelier at it. A vision-capable model lets Vitruvius read images you attach. Atelier is tuned for Holo-style models, but every model works through the same default path. Each model keeps its own licence; check it fits how you work.

## Quick start

You need [Node.js 24](https://nodejs.org/) and pnpm 10 or newer (`npm install -g pnpm`).

```sh
pnpm install --frozen-lockfile
# Point Atelier at your model (first run only; local servers need no API key):
ATELIER_BASE_URL=http://localhost:8000/v1 ATELIER_MODEL=your-model-id pnpm start
```

On Windows PowerShell, set the variables first: `$env:ATELIER_BASE_URL="http://localhost:8000/v1"; $env:ATELIER_MODEL="your-model-id"; pnpm start`.

Atelier checks that your endpoint answers, then prints a local address. Open it in your browser (add `-- --open` to `pnpm start` to open it for you), choose a workspace folder, and ask Vitruvius a design question. Full details, settings and the optional extras are in [QUICKSTART.md](QUICKSTART.md), and the step-by-step guides (models, IngeTrazo, saving your work, exporting to Unreal Engine, skills, troubleshooting) are in [docs/](docs/README.md).

## In the terminal

Prefer the keyboard? `atelier` opens a terminal UI on the same engine as the web app, so your chats, profiles and model roles are shared with the browser. The terminal UI has a chats sidebar, streaming answers, collapsible tool steps and a `/` command palette. Other commands:

- `atelier chat "..."` answers one prompt; add `--json` for scripts.
- `atelier sessions list|open|export` lists, opens and saves your chats.
- `atelier roles list|set|test` shows, changes and checks your model roles.
- `atelier profile use vitruvius|vitruvius-zero|cloud` chooses the profile new chats start in.
- `atelier update check|apply|rollback` updates Atelier or goes back a version.
- `atelier doctor` checks your setup and tells you how to fix problems.

The installer puts `atelier` on your PATH (Windows, Linux and WSL). From a checkout, run `pnpm exec atelier`. See [docs/CLI.md](docs/CLI.md) for the keys, the commands and scripting examples. Atelier is made by ARCITECH.

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
