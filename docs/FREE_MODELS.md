# Use Atelier for free

Atelier is free. It does not include an AI model, so you connect one. This page shows the free ways to do that, in plain steps.

There are two routes:

- **Cloud models with a free tier.** You make a free account with a provider, copy a key, and paste it into Atelier. No graphics card needed. What you type is sent to that provider.
- **A model on your own computer.** Nothing leaves your machine. You need a reasonably modern computer, and a graphics card helps a lot.

Free tiers change. The facts below were checked against each provider's own pages on 11 October 2026. Before you rely on a number, look at the provider's page (every table row links to it).

## Which should I pick?

- Want to start in ten minutes and have no strong graphics card: **Google AI Studio** (Gemini). It needs a Google account and no card, and Gemini models can read the images you attach.
- Already have an account with one of the others, or want a second option when Google runs out: **OpenRouter** or **Groq**.
- Working on a confidential client project: run the model on your own computer ([Run it fully local](#run-it-fully-local)). Do not send client material to a free cloud tier.
- Not sure: use approach B below and let your own AI assistant walk you through it.

A free tier is a trial-sized allowance. Atelier sends a block of instructions with every message, so a long design session can use up a small allowance quickly. If you hit a limit, wait, or add a second provider.

## The free options

| Provider | What is free | Card needed | Get a key |
|---|---|---|---|
| [Google AI Studio (Gemini API)](https://ai.google.dev/gemini-api/docs/pricing) | A free tier with several Gemini models, for example `gemini-3.8-flash`, `gemini-3.6-flash` and `gemini-2.5-pro`. Limits are shown in your AI Studio account. | No. Billing is only for moving to a paid tier. | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| [OpenRouter](https://openrouter.ai/collections/free-models) | Models whose name ends in `:free`, and the `openrouter/free` router that picks one for you. 20 requests per minute. 50 requests per day, or 1,000 per day once you have bought at least 10 credits. | No, only to buy credits. | [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys) |
| [Groq](https://console.groq.com/docs/rate-limits) | A free plan. For `openai/gpt-oss-120b`, `openai/gpt-oss-20b` and `qwen/qwen3.8-27b`: 30 requests per minute, 1,000 per day, 8,000 tokens per minute, 200,000 tokens per day. | No. A card is only for the paid Developer plan. | [console.groq.com/keys](https://console.groq.com/keys) |
| [Mistral](https://docs.mistral.ai/admin/billing-usage/usage-limits) | A free mode that lets you create API keys and use a monthly allowance. The limits are shown on the Limits page of your account. | Not stated by Mistral | [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys) |
| [NVIDIA build](https://build.nvidia.com/) | Free API endpoints for some hosted models, for example `nvidia/nemotron-3-ultra-550b-a55b`. NVIDIA's pages do not state the limits; they show in your account. | Not stated by NVIDIA | Open a model page on [build.nvidia.com](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b) and press **Generate API Key** |
| [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/) | 10,000 "Neurons" per day on the Workers Free plan, reset at 00:00 UTC. Some models need a paid plan. | Not stated by Cloudflare | [Sign up](https://dash.cloudflare.com/sign-up), then [create an API token](https://dash.cloudflare.com/profile/api-tokens). More steps than the others. |

Notes:

- **Google:** on the free tier, Google says your content may be used to improve its products. The paid tier says it is not. Read the [pricing page](https://ai.google.dev/gemini-api/docs/pricing) before you send anything private.
- **Groq:** 8,000 tokens per minute is small. Atelier's start-up text alone is about 1,900 tokens in **Vitruvius Zero** and about 3,400 in **Vitruvius**. Choose Vitruvius Zero, and expect to wait between messages.
- **OpenRouter:** free models differ a lot. Atelier works best with a model that supports tool calling. If one fails, pick another from the [free list](https://openrouter.ai/collections/free-models).
- **Mistral and NVIDIA:** the free offer is real, but the providers do not publish numbers on the pages we could read. Check your account.
- **Cloudflare:** the address contains your account ID, so you need to copy two things, the account ID and a token.

**Checked and left out**

- **Cerebras** gives a one-time $5 credit that needs a payment method and expires after 30 days ([pricing](https://www.cerebras.ai/pricing)). That is a trial, not a free tier.
- **GitHub Models** was retired on 30 July 2026 ([notice](https://docs.github.com/en/github-models)).
- **Hugging Face Inference Providers** gives free accounts no monthly credits; you need to buy credits or have PRO ([pricing](https://huggingface.co/docs/inference-providers/pricing)).

## Approach A: add a key yourself

You need Atelier installed and open. About ten minutes.

### 1. Get a key

1. Pick one provider from the table. Google AI Studio is the simplest.
2. Open its key link, sign in or sign up, and create an API key.
3. Copy the key. Treat it like a password. Do not post it, e-mail it or paste it into a chat.

### 2. Find the place in Atelier

- The first time Atelier starts with no model, it opens the **Model roles** page by itself.
- Any other time: **Settings** (bottom left) > **Model roles**. On Windows you can also use the AIT icon next to the clock > **Set up model endpoint**.
- On the **Brain** card press **Connect** (or **Change** if one is already set).

### 3. Fill in the Brain card

| Field | What to put |
|---|---|
| **Server type** | **Custom OpenAI-compatible** |
| **Address** | The base URL from the table below |
| **API key** | Your key |
| **Model name** | The model from the table below (or any name the provider lists) |
| **This model reads images** | Tick it if the model reads images. Gemini models do. For others, check the model's page. |
| **Context window (tokens)** | Leave the default unless you know your model's limit |

Base URLs and example models:

| Provider | Address | Example model name |
|---|---|---|
| Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.8-flash` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openrouter/free` |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` |
| Mistral | `https://api.mistral.ai/v1` | `mistral-large-latest` (check which models your free mode allows) |
| NVIDIA build | `https://integrate.api.nvidia.com/v1` | `nvidia/nemotron-3-ultra-550b-a55b` |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1` | `@cf/openai/gpt-oss-120b` |

Atelier removes a trailing `/` from the address for you.

### 4. Test, then save

1. Press **Test**. Atelier asks the provider which models it offers. If the card says **Connected**, the key and address work, and the box under **Model name** now suggests the exact names the provider uses. Pick one.
2. If the card says **Failing**, it tells you why in plain words. The usual causes are a wrong address, a key copied with a space at the end, or a model name that is not in the provider's list.
3. Press **Save**.

### 5. Try one message

Open a new chat, choose **Vitruvius** (or **Vitruvius Zero** for a small allowance), and send: "Sketch a plan for a 4 by 5 m home studio with a desk and a bookshelf." If you get an answer, you are done.

If the answer says the limit is reached, wait a minute, or try another model or provider.

### Optional: the settings file

The Model roles page writes this for you, so you normally never need to edit a file. It is shown so you can see what is stored. It lives in `settings.yaml` in your Atelier home folder (`%APPDATA%\Atelier-Preview` on Windows, `~/.config/atelier-preview` on Linux and WSL):

```yaml
llm-pi-ai:
  providers:
    atelier-brain:
      displayName: Brain (Model roles)
      api: openai-completions
      baseURL: https://generativelanguage.googleapis.com/v1beta/openai
      apiKeyEnv: ATELIER_ROLE_BRAIN_KEY
      models:
        - id: gemini-3.8-flash
          name: gemini-3.8-flash
          contextWindow: 32768
          maxTokens: 8192
          input: [text, image]
agent-default-model:
  provider: atelier-brain
  model: gemini-3.8-flash
```

The key itself is not in this file. It is stored separately on your computer under the name `ATELIER_ROLE_BRAIN_KEY`. An environment variable with that name takes priority over the stored key. To remove the stored key, press **Remove stored key** on the card.

## Approach B: let your own AI assistant set it up

If you already use Claude, ChatGPT, Gemini or Copilot, it can guide you step by step. You stay in control: it explains, you click.

1. Open your assistant in a new chat.
2. Copy the whole prompt below and send it.
3. Open Atelier's **Settings > Model roles** page next to the chat.
4. When the assistant asks, send a screenshot of that page or of the provider's page. **Cover the key first**: never include a visible key in a screenshot.
5. Follow the steps. When you have a key, paste it only into the **API key** box in Atelier.

What the assistant needs to see: a screenshot of the Model roles page (the Brain card, after pressing **Connect**), and later a screenshot of the card after **Test**, so it can read the status message. If you hit an error on a provider's website, a screenshot of that page helps too.

### The prompt to copy

```text
You are helping me connect a free AI model to a desktop app called Atelier. I am an architect, not a programmer. Use plain English, short sentences, and one step at a time. Wait for me to confirm each step before the next.

RULES YOU MUST FOLLOW
1. Never ask me to paste, type or send my API key into this chat. Not even part of it. I will paste the key only into the API key box in Atelier. If I paste a key here by mistake, tell me to delete it from this chat and create a new key in the provider's dashboard.
2. If I send a screenshot, tell me to hide any key first. If one is visible, tell me to revoke it and make a new one.
3. Free tiers change. Do not trust your memory for limits, model names or addresses. Open the provider's own page (links below) if you can browse, or ask me to open it and send a screenshot or the text.
4. Never ask me for a credit card unless the provider requires it, and say so before I sign up.
5. Tell me honestly that what I send to a cloud provider leaves my computer, and that some free tiers may use my content to improve their products. If I mention confidential client work, suggest running a model on my own computer instead (Ollama or LM Studio) and help me with that.

WHAT ATELIER IS
Atelier is free software for architects, installed on my computer. It does not include an AI model. It connects to any model server that speaks the "OpenAI-compatible" interface.

WHERE THE SETTING LIVES
Atelier > Settings (bottom left) > Model roles > the "Brain" card > press "Connect" (or "Change"). The fields are:
- Server type: choose "Custom OpenAI-compatible"
- Address: the provider's base URL (usually ends in /v1)
- API key: my key
- Model name: the model's exact name. After I press "Test", the box suggests the names the provider reports.
- "This model reads images": tick if the model can read images
- Context window (tokens): leave the default
Then I press "Test" (the card should say Connected), then "Save". Then I open a new chat and send one message.

FREE OPTIONS (checked 11 October 2026; verify before you rely on them)
- Google AI Studio (Gemini API). Key: https://aistudio.google.com/apikey . Address: https://generativelanguage.googleapis.com/v1beta/openai . Example model: gemini-3.8-flash . Free tier, no card. Limits are listed in my AI Studio account. Pricing: https://ai.google.dev/gemini-api/docs/pricing
- OpenRouter. Key: https://openrouter.ai/settings/keys . Address: https://openrouter.ai/api/v1 . Free models end in ":free"; "openrouter/free" picks one. Free list: https://openrouter.ai/collections/free-models . Limits: https://openrouter.ai/docs/api-reference/limits . No card for free models.
- Groq. Key: https://console.groq.com/keys . Address: https://api.groq.com/openai/v1 . Example model: openai/gpt-oss-120b . Free plan, no card. Limits: https://console.groq.com/docs/rate-limits . The free token limit per minute is small.
- Mistral. Key: https://console.mistral.ai/api-keys . Address: https://api.mistral.ai/v1 . Free mode with limits shown in my account. Limits: https://docs.mistral.ai/admin/billing-usage/usage-limits
- NVIDIA build. Key: open a model page at https://build.nvidia.com/ and press "Generate API Key". Address: https://integrate.api.nvidia.com/v1 . Example model: nvidia/nemotron-3-ultra-550b-a55b
- Cloudflare Workers AI. Sign up: https://dash.cloudflare.com/sign-up . Needs my account ID and an API token. Address: https://api.cloudflare.com/client/v4/accounts/MY_ACCOUNT_ID/ai/v1 . More steps than the others. Pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Fully local, free, nothing leaves my computer: Ollama https://ollama.com/download (address http://localhost:11434/v1) or LM Studio https://lmstudio.ai/ (address http://localhost:1234/v1; start its server in the Developer tab). No key needed.

WHAT TO DO
1. Ask me three short questions: do I have a strong graphics card (or how much memory it has), is this project confidential, and do I already have a Google, OpenRouter or other account. Then recommend one option and say why. Default to Google AI Studio if I have no graphics card and the work is not confidential.
2. Walk me through creating the key on the provider's site, one step at a time. Remind me to keep it private.
3. Ask me to open Atelier's Model roles page and send a screenshot (key hidden). Tell me exactly what to type in each field, using the values above.
4. After I press Test, ask for a screenshot of the card. If it says Failing, read the message and tell me the single most likely fix (wrong address, a stray space in the key, or a wrong model name).
5. When it says Connected, tell me to press Save, open a new chat in Atelier, pick Vitruvius, and send: "Sketch a plan for a 4 by 5 m home studio with a desk and a bookshelf."
6. If the free allowance runs out later, explain what happened and suggest a second provider.

Start with step 1 now.
```

## Run it fully local

Nothing leaves your computer, and there are no limits other than your hardware. Atelier ships no model, so you install a model server first.

**Ollama**

1. Install [Ollama](https://ollama.com/download) and start it.
2. Download a model that reads images, for example, in a terminal: `ollama pull qwen3-vl:8b`. Pick a size that fits your graphics card (see the table in [Add your endpoint](add-your-endpoint.md#which-model-for-my-graphics-card)).
3. In Atelier, on the **Brain** card: **Server type** Ollama, **Model name** `qwen3-vl:8b`, **Test**, **Save**.

**LM Studio**

1. Install [LM Studio](https://lmstudio.ai/), download a model in it and load it.
2. Open the **Developer** tab and switch **Start server** on.
3. In Atelier: **Server type** LM Studio, press **Test**, pick the model it lists, **Save**.

**llama.cpp** is also supported: see [Add your endpoint](add-your-endpoint.md#llamacpp-server). The **Set me up** button on the Model roles page can download one for you, after showing the sizes and checking your disk space.

A computer with no graphics card can run a small model, slowly. If that is you, a free cloud tier above is the easier start.

## Privacy

- Your key stays on your computer. Atelier stores it in its own credentials file, never shows it again on the page, and never writes it to a log.
- Atelier sends no telemetry. It talks only to the addresses you enter.
- A cloud provider sees everything you send it: your messages, and any images or files you attach. Its own terms decide what it does with them. Some free tiers use content to improve their products.
- For confidential client work, use a model on your own computer.
- If a key leaks, delete it in the provider's dashboard and make a new one.

## If something goes wrong

| What you see | What to try |
|---|---|
| **Failing**: nothing is listening at this address | Check the address. Cloud addresses start with `https://` and usually end in `/v1`. |
| **Failing**: the server refused the key | Type the key again. Check for a space at the end. Check it in the provider's dashboard. |
| **Failing**: the server does not serve this model | Press **Test** and pick a name from the list it suggests. |
| Answers stop with a limit message | You used the free allowance. Wait, pick another model, or add a second provider. |
| Answers are short or tools do not run | Some free models are weak at tools. Try another model, and use Vitruvius Zero. |

More: [Troubleshooting](troubleshooting.md), [Model roles](ROLES_SETUP.md), [Add your endpoint](add-your-endpoint.md).
