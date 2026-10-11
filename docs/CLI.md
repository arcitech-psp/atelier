# Atelier in the terminal

Atelier by ARCITECH has a command, `atelier`, and a terminal UI for people who prefer the keyboard. Both use the same engine as the web app. Your chats, profiles and model roles are shared, so a chat started in the terminal opens in the browser, and the other way round.

## Install

- **Installer (Windows, Linux, WSL).** The installer puts `atelier` on your PATH:
  - Windows: `%LOCALAPPDATA%\Programs\Atelier-Preview\bin` (`atelier.cmd` for cmd, `atelier.ps1` for PowerShell). Open a new terminal after installing.
  - Linux and WSL: `~/.local/bin/atelier`.
- **From a checkout.** After `pnpm install --frozen-lockfile`, run `pnpm exec atelier`, or `node public/atelier-cli/bin/atelier.mjs`. You can also add a shell alias.

`atelier --version` prints `Atelier 0.1.0 by ARCITECH — powered by DSH <version>`.

## Commands

| Command | What it does |
|---|---|
| `atelier` | Opens the terminal UI. Add `--session <id>` to open a chat, and `--theme auto\|truecolor\|256\|mono` to choose colours. |
| `atelier web [--port N] [--open] [--bottega]` | Starts the web app. `--open` also opens your browser. `--bottega` also starts [Bottega](BOTTEGA.md) (team mode) and prints the address and a pairing code. |
| `atelier chat "prompt"` | Answers one prompt and streams the answer to stdout; tool steps go to stderr. |
| `atelier chat ... --json` | Prints one JSON object when the answer is done, for scripts. |
| `atelier sessions list [--json] [--limit N]` | Lists your chats, newest first. It is the same list as the web app's sidebar. |
| `atelier sessions open <id> [--web]` | Opens a chat in the terminal UI. With `--web`, it prints the web address instead. |
| `atelier sessions export <id> [--format md\|json\|zip] [--out file]` | Saves a chat. `md` is readable Markdown (the default), `json` is the transcript, and `zip` is the web app's full archive. |
| `atelier roles list [--json]` | Shows which model does which job (Model roles). |
| `atelier roles set <role> --url <address> --model <name> [--key-env VAR] [--vision] [--context N]` | Points a role at an OpenAI-compatible server. |
| `atelier roles test [<role>] [--json]` | Checks that each role answers, the same way the web page's Test button does. |
| `atelier profile list` / `atelier profile use <vitruvius\|vitruvius-zero\|cloud>` | Chooses the profile that new chats start in. |
| `atelier update check\|apply\|rollback` | Checks GitHub for a new version, installs it next to the current one, or goes back to the previous one. Atelier contacts GitHub only when you run `check` or `apply`. |
| `atelier doctor [--json]` | Checks Node, the install, disk space, ports, your model endpoints and the IngeTrazo bridge, with a plain-English fix for each problem. |

**Command details**

- **`chat` options.** `--session <id>` continues a chat, `--profile vitruvius-zero` starts it in a given profile, `--attach <file>` (repeatable) adds files and images, `--cwd <dir>` sets the project folder, and `-q` hides progress. You can also pipe the prompt in: `cat brief.txt | atelier chat`.
- **Roles.** Roles are `brain`, `vision`, `stt`, `tts`, `embeddings`, `image` and `helper`; [ROLES_SETUP.md](ROLES_SETUP.md) explains each one. `--key-env` takes the *name* of an environment variable that holds the key, for example `--key-env OPENROUTER_API_KEY`. Keys are never typed on the command line or printed.
- **Profiles.** `cloud` adds the cloud routes (OmniRoute and your ChatGPT plan) and makes them the default. Your own model is kept, and switching back to `vitruvius` restores it.

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | Done |
| 1 | Failed (for `doctor`: at least one problem to fix) |
| 2 | Wrong usage |
| 3 | Not possible here (for example, a port in use, or no updater) |
| 4 | The web app did not start |
| 130 | You stopped the answer |

## The terminal UI

```
 Atelier by ARCITECH  │  Reading room concept plan
 Chats               │
 ▸ Reading room …  2m │  You
   Facade options  1h │    Draw a simple concept plan of a 4 x 5 m reading room ...
                      │  Vitruvius
                      │    ▸ 2 steps  board_draw
                      │    Saved to the canvas: a to-scale concept plan ...
                      │ ─────────────────────────────────────────────
                      │ › Describe the project, or type / for commands
 Vitruvius │ ● brain my-model    │ 7.6k in · 684 out │ 32 tok/s            ready
 Enter send  / commands  Ctrl+N new  Ctrl+B chats  Ctrl+T steps  Esc stop
```

The screen has these parts:

- **Chats sidebar** (left). It hides itself in narrow windows.
- **Chat pane.** Answers stream in as formatted Markdown.
- **Tool steps.** They are collapsed by default; Ctrl+T expands them.
- **Command palette.** Type `/` to open it.
- **Status line.** It shows the profile, the brain and whether it answers, tokens in and out, speed, and whether Vitruvius is working.
- **Footer.** It lists the keys.

| Key | Action |
|---|---|
| Enter | send |
| `/` | command palette (Tab completes, Up/Down choose) |
| Esc | stop Vitruvius, close a list, leave the sidebar |
| Ctrl+N | new chat (it is created when you send the first message) |
| Ctrl+B | show or hide the chats sidebar; Tab moves between it and typing |
| Ctrl+T | expand or collapse tool steps |
| Ctrl+R | show or hide the model's thinking |
| PgUp / PgDn | scroll the chat |
| Up / Down | earlier messages you typed |
| Ctrl+U, Ctrl+W, Ctrl+A, Ctrl+E | clear the line, delete a word, start, end |
| Ctrl+L | redraw |
| Ctrl+C | quit |

