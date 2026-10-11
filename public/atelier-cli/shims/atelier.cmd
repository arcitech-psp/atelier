@echo off
rem Atelier by ARCITECH: the "atelier" command (Windows cmd). Installed into <install root>\bin by the installer.
rem It always runs the version named in <install root>\current, so updates and rollbacks need no new shim.
setlocal
set "ATELIER_INSTALL_ROOT=%~dp0.."
set /p ATELIER_VERSION=<"%ATELIER_INSTALL_ROOT%\current"
set "ATELIER_APP=%ATELIER_INSTALL_ROOT%\versions\%ATELIER_VERSION%"
if not exist "%ATELIER_APP%\runtime\node.exe" (echo Atelier is not installed completely in %ATELIER_INSTALL_ROOT%. Run the installer again. 1>&2 & exit /b 1)
"%ATELIER_APP%\runtime\node.exe" "%ATELIER_APP%\app\public\atelier-cli\bin\atelier.mjs" %*
exit /b %ERRORLEVEL%
