# Getting started

## What you need

| | Needed | Notes |
|---|---|---|
| Computer | Windows 11, 64-bit | Installed and tested on **Windows 11**. Windows 10, Linux and macOS have not been tested yet. |
| Node.js | Version 24 | Download from [nodejs.org](https://nodejs.org/). Tested with 24.19.0. |
| pnpm | Version 10 or newer | `npm install -g pnpm`. Tested with 10.34.6. |
| A model | One OpenAI-compatible endpoint | Your own GPU, a machine on your network, or a cloud route. See [Choosing a model](choosing-a-model.md). |
| Disk | About 300 MB for Atelier and its packages | The tested install was 266 MB. Models are separate and take many gigabytes if you run them yourself. |
| IngeTrazo | Optional | Free 3D modelling program, installed separately. See [Connecting IngeTrazo](ingetrazo.md). |
| A graphics card | Only if you run the model yourself | No GPU is needed for the cloud routes. |

What we have not tested yet, so you know before you start: Windows 10, a Windows PC with no developer tools on it, Linux, and macOS. If you try one of these, please tell us how it went.

## Install

1. Install Node.js 24, then open PowerShell and run `npm install -g pnpm`.
2. Download Atelier and unzip it (or clone the repository) into a folder you will keep, for example `Documents\Atelier`.
3. In that folder run:

   ```powershell
   pnpm install --frozen-lockfile
   ```

   This fetches the JavaScript packages Atelier needs. It does not download any model. On the test machine it took about 40 seconds.

## Start it for the first time

Tell Atelier where your model is, once. For a model server on this computer:

```powershell
$env:ATELIER_BASE_URL = "http://localhost:8000/v1"
$env:ATELIER_MODEL = "your-model-id"
pnpm start -- --open
```

For the cloud routes, start with `$env:ATELIER_PROFILE = "cloud"; pnpm start -- --open` instead (see [Choosing a model](choosing-a-model.md)).

On the first run Atelier:

- creates your **home folder** (`user-home` inside the Atelier folder, or the folder named by `ATELIER_HOME`);
- saves your model settings there, so you do not need the variables again;
- checks that the model answers, and tells you plainly if it cannot reach it, the key is refused, or the model id is wrong;
- opens the app in your browser at a local address with a private login token. Keep that address to yourself.

Atelier only listens on your own computer (`127.0.0.1`). It sends no telemetry.

## Stop and start again

- Stop: press **Ctrl+C** in the PowerShell window.
- Start again: `pnpm start -- --open` in the same folder. Your chats, boards and settings are still there.

Next: [Choosing a model](choosing-a-model.md), then [Your first chat](first-chat.md).
