# Quickstart

This page is for running Atelier from the source code. Most people should use the installers instead: see [docs/INSTALL.md](docs/INSTALL.md) (Windows setup.exe, Linux and WSL archive).

## 1. Install

1. Install [Node.js 24](https://nodejs.org/) (the tested version is in `.node-version`), then run `corepack enable` once: it provides the pinned pnpm (10.34.6).
2. In this folder, run `pnpm install --frozen-lockfile`. This fetches the JavaScript packages from the npm registry. No model is downloaded.

## 2. Have a model endpoint ready

Atelier ships no model. Start any OpenAI-compatible server you like (vLLM, llama.cpp `llama-server`, Ollama, LM Studio) or use a hosted API, and note two things:

- the base URL, ending in `/v1` (for example `http://localhost:8000/v1`, or `http://localhost:11434/v1` for Ollama);
- the model id the server lists at `<base URL>/models`.

Choose a model, quantisation and context length that fit your hardware. A vision-capable model lets Vitruvius read images you attach; start once with `ATELIER_VISION=1` so Atelier knows.

Small model (about 14B parameters or fewer, or a 32K context)? Atelier starts you in **Vitruvius Zero**, the lightest profile. Set `ATELIER_TIER=zero` or `ATELIER_TIER=full` on the first start to choose yourself; the profile picker switches at any time.

## 3. Start Atelier

```sh
ATELIER_BASE_URL=http://localhost:8000/v1 ATELIER_MODEL=your-model-id pnpm start
```

Windows PowerShell:

```powershell
$env:ATELIER_BASE_URL = "http://localhost:8000/v1"
$env:ATELIER_MODEL = "your-model-id"
pnpm start
```

On the first run Atelier creates your home folder (`user-home` next to this file, or the folder named by `ATELIER_HOME`; an existing DeepSeek Harness `DSH_HOME` is never used) and writes your endpoint into `settings.yaml` and `cordis.patch.yml` there. Later runs reuse those files, so the variables are only needed once. Atelier then checks your endpoint and tells you if it cannot be reached, refuses the key, or does not serve that model id.

Atelier prints a local address with a login token. Open it in your browser, or start with `pnpm start -- --open` to have it opened for you. Keep that address private.

Then choose a workspace folder (Atelier reads and writes files only there, and asks before running commands), pick **Vitruvius**, and ask a design question, for example: "Sketch a plan for a 4 by 5 m home studio with a desk and a bookshelf."

Stop Atelier with Ctrl+C. Your chats and canvas content stay in your home folder.

Want colleagues on your office network to use this Atelier from their own browser, tablet or phone? Start with `pnpm start -- --bottega` (or switch on **Bottega** on the new-session page): it prints an address and a pairing code. It is off by default; see [docs/BOTTEGA.md](docs/BOTTEGA.md).

## No GPU? Use cloud AI instead (optional "Cloud" profile)

You can run Atelier with no local model at all: only Atelier and your design software run on your computer, and the AI runs in the cloud. Two routes are included, and you can use either or both:

- **Free tiers and your own API keys, through [OmniRoute](https://github.com/diegosouzapw/OmniRoute)** (a local AI gateway). Install it with `npm install -g omniroute`, run `omniroute` once, and in its dashboard (`http://localhost:20128`) add the providers you have keys for. Free tiers that work well: Google AI Studio (Gemini), OpenRouter (`:free` models), Groq, Cerebras and Mistral. Paid keys you already own (OpenAI, Anthropic, DeepSeek, and others) work too and are only used after the free ones. Then run `node profiles/cloud/setup-omniroute-combos.mjs` to create the three Atelier combos: `atelier-brain`, `atelier-fast` and `atelier-vision`.
- **Your ChatGPT plan**, through OpenAI's official [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source). After Atelier starts, open `http://127.0.0.1:18345/signin`, sign in, and allow ChatGPT plan usage. Then pick a "ChatGPT plan" model, for example *GPT-6 Luna - no reasoning* for fast work. Usage counts against your plan; you can review or limit it under [ChatGPT Settings > Usage](https://chatgpt.com/settings/usage).

Start the Cloud profile on the first run:

```sh
ATELIER_PROFILE=cloud pnpm start
```

Windows PowerShell: `$env:ATELIER_PROFILE = "cloud"; pnpm start`

The launcher starts a small local bridge (`127.0.0.1:18345`, reachable only from your computer). The bridge starts OmniRoute on the first cloud request and handles the ChatGPT sign-in; your tokens stay in a private file in your home folder. If your OmniRoute requires a client key, set `ATELIER_OMNIROUTE_KEY`. Cloud requests send your chats to the providers you connected, so keep confidential client work on a local model.

For images on the moodboard, set `ATELIER_IMAGE_ENDPOINT=http://127.0.0.1:18345/omniroute/v1/images/generations` and `ATELIER_IMAGE_MODEL` to an image model you connected in OmniRoute, for example `pollinations/flux` (needs a free Pollinations key). The ChatGPT-plan route does not generate images.

## Settings you may want

| Variable | What it does | Default |
|---|---|---|
| `ATELIER_BASE_URL` | Your OpenAI-compatible endpoint (first run) | none |
| `ATELIER_MODEL` | The model id at that endpoint (first run) | none |
| `ATELIER_CONTEXT` | The model's context window in tokens (first run) | 32768 |
| `ATELIER_API_KEY` | API key for endpoints that need one | not needed for local servers |
| `ATELIER_PORT` | Local web port | 3081 |
| `ATELIER_HOME` | Your Atelier home folder | `./user-home` |
| `ATELIER_BOTTEGA` | `1` starts Bottega (team mode on your private network) at launch, `0` keeps it off | off |
| `ATELIER_BOTTEGA_PORT` | Port Bottega listens on | 3082 |

To change the endpoint later, edit `settings.yaml` (`baseURL`, the model `id`, `contextWindow`, `maxTokens`) and the model id in `cordis.patch.yml` in your home folder, or delete both files and start again with new variables. The model list and keys can also be changed in the web app under Settings > Models.

## Optional: generated images for moodboards

Without an image endpoint, moodboards still work as colour and material cards and say that images are unavailable. To add images, run your own image service (for example ComfyUI) behind an OpenAI-compatible `/images/generations` API that returns `b64_json`, then set:

- `ATELIER_IMAGE_ENDPOINT`: the complete `/images/generations` URL;
- `ATELIER_IMAGE_MODEL`: the image model name;
- `ATELIER_IMAGE_API_KEY`: only if the service needs one.

Restart Atelier after changing these. Image models have their own licences; check them before use.

## Optional: live modelling in IngeTrazo

1. Install [IngeTrazo](https://github.com/ingelibre/ingetrazo) yourself and turn on its local AI bridge.
2. Open a new Vitruvius chat. Atelier checks the bridge on `localhost` port 4763 when the chat opens; if it answers, IngeTrazo's official MCP tools appear in that chat. If not, Vitruvius explains how to enable it and still helps on the canvas.
3. On Windows Atelier finds `ingetrazo-mcp.exe` under Program Files or your per-user Programs folder; on Linux it runs `ingetrazo --mcp`. For another installation set `ATELIER_INGETRAZO_COMMAND` and `ATELIER_INGETRAZO_ARGS` (a JSON array). `ATELIER_INGETRAZO_PORT` selects another bridge port.

The optional native panel for IngeTrazo is in `ingetrazo-plugin/atelier_panel`, a separate GPL-3.0-or-later download with its own instructions.

## Other ways to run it

The stock DeepSeek Harness launcher profiles work with the same home folder:

```sh
DSH_HOME=./user-home ATELIER_API_KEY=not-needed node harness/apps/cli/lib/bin.js --profile headless "Give me three ideas for a reading nook"
```

Profiles: `web`, `headless`, `acp`, `sdk`, `sdk-minimal`. Set `ATELIER_API_KEY` (any value for a local server that needs none) when you use the launcher directly.

## Make it yours

Duplicate Vitruvius from the preset picker, or use the stock Creator mode to build a new preset with the agent's help, then add your own prompts and plugins. The Vitruvius preset files are in `harness/packages/preset/agent-presets/presets/vitruvius`.

## If something goes wrong

- **"No model is connected yet"**: connect it on the Model roles page (Settings > Model roles), or set `ATELIER_BASE_URL` and `ATELIER_MODEL` for the first run.
- **"Could not reach ..."**: start your model server first, and check the URL ends in `/v1`.
- **"The endpoint serves ..., not ..."**: copy one of the listed ids into `settings.yaml` and `cordis.patch.yml`.
- **"refused the API key"**: set `ATELIER_API_KEY`.
- **Port already in use**: without `ATELIER_PORT` Atelier moves to the next free port by itself; with it, choose another, e.g. `ATELIER_PORT=3082`.

## Skills

Vitruvius starts with a short prompt and a one-line catalogue of skills; a skill is a folder with a `SKILL.md` (YAML frontmatter with `name` and `description`, then the instructions). The catalogue lists each skill in every chat; the full instructions load only when Vitruvius calls the `skill` tool or you type `/name` in the composer.

Shipped public skills (`skills/public/`): `canvas-moodboard`, `ingetrazo-live`, `design-review`.

Write your own: copy one of them into `skills/community/<your-skill>/SKILL.md`, keep the description to one line, then run `node skills/review.mjs skills/community/<your-skill>` to see what a reviewer sees (tools, hosts, paths, problems). The frontmatter schema is `skills/skill-frontmatter.schema.json`; `ATELIER_SKILLS_DIR` (paths separated by `;`) points Atelier at other skill folders. To contribute a skill, open a pull request with the folder; approved skills are recorded in `skills/APPROVED.json`.
