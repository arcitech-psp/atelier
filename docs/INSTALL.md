# Installing Atelier

Atelier by ARCITECH runs on your own computer and opens in your web browser. Pick your system:

- [Windows 10 or 11](#windows) (the main platform)
- [Linux](#linux) (Ubuntu 22.04 / 24.04, 64-bit)
- [WSL on Windows](#wsl-windows-subsystem-for-linux) (Atelier inside Ubuntu on WSL2, used from your Windows browser)
- [From the source code](#from-the-source-code) (for people who like a terminal)

Atelier ships **no AI model**. After installing, you connect the model you use: see [Add your endpoint](add-your-endpoint.md). Downloads are on the [GitHub Releases page](https://github.com/arcitech-psp/atelier/releases/latest).

## Windows

You need Windows 10 (version 1803 or newer) or Windows 11, 64-bit, and about 900 MB of free disk space. No administrator rights and no other software are needed: the installer brings everything Atelier runs on.

1. Download **Atelier-Preview-0.1.0-Setup.exe** from the [Releases page](https://github.com/arcitech-psp/atelier/releases/latest).
2. Open it. The installer is not code-signed yet, so Windows SmartScreen may say it "protected your PC". Choose **More info**, then **Run anyway**. (You can check the file first: see [Is the download genuine?](#is-the-download-genuine))
3. Follow the steps:

   | | |
   |---|---|
   | ![Welcome page](images/install/windows-1-welcome.png) | **Welcome.** What Atelier is, and the credit to DSH (DeepSeek Harness), on which it is built. |
   | ![Licence page](images/install/windows-2-licence.png) | **Licence.** Atelier's own parts are source-available under PolyForm Shield 1.0.0; DSH stays MIT. |
   | ![Choose components](images/install/windows-3-components.png) | **Components.** Keep **Desktop shortcut** for an icon on your desktop. **The atelier command** lets you type `atelier` in a terminal. |
   | ![Install location](images/install/windows-4-folder.png) | **Folder.** The default, `%LOCALAPPDATA%\Programs\Atelier-Preview`, is right for most people. |
   | ![Finished](images/install/windows-5-finish.png) | **Done.** Leave **Start Atelier now** ticked. |

4. Atelier starts in the background (look for the AIT icon next to the clock) and opens in your browser. The first start takes about half a minute.
5. The first time, the **Model roles** page opens so you can connect your model: see [Add your endpoint](add-your-endpoint.md).

![Model roles page on first start](images/install/first-run-model-roles.png)

### Everyday use

- **Start:** the **Atelier Preview** icon on your desktop, or Start menu > **ARCITECH** > **Atelier Preview**. Starting it again while it runs just opens the window again.
- **The AIT icon next to the clock** (click the arrow if it is hidden): **Open Atelier**, **Set up model endpoint**, **Open logs folder**, **Quit Atelier**.
- **Terminal:** Start menu > ARCITECH > **Atelier (terminal)**, or type `atelier` in any new terminal. `atelier update check` looks for a new version.
- **Your chats and settings** are in `%APPDATA%\Atelier-Preview`. Your project files stay in the workspace folders you choose.

### Updates

Atelier never checks for updates on its own unless you ask it to. In Atelier, open **Settings > Updates**:

- **Check for updates** asks GitHub whether a newer release exists.
- **Download and install** fetches it, checks its SHA-256 fingerprint against the release, and installs it **next to** your current version. **Restart now** switches over. Your chats and settings stay as they are.
- **Roll back to 0.1.0** (or whichever version you had before) switches back, also with one click.
- **Install updates automatically** is off by default. When on, Atelier checks once a day and installs a new version for the next start.

![Settings > Updates](images/install/settings-updates.png)

The same from a terminal: `atelier update check`, `atelier update apply`, `atelier update rollback`.

### Uninstall

Windows Settings > Apps > Installed apps > **Atelier (preview)** > Uninstall, or Start menu > ARCITECH > **Uninstall Atelier**. Your chats and settings are kept unless you tick **Also remove my chats, settings and logs**. Your workspace folders are never touched.

## Linux

Ubuntu 22.04 or 24.04 (or another 64-bit distribution with glibc 2.28 or newer), about 900 MB of free disk space. No root rights, Node.js or internet connection are needed for the install itself.

```sh
# 1. Download atelier-preview-0.1.0-linux-x64.tar.gz from the Releases page, then:
tar -xzf atelier-preview-0.1.0-linux-x64.tar.gz
cd atelier-preview-0.1.0-linux-x64
./install.sh
```

The installer copies Atelier to `~/.local/share/atelier-preview`, adds **Atelier Preview** to your applications menu, puts two commands in `~/.local/bin`, and starts Atelier in your browser.

| Command | What it does |
|---|---|
| `atelier-preview` | Start Atelier (if needed) and open it in your browser |
| `atelier-preview setup` | Open the Model roles page to connect your model |
| `atelier-preview stop` / `restart` / `status` / `logs` | Stop, restart, see what runs where, read the log |
| `atelier update check` / `apply` / `rollback` | Updates, exactly as in Settings > Updates |
| `atelier-preview uninstall` | Remove Atelier; add `--purge` to delete your chats and settings too |

Your chats and settings are in `~/.config/atelier-preview`. If `~/.local/bin` is not on your PATH yet, open a new terminal (Ubuntu adds it automatically once the folder exists).

## WSL (Windows Subsystem for Linux)

You can run Atelier inside Ubuntu on WSL2 and use it from your normal Windows browser. This suits people who already keep their tools (or their model server) in WSL.

1. If you do not have WSL yet, open PowerShell and run `wsl --install -d Ubuntu`, restart, and finish the Ubuntu set-up.
2. In the Ubuntu terminal, download and install exactly as for [Linux](#linux):

   ```sh
   cd ~
   tar -xzf /mnt/c/Users/<you>/Downloads/atelier-preview-0.1.0-linux-x64.tar.gz
   cd atelier-preview-0.1.0-linux-x64 && ./install.sh
   ```

3. Atelier opens in your **Windows** browser by itself. Inside WSL it listens on `127.0.0.1`, and WSL passes `http://localhost:3081` through to Windows. If no browser opens, run `ATELIER_NO_BROWSER=1 atelier-preview` and paste the address it prints into your Windows browser.

Keep Atelier's files inside the Linux file system (`~`), not under `/mnt/c`: it is much faster.

### Reaching your model from WSL

Where your model server runs decides the address you give Atelier:

| Model server runs on | Address to use in Atelier (inside WSL) | What to check |
|---|---|---|
| WSL (the same Ubuntu) | `http://localhost:<port>/v1` | Nothing special. |
| Windows, with WSL **mirrored networking** | `http://localhost:<port>/v1` | Mirrored mode is on when `%USERPROFILE%\.wslconfig` has `networkingMode=mirrored` under `[wsl2]` (Windows 11 22H2 or newer). Run `wsl --shutdown` after changing it. |
| Windows, with WSL's default (NAT) networking | `http://<Windows host IP>:<port>/v1`, where the IP is what `ip route show default \| awk '{print $3}'` prints inside WSL | The server must listen on the network, not only on itself: Ollama `OLLAMA_HOST=0.0.0.0`, LM Studio "Serve on Local Network", llama.cpp and vLLM `--host 0.0.0.0`. Allow it through Windows Firewall for the WSL network only. |
| Another computer on your network | `http://<that computer's IP>:<port>/v1` | Same as above: listening on the network, firewall open, and an API key (`--api-key`) on anything not only for you. Never forward the port to the internet. |

The other way round also works: a model server running in WSL is reachable from Windows programs at `http://localhost:<port>/v1`.

## From the source code

For developers, or to try changes. You need Git, [Node.js 24](https://nodejs.org/) (the tested version is in `.node-version`) and corepack, which comes with Node.js.

```sh
git clone https://github.com/arcitech-psp/atelier.git
cd atelier
corepack enable          # once; provides the pinned pnpm 10.34.6
pnpm install --frozen-lockfile
pnpm start -- --open
```

Your home folder is then `user-home` inside the checkout (or `ATELIER_HOME`). See [QUICKSTART](../QUICKSTART.md) for every setting. A source checkout updates with `git pull` and `pnpm install`, not through Settings > Updates.

## Is the download genuine?

Each release lists the SHA-256 fingerprint of every file in `SHA256SUMS` and in the release notes. Compare it with yours:

- Windows PowerShell: `Get-FileHash .\Atelier-Preview-0.1.0-Setup.exe`
- Linux / WSL: `sha256sum -c SHA256SUMS --ignore-missing`

The in-app updater does the same check by itself and refuses a file that does not match.

## What runs where, and privacy

- Atelier listens only on your own computer (`localhost`), behind a private login token. It sends no telemetry.
- It talks to the model endpoints you connect, to IngeTrazo on your computer if you use it, and to GitHub only when you check for updates or turn automatic updates on.
- Removing Atelier leaves your workspace folders untouched.

Something not working? See [Troubleshooting](troubleshooting.md) and the [FAQ](FAQ.md).
