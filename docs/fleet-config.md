# Fleet configuration

The fleet catalog exposes configured service endpoints, probe status, and provider model names as schema version 1.0.0 JSON. It is observational: it does not start, stop, or reconfigure services.

Run `node public/atelier-fleet-config/cli.mjs serve --config fleet-config.json --state fleet-state.json --port 8420`. The configuration file contains `services` (id, kind, baseUrl, healthRoute, and optional `modelsRoute`) and `providers` (id, name, baseUrl, models). `GET /config` supports ETags, `GET /status` reports probe results, and `POST /refresh` probes again.

Clients can run `node public/atelier-fleet-config/cli.mjs update --url http://host:8420 --fragment path/to/managed.json --log path/to/updates.jsonl`, or use `watch` with `--interval 600` for the default ten-minute interval. `rollback` restores the newest timestamped backup. The updater writes only the managed fragment and its audit log. A settings adapter can verify and load `providers` with `readManagedProviders()` and merge them with `mergeManagedProviders()`; the host application must explicitly call these functions to include the fragment.
