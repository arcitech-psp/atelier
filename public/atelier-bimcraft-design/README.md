# BIMCraft design adapter

This package adds a brief-first architectural design route, deterministic massing and roof selection, and preflight validation for supported two-storey residential concepts. It depends on a separately installed BIMCraft CLI for native models, IFC, and drawing sheets. The package does not bundle BIMCraft, IFC projects, or user workspace files.

The 27 Oct source work proved deterministic houses, IFC4 geometry and relationships, sheet output, and the design adapter in isolated clients. It remained staged for integration. The automatic generator is bounded to two storeys, two bedrooms, one bathroom, and a temperate northern site; unsupported programmes and rotated full-sheet exports must be reported for follow-up. Concept geometry is not engineering or permit approval.

Run `npm test` for the provider-free design-method checks. Full IFC/CLI acceptance requires a separately installed compatible BIMCraft and IFC validation environment.
