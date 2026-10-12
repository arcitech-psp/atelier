# Brains: see what is loaded, and switch it

**Settings > General > Brains** shows the model your computer is running **right now**, and lets you load a different one, unload it, or restart it. It reads the answer from the model server itself, so the name on the screen is what is really loaded, not a label someone typed.

Each computer is one compact row:

- a coloured dot (green: loaded, amber: working, red: a problem, grey: nothing loaded),
- the computer and its graphics card,
- the brain that is loaded, and how fast it is writing (tokens per second),
- a **Change** button.

Press **Change** to choose a brain from the list, then **Load**, **Unload** or **Reload**. Atelier asks you to confirm in the page before it does anything, shows progress while the model loads, and, if it fails, shows the last lines of the model's log so you can see why.

If the brain you choose does not fit next to the one that is loaded, Atelier unloads the first one before it starts the second. One graphics card, one brain at a time.

## Setting it up (once)

Atelier cannot guess how you start your model server, and it will never run a command that is not written down by you. The list lives in a small file, `brains.json`.

1. Open the folder named in the Brains section (Atelier also leaves a file called `brains.example.json` there). On Windows it is inside `%APPDATA%\Atelier-Preview\atelier-brains`, on Linux inside `~/.config/atelier-preview/atelier-brains`.
2. Copy `brains.example.json` to `brains.json`.
3. Edit it: your graphics card's name and memory, and for each model you want in the list: a friendly name, the port its server uses, and how to start and stop it.
4. Reopen Settings. Changes to `brains.json` are picked up without restarting Atelier. If the file has a mistake, the section says what is wrong in plain words and keeps the last good list.

### What a brain needs

| Line | Meaning |
|---|---|
| `id` | A short name with lowercase letters, numbers and dashes. |
| `name`, `blurb` | What you see in the list: "Qwen3 14B", "quick and light, 32K context". |
| `engine` | llama.cpp, vLLM, Ollama... only shown to you. |
| `port` | The port the model server listens on. Atelier asks `http://127.0.0.1:<port>/v1/models` to see whether it is loaded (change it with `healthUrl`). |
| `vramGb` | The graphics card memory this brain needs. A brain that cannot fit on your card is refused. |
| `metricsUrl` (optional) | A llama.cpp `/metrics` address, to show tokens per second. |
| `loadTimeoutSec` (optional) | How long to wait for the model to answer after starting (default 180). |
| `logFile` (optional) | The model server's log. Atelier shows its last lines if loading fails. |
| `start`, `stop` | What to do. See below. |

### The only things Atelier can do

`start` and `stop` are short lists made of these actions, and nothing else:

| Action | What it does |
|---|---|
| `{"type": "spawn", "file": "...", "args": [...]}` | Starts a program on this computer, with no window, and keeps it running even if Atelier is closed. |
| `{"type": "kill-port", "port": 8080}` | Stops the program that is listening on that port, by its exact process number. It never stops anything by name. |
| `{"type": "systemd", "unit": "my-model.service", "verb": "start"}` | Linux: start, stop or restart a service you already set up. |
| `{"type": "schtask-run", "task": "My model"}` and `schtask-end` | Windows: run or end a Scheduled Task you already set up. |

Nothing in the browser can add to this list. The page only sends "load this brain on this computer"; the command comes from your file.

## One graphics card

Computers with a 16 GB card usually fit one big model at a time. Brains keeps it that way: loading a brain stops the others on that card first. Two actions can never run at the same moment on one computer; a second press shows "busy" until the first one finishes.

## If you use LM Studio, Ollama or llama-swap

Those tools already load and unload models by themselves, as described in [One graphics card, several models](ONE_GPU.md). You do not need Brains for them. Brains is for people who start their own model servers (llama.cpp, vLLM and similar) and want a button instead of a terminal.

## Several computers

If a model runs on another computer you can reach with `ssh` (key-based, no password), add it as a second machine with `"transport": {"type": "ssh", "host": "my-other-pc", "os": "windows"}` and use `schtask-run`, `kill-port` or `systemd` actions. A computer whose brain you only want to look at, not control, takes `"control": "view"`; it then needs no `start` or `stop`.

## Privacy

Atelier asks the model server on your own machines and nothing else. Every load, unload and reload is noted, with the time and the result, in `brains-actions.jsonl` next to `brains.json`. Nothing is sent anywhere. Colleagues paired through [Bottega](BOTTEGA.md) see the same section and can press the same buttons, so pair only people you trust with your computer.
