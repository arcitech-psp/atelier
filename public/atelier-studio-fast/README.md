# Fast image preset

This package defines Atelier's fast architectural image preset and a small adapter boundary for a user's configured image renderer and upscaler. It does not include a model, inference endpoint, credentials, private service names, or an image-generation UI.

The preset requests a 1376 × 768 render for the documented 1366 × 768 tier, then asks the configured upscaler for a centered 3840 × 2160 result (8,294,400 pixels). `runFastImage` requires both adapters and returns an error if either step produces no image. The caller owns endpoint selection, authorization, cancellation, and artifact storage.

Source evidence: the 27 Oct fast-generation job reported 65/65 focused tests and this tier mapping. Its image-service changes were staged only; no fresh image generation or production deployment was proven. This package's tests cover the provider-neutral plan and adapter ordering, not a live renderer or upscale engine.
