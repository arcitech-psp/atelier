# Model roles: which model does what

Atelier uses a few models, each for one job. You can bring your own model for every job (BYOLLM: bring your own LLM), or press **Set me up** and let Atelier install a small working set for you. Roles you leave empty switch their feature off; nothing breaks.

## Where to find it

- In Atelier: **Settings** (bottom left) > **Model roles**.
- Straight to the page: add `#model-roles` to the address Atelier prints when it starts, for example `http://localhost:3081/?token=...#model-roles`. Installers and first-run screens link here.
- When no brain is connected yet, the page opens by itself once.
- From a terminal: `pnpm roles plan`, `pnpm roles setup`, `pnpm roles show` (see the end of this page).

## The roles

| Role | What it does for you | If you leave it empty |
|---|---|---|
| **Brain** (needed) | The main assistant. It talks with you, plans the work and uses the tools. Pick a model that can read images, so it can look at your sketches and screenshots. | Atelier cannot answer. |
| **Vision** | Looks at images for the brain. Only needed when your brain cannot read images. | A text-only brain cannot look at the images you attach. |
| **Speech to text** | Turns your voice into text: a microphone button appears next to the Send button. | No microphone button. |
| **Text to speech** | Reads answers aloud: a "Read aloud" button appears under each reply. | No "Read aloud" button. |
| **Embeddings** | Search and recall: lets the assistant find the right notes, briefs and schedules in your project folder by meaning, not only by exact words. | The project search tool is not offered. |
| **Image generation** | Concept images for moodboards on the canvas. | Moodboards use colour and material cards only. |
| **Small helper** | A small, fast model for quick side jobs. It appears in the model list, so you can choose it for a quick chat or a sub-agent. | Everything runs on the brain. |

Each card shows the role's status:

- **Connected**: Atelier reached the server and it serves the model you named.
- **Not set**: the role is empty.
- **Failing**: Atelier could not use it; the card says why in plain words (nothing listening, wrong key, wrong model name).
- **Covered by the brain** (Vision only): your brain reads images itself.

## Connect your own model (bring your own)

1. Open the role's card and press **Connect** (or **Change**).
2. Pick a **Server type**. This fills in the usual address; change it if your server runs elsewhere.
3. Type the **Model name** exactly as the server lists it. After **Test**, the box suggests the names the server reported.
4. Add an **API key** only if the server needs one. Local servers usually do not.
5. Press **Test**, then **Save**.

**Use default** puts a role back: to the local server from Set me up if you installed one, otherwise (for the brain) to the endpoint chosen when Atelier first started, or (for other roles) to empty.

Any OpenAI-compatible server works. The usual ones:

