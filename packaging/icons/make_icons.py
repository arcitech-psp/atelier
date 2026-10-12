"""Build the Atelier Preview icon set from the final AIT brand kit (ARCITECH).

Usage: python make_icons.py <kit_atelier_dir> <out_dir> [atelier-1024.png]

<kit_atelier_dir> holds the kit's atelier.ico (16-256; sizes up to 48 use the small-size cut on the tile) and
app-icon-256.png / app-icon-512.png. Writes atelier.ico (the kit file, unchanged), atelier-<n>.png for the Linux
hicolor sizes (16-128 taken from the .ico frames, 256 and 512 the kit PNGs) and atelier-1024.png. The 1024 is a render
of atelier-app-icon.svg (the kit tile with the accent mark over its central 80%) at 1024 px in a headless browser;
without one, the 512 is scaled up.
"""
import shutil
import sys
from pathlib import Path
from PIL import Image

kit, out = Path(sys.argv[1]), Path(sys.argv[2])
big = Path(sys.argv[3]) if len(sys.argv) > 3 else None
out.mkdir(parents=True, exist_ok=True)
shutil.copyfile(kit / "atelier.ico", out / "atelier.ico")
ico = Image.open(kit / "atelier.ico")
for n in (16, 24, 32, 48, 64, 128):
    ico.size = (n, n)
    ico.convert("RGBA").save(out / f"atelier-{n}.png", optimize=True)
for n in (256, 512):
    shutil.copyfile(kit / f"app-icon-{n}.png", out / f"atelier-{n}.png")
if big:
    Image.open(big).convert("RGBA").save(out / "atelier-1024.png", optimize=True)
else:
    Image.open(kit / "app-icon-512.png").convert("RGBA").resize((1024, 1024), Image.LANCZOS).save(out / "atelier-1024.png", optimize=True)
print("ok", sorted(p.name for p in out.iterdir()))
