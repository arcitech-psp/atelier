# Fleet configuration document

Schema version `1.0.0`. The live document is UTF-8 JSON served at `GET /config`.
The `hash` field is the lowercase SHA-256 hex digest of the canonical UTF-8 JSON
encoding of the document with `hash`, `revision`, and `generatedAt` omitted
(keys sorted, no insignificant whitespace). `revision` is a monotonically
increasing integer assigned when the remaining content changes. A client should also use HTTP
`ETag` for conditional requests. A config snapshot reports observations; it
does not authorize service changes.

```json
{
  "schemaVersion": "1.0.0",
  "revision": 1,
  "generatedAt": "2026-10-26T00:00:00Z",
  "hash": "<sha256-of-canonical-document-without-hash>",
  "services": [
    {
      "id": "chat-primary",
      "kind": "openai-compatible-chat",
      "baseUrl": "http://example.invalid/v1",
      "modelIds": ["model-id"],
      "healthRoute": "/models",
      "status": "up",
      "device": "example-host",
      "gpu": "example-accelerator"
    }
  ],
  "providers": [
    {
      "id": "provider-id",
      "name": "Provider display name",
      "baseUrl": "http://example.invalid/v1",
      "models": [{"id": "model-id", "name": "Model display name"}]
    }
  ]
}
```

`services` contains the known runtime endpoints and their latest probe state.
`status` is `up`, `down`, or `unknown`; clients must not infer readiness from a
model/provider declaration. `device` and `gpu` may be `null` when not known.
Provider `baseUrl` and model names come from the operator-supplied,
read-only provider settings snapshot. The server must not expose credentials
or environment variable values from that file.

`GET /status` returns server health, last refresh time, last refresh error (if
any), current revision and per-service probe timestamps/results. `POST
/refresh` requests a new read-only probe cycle and returns the resulting status
document. `GET /config` supports `If-None-Match` and returns `304` when the
entity tag matches.

Clients write only their configured managed fragment. Before replacing it,
they create a timestamped backup; each successful change and rollback is
appended to the updater log. The fragment is an include input owned by the
client integration, never the main settings file.