| Server | Address | Good for |
|---|---|---|
| [Ollama](https://ollama.com/) | `http://localhost:11434/v1` | Brain, vision, helper, embeddings |
| [LM Studio](https://lmstudio.ai/) | `http://localhost:1234/v1` | Brain, vision, helper, embeddings |
| [llama.cpp server](https://github.com/ggml-org/llama.cpp) | `http://localhost:8080/v1` | Brain, vision, helper, embeddings (`--embeddings`) |
| [vLLM](https://github.com/vllm-project/vllm) | `http://localhost:8000/v1` | Brain, vision, helper, embeddings, speech to text |
| [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (cloud) | `http://localhost:20128/v1` | Brain, vision, helper through free tiers or your keys. Your messages leave your computer. |
| [whisper.cpp server](https://github.com/ggml-org/whisper.cpp) | `http://localhost:8178/v1` | Speech to text. Start it with `--inference-path /v1/audio/transcriptions`. |
| [Speaches](https://github.com/speaches-ai/speaches) | `http://localhost:8000/v1` | Speech to text and text to speech in one server |
| [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) | `http://localhost:8880/v1` | Text to speech (Kokoro voices, e.g. `af_bella`) |
| Image endpoint | the full URL, e.g. `http://localhost:8188/v1/images/generations` | Image generation: any server that answers the OpenAI images API with base64 images |

**ARCITECH recommended.** Each card names the model Atelier is tuned for. For the brain that is the ARCITECH brain on Hugging Face (`arcitech/atelier-brain`, a 27B model in 4-bit for vLLM; it needs a 24 GB graphics card or more). It is a suggestion: any model works.

## Set me up (one click, optional)

**Set me up** downloads the smallest set that works, into a folder you choose, then starts a local server for each role and connects it. It installs:

- the official [llama.cpp](https://github.com/ggml-org/llama.cpp) server (MIT), build b11552, for Windows or Linux (x64), with a graphics-card (Vulkan) build when your computer has Vulkan and a processor-only build otherwise;
- a brain that fits your graphics card: [Qwen3-VL Instruct](https://huggingface.co/collections/Qwen/qwen3-vl) GGUF (Apache-2.0), which reads images;
- [EmbeddingGemma 2](https://huggingface.co/ggml-org/embeddinggemma-2-GGUF) for embeddings (Apache-2.0), run on the processor;
- optionally, speech to text: the [whisper.cpp](https://github.com/ggml-org/whisper.cpp) server (MIT) with the Whisper base model (MIT, 82 MB).

| Your computer | Brain installed | Download (Windows) | With speech to text |
|---|---|---|---|
| No graphics card | Qwen3-VL 2B, 4-bit | 1.9 GB | 2.0 GB |
| 8 GB graphics card | Qwen3-VL 4B, 4-bit | 3.3 GB | 3.4 GB |
| 12 GB graphics card | Qwen3-VL 8B, 4-bit | 6.1 GB | 6.2 GB |
| 16 GB and 24 GB graphics cards | Qwen3-VL 8B, 8-bit | 9.8 GB | 9.9 GB |

Linux downloads are a few megabytes smaller (the server archives are smaller).

How it behaves:

- **Nothing happens until you press Download.** First press **Check space**: it lists every file, its size, its source and its licence, and compares what is needed with the free space in your folder. Unpacked servers take a little extra room; the check counts that too.
- **Folder.** The default is your app data folder: `%LOCALAPPDATA%\Atelier\models` on Windows, `~/.local/share/atelier/models` on Linux and WSL (or `$ATELIER_DATA_DIR/models` if you set it). Any folder with enough space works.
- **Progress, cancel and resume.** A bar shows the progress. **Cancel** stops; pressing the button again (it says **Resume download**) continues where it stopped.
- **Checksums.** Every file is checked against the SHA-256 its publisher lists (Hugging Face and GitHub). A file that does not match is set aside as `.bad` and never used.
- **Servers.** They listen on this computer only (`127.0.0.1`, ports 41901 brain, 41902 embeddings, 41903 speech), with no window. They start with Atelier and stop when Atelier stops. **Stop local servers** turns them off and keeps them off; **Start local servers** brings them back. Logs are in the `logs` folder of the kit.
- **It never overwrites your choice on later starts.** When Atelier starts again, the kit fills only roles that are empty or already its own.
- **macOS** is not supported by the kit; connect a server yourself.

### Which brain for my graphics card?

Rough guidance; speed depends on the card and on how long the chat is.

| Your computer | Brain | What to expect |
|---|---|---|
| No graphics card | Qwen3-VL 2B (4-bit) | Works, but slowly: a few words per second and long waits on big requests. Use Vitruvius Zero, or a cloud brain through OmniRoute. |
| 8 GB | Qwen3-VL 4B (4-bit) | The minimum for a pleasant local experience. Good for design chat, images and short tasks. Vitruvius Zero fits better. |
| 12 GB | Qwen3-VL 8B (4-bit) | Noticeably better answers and tool use. Full Vitruvius works with a 32K context. |
| 16 GB | Qwen3-VL 8B (8-bit) | Higher precision and a longer context. A 14B-class model in 4-bit also fits. |
| 24 GB or more | ARCITECH recommended brain (27B, 4-bit, vLLM) | The model Atelier is tuned for: about 32K context on 24 GB (64K is tight), 128K on 32 GB. |

## Keys and privacy

- Keys are stored only on this computer, in Atelier's credentials file (`.credentials.yaml` in your Atelier home folder), under the names `ATELIER_ROLE_BRAIN_KEY`, `ATELIER_ROLE_EMBEDDINGS_KEY` and so on. On Linux the file is readable by you alone.
- A key is never shown again on the page, never sent back to the browser and never written to a log. To change it, type a new one; to remove it, press **Remove stored key**.
- An environment variable with the same name wins over the stored key.
- Atelier talks to the addresses you enter and nowhere else. If you choose a cloud address, what you send goes there.

## Where the settings live

- **Brain** and **Small helper** are ordinary model routes in `settings.yaml` (`llm-pi-ai` providers `atelier-brain` and `atelier-helper`); the brain is also the default model (`agent-default-model`). You can see and edit them under **Settings > Models** too.
- The other roles are kept in `atelier-roles/roles.json` in your Atelier home folder.
- The starter kit writes `atelier-kit.json` in its own folder.

## From a terminal (installers, WSL, Linux)

```sh
pnpm roles plan  --tier 8gb [--folder <dir>] [--speech]   # list files, sizes, free space; downloads nothing
pnpm roles setup --tier 8gb [--folder <dir>] [--speech]   # download and verify; Atelier starts and connects the servers
pnpm roles show                                           # where each role points (never shows keys)
pnpm roles open                                           # how to open the Model roles page
```

Tiers: `cpu`, `8gb`, `12gb`, `16gb`, `24gb`. Ctrl+C cancels; running the same command again resumes.

## Already installed Atelier before this page existed?

New installs get the Model roles page automatically. An Atelier home created by an earlier preview keeps its own `cordis.patch.yml`; add these two lines under `- insert:` in it (next to `atelier-canvas`), then restart Atelier:

```yaml
    - id: atelier-roles
      name: '@arcitech/atelier-roles'
```

## When something fails

| The card says | What to do |
|---|---|
| Nothing is listening at this address | Start the server, or check the port in the address. |
| The server does not serve "…" | Pick one of the model names the card lists. |
| The server refused the key | Type the key again, or check it in the provider's dashboard. |
| No answer within a few seconds | The server may still be loading a model; press Test again in a minute. |
| A Set me up server "did not start" | Open the `logs` folder in the kit folder. A graphics driver without Vulkan support can stop the graphics build; choose "No graphics card" to use the processor build. |
