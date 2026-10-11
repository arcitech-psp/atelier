# Frequently asked questions

**What is Atelier?**
A design assistant for architects, interior designers and students, by ARCITECH. You describe the project; it works through it with you one visible step at a time, on your own computer. It is powered by DSH (DeepSeek Harness), an open agent harness by DeepSeek-AI (MIT licence).

**Is it free?**
Yes. Atelier's own parts are source-available under the PolyForm Shield License 1.0.0: free to use, read, change and share, but not to build a competing product. See [Licence in plain words](licence.md). The model you connect may have its own costs and licence.

**Does it include an AI model?**
No. You connect one: a model on your computer (Ollama, LM Studio, llama.cpp, vLLM), a server on your network, a cloud service, or your ChatGPT plan. See [Add your endpoint](add-your-endpoint.md).

**Do I need a graphics card?**
Only to run the model yourself. With a cloud route, Atelier runs on any recent Windows or Linux computer. The [graphics card table](add-your-endpoint.md#which-model-for-my-graphics-card) gives honest guidance per size.

**Which systems does it run on?**
Windows 10 and 11 (64-bit), Linux x64 (Ubuntu 22.04 / 24.04), and Ubuntu on WSL2. See [Installing Atelier](INSTALL.md).

**Where are my chats and settings?**
Windows: `%APPDATA%\Atelier-Preview`. Linux and WSL: `~/.config/atelier-preview`. Your project files stay in the workspace folders you choose; Atelier reads and writes files only there and asks before running commands.

**Does Atelier send my data anywhere?**
No telemetry. It talks to the model endpoints you connect, to IngeTrazo on your computer if you use it, and to GitHub only when you check for updates (or turn automatic updates on). If you connect a cloud model, what you send goes to that provider.

**Can my colleagues use my Atelier?**
Yes, with Bottega (team mode): switch on **Share on my network** and pair their devices with a code, all on your office network. It is off by default. See [Bottega](BOTTEGA.md). Reaching it from outside your network (Tailscale) is planned and coming soon.

**Does it update itself?**
Only if you turn **Install updates automatically** on in Settings > Updates (off by default). Otherwise you press **Check for updates** when you like. Every update is checked against its SHA-256 fingerprint, installed next to your current version, and can be rolled back with one click.

**Why does Windows warn me about the installer?**
The installer is not code-signed yet, so SmartScreen does not know it. Choose **More info > Run anyway**, after checking the file's fingerprint if you like ([how](INSTALL.md#is-the-download-genuine)).

**Can I use it on a Mac?**
Not in this preview. Windows, Linux and WSL are supported.

**How do I start, stop or remove it?**
Windows: the desktop icon or Start menu > ARCITECH > Atelier Preview; quit from the AIT icon next to the clock; remove in Settings > Apps. Linux / WSL: `atelier-preview`, `atelier-preview stop`, `atelier-preview uninstall`. Removing Atelier keeps your chats unless you ask otherwise, and never touches your workspace folders.

**What is DSH, and why is it credited?**
DSH (DeepSeek Harness) is the agent harness by DeepSeek-AI that Atelier is built on, under the MIT licence: the chat engine, tools, sessions and web app. Atelier adds Vitruvius, the design canvas, model roles, the IngeTrazo connection, the installers and the updater. When DSH releases an update, Atelier follows ([how](UPSTREAM_SYNC.md)).

**Is the output safe to build from?**
No. Plans, moodboards and images are design aids. Check dimensions and clearances as you would a junior's drawing, and get qualified local review for structure, life safety, accessibility and permits.

**Where do I report a problem?**
GitHub Issues on [arcitech-psp/atelier](https://github.com/arcitech-psp/atelier/issues), or e-mail parthpatel266@gmail.com. Please include your system, the model route and the exact message, and never paste keys, tokens or client material.
