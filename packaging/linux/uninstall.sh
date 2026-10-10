#!/bin/sh
# Remove Atelier (public preview) for the current user. Your chats and settings stay unless you pass --purge.
#   atelier-preview uninstall [--purge]      or      sh uninstall.sh [--purge]
set -eu
purge=0
for arg in "$@"; do case "$arg" in --purge) purge=1 ;; *) echo "unknown option: $arg"; exit 2 ;; esac; done

ROOT="${ATELIER_INSTALL_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/atelier-preview}"
DATA="${ATELIER_DATA_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/atelier-preview}"
BIN="${ATELIER_BIN_DIR:-$HOME/.local/bin}"
SHARE="${XDG_DATA_HOME:-$HOME/.local/share}"
say() { printf '%s\n' "[atelier] $*"; }

[ -x "$BIN/atelier-preview" ] && "$BIN/atelier-preview" stop >/dev/null 2>&1 || true
# rm -rf removes symlinks themselves and never follows them, so nothing outside these folders is touched.
case "$ROOT" in */atelier-preview*) rm -rf "$ROOT" ;; *) say "Refusing to remove unexpected folder $ROOT"; exit 1 ;; esac
rm -f "$BIN/atelier-preview" "$SHARE/applications/atelier-preview.desktop"
# Remove the `atelier` command only if it is ours (a link into the removed install root).
if [ -L "$BIN/atelier" ] && [ "$(readlink "$BIN/atelier")" = "$ROOT/bin/atelier" ]; then rm -f "$BIN/atelier"; fi
for size in 16 24 32 48 64 128 256 512; do rm -f "$SHARE/icons/hicolor/${size}x${size}/apps/atelier-preview.png"; done
say "Atelier is removed."
if [ "$purge" = "1" ]; then
  case "$DATA" in */atelier-preview*) rm -rf "$DATA"; say "Your Atelier chats and settings ($DATA) are removed too." ;; esac
else
  say "Your chats and settings are kept in $DATA (remove that folder, or run with --purge, to delete them)."
fi
