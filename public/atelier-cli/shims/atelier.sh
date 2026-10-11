#!/bin/sh
# Atelier by ARCITECH: the "atelier" command (Linux and WSL). Installed as ~/.local/bin/atelier by install.sh.
# It always runs the version named in $ROOT/current, so updates and rollbacks need no new shim.
ROOT="${ATELIER_INSTALL_ROOT:-@ROOT@}"
version=$(tr -d ' \r\n' < "$ROOT/current" 2>/dev/null)
app="$ROOT/versions/$version"
if [ -z "$version" ] || [ ! -x "$app/runtime/bin/node" ]; then
  echo "Atelier is not installed completely in $ROOT. Run install.sh again." >&2; exit 1
fi
ATELIER_INSTALL_ROOT="$ROOT"; export ATELIER_INSTALL_ROOT
exec "$app/runtime/bin/node" "$app/app/public/atelier-cli/bin/atelier.mjs" "$@"
