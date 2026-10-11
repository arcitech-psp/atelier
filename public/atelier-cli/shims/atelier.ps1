# Atelier by ARCITECH: the "atelier" command (PowerShell). Installed into <install root>\bin by the installer.
# It always runs the version named in <install root>\current, so updates and rollbacks need no new shim.
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $root 'current')).Trim()
$app = Join-Path $root "versions\$version"
$node = Join-Path $app 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $node)) { [Console]::Error.WriteLine("Atelier is not installed completely in $root. Run the installer again."); exit 1 }
$env:ATELIER_INSTALL_ROOT = $root
& $node (Join-Path $app 'app\public\atelier-cli\bin\atelier.mjs') @args
exit $LASTEXITCODE
