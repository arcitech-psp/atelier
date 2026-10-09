# Troubleshooting

## Starting Atelier

### "No model endpoint is set yet"
Set `ATELIER_BASE_URL` and `ATELIER_MODEL` for the first run, or edit `settings.yaml` in your Atelier home folder. For the cloud routes, start with `ATELIER_PROFILE=cloud`.

### "Could not reach ..."
Start the model server first. Check that the address ends in `/v1` and that the port is right (Ollama uses 11434, many others 8000). For a server on another machine, check that it listens on the network and not only on itself.

### "The endpoint serves ..., not ..."
The model id does not match. Copy one of the ids Atelier lists into `settings.yaml` and `cordis.patch.yml` in your home folder, or start again with the right `ATELIER_MODEL`.

### "... refused the API key"
Set `ATELIER_API_KEY`. Local servers usually need none.

### Port already in use
Something else is using port 3081. Start with `$env:ATELIER_PORT = "3082"; pnpm start`. If you use the IngeTrazo panel, change its port to match.

### `pnpm install` fails
Check `node --version` (24) and `pnpm --version` (10 or newer). Run the command from the Atelier folder itself.

## Chatting

### The answer is slow or stops halfway
Press Stop and send the message again. Small local models and busy free tiers are the usual cause. A larger context than your model supports also causes failures; set `ATELIER_CONTEXT` to the model's real context length.

### Vitruvius cannot see my image
The model must be vision-capable, and its entry must say it reads images. For your own endpoint, start once with `ATELIER_VISION=1` (delete `settings.yaml` and `cordis.patch.yml` in your home folder first), or add `input: [ text, image ]` under your model in `settings.yaml`. The same applies to IngeTrazo screenshots. In the cloud profile, use the `atelier-vision` route.

### The moodboard says images are unavailable
No image service is connected. Moodboards still work as cards. See [Choosing a model](choosing-a-model.md#optional-images-for-moodboards).

## Cloud routes

### Free-tier limit reached
Each provider has per-minute and per-day limits. Connect another free provider in OmniRoute, or wait, or add a key you already own.

### OmniRoute does not start
Run `omniroute` yourself and open `http://localhost:20128`. If you installed it differently, set `ATELIER_OMNIROUTE_START` to the command that starts it.

### ChatGPT sign-in: callback port busy
The sign-in uses port 1455 and falls back to 1456 to 1459. Close whatever holds the port, then try `http://127.0.0.1:18345/signin` again.

## IngeTrazo

### IngeTrazo tools do not appear in the chat
Turn on the bridge in IngeTrazo (AI tab, AI Bridge (MCP), Start bridge), then open a **new** chat. The check runs when a chat opens.

### IngeTrazo tools are missing in a second chat
IngeTrazo's bridge serves one client at a time, and an earlier chat keeps its connection open. In IngeTrazo, stop and start the bridge (AI tab, AI Bridge (MCP)), or restart Atelier, then open a new chat.

### The chat waits forever on an IngeTrazo step
IngeTrazo is probably showing a dialog. Answer it in IngeTrazo; the bridge cannot respond while a dialog is open. The bridge also serves one client at a time, so close other programs that use it.

### Atelier cannot find IngeTrazo
Set `ATELIER_INGETRAZO_COMMAND` to the full path of `ingetrazo-mcp.exe` (or `ingetrazo` with `ATELIER_INGETRAZO_ARGS='["--mcp"]'` on Linux).

### The model is the wrong size or in the wrong place
Ask Vitruvius to measure it: "Read back the real bounds of the pergola group." It reports from the drawing, not from the picture. Then ask for the correction, or fix it by hand; a new chat reads your changes.

## Unreal Engine

### GLB export fails with "too many values to unpack (expected 3)"
Some scripted geometry stores colours with an alpha value, which IngeTrazo's GLB export does not accept yet. Ask Vitruvius, with the bridge on:

> Before I export: run this in IngeTrazo, then tell me how many faces changed.

```python
def _walk(gs):
    for g in gs:
        yield g
        yield from _walk(getattr(g, "children", []))
n = 0
for m in [scene.loose_mesh] + [g.mesh for g in _walk(scene.groups)]:
    for f in m.faces:
        c = f.attrs.get("color")
        if c is not None and len(c) == 4:
            if c[3] < 1.0 and f.attrs.get("opacity") is None:
                f.attrs["opacity"] = float(c[3])
            f.attrs["color"] = tuple(c[:3]); n += 1
print("faces changed:", n)
```

It keeps the colours and turns any transparency into IngeTrazo's opacity. Then export again. It is one undo step, so Ctrl+Z puts it back.

### The model is 100 times too big or too small in Unreal
Use the GLB export (metres), not OBJ or STL, and leave the import scale at 1.0.

### Glass looks opaque
Turn Nanite off for that static mesh and adjust the glass material instance. See [Exporting to Unreal Engine](export-to-unreal.md#things-to-know).

## Still stuck

Open an issue on GitHub with your Windows version, `node --version`, `pnpm --version`, the model route you use and the exact message. Never paste API keys, tokens, login addresses or client material into an issue. Email: arcitech.team@outlook.com.