**Slash commands:**

| Command | What it does |
|---|---|
| `/model` | picks a model for this chat |
| `/roles` | lists the roles with a live check |
| `/profile` | chooses Vitruvius, Vitruvius Zero or Cloud |
| `/new` | starts a new chat |
| `/sessions` | lists your chats |
| `/attach <file>` | attaches a file or image |
| `/export [file]` | saves the chat as Markdown |
| `/help` | lists the keys and commands |
| `/quit` | quits |

**Approvals and questions.** When a tool needs your approval, the UI asks: press `a` to allow it once or `r` to reject it. When Vitruvius asks you a question, type the number of an option, or your own answer, and press Enter.

**Terminals.** The UI works in Windows Terminal, PowerShell, cmd, and Linux and WSL terminals:

- It redraws cleanly when you resize the window.
- Colours use the ARCITECH studio palette (warm charcoal, paper and copper). Terminals with 256 colours get the nearest matches.
- `NO_COLOR=1` or `--theme mono` uses no colour, only weight.
- `ATELIER_THEME` sets the default theme. `ATELIER_ASCII=1` swaps the symbols for plain ASCII, for very old consoles.

## How it works (and why)

The terminal is a **client of the web app's own server**: the DeepSeek Harness `web` profile, started by `start-preview.mjs`, exactly as the browser uses it.

**Connecting to a server.** When you run a command:

- If the desktop launcher or `atelier web` is already running for your Atelier folder, the terminal connects to it.
- Otherwise it starts the server in the background, with no window, and stops it again when you quit. Starting takes about 20 seconds.
- Keep `atelier web` running for instant chats.

**Why it works this way:**

- **Shared chats.** There is one engine and one session store. Two engines writing the same chats would not see each other's new chats until a restart, and the DeepSeek Harness does not support two writers on one live chat.
- **Easy upstream sync.** The upstream DeepSeek Harness command (`harness/apps/cli`, `dsh`) is unchanged. `atelier` is a small ARCITECH layer in `public/atelier-cli` that calls it through the Atelier launcher.
- **Same features in both.** Everything the web app has, such as the canvas tools, IngeTrazo, approvals and profiles, works in the terminal without being copied.

**Why Ink.** The UI is built with [Ink](https://github.com/vadimdemedes/ink) 5 (MIT), React for the terminal:

- Atelier is Node and TypeScript, and the repository already uses React 18, which Ink 5 supports.
- Ink handles raw keyboard input on Windows consoles and POSIX terminals, plus resize and redraw. Each row of the screen is composed by Atelier and cut to the exact width, so the layout does not depend on how a terminal wraps lines.
- Upstream DeepSeek Harness ships no terminal UI to build on, only the `dsh` launcher and its `web`, `headless`, `acp` and `sdk` profiles.

New npm packages, all small and MIT or ISC licensed, about 1 MB in total:

- `ink` 5.2.1 and its dependencies (`yoga-layout`, `react-reconciler`, `cli-cursor`, `cli-truncate`, `slice-ansi`, `ansi-escapes`, `patch-console`, `es-toolkit` and others);
- `chalk` 5.6.2;
- `wrap-ansi` 9.0.2;
- `string-width` 7.2.0.

`yaml`, `node-pty`, `@xterm/headless` and `sharp` (the last three are for tests only) were already in the lockfile.

**Where things are stored.** Your Atelier folder is chosen like this:

- `ATELIER_HOME` if it is set;
- otherwise the installed data folder (`%APPDATA%\Atelier-Preview` on Windows, `~/.config/atelier-preview` on Linux and WSL);
- otherwise `user-home` in a checkout.

What lives where:

- **Settings changes** are written to `settings.yaml` the same way the web app writes them: under its file lock, atomically, keeping your comments. A running Atelier picks them up at once.
- **Other roles** (not the brain or helper) are kept in `atelier-roles/roles.json`. They take effect when Atelier next starts.

## Scripting examples

```sh
# One answer, plain text
atelier chat "Three facade materials for a coastal cabin, one line each" > ideas.md

# JSON for scripts: {sessionId, text, stopReason, provider, model, profile, usage, steps}
atelier chat --json "List the rooms of a two-bed flat" | jq -r .text

# Continue the same chat
id=$(atelier chat --json "Start a brief for a reading room" | jq -r .sessionId)
atelier chat --session "$id" "Now add a window seat"

# Attach a plan image and a brief
atelier chat --attach plan.png --attach brief.md "Check this plan against the brief"

# Health check in CI or a setup script (exit code 1 when something needs fixing)
atelier doctor --json | jq '.checks[] | select(.state=="fail")'

# Connect a brain served by vLLM on another machine, with its key in an environment variable
atelier roles set brain --url http://my-gpu-box:8000/v1 --model my-model --key-env MY_GPU_KEY --vision --context 65536
atelier roles test brain

# Export every chat as Markdown
atelier sessions list --json | jq -r '.[].id' | while read id; do atelier sessions export "$id" --out "chats/$id.md"; done
```

PowerShell:

```powershell
(atelier chat --json "Name three warm timber species" | ConvertFrom-Json).text
```

## Tests

```sh
cd public/atelier-cli
node --test test/*.test.mjs          # argument parsing and the config commands
ATELIER_HOME=/tmp/atelier-smoke node test/smoke-pty.mjs --port 3393 [--shots <dir>]
```

The smoke test drives the real terminal UI in a pseudo-terminal: ConPTY on Windows, so no window opens, and a pty on Linux. It reads the screen through a headless xterm, checks the layout, the palette, the help overlay, a resize, a real chat turn (when the brain answers) and a clean exit, and can save SVG and PNG screenshots.
