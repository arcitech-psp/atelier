# Windows wrapper: sync Atelier's harness/ with a DSH (DeepSeek Harness) release. See docs/UPSTREAM_SYNC.md.
#   powershell -ExecutionPolicy Bypass -File scripts\sync-upstream.ps1 status
node (Join-Path $PSScriptRoot 'sync-upstream.mjs') @args
exit $LASTEXITCODE
