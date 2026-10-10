#!/bin/sh
# Install Atelier (public preview) for the current user on Linux x64 or WSL2. No root needed.
# Run it from the unpacked release folder:   ./install.sh
#
# Options:
#   --no-desktop     skip the application-menu entry and icon
#   --no-start       do not start Atelier at the end
# Environment (optional):
#   ATELIER_INSTALL_ROOT  where versions are kept (default ~/.local/share/atelier-preview)
#   ATELIER_BIN_DIR       where the atelier-preview command goes (default ~/.local/bin)
#   ATELIER_DATA_DIR      your chats and settings (default ~/.config/atelier-preview)
#   XDG_DATA_HOME         where the menu entry and icon go (default ~/.local/share)
set -eu

here=$(cd "$(dirname "$0")" && pwd)
desktop=1; start=1
for arg in "$@"; do
  case "$arg" in
    --no-desktop) desktop=0 ;;
    --no-start) start=0 ;;
    *) echo "unknown option: $arg"; exit 2 ;;
  esac
done
say() { printf '%s\n' "[atelier] $*"; }

if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  say "This build is for Linux x64 (including WSL2). This computer is $(uname -s) $(uname -m)."; exit 1
fi
if [ ! -f "$here/app/start-preview.mjs" ] || [ ! -x "$here/runtime/bin/node" ]; then
  say "Run install.sh from the unpacked atelier-preview folder (it needs app/ and runtime/ beside it)."; exit 1
fi
if ! "$here/runtime/bin/node" -e 'process.exit(0)' 2>/dev/null; then
  say "The bundled Node.js runtime does not start here (it needs glibc 2.28 or newer, e.g. Ubuntu 20.04+)."; exit 1
fi

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$here/app/package.json" | head -n 1 | sed 's/-preview$//')
ROOT="${ATELIER_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/atelier-preview}"
BIN="${ATELIER_BIN_DIR:-$HOME/.local/bin}"
SHARE="${XDG_DATA_HOME:-$HOME/.local/share}"
target="$ROOT/versions/$version"

say "Installing Atelier $version (powered by DSH, DeepSeek Harness) into $ROOT"
mkdir -p "$ROOT/versions" "$BIN"
if [ "$here" != "$target" ]; then
  rm -rf "$target.partial"
  mkdir -p "$target.partial"
  # Copy app, runtime and these scripts; tar keeps pnpm's relative package links intact.
  (cd "$here" && tar -cf - .) | (cd "$target.partial" && tar -xf -)
  rm -rf "$target"
  mv "$target.partial" "$target"
fi

current=$(cat "$ROOT/current" 2>/dev/null || true)
if [ -n "$current" ] && [ "$current" != "$version" ]; then printf '%s' "$current" > "$ROOT/previous"; fi
printf '%s' "$version" > "$ROOT/current"
rm -f "$ROOT/pending"

cp "$target/app/packaging/linux/atelier-preview" "$BIN/atelier-preview"
chmod 755 "$BIN/atelier-preview"
if [ -n "${ATELIER_INSTALL_ROOT:-}" ] || [ -n "${ATELIER_DATA_DIR:-}" ]; then
  # Remember custom locations inside the command itself.
  tmp="$BIN/atelier-preview.tmp"
  { sed -n '1p' "$BIN/atelier-preview"
    [ -n "${ATELIER_INSTALL_ROOT:-}" ] && printf ': "${ATELIER_INSTALL_ROOT:=%s}"; export ATELIER_INSTALL_ROOT\n' "$ATELIER_INSTALL_ROOT"
    [ -n "${ATELIER_DATA_DIR:-}" ] && printf ': "${ATELIER_DATA_DIR:=%s}"; export ATELIER_DATA_DIR\n' "$ATELIER_DATA_DIR"
    sed -n '2,$p' "$BIN/atelier-preview"; } > "$tmp"
  mv "$tmp" "$BIN/atelier-preview"; chmod 755 "$BIN/atelier-preview"
fi

# The `atelier` command: a stable copy in the install root, linked from your bin folder.
mkdir -p "$ROOT/bin"
cp "$target/app/packaging/linux/atelier" "$ROOT/bin/atelier"
chmod 755 "$ROOT/bin/atelier"
ln -sf "$ROOT/bin/atelier" "$BIN/atelier"
# The atelier CLI, when this version ships one, installs its own command in place of the basic one.
if [ -f "$target/app/public/atelier-cli/install-shims.mjs" ]; then
  "$target/runtime/bin/node" "$target/app/public/atelier-cli/install-shims.mjs" --install-root "$ROOT" --bin-dir "$BIN" || true
fi

if [ "$desktop" = "1" ]; then
  mkdir -p "$SHARE/applications"
  for size in 16 24 32 48 64 128 256 512; do
    mkdir -p "$SHARE/icons/hicolor/${size}x${size}/apps"
    cp "$target/app/packaging/icons/atelier-$size.png" "$SHARE/icons/hicolor/${size}x${size}/apps/atelier-preview.png"
  done
  sed "s|@BIN@|$BIN|g" "$target/app/packaging/linux/atelier-preview.desktop" > "$SHARE/applications/atelier-preview.desktop"
  chmod 644 "$SHARE/applications/atelier-preview.desktop"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$SHARE/applications" >/dev/null 2>&1 || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q "$SHARE/icons/hicolor" >/dev/null 2>&1 || true
  say "Added \"Atelier Preview\" to your applications menu."
fi

say "Installed. Start it any time with:  atelier-preview"
case ":$PATH:" in *":$BIN:"*) ;; *) say "Note: $BIN is not on your PATH yet. Open a new terminal, or run $BIN/atelier-preview";; esac
if grep -qi microsoft /proc/version 2>/dev/null; then
  say "WSL: Atelier opens in your Windows browser. A model server running on Windows is reachable as described in docs/INSTALL.md (WSL section)."
fi
if [ "$start" = "1" ]; then "$BIN/atelier-preview" start; fi
