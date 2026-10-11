# Credits

Atelier stands on other people's work. Thank you to every one of them.

## Built on

| Project | By | Licence | How Atelier uses it |
|---|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | DeepSeek-AI | MIT | Atelier is a fork of it: the app, the agent loop, the presets and launcher profiles. |
| [Cordis](https://github.com/cordiverse/cordis), Cosmokit, Schemastery | Shigma and contributors | MIT | The plugin framework inside DeepSeek Harness, vendored in `harness/vendor/`. |
| [IngeTrazo](https://github.com/ingelibre/ingetrazo) | Marco Sumari Tellez and contributors | GPL-3.0-or-later | The 3D modelling program and its official AI bridge. Installed separately, never bundled. |
| [PySide6 / Qt for Python](https://doc.qt.io/qtforpython-6/) | The Qt Company and contributors | LGPL-3.0 | Used by the optional IngeTrazo panel through IngeTrazo's own runtime. Not redistributed. |
| [OmniRoute](https://github.com/diegosouzapw/OmniRoute) | diegosouzapw and contributors | MIT | Optional local AI gateway for the cloud profile. Installed separately. |
| [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source) | OpenAI | OpenAI terms | The official sign-in the ChatGPT-plan route uses. |
| [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/) | Their communities | MIT | Runtime and package manager. |
| JavaScript packages | Their authors | See `licenses/` | Installed by pnpm; full list and texts in `licenses/`. |

## Works well with

These are not part of Atelier. They are the tools we used while testing, named so you can find them.

| Project | By | What for |
|---|---|---|
| [vLLM](https://github.com/vllm-project/vllm) | The vLLM project | Serving a local model, including on Intel Arc GPUs |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | ggml-org and contributors | Serving GGUF models on almost any hardware |
| [Ollama](https://ollama.com/) and [LM Studio](https://lmstudio.ai/) | Their teams | Easy local model servers |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Comfy Org and contributors | Image generation for moodboards |
| [Unreal Engine](https://www.unrealengine.com/) | Epic Games | Interactive architecture; GLB import through Interchange |
| [PolyForm Project](https://polyformproject.org/) | PolyForm Project | The Shield licence text |

## The name

Vitruvius is named after Marcus Vitruvius Pollio, whose *De architectura* is the oldest surviving book on architecture, and whose triad of **venustas, firmitas and utilitas** still frames how architects judge a design.

## Atelier

Atelier is made by ARCITECH (Architecture Interactive Technology), Calgary, Alberta, Canada. Feedback: https://docs.google.com/forms/d/e/1FAIpQLSeulyC06qEOVDn2aSjJqTlbCjifoYXqQzhDXb9Du16Ev5TiHA/viewform
