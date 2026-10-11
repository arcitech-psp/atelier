# One graphics card, several models (16 GB and under)

Atelier works best with a few models, each with its own job: the **main model** (the brain), a **vision** model that reads plans and photos, an **embeddings** model for project search, and sometimes a small **helper** ([Model roles](ROLES_SETUP.md)). On a computer with one 16 GB graphics card they do not all fit in memory at once. That is fine: let your model server **swap** them. A model is loaded when Atelier first asks for it and unloaded again when it has been idle for a while or when another one needs the room.

You do not need anything new for this. LM Studio, Ollama and llama-swap already do the swapping. Atelier adds two things:

- **It waits.** The first request to a model that is not loaded yet takes as long as the load, from a few seconds to a few minutes. Atelier waits for it instead of giving up ([Wait for models to load](#wait-for-models-to-load)).
- **It shows you.** The chip in the session header, and Mission Control behind it, tell you which model is loaded now, which is loading, and which will load on first use ([How the indicator works](#how-the-indicator-works)).

## What fits in 16 GB

Rough figures for 4-bit models; the exact size depends on the model and on the context length you give it (more context needs more memory).

| Model | Memory when loaded |
|---|---|
| Main model, 8 to 14 billion parameters | 5 to 10 GB, plus 1 to 4 GB for a long context |
| Vision model, 7 to 8 billion parameters | 5 to 7 GB |
| Embeddings model | 0.3 to 1 GB |
| Small helper, 1 to 4 billion parameters | 1 to 3 GB |

So a 14B main model and a 7B vision model do not fit together in 16 GB with a useful context, but the main model and the embeddings model do. Set the tool up so that big models swap and small ones can stay.

## Pick your tool

| | Loads on first use | Unloads when idle | Frees room for another model | Tells Atelier what is loaded |
|---|---|---|---|---|
| [LM Studio](https://lmstudio.ai/) | Yes (just-in-time loading) | Yes (idle TTL, default 60 min) | Yes (auto-evict, on by default) | `GET /api/v0/models` |
| [Ollama](https://ollama.com/) | Yes | Yes (`keep_alive`, default 5 min) | Yes, when a new model needs the memory | `GET /api/ps` |
| [llama-swap](https://github.com/mostlygeek/llama-swap) (for llama.cpp) | Yes | Optional (`ttl`) | Yes, by default one model at a time | `GET /running` |

Not sure which? LM Studio is the easiest (windows and buttons). Ollama is the lightest to run in the background. llama-swap gives the most control over `llama-server` settings, and is the choice when you use llama.cpp directly or Atelier's own **Set me up** kit.

In all three, Atelier connects the usual way ([Add your endpoint](add-your-endpoint.md)): every role points at the same address, and the **model name** tells the server which model you mean.

### LM Studio

1. In LM Studio, download the models you want: the main model, a vision model, an embeddings model.
2. Open the **Developer** tab and switch the server on (address `http://localhost:1234/v1`). Just-in-time (JIT) loading is on by default: do not load anything by hand, a model is loaded when Atelier asks for it.
3. Two LM Studio features do the unloading. **Idle TTL** unloads a model that has received no request for a while (default 60 minutes; a shorter TTL gives the memory back sooner). **Auto-Evict** unloads the models that JIT loaded before it loads a new one (on by default; switch it on or off in the Developer tab, Server Settings). Both are described on LM Studio's page [Idle TTL and Auto-Evict](https://lmstudio.ai/docs/developer/core/ttl-and-auto-evict).
4. In Atelier, on **Settings > Model roles**, set Brain, Vision and Embeddings to server type **LM Studio**, the same address, and the model name LM Studio shows for each one (**Test** lists them).
5. Auto-evict means that asking for the vision model unloads the main model first (and the next chat message loads it again). That is the swap. If your models all fit together, switch Auto-Evict off in Server Settings and nothing swaps.

LM Studio lists model state through its REST API: [`/api/v0/models`](https://lmstudio.ai/docs/developer/rest/endpoints) (and, in newer versions, [`/api/v1/models`](https://lmstudio.ai/docs/developer/rest/list)). Atelier reads either.

### Ollama

1. Install Ollama and pull the models: `ollama pull qwen3:14b`, `ollama pull qwen3-vl:8b`, `ollama pull nomic-embed-text` (use the ones that suit your card).
2. Ollama loads a model on its first request and keeps it for 5 minutes after the last one. Change that for every model with the `OLLAMA_KEEP_ALIVE` environment variable (for example `2m`; `-1` keeps models loaded for ever). Quit Ollama from the tray icon, set the variable in the Windows **Environment Variables** settings (or in your shell on Linux), and start Ollama again.
3. With little memory, Ollama queues a request for a model that does not fit until the models that are loaded have gone idle, then unloads them to make room. To force one model at a time, set `OLLAMA_MAX_LOADED_MODELS=1`.
4. In Atelier: server type **Ollama** (address `http://localhost:11434/v1`), and the model name exactly as `ollama list` shows it (`qwen3:14b`).

Ollama documents all of this in its [FAQ](https://docs.ollama.com/faq) (keep-alive and concurrent loads). `GET /api/ps` is documented in its [API reference](https://github.com/ollama/ollama/blob/main/docs/api.md).

Ollama's `/api/ps` only lists models that are in memory, so while a model is loading it still shows as "not loaded". Atelier fills that gap: see below.

### llama-swap (llama.cpp)

[llama-swap](https://github.com/mostlygeek/llama-swap) (MIT licence) is a small program that sits in front of `llama-server`. It starts the right `llama-server` for the model a request names, and stops it when another is needed.

1. Install it: `winget install llama-swap` on Windows, or download a binary from the [releases page](https://github.com/mostlygeek/llama-swap/releases).
2. Write a `config.yaml`. One entry per model; the key is the name Atelier will use:

```yaml
healthCheckTimeout: 300      # seconds a model may take to become ready (default 120)
models:
  brain:
    cmd: llama-server --port ${PORT} -m C:\models\qwen3-14b-q4_k_m.gguf -c 16384 -ngl 99
    ttl: 600                 # unload after 10 minutes idle (0 = keep until another model needs the room)
  vision:
    cmd: llama-server --port ${PORT} -m C:\models\qwen2.5-vl-7b-q4_k_m.gguf --mmproj C:\models\qwen2.5-vl-7b-mmproj.gguf -c 8192 -ngl 99
    ttl: 300
  embeddings:
    cmd: llama-server --port ${PORT} -m C:\models\embeddinggemma-q8_0.gguf --embeddings
    ttl: 0
```

3. Start it: `llama-swap --config config.yaml --listen localhost:8080`.
4. In Atelier: server type **llama.cpp server** (address `http://localhost:8080/v1`) for every role, and the model names `brain`, `vision`, `embeddings`.

By default llama-swap runs **one model at a time**: asking for `vision` stops `brain`. To keep small models loaded while the big ones swap, put them in a group that other groups cannot unload ([routing groups](https://github.com/mostlygeek/llama-swap/blob/main/docs/config.example.yaml)). If a big model needs longer than `healthCheckTimeout` to load, raise it, or the request fails with a 502 even though Atelier is still waiting.

`sendLoadingState: true` in the llama-swap config makes it stream "loading" messages while a model starts. Atelier may show those lines as the model's thinking. Leave it off if you prefer a quiet wait.

Atelier's **Set me up** kit (Model roles page) starts one `llama-server` per role and keeps them all loaded. That is right for 24 GB and above or small models; on 16 GB with larger models use llama-swap instead.

## Wait for models to load

By default the harness gives up on a model after five minutes with no answer, and a model that swaps in from a slow disk can take longer than that. Open **Mission Control** (the chip in the session header) and use the **Wait for models to load** panel at the bottom:

- Press **Turn on**, and choose how many minutes to wait (default 15, at most 60).
- For every model route that points to this computer or your own network, Atelier then raises three timers, so that the load is waited for rather than failed: the HTTP wait for the first byte of the reply, the provider's request timeout (`timeoutMs`), and the stream idle timer (`streamIdleTimeoutMs`). It also allows more retries (8, with pauses up to 15 s) for a refused connection or a server error while the server swaps. A silent server is still not retried after a long wait: that would hide a stuck server for hours.
- Routes that point to hosted APIs on the internet keep their normal timers. A value you set yourself in `settings.yaml` is never overwritten, and **Turn off** removes only what Atelier added.
- It applies to your next message. Routes you add later (on the Model roles page) are covered the next time Atelier starts.

Nothing else is needed for the **first request** to work: a request to a model that is not loaded waits inside the model server, and the answer starts as soon as the load is done. This setting only lengthens how long Atelier is patient.

## How the indicator works

The chip next to **Canvas** in the session header shows your main model and its state; press it to open Mission Control. The **Models** panel lists every role you have set up (main model, helper, vision, embeddings and so on):

| Word | Meaning |
|---|---|
| **Loaded** | The model is in memory now. Where the server says so, the panel also shows its size and when it will be unloaded if idle. |
| **Loading** | The server says it is starting the model, or (see below) a request has waited for its first token to a model that is not in memory. |
| **Unloading** | The server is stopping the model (llama-swap). |
| **Not loaded** | The server knows the model but it is not in memory. It loads the first time it is used. |
| **Not tracked** | The server is none of the three above (for example a plain `llama-server` or vLLM), so it does not report what is loaded. It is shown as reachable. |
| **Offline** | The server does not answer. The panel says why in plain words. |

Atelier reads the state from each tool's own endpoint, about every 5 seconds (every 2 seconds while a load is going on): LM Studio `GET /api/v0/models` (then `/api/v1/models`), Ollama `GET /api/ps`, llama-swap `GET /running`. It recognises the tool by the shape of the answer, not by the port, so a server on any address works. It sends your API key only to the server it belongs to. It never loads or unloads anything itself.

Two of the states are worked out rather than read, and are marked that way in the panel: LM Studio and Ollama have no "loading" state in those endpoints. If the main model is reported as not loaded and a request has already waited more than 1.5 seconds for its first token, Atelier shows **Loading** and the number of seconds waited. The **Tokens and speed** panel also counts **Model loads waited for**: replies whose first token took longer than 15 seconds, and shows the slowest first-token time, so you can see what swapping costs you.

## Tips for a smoother swap

- Pick models that load fast: an SSD makes a big difference, and a model of 8 to 14 billion parameters loads in seconds to a minute. A hard disk can take several minutes for the same file.
- Give the main model the context it needs and no more. Memory for the context is part of the load.
- Prefer one swap per task: finish the drawing review in the vision model, then continue in the main model, rather than switching on every message.
- Keep embeddings and a small helper loaded and let only the big models swap.

If something does not work as described here, see [Troubleshooting](troubleshooting.md). Mission Control itself is described in [Mission Control](mission-control.md).
