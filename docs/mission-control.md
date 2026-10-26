# Mission Control: what this computer is doing, and what it costs

Mission Control is the chip in the session header, next to **Canvas**. It shows the current model and local usage; press it to open the panel. **Devices and services** is also available in Settings > General, before a chat starts. Device inventory and assignments stay in your Atelier config. Devices are checked at their configured addresses, and config is sent to a config server only when you press **Publish to clients**.

| Panel | What it shows |
|---|---|
| **Devices and services** | Connected machine status, accelerator inventory, service health and the device/GPU assignment for each service. Add a read-only device agent to report accelerator memory. |
| **Models** | Every model role you have set up (main model, helper, vision, embeddings...) with its state: loaded, loading, not loaded, offline. See [One graphics card, several models](ONE_GPU.md). |
| **This computer** | Graphics card use, memory, temperature and power (NVIDIA cards, read with `nvidia-smi`), processor and memory use, and charts of the last ten minutes. |
| **Tokens and speed** | Tokens and requests today and since Atelier started, writing speed (tokens per second), time to the first token, and how often a reply waited more than 15 seconds for a model to load. |
| **Energy and cost** | Energy used today, since Atelier started and during a stopwatch run, with the cost at your own price. |
| **Stopwatch** | Start, Lap, Stop: time, tokens, energy and cost for one piece of work. Earlier runs can be downloaded as a CSV file. |
| **Wait for models to load** | On by default. The switch for computers that swap models in and out of one graphics card. See [One graphics card, several models](ONE_GPU.md#wait-for-models-to-load). |

## Energy and cost

1. In **Energy and cost**, choose your **Currency** and type the **Price per kWh** from your electricity bill (the "rate", for example 0.229). Press **Save**. Until you do, the panel uses a typical price for the currency and says so.
2. Atelier then works out `cost = energy in kWh x price`.

Where the energy comes from, and how honest the number is:

- **Measured.** On an NVIDIA graphics card Atelier reads the card's power draw with `nvidia-smi` about every 5 seconds while the panel is open, a model reply is being written, or the stopwatch runs, and adds up power times time. This covers **the graphics card only**. The processor, the screen and the rest of the computer are not included, so your real bill for the same hours is higher. Gaps longer than 30 seconds are not guessed.
- **Estimate.** If the card cannot report its power (AMD, Intel, no driver tool), type your computer's typical power draw while it works into **Power if the card cannot report it (W)**. Atelier then multiplies it by the time the harness was working on model replies and labels the result an **estimate** everywhere. If you type nothing, the panel shows no energy figure rather than inventing one.
- A reading beats an estimate: if the card reports power, the estimate is not used.

Your price, currency and estimate are kept in `atelier-mission/state.json` in your Atelier home folder (on Windows `%APPDATA%\Atelier-Preview`, on Linux `~/.config/atelier-preview`), together with the daily totals and stopwatch runs. The file holds counts and times only. No message text is stored. Delete the file to start again.

## What it reads

- Tokens and timings come from the harness's own session events: the number of tokens each reply reported, and when it started and finished. Not the text.
- Graphics card readings use local driver data only: `nvidia-smi`, Intel `xpu-smi` when available, AMD `rocm-smi` when available, and Linux graphics sysfs. Unsupported readings stay unavailable instead of being guessed. On other systems without a supported local reader, the panel shows processor and memory only. To switch card reading off completely, add `config: {readGpu: false}` to the `atelier-mission` entry in `cordis.patch.yml`.
- The current model state is read from your model server's own endpoints, about every 5 seconds while the panel is open. Assigned service health uses its configured health route, at most once per 30 seconds with backoff after failures. Atelier never loads or unloads a model by itself. If you want buttons for that, the optional [Brains](brains.md) section in Settings does it, only when you press them.

## Devices and services

The **Devices and services** panel is part of Mission Control. Add a device by its HTTP address. For accelerator inventory and memory, start the read-only device agent on that machine:

```sh
node public/atelier-mission/agent.mjs
```

It listens on loopback port 41920 by default. To let another machine query it, set `ATELIER_MISSION_AGENT_HOST` to a network interface and `ATELIER_MISSION_AGENT_PORT` to a reachable port before starting it. Then add `http://machine:41920` in Mission Control. The agent only answers `GET /api/atelier-mission/agent`; it does not run commands or manage models. Without the agent, a device address is checked directly and no GPU inventory is shown.

Choose a service, device, accelerator, endpoint and the endpoint's own health route. Test checks that route; Save tests again unless a recent successful service check is still within the 30-second limit, then stores the assignment. Assignments are written to the existing Model roles configuration used by the harness, including device and accelerator IDs. Chat, image, speech and embeddings also update their active role endpoints; video, 3D and search retain the same assignment data for profile consumers. Each change writes `control.backup.json`; **Undo last change** restores the prior Mission Control config and, for a Model roles entry, its previous role config.

Health checks are made at most once per service per 30 seconds. A failed check waits 60 seconds before the next attempt, doubling to a 15-minute ceiling. Device reachability is refreshed every 30 seconds.

### Config server draft

No `CONFIG-SCHEMA.md` was present in the shared reference folder when this page was written. The candidate schema is [config-server-schema-draft.json](config-server-schema-draft.json), version 1. The current hook uses `POST /api/config/publish` with `{schemaVersion, devices, assignments}` and `GET /api/config/current` with that document as the response. Confirm these paths and the schema with the config-server job before calling the contract final.

Mission Control is also available at **Settings > General > Devices and services**, so device and service assignments work before a chat session starts.
