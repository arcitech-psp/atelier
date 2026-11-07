# Context window from your engine

A model route in Atelier carries a context window (`contextWindow` in `settings.yaml`, or `ATELIER_CONTEXT` on first run). If it is smaller than what your server really runs, long chats are compacted earlier than they need to be; if it is larger, a long chat can hit the server's limit. Many local servers report the window they actually serve, and Atelier can now read it.

## What Atelier reads

- **Model listing, every route.** When Atelier lists a server's models, it reads vLLM's `max_model_len` (as before) and now also `meta.n_ctx`, which llama.cpp-style servers publish for the loaded context. `n_ctx_train` (the checkpoint's training length) is ignored on purpose.
- **Optional module `@arcitech/atelier-engine-context`.** It asks each route on this computer or your private network (`localhost`, `127.x`, `10.x`, `192.168.x`, `172.16-31.x`, `fd00::/8`) which window it serves:
  - `GET <baseURL>/models`: `max_model_len`, `meta.n_ctx`, `context_length`, `context_window` or `max_context` of the configured model id (a LoRA adapter without its own value inherits its parent's);
  - if the listing has no window: `GET <server>/health`: `max_context` or `n_ctx`.

  It asks at start, when the model routes change, every 2 minutes, and right after a reply stops at its token limit or overflows the context. The reported window replaces the configured one for that route's **next** request; replies already running keep the window they started with. Nothing is written to your settings, and only `GET` requests are sent. Servers on the internet are never asked unless you list their host in `allowHosts`.

If a server does not report a window or does not answer, the value you configured stays.

## Turn it on

The module is included but off. Add this to `cordis.patch.yml` in your Atelier home folder, then restart Atelier:

```yaml
- insert:
    - id: atelier-engine-context
      name: '@arcitech/atelier-engine-context'
      config:
        intervalMs: 120000        # how often to ask, in ms (default 120000)
        timeoutMs: 3000           # per request (default 3000)
        # observeOnly: [my-route]           # log what the engine reports, keep the configured window
        # contextWindowMax: { my-route: 65536 }   # never use more than this, even if the engine reports more
        # routes: [my-route]                # only these routes (default: all)
        # allowHosts: [gpu-box.example.lan] # extra host names to ask (default: loopback and private addresses only)
```

## Check it

- Every first observation and every change is one line in `<Atelier home>/logs/engine-context.jsonl`, for example
  `{"kind":"changed","route":"atelier-openai/my-model","from":32768,"to":131072,"source":"max_model_len"}`.
- In the browser you are signed in with, `GET /api/atelier/engine-context` shows the current status per route (configured, reported, effective, cap); `POST /api/atelier/engine-context` asks again now (`?provider=<route>` for one route). Both need your Atelier sign-in.

## For developers

`@deepseek-ai/dsh-llm-pi-ai` gained two seams any plugin can use:

- `ctx.engineContext` (optional): an object with `revision` and `window(provider, model)`. When present, a positive integer it returns replaces that route model's `contextWindow` on the next resolution; a new `revision` invalidates the cached profiles.
- `llm-pi-ai/length-stop` event: `{ provider, model, reason: 'max-tokens' | 'context-overflow', contextWindow }`, emitted when a stream ends at its token limit or with a context overflow.

Tests: `node --test public/atelier-engine-context/test/*.test.mjs`.
