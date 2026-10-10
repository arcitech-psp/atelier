<#
.SYNOPSIS
  Build every release asset into dist-release\: the Windows installer, the Linux/WSL archive, SHA256SUMS and
  RELEASE_NOTES.md. Nothing is uploaded or published.

.DESCRIPTION
  Windows: packaging\windows\build.ps1 (NSIS + the tray launcher + Node.js runtime).
  Linux:   packaging/linux/build.sh, run inside WSL (default distribution "Ubuntu") or skipped with -SkipLinux.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File packaging\build-release.ps1
#>
param(
  [string]$WslDistro = "Ubuntu",
  [switch]$SkipWindows,
  [switch]$SkipLinux
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$out = "$repo\dist-release"
$version = ((Get-Content "$repo\package.json" -Raw | ConvertFrom-Json).version) -replace '-preview$', ''
New-Item -ItemType Directory -Force $out | Out-Null

if (-not $SkipWindows) { & "$repo\packaging\windows\build.ps1" -OutDir $out }

if (-not $SkipLinux) {
  Write-Host "== Linux / WSL archive (in WSL: $WslDistro)"
  $buildDir = "$repo\packaging\build\linux"
  New-Item -ItemType Directory -Force $buildDir | Out-Null
  $list = "$buildDir\files.txt"
  git -C $repo ls-files --cached --others --exclude-standard | Where-Object { $_ -notmatch '^(packaging/build/|dist-release/|\.upstream-cache/)' -and (Test-Path -LiteralPath "$repo\$_" -PathType Leaf) } | Set-Content $list -Encoding utf8NoBOM
  $srcTar = "$buildDir\source.tar"
  if (Test-Path $srcTar) { Remove-Item $srcTar }
  & "$env:WINDIR\System32\tar.exe" -cf $srcTar -C $repo -T $list
  if ($LASTEXITCODE -ne 0) { throw "source tar failed" }
  $toWsl = { param($p) (& wsl.exe -d $WslDistro -- wslpath -a ($p -replace '\\', '/')).Trim() }
  $wslTar = & $toWsl $srcTar; $wslOut = & $toWsl $out; $wslScript = & $toWsl "$repo\packaging\linux\build.sh"
  # Build in the WSL home folder (fast Linux file system), then copy the archive back.
  # (build.sh keeps LF line endings through .gitattributes.)
  & wsl.exe -d $WslDistro -- sh $wslScript $wslTar $wslOut
  if ($LASTEXITCODE -ne 0) { throw "Linux build failed" }
}

Write-Host "== SHA256SUMS and release notes"
$assets = Get-ChildItem $out -File | Where-Object { $_.Name -match '\.(exe|tar\.gz|AppImage)$' -and $_.Name -match [regex]::Escape($version) }
$lines = foreach ($asset in $assets | Sort-Object Name) { "{0}  {1}" -f (Get-FileHash $asset.FullName -Algorithm SHA256).Hash.ToLower(), $asset.Name }
[IO.File]::WriteAllText("$out\SHA256SUMS", (($lines -join "`n") + "`n"))
$notes = (Get-Content "$repo\packaging\RELEASE_NOTES.md" -Raw).Replace('{{VERSION}}', $version)
$table = ($assets | Sort-Object Name | ForEach-Object { "| {0} | {1:N1} MB | ``{2}`` |" -f $_.Name, ($_.Length / 1MB), (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower() }) -join "`n"
[IO.File]::WriteAllText("$out\RELEASE_NOTES.md", $notes.Replace('{{ASSETS}}', $table))
Get-ChildItem $out -File | Format-Table Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } -AutoSize
