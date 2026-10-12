# Getting started

## What you need

| | Needed | Notes |
|---|---|---|
| Computer | Windows 10/11 64-bit, Linux x64 (Ubuntu 22.04/24.04), or Ubuntu on WSL2 | Tested on Windows 11, Ubuntu 24.04 and Ubuntu 24.04 on WSL2. |
| Disk | About 900 MB | Atelier and its own Node.js runtime. Models are separate and take many gigabytes if you run them yourself. |
| A model | One OpenAI-compatible endpoint | Your own graphics card, a machine on your network, or a cloud route. See [Add your endpoint](add-your-endpoint.md). |
| IngeTrazo | Optional | Free 3D modelling program, installed separately. See [Connecting IngeTrazo](ingetrazo.md). |
| A graphics card | Only if you run the model yourself | Starts on as little as one 16 GB graphics card. On one card the models take turns: each loads when its job comes up, and Atelier waits for it and shows what is loading. More cards, a bigger card or a model server keep them loaded side by side, so everything is faster. No GPU? Point the roles at a cloud endpoint. |

The installers bring their own Node.js; you do not need to install anything else.

## Install

Follow [Installing Atelier](INSTALL.md): the Windows installer, the Linux/WSL archive, or the source code.

## Start it for the first time

Start **Atelier Preview** (desktop icon or Start menu > ARCITECH on Windows; `atelier-preview` on Linux and WSL). The first start takes about half a minute. Atelier:

- creates your **home folder** for chats and settings (`%APPDATA%\Atelier-Preview` on Windows, `~/.config/atelier-preview` on Linux and WSL);
- opens the **Model roles** page so you can connect your model ([Add your endpoint](add-your-endpoint.md));
- checks later starts against your model and tells you plainly if it cannot reach it, the key is refused, or the model name is wrong.

Atelier only listens on your own computer, behind a private login token. It sends no telemetry.

## Stop and start again

- Windows: the AIT icon next to the clock > **Quit Atelier**; start again from the desktop icon.
- Linux / WSL: `atelier-preview stop`, then `atelier-preview`.

Your chats, boards and settings are still there.

Next: [Your first chat](first-chat.md).
