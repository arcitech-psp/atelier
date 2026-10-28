# Optional public modules

This build carries three optional packages. They are included in the distribution and release manifest, but are not activated in the default profile; the public UI and runtime routes for them have not been integrated.

## Fast image preset

`@arcitech/atelier-studio-fast` supplies the provider-neutral `fast-1366x768` plan. It requests a 1376 × 768 render and a centered 3840 × 2160 upscale. The user supplies both adapters. The package does not contain an image engine, endpoint, model, credentials, or Studio panel.

The source job passed 65 focused tests. Its provider-specific changes were staged, and a fresh image generation and production route were not proven. This package's 4 tests cover the preset mapping and adapter order only.

## BIMCraft design

`@arcitech/atelier-bimcraft-design` includes the tested design method and route adapter. It requires a compatible BIMCraft CLI and a separately configured IFC validation environment. The tests cover supported design selection, north rotation, roof profiles, and preflight validation. Full CLI-backed release acceptance still belongs to the host where BIMCraft is installed.

The generator is bounded to a documented residential scope. Unsupported programmes and known sheet limitations must be disclosed; concept output is not engineering or permit approval.

## SolidCraft recipes

`@arcitech/atelier-solidcraft-recipes` contains five native containers: four furniture recipe families and a resized table variant. The package tests validate the archive structure, document format, units, and metadata privacy markers. The source job separately recorded a successful live SolidCraft run and 64 focused tests; this release smoke does not launch SolidCraft.

## Excluded from this build

No video generation package or video panel is present. Virtual Staging was not accepted in today's run, the current TripoSplat run did not produce an asset, and UI panel work remains design-only. The existing bylaw research profile remains jurisdiction-neutral; no local bylaw library is included.

Run the package checks with `node --test public/atelier-studio-fast/test/*.test.mjs public/atelier-bimcraft-design/test/*.test.mjs public/atelier-solidcraft-recipes/test/*.test.mjs`. The main application smoke is `node scripts/smoke-test.mjs`.
