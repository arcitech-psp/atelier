# Choosing a model

Atelier ships no model. It talks to any model that speaks the OpenAI-compatible API, so you choose where the thinking happens. Pick by two questions: **where may my project data go**, and **what hardware do I have**.

| Route | Your data goes to | Hardware | Cost |
|---|---|---|---|
| 1. Your own graphics card | Nowhere. It stays on this computer. | A GPU with enough memory (see below) | Free after the hardware |
| 2. A model server on your network | A machine in your office | One stronger machine shared by several desks | Free after the hardware |
| 3. Free cloud tiers through OmniRoute | The providers you connect | None | Free, within each provider's limits |
| 4. Your own API keys | The provider of that key | None | What the provider charges |
| 5. Your ChatGPT plan | OpenAI | None | Counts against your plan |

For confidential client work, use route 1 or 2.

## 1. Fully local, on your own graphics card

Run a model server on this computer: [vLLM](https://github.com/vllm-project/vllm), [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`), [Ollama](https://ollama.com/) or [LM Studio](https://lmstudio.ai/). Note its base URL (ending in `/v1`) and the model id it lists at `<base URL>/models`, then start Atelier once with:

```powershell
$env:ATELIER_BASE_URL = "http://localhost:8000/v1"   # Ollama: http://localhost:11434/v1
$env:ATELIER_MODEL = "your-model-id"
$env:ATELIER_CONTEXT = "32768"                       # optional: your model's context length
pnpm start -- --open
```

A vision-capable model lets Vitruvius look at images you attach.

**What fits your card.** These are the setups we have actually run, and one suggestion we have not:

| GPU memory | What we ran | How sure |
|---|---|---|
| 32 GB | A 27B vision-capable open-weight model, 4-bit, on vLLM. Three chats at once with long context. | Measured in the studio |
| 16 GB | The same 27B family as a 3-bit GGUF on llama.cpp, about 98K context. Slower. | Measured in the studio |
| 8 to 12 GB | A 7 to 9B vision-capable instruct model at 4-bit, 32K context, on llama.cpp, LM Studio or Ollama. | Suggestion only, not measured. Expect weaker tool use. |
| No GPU | Use a cloud route below. | |

Atelier is tuned for Holo-style models, but every model goes through the same path. Each model keeps its own licence; check that it fits how you work.

## 2. A model server on your network

This is how a small office shares one good graphics card: one machine runs the model server, every desk runs Atelier and points at it.

- On the model machine, start the server so it listens on your local network, not only on itself (for llama.cpp `--host 0.0.0.0`; for vLLM `--host 0.0.0.0`; Ollama `OLLAMA_HOST=0.0.0.0`).
- On each desk, use that machine's network address as `ATELIER_BASE_URL`, for example `http://<model-machine>:8000/v1`.

Atelier itself still listens only on each desk. Your prompts travel over your own network to the model machine. Keep that server on a network you trust, and do not open it to the internet. If your server supports an API key, set it and give it to Atelier with `ATELIER_API_KEY`.

## 3. Free cloud tiers through OmniRoute

No GPU needed. Atelier and your design software run on your computer; the AI runs at the providers you connect.

1. Install [OmniRoute](https://github.com/diegosouzapw/OmniRoute), a local AI gateway: `npm install -g omniroute`, then run `omniroute` once.
2. Open its dashboard at `http://localhost:20128` and add providers you have keys for. Free tiers that worked well in testing: Google AI Studio (Gemini), OpenRouter models ending in `:free`, Groq, Cerebras and Mistral. Each needs its own free account and key. Skip any provider whose terms do not allow this use.
3. In the Atelier folder run `node profiles/cloud/setup-omniroute-combos.mjs`. It creates three routes: `atelier-brain` (main), `atelier-fast` (quick helper) and `atelier-vision` (images). Free providers are tried first.
4. Start Atelier with the cloud profile:

   ```powershell
   $env:ATELIER_PROFILE = "cloud"
   pnpm start -- --open
   ```

What we measured with only a free Gemini key and OpenRouter free models: a plain reply in about 3 seconds, a first Atelier chat turn in about 17 seconds including opening the chat. Free tiers have per-minute and per-day limits; when one runs out, the route moves to the next provider you connected.

## 4. Your own API keys

Paid keys you already own (OpenAI, Anthropic, DeepSeek, xAI, OpenRouter credit and others) can be added in the OmniRoute dashboard. The Atelier routes use them only after the free ones. You can also point Atelier straight at any OpenAI-compatible hosted API with `ATELIER_BASE_URL`, `ATELIER_MODEL` and `ATELIER_API_KEY`.

## 5. Your ChatGPT plan

Atelier uses OpenAI's official [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source). It is not a token hack.

1. Start Atelier with the cloud profile (as in route 3).
2. Open `http://127.0.0.1:18345/signin`, sign in, and allow ChatGPT plan usage for the app named Atelier.
3. The page should say **Connected to ChatGPT**. In Atelier's model picker, choose a model under **ChatGPT plan**.

Usage counts against your plan; you can review or limit it in [ChatGPT Settings > Usage](https://chatgpt.com/settings/usage). This route accepts text, images and files as input, but it does not generate images. Honest status: the sign-in and model list work; a full answer has not been timed end to end yet.

## Optional: images for moodboards

Without an image service, moodboards still work as colour and material cards. To add generated images, run an image service with an OpenAI-compatible `/images/generations` endpoint (for example [ComfyUI](https://github.com/Comfy-Org/ComfyUI) behind such an API) or connect an image provider in OmniRoute, then set `ATELIER_IMAGE_ENDPOINT` and `ATELIER_IMAGE_MODEL`. Image models have their own licences.

## Changing your mind later

Your choice is saved in `settings.yaml` and `cordis.patch.yml` in your Atelier home folder. Change it under **Settings > Models** in the app, edit those two files, or delete them and start again with new variables.
