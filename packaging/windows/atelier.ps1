# The `atelier` command for PowerShell (installed by Atelier's setup in <install folder>\bin and added to your PATH).
$root = Split-Path -Parent $PSScriptRoot
$env:ATELIER_INSTALL_ROOT = $root
if (-not $env:ATELIER_HOME) { $env:ATELIER_HOME = Join-Path $env:APPDATA 'Atelier-Preview' }
$version = (Get-Content (Join-Path $root 'current') -Raw).Trim()
$dir = Join-Path $root "versions\$version"
if (-not (Test-Path (Join-Path $dir 'runtime\node.exe'))) { Write-Error 'Atelier is not installed completely. Please run the installer again.'; exit 1 }
& (Join-Path $dir 'runtime\node.exe') (Join-Path $dir 'app\packaging\cli-entry.mjs') @args
exit $LASTEXITCODE