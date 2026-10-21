# Mission Control: what this computer is doing, and what it costs

Mission Control is the chip in the session header, next to **Canvas**. It shows your main model and whether it is loaded; press it to open the full panel. Everything in it is about **this computer only**. Nothing is sent anywhere.

| Panel | What it shows |
|---|---|
| **Models** | Every model role you have set up (main model, helper, vision, embeddings...) with its state: loaded, loading, not loaded, offline. See [One graphics card, several models](ONE_GPU.md). |
| **This computer** | Graphics card use, memory, temperature and power (NVIDIA, Intel and AMD, using the local driver tools or Linux graphics sysfs), processor and memory use, and charts of the last ten minutes. |
| **Tokens and speed** | Tokens and requests today and since Atelier started, writing speed (tokens per second), time to the first token, and how often a reply waited more than 15 seconds for a model to load. |
| **Energy and cost** | Energy used today, since Atelier started and during a stopwatch run, with the cost at your own price. |
| **Stopwatch** | Start, Lap, Stop: time, tokens, energy and cost for one piece of work. Earlier runs can be downloaded as a CSV file. |
| **Wait for models to load** | On by default. The switch for computers that swap models in and out of one graphics card. See [One graphics card, several models](ONE_GPU.md#wait-for-models-to-load). |

## Energy and cost

1. In **Energy and cost**, choose your **Currency** and type the **Price per kWh** from your electricity bill (the "rate", for example 0.229). Press **Save**. Until you do, the panel uses a typical price for the currency and says so.
2. Atelier then works out `cost = energy in kWh x price`.

Where the energy comes from, and how honest the number is:

- **Measured.** When the graphics driver reports card power, Atelier reads it about every 5 seconds while the panel is open, a model reply is being written, or the stopwatch runs, and adds up power times time. This covers **the graphics card only**. The processor, the screen and the rest of the computer are not included, so your real bill for the same hours is higher. Gaps longer than 30 seconds are not guessed.
- **Estimate.** If the card cannot report its power, type your computer's typical power draw while it works into **Power if the card cannot report it (W)**. Atelier then multiplies it by the time the harness was working on model replies and labels the result an **estimate** everywhere. If you type nothing, the panel shows no energy figure rather than inventing one.
- A reading beats an estimate: if the card reports power, the estimate is not used.

Your price, currency and estimate are kept in `atelier-mission/state.json` in your Atelier home folder (on Windows `%APPDATA%\Atelier-Preview`, on Linux `~/.config/atelier-preview`), together with the daily totals and stopwatch runs. The file holds counts and times only. No message text is stored. Delete the file to start again.

## What it reads

- Tokens and timings come from the harness's own session events: the number of tokens each reply reported, and when it started and finished. Not the text.
- Graphics card readings use local driver data only: `nvidia-smi`, Intel `xpu-smi` when available, AMD `rocm-smi` when available, and Linux graphics sysfs. Unsupported readings stay unavailable instead of being guessed. On other systems without a supported local reader, the panel shows processor and memory only. To switch card reading off completely, add `config: {readGpu: false}` to the `atelier-mission` entry in `cordis.patch.yml`.
- Model state is read from your model server's own endpoints, about every 5 seconds while a chat is open. Atelier never loads or unloads a model by itself. If you want buttons for that, the optional [Brains](brains.md) section in Settings does it, only when you press them.
