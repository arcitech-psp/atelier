# Add your endpoint (connect a model)

Atelier ships no AI model; you connect it to one. Three words used on this page:

- **Model server:** the program that loads the model and answers (Ollama, LM Studio, llama.cpp, vLLM, or a cloud service).
- **Address (base URL):** where Atelier reaches that server, for example `http://localhost:11434/v1`.
- **OpenAI-compatible:** the common way of talking to a model server that almost every server offers. Atelier needs nothing else.

Start the model server first, then connect it here and press **Test**: it sends one short test message and shows the model names the server reports, so pick the name from that list. No graphics card? Use a cloud endpoint ([Choosing a model](choosing-a-model.md)). This page shows each ready-made choice step by step. More detail on every model role (vision, speech, images...) is in [Model roles](ROLES_SETUP.md).

## Where to connect it

The first time Atelier starts without a model, it opens the **Model roles** page by itself. Later you find it under **Settings** (bottom left) > **Model roles**, or from the AIT icon next to the clock > **Set up model endpoint** (Windows), or with `atelier-preview setup` (Linux and WSL).

On the **Brain** card: press **Connect**, pick the **Server type**, check the address, type the **Model name**, add an **API key** only if the server needs one, press **Test**, then **Save**. Test lists the model names the server reports, so you can pick one instead of typing.

## The ready-made choices

| Server type | Address it fills in | Key needed? | Runs where |
|---|---|---|---|
| Ollama | `http://localhost:11434/v1` | No | Your computer |
| LM Studio | `http://localhost:1234/v1` | No | Your computer |
| llama.cpp server | `http://localhost:8080/v1` | No (unless you set `--api-key`) | Your computer |
| vLLM | `http://localhost:8000/v1` | No (unless you set `--api-key`) | Your computer or a machine on your network |
| Custom (any OpenAI-compatible URL) | the address you type | Usually yes | Anywhere |
| OmniRoute (cloud free tiers) | `http://localhost:20128/v1` | No (OmniRoute holds the provider keys) | The cloud providers you connect |
| Your ChatGPT plan | through the Cloud profile, see below | Sign-in instead of a key | OpenAI |

### Ollama

1. Install [Ollama](https://ollama.com/download) and start it (it runs in the background).
2. Get a model that reads images, for example in a terminal: `ollama pull qwen3-vl:8b` (pick the size for your graphics card from the table at the end).
3. In Atelier: Server type **Ollama**, Model name `qwen3-vl:8b`, Test, Save.

### LM Studio

1. Install [LM Studio](https://lmstudio.ai/), download a model in it, and load it.
2. Open the **Developer** tab and switch **Start server** on (port 1234).
3. In Atelier: Server type **LM Studio**, press Test, pick the model it lists, Save.

### llama.cpp server

1. Download a release of [llama.cpp](https://github.com/ggml-org/llama.cpp/releases) for your system and a GGUF model.
2. Start it: `llama-server -m your-model.gguf --port 8080 -c 32768` (add `--mmproj <projector.gguf>` for a vision model).
3. In Atelier: Server type **llama.cpp server**, Test, Save. Or let Atelier do all of this: **Set me up** on the Model roles page downloads llama.cpp and a model that fits your computer ([details](ROLES_SETUP.md#set-me-up-one-click-optional)).

### vLLM

1. Start vLLM on a Linux machine or WSL with an NVIDIA, AMD or Intel graphics card: `vllm serve <model> --port 8000 --max-model-len 32768`.
2. In Atelier: Server type **vLLM**. If vLLM runs on another machine, replace `localhost` with that machine's address. Test, Save.
3. A server that others on your network can reach should have a key: start it with `--api-key <something long>` and type the same key in Atelier.

### Custom URL with a key (hosted APIs)

Any service that offers an OpenAI-compatible API works: for example OpenRouter (`https://openrouter.ai/api/v1`), Groq (`https://api.groq.com/openai/v1`), Mistral (`https://api.mistral.ai/v1`) or your company's own gateway.

1. Create an API key in the provider's dashboard.
2. In Atelier: Server type **Custom**, paste the address (it ends in `/v1` for most services), paste the key, type the model name, Test, Save.

What you type goes to that service. Keep confidential client work on a model you run yourself.

### OmniRoute: free cloud tiers

[OmniRoute](https://github.com/diegosouzapw/OmniRoute) is a small gateway on your computer that spreads requests over free tiers (Google AI Studio, OpenRouter `:free` models, Groq, Cerebras, Mistral) and any keys you already own.

1. Install it once: `npm install -g omniroute` (needs Node.js), then run `omniroute` and open its dashboard at `http://localhost:20128`.
2. Add the providers you have keys for (most free tiers only need an e-mail sign-up).
3. In Atelier: Server type **OmniRoute**, Test, pick a model or combo, Save.

### Your ChatGPT plan

Atelier can use your ChatGPT plan through OpenAI's official [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source). This route lives in Atelier's **Cloud** profile, chosen when Atelier starts for the first time with `ATELIER_PROFILE=cloud`:

- Windows (installed): close Atelier, open PowerShell and run `setx ATELIER_PROFILE cloud`, rename `%APPDATA%\Atelier-Preview\settings.yaml` and `cordis.patch.yml` (for example to `.old`), then start Atelier.
- Linux / WSL: `atelier-preview stop`, move `~/.config/atelier-preview/settings.yaml` and `cordis.patch.yml` aside, then `ATELIER_PROFILE=cloud atelier-preview`.

Then open `http://127.0.0.1:18345/signin`, sign in, allow ChatGPT plan usage, and pick a "ChatGPT plan" model in the chat's model list. Usage counts against your plan.

## Keys stay on your computer

- Keys are stored only in Atelier's home folder on your computer and never written to a log.
- The page never shows a saved key again; it shows that one is stored. Type a new one to change it.
- Atelier contacts only the addresses you enter.

## Which model for my graphics card?

Honest guidance for the **brain** (the main model). Speed depends on the card, the server and the length of the chat; small models are noticeably weaker at multi-step work and tools.

| Graphics card memory | Suggested brain | What to expect |
|---|---|---|
| None (processor only) | A cloud route (OmniRoute or a hosted API), or a 2-4B model | Local runs work but are slow. Use **Vitruvius Zero**. |
| 8 GB | 4B vision model at 4-bit (e.g. Qwen3-VL 4B), 16-32K context | Fine for design chat and short tasks. Vitruvius Zero fits better. |
| 12 GB | 8B vision model at 4-bit (e.g. Qwen3-VL 8B), 32K context | Clearly better answers and tool use. Full Vitruvius works. |
| 16 GB | 8B at 8-bit, or a 14B-class model at 4-bit, 32-64K context | Good everyday quality. |
| 24 GB and more | A 27B-class vision model at 4-bit, such as Qwen3.8-27B (Apache-2.0), 32K or more context | The size Atelier is tuned for: the best results for multi-step design work. |

Atelier starts small models (14B or less, or a context of 32K or less) in **Vitruvius Zero**, the lighter profile; you can switch in the profile list at any time.

## Without the app: environment variables

For scripted or headless set-ups, the first start also reads `ATELIER_BASE_URL`, `ATELIER_MODEL`, `ATELIER_API_KEY` and `ATELIER_CONTEXT` (see [QUICKSTART](../QUICKSTART.md)). For example on Linux: `ATELIER_BASE_URL=http://localhost:11434/v1 ATELIER_MODEL=qwen3-vl:8b atelier-preview`.

Running Atelier in WSL with the model on Windows (or the other way round)? See [Reaching your model from WSL](INSTALL.md#reaching-your-model-from-wsl).
