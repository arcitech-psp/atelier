# Notices for Atelier by ARCITECH

Atelier by ARCITECH (public preview 0.1.0-preview) is built on DeepSeek Harness.

## DeepSeek Harness

Copyright (c) 2026 DeepSeek. MIT License; the full text is in `licenses/DSH-MIT.txt`.
Source: https://github.com/deepseek-ai/deepseek-harness

The `harness/` folder is DeepSeek Harness with Atelier's changes: the Atelier brand text in the
user interface, the Vitruvius preset, telemetry switched off by default, and small fixes listed
in `RELEASE_MANIFEST.json`. The Cordis framework and the vendored plugins in `harness/vendor/`
keep their own licences and copyright notices in their package folders. The upstream third-party
inventory is kept in `licenses/UPSTREAM_THIRD_PARTY_NOTICES.md`; it describes the whole upstream
repository, which is larger than this preview.

## Other packages

JavaScript packages fetched by `pnpm install` keep their own licences. The licence texts of the
packages bundled into the prebuilt files are in `licenses/npm/`, and the lists are in
`licenses/BUNDLED_LIBRARIES.json` and `licenses/EXTERNAL_RUNTIME.json`.

## IngeTrazo (not included)

IngeTrazo, by Marco Sumari Tellez and contributors, is GPL-3.0-or-later:
https://github.com/ingelibre/ingetrazo. No IngeTrazo source or executable is included. If you
install IngeTrazo yourself, Atelier starts its official MCP server as a separate program.

The optional panel in `ingetrazo-plugin/atelier_panel` is a separate work licensed
GPL-3.0-or-later, with its full licence text beside it. That grant applies to the panel only. The folder `ingetrazo-plugin/` stays GPL-3.0-or-later whichever licence
is chosen for the rest of ARCITECH's additions, and its contributors keep that licence.

## Models

No model weights are included. Every model you connect keeps its own licence.

## ARCITECH additions

Vitruvius, the Atelier canvas and brand plugin (`public/atelier-canvas`) and the IngeTrazo
connector (`public/atelier-ingetrazo`) are by ARCITECH. See `LICENSE` for their terms.

"Atelier", "ARCITECH" and the AIT logo are reserved for the official build; see `TRADEMARK.md`. How to contribute: `CONTRIBUTING.md`.

Contact: parthpatel266@gmail.com
