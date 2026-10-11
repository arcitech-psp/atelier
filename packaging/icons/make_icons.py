"""Build the Atelier Preview icon set from the AT mark (black disc, white mark).

Usage: python make_icons.py <source.png> <out_dir>
Writes atelier.ico (16-256), atelier-<n>.png for Linux hicolor sizes, and a 512/1024 PNG.
"""
import sys
from pathlib import Path
from PIL import Image

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
im = Image.open(src).convert("RGBA")
# Square, with a small transparent margin so the disc does not touch the tile edge.
side = max(im.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
pad = round(side * 0.03)
base = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
base.paste(canvas, (pad, pad))
big = base.resize((1024, 1024), Image.LANCZOS)
for n in (16, 24, 32, 48, 64, 128, 256, 512, 1024):
    big.resize((n, n), Image.LANCZOS).save(out / f"atelier-{n}.png", optimize=True)
big.save(out / "atelier.ico", sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
print("ok", sorted(p.name for p in out.iterdir()))
