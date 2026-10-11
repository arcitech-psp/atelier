@echo off
rem The `atelier` command (installed by Atelier's setup in <install folder>\bin and added to your PATH).
setlocal
set "ATELIER_INSTALL_ROOT=%~dp0.."
if not defined ATELIER_HOME set "ATELIER_HOME=%APPDATA%\Atelier-Preview"
set /p ATELIER_VERSION_DIR=<"%ATELIER_INSTALL_ROOT%\current"
set "V=%ATELIER_INSTALL_ROOT%\versions\%ATELIER_VERSION_DIR%"
if not exist "%V%\runtime\node.exe" (
  echo Atelier is not installed completely. Please run the installer again.
  exit /b 1
)
"%V%\runtime\node.exe" "%V%\app\packaging\cli-entry.mjs" %*