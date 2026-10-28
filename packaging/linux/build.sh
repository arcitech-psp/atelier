#!/bin/sh
# Build atelier-preview-<version>-linux-x64.tar.gz on Linux x64 or WSL2 (Ubuntu 22.04/24.04 tested).
#   sh packaging/linux/build.sh <source.tar> <out-dir> [work-dir]
# <source.tar> holds the tracked files of the checkout (packaging/build-release.ps1 makes it with git).
# The archive bundles the official Node.js runtime (SHA-256 checked) and the installed packages, so users need
# no Node.js, pnpm or internet connection to install. Needs: curl, tar, xz, sha256sum.
set -eu
src=${1:?Usage: $0 <source.tar> <out-dir> [work-dir]}; out=${2:?Usage: $0 <source.tar> <out-dir> [work-dir]}; work=${3:-${TMPDIR:-/tmp}/atelier-public-build}
here=$(cd "$(dirname "$0")" && pwd)
say() { printf '%s\n' "== $*"; }

mkdir -p "$work/cache" "$out"
rm -rf "$work/src"; mkdir -p "$work/src"
tar -xf "$src" -C "$work/src"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$work/src/package.json" | head -n 1 | sed 's/-preview$//')
pnpm=$(sed -n 's/.*"packageManager": *"\([^"+]*\).*/\1/p' "$work/src/package.json")
node_version=$(tr -d ' \r\n' < "$work/src/.node-version")
name="atelier-preview-$version-linux-x64"
stage="$work/stage/$name"

say "Node.js $node_version runtime"
tarball="node-v$node_version-linux-x64.tar.xz"
cd "$work/cache"
[ -f "SHASUMS256-$node_version.txt" ] || curl -fsSL "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "SHASUMS256-$node_version.txt"
[ -f "$tarball" ] || curl -fsSL "https://nodejs.org/dist/v$node_version/$tarball" -o "$tarball"
grep "  $tarball\$" "SHASUMS256-$node_version.txt" | sha256sum -c - >/dev/null || { rm -f "$tarball"; echo "Node.js download failed its SHA-256 check"; exit 1; }
[ -d "node-v$node_version-linux-x64" ] || tar -xJf "$tarball"
nodedir="$work/cache/node-v$node_version-linux-x64"

say "Stage Atelier $version"
rm -rf "$work/stage"; mkdir -p "$stage/runtime/bin"
mv "$work/src" "$stage/app"
rm -rf "$stage/app/ingetrazo-plugin"
cp "$nodedir/bin/node" "$stage/runtime/bin/node"
cp "$nodedir/LICENSE" "$stage/runtime/NODE-LICENSE.txt"

say "Install packages with $pnpm (production only)"
cd "$stage/app"
PATH="$nodedir/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack "$pnpm" install --frozen-lockfile --prod --config.confirmModulesPurge=false
if find . -type l -lname '/*' | grep -q .; then echo "absolute package links found; the archive would break when moved"; exit 1; fi
broken=$(find . -xtype l | wc -l)
[ "$broken" -eq 0 ] || { echo "$broken broken package links"; exit 1; }

cp "$stage/app/packaging/linux/install.sh" "$stage/app/packaging/linux/uninstall.sh" "$stage/"
chmod 755 "$stage/install.sh" "$stage/uninstall.sh" "$stage/app/packaging/linux/atelier-preview" "$stage/app/packaging/linux/atelier"
cat > "$stage/README.txt" <<EOF
Atelier $version (public preview) for Linux x64 and WSL2, by ARCITECH. Powered by DSH (DeepSeek Harness), MIT.

Install for your user (no root needed):   ./install.sh
Then start it from the applications menu or with:   atelier-preview
Remove it:   atelier-preview uninstall   (add --purge to delete your chats and settings too)

Guides: app/docs/INSTALL.md and app/docs/add-your-endpoint.md
EOF

say "Archive"
cd "$work/stage"
tar --owner=0 --group=0 -czf "$out/$name.tar.gz" "$name"
ls -l "$out/$name.tar.gz"
