<#
.SYNOPSIS
  Build Atelier-Preview-<version>-Setup.exe (Windows 10/11 x64, per-user installer).

.DESCRIPTION
  1. Copies the tracked files of this checkout into a stage folder (your user-home and node_modules are never copied).
  2. Installs the packages there with the pinned pnpm (production only), records pnpm's package links and removes
     them, because an installer cannot carry links; the installer recreates them on the user's computer.
  3. Adds the official Node.js runtime (downloaded from nodejs.org once, SHA-256 checked against SHASUMS256.txt).
  4. Compiles the tray launcher with the C# compiler that ships with Windows, and runs NSIS.

  Needs: Node.js 24 with corepack, git, NSIS 3 (makensis.exe; pass -Makensis if it is not on PATH).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1
#>
param(
  [string]$Makensis = "",
  [string]$NodeVersion = "",
  [string]$OutDir = ""
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$node = (Get-Command node -ErrorAction Stop).Source
& $node "$repo\scripts\check-private-strings.mjs" --root $repo
if ($LASTEXITCODE -ne 0) { throw "Private string check failed; Windows build stopped." }
$pkg = Get-Content "$repo\package.json" -Raw | ConvertFrom-Json
$version = $pkg.version -replace '-preview$', ''
$pnpm = ($pkg.packageManager -replace '\+.*$', '')
if (-not $NodeVersion) { $NodeVersion = (Get-Content "$repo\.node-version" -Raw).Trim() }
if (-not $OutDir) { $OutDir = "$repo\dist-release" }
$dshVersion = (Get-Content "$repo\harness\apps\cli\package.json" -Raw | ConvertFrom-Json).version
$build = "$repo\packaging\build\windows"
$cache = "$repo\packaging\build\cache"
$stage = "$build\stage"
$appDir = "$stage\versions\$version\app"
$runtimeDir = "$stage\versions\$version\runtime"

function Step($text) { Write-Host "== $text" }
if (-not $Makensis) {
  $found = Get-Command makensis -ErrorAction SilentlyContinue
  foreach ($candidate in @($found.Source, "${env:ProgramFiles(x86)}\NSIS\makensis.exe", "$env:ProgramFiles\NSIS\makensis.exe", "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe")) {
    if ($candidate -and (Test-Path $candidate)) { $Makensis = $candidate; break }
  }
}
if (-not $Makensis) { throw "NSIS (makensis.exe) not found. Install NSIS 3 or pass -Makensis <path>." }
if (git -C $repo status --porcelain) { Write-Warning "The checkout has uncommitted changes; they are included in this build." }

Step "Stage Atelier $version (DSH $dshVersion) in $stage"
if (Test-Path $build) {
  # Clear the previous stage: links first so nothing outside it is followed, and past the 260-character limit.
  node "$repo\packaging\links.mjs" remove $build | Out-Null
}
New-Item -ItemType Directory -Force $appDir, $runtimeDir, $cache, $OutDir | Out-Null
$files = git -C $repo ls-files --cached --others --exclude-standard
$skip = '^(ingetrazo-plugin/|packaging/build/|dist-release/|\.upstream-cache/)'
$count = 0
foreach ($file in $files) {
  if ($file -match $skip -or -not (Test-Path -LiteralPath "$repo\$file" -PathType Leaf)) { continue }
  $target = Join-Path $appDir $file
  $parent = Split-Path $target
  if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force $parent | Out-Null }
  Copy-Item -LiteralPath "$repo\$file" -Destination $target
  $count++
}
Write-Host "   $count files"

Step "Install packages with $pnpm (production only)"
Push-Location $appDir
try {
  corepack $pnpm install --frozen-lockfile --prod --config.confirmModulesPurge=false 2>&1 | Select-String -Pattern 'Done in|ERR|error' | ForEach-Object { Write-Host "   $_" }
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
} finally { Pop-Location }
node "$repo\packaging\links.mjs" record $appDir "$stage\versions\$version\links.json"
node "$repo\packaging\links.mjs" unlink $appDir

Step "Node.js $NodeVersion runtime"
$zipName = "node-v$NodeVersion-win-x64.zip"
$zip = "$cache\$zipName"
$sums = "$cache\SHASUMS256-$NodeVersion.txt"
if (-not (Test-Path $sums)) { Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile $sums -UseBasicParsing }
if (-not (Test-Path $zip)) { Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$zipName" -OutFile $zip -UseBasicParsing }
$expected = (Select-String -Path $sums -Pattern "  $([regex]::Escape($zipName))$").Line.Split(' ')[0]
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($expected -ne $actual) { Remove-Item $zip; throw "Node.js download failed its SHA-256 check" }
$unzipped = "$cache\node-v$NodeVersion-win-x64"
if (-not (Test-Path $unzipped)) { Expand-Archive $zip -DestinationPath $cache }
Copy-Item "$unzipped\node.exe", "$unzipped\LICENSE" $runtimeDir
Rename-Item "$runtimeDir\LICENSE" "NODE-LICENSE.txt"

Step "Launcher, icon, licence"
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $csc /nologo /target:winexe /optimize+ "/win32icon:$repo\packaging\icons\atelier.ico" "/out:$stage\Atelier Preview.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll "$repo\packaging\windows\AtelierLauncher.cs"
if ($LASTEXITCODE -ne 0) { throw "launcher build failed" }
Copy-Item "$repo\packaging\icons\atelier.ico" "$stage\atelier.ico"
Copy-Item "$repo\packaging\windows\welcome.bmp" "$stage\welcome.bmp"
Copy-Item "$repo\LICENSE" "$stage\LICENSE.txt"
New-Item -ItemType Directory -Force "$stage\bin" | Out-Null
Copy-Item "$repo\packaging\windows\atelier.cmd", "$repo\packaging\windows\atelier.ps1", "$repo\packaging\windows\path.ps1" "$stage\bin"

Step "Payload archive"
# One archive instead of 27,000 installer entries: Windows' own tar unpacks it on the user's computer and copes with
# the long paths inside node_modules (the installer's file copy is limited to 260 characters).
& "$env:WINDIR\System32\tar.exe" -cf "$stage\payload.tar" -C "$stage\versions\$version" .
if ($LASTEXITCODE -ne 0) { throw "payload tar failed" }

Step "NSIS"
$setup = "$OutDir\Atelier-Preview-$version-Setup.exe"
$sizeKb = [int]((Get-ChildItem "$stage\versions\$version" -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
& $Makensis /V2 "/DSIZE_KB=$sizeKb" "/DVERSION=$version" "/DDSH_VERSION=$dshVersion" "/DSTAGE=$stage" "/DOUTFILE=$setup" "$repo\packaging\windows\installer.nsi"
if ($LASTEXITCODE -ne 0) { throw "makensis failed" }
$size = [math]::Round((Get-Item $setup).Length / 1MB, 1)
Write-Host "== Built $setup ($size MB)"
