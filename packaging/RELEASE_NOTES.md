# Atelier {{VERSION}} (public preview)

Atelier by ARCITECH is a design assistant for architects, interior designers and students. It is powered by DSH (DeepSeek Harness) 0.1.2-alpha.1 by DeepSeek-AI (MIT). This first public preview is now available, free to use: expect rough edges, and please tell us what breaks.

## Download

| File | Size | SHA-256 |
|---|---|---|
{{ASSETS}}

- **Windows 10/11 (64-bit):** `Atelier-Preview-{{VERSION}}-Setup.exe`. Installs for your user only (no administrator rights), adds a Start menu entry and an optional desktop icon, and brings its own Node.js runtime.
- **Linux x64 and WSL2 (Ubuntu 22.04/24.04):** `atelier-preview-{{VERSION}}-linux-x64.tar.gz`. Unpack it and run `./install.sh`. Also brings its own Node.js runtime.

Check a download with `SHA256SUMS` (Windows PowerShell: `Get-FileHash <file>`; Linux: `sha256sum -c SHA256SUMS --ignore-missing`). The files are not code-signed yet, so Windows SmartScreen may warn the first time: choose "More info", then "Run anyway".

Installation steps: [docs/INSTALL.md](https://github.com/arcitech-psp/atelier/blob/main/docs/INSTALL.md). Connecting a model: [docs/add-your-endpoint.md](https://github.com/arcitech-psp/atelier/blob/main/docs/add-your-endpoint.md).

## What is in it

- **Free to use.** Use free AI services, or run fully local on your own computer: see the [free models guide](https://github.com/arcitech-psp/atelier/blob/main/docs/FREE_MODELS.md).
- **Works on one 16 GB graphics card.** Models are loaded when they are needed, and Atelier waits for each load and shows its state: see [One graphics card, several models](https://github.com/arcitech-psp/atelier/blob/main/docs/ONE_GPU.md).
- **Mission Control.** A chip in the session header shows which model is loaded, graphics card use, tokens and speed, and the energy cost at your own electricity price: see [Mission Control](https://github.com/arcitech-psp/atelier/blob/main/docs/mission-control.md).
- **Brains.** Settings > General shows the model that is really loaded now on each computer and graphics card, with Load, Unload and Reload (one brain at a time per card, with a confirm step and progress): see [Brains](https://github.com/arcitech-psp/atelier/blob/main/docs/brains.md).
- **Vitruvius** and **Vitruvius Zero** (for small models), a design canvas with concept plans and material/colour moodboards, and an optional bridge to IngeTrazo (installed separately, GPL-3.0-or-later).
- The stock DeepSeek Harness agent presets (Standard, PTC, Minimal and Creator modes) and launcher profiles.
- Works with any OpenAI-compatible model endpoint: Ollama, LM Studio, llama.cpp, vLLM, a custom URL with a key, cloud free tiers through OmniRoute, or your ChatGPT plan.
- **Bottega (team mode)**: share one Atelier with colleagues on your office network. Other devices open it in their browser, tablet or phone after a one-time pairing code; you see and revoke every device. Off by default, private networks only, plain HTTP. Tailscale support is planned and coming soon.
- **Settings > Updates**: the version, credits, "Check for updates", and opt-in automatic updates (off by default). Updates install beside the current version, which is kept for one-click rollback.

## Privacy

Atelier sends no telemetry. It talks only to the model endpoint you choose, to IngeTrazo on your computer, and to GitHub when you check for updates (or if you turn automatic updates on).

## Known limits

- Tested on Windows 11 and on Ubuntu 24.04 (desktop and WSL2). Windows 10 and Ubuntu 22.04 should work but are less tested.
- Atelier ships no model. How well Vitruvius works depends on the model you connect.
- Plans, moodboards and images are design aids, not engineering or code compliance.

## Credits

Atelier is built on [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) by DeepSeek-AI (MIT). [IngeTrazo](https://github.com/ingelibre/ingetrazo) is by Marco Sumari Tellez and contributors (GPL-3.0-or-later). Atelier's own parts are source-available under the PolyForm Shield License 1.0.0. Website: [arcitech.info](https://arcitech.info).

## Feedback

Feedback goes through the [feedback form](https://docs.google.com/forms/d/e/1FAIpQLSeulyC06qEOVDn2aSjJqTlbCjifoYXqQzhDXb9Du16Ev5TiHA/viewform) (no account needed) or [GitHub Issues](https://github.com/arcitech-psp/atelier/issues/new/choose), rather than email. Never paste API keys, tokens or client material into a report.
