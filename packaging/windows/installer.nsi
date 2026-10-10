; Atelier (public preview) installer for Windows 10/11 x64. Per-user: no administrator rights needed.
; Built by packaging/windows/build.ps1:  makensis /DVERSION=0.1.0 /DSTAGE=<stage dir> /DOUTFILE=<setup.exe> installer.nsi
;
; Installs to   %LOCALAPPDATA%\Programs\Atelier-Preview\versions\<version>\{app,runtime}
; User data in  %APPDATA%\Atelier-Preview (kept on uninstall unless you tick "Also remove my chats and settings")
; Update mode   Setup.exe /S /UPDATE  adds the new version beside the running one and marks it pending; the launcher
;               switches on its next start and keeps the old version for one-click rollback.

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user

!ifndef VERSION
  !error "Pass /DVERSION=x.y.z"
!endif
!ifndef STAGE
  !error "Pass /DSTAGE=<stage folder>"
!endif
!ifndef OUTFILE
  !define OUTFILE "Atelier-Preview-${VERSION}-Setup.exe"
!endif
!ifndef DSH_VERSION
  !define DSH_VERSION "0.1.2-alpha.1"
!endif

!define APPNAME "Atelier"
!define APPKEY "Atelier-Preview"
!define LAUNCHER "Atelier Preview.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPKEY}"
!define DATADIR "$APPDATA\Atelier-Preview"
!define MENUDIR "$SMPROGRAMS\ARCITECH"

Name "Atelier ${VERSION} (preview)"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Atelier-Preview"
InstallDirRegKey HKCU "${UNINSTKEY}" "InstallLocation"
BrandingText "Atelier by ARCITECH - powered by DSH (DeepSeek Harness)"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Atelier (preview)"
VIAddVersionKey "CompanyName" "ARCITECH"
VIAddVersionKey "FileDescription" "Atelier ${VERSION} setup - powered by DSH (DeepSeek Harness)"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "(c) 2026 ARCITECH. PolyForm Shield 1.0.0; DSH is MIT (DeepSeek-AI)."

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "${STAGE}\atelier.ico"
!define MUI_UNICON "${STAGE}\atelier.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to Atelier ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Atelier by ARCITECH is a design assistant for architects, interior designers and students. This is a public preview.$\r$\n$\r$\nAtelier is powered by DSH (DeepSeek Harness) ${DSH_VERSION} by DeepSeek-AI, MIT licence.$\r$\n$\r$\nAtelier ships no AI model. After installing, you connect the model you use: one on this computer (Ollama, LM Studio, llama.cpp, vLLM) or a cloud service.$\r$\n$\r$\nNo administrator rights are needed. Click Next to continue."
!define MUI_LICENSEPAGE_TEXT_TOP "Atelier's own parts are source-available under the PolyForm Shield License 1.0.0. DSH (DeepSeek Harness) stays MIT."
!define MUI_COMPONENTSPAGE_NODESC
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Start Atelier now"
!define MUI_FINISHPAGE_RUN_FUNCTION StartAtelier
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the guide to connecting a model"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION OpenGuide
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_COMPONENTS
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Var UpdateMode
Var OldCopy

Function .onInit
  StrCpy $UpdateMode "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/UPDATE" $R1
  ${IfNot} ${Errors}
    StrCpy $UpdateMode "1"
    SetSilent silent
  ${EndIf}
FunctionEnd

Function StartAtelier
  Exec '"$INSTDIR\${LAUNCHER}"'
FunctionEnd

Function OpenGuide
  ExecShell "open" "https://github.com/arcitech-psp/atelier/blob/main/docs/add-your-endpoint.md"
FunctionEnd

Section "Atelier" SecApp
  SectionIn RO
  ; A normal install closes a running Atelier first; update mode installs beside it and switches later.
  ${If} $UpdateMode == "0"
  ${AndIf} ${FileExists} "$INSTDIR\${LAUNCHER}"
    ExecWait '"$INSTDIR\${LAUNCHER}" --quit'
  ${EndIf}

  ; Reinstalling the same version: move the old copy aside first, and delete it once the new one is in place.
  StrCpy $OldCopy ""
  ${If} ${FileExists} "$INSTDIR\versions\${VERSION}\*.*"
    StrCpy $OldCopy "$INSTDIR\versions\${VERSION}.old"
    ${If} ${FileExists} "$OldCopy\*.*"
      StrCpy $OldCopy "$INSTDIR\versions\${VERSION}.old2"
    ${EndIf}
    ClearErrors
    Rename "$INSTDIR\versions\${VERSION}" "$OldCopy"
    ${If} ${Errors}
      MessageBox MB_ICONSTOP|MB_OK "Atelier ${VERSION} is in use. Quit Atelier (tray icon > Quit Atelier) and run the installer again." /SD IDOK
      Abort
    ${EndIf}
  ${EndIf}

  ; The application travels as one archive and is unpacked with Windows' own tar, which (unlike installers)
  ; handles the long paths inside node_modules.
  CreateDirectory "$INSTDIR\versions\${VERSION}"
  SetOutPath "$INSTDIR\versions"
  DetailPrint "Copying Atelier ${VERSION}..."
  File "/oname=$INSTDIR\versions\atelier-${VERSION}.tar" "${STAGE}\payload.tar"
  DetailPrint "Unpacking..."
  nsExec::ExecToLog '"$SYSDIR\tar.exe" -xf "$INSTDIR\versions\atelier-${VERSION}.tar" -C "$INSTDIR\versions\${VERSION}"'
  Pop $0
  Delete "$INSTDIR\versions\atelier-${VERSION}.tar"
  ${If} $0 != "0"
    MessageBox MB_ICONSTOP|MB_OK "Atelier could not unpack its files (tar code $0). Windows 10 version 1803 or newer is needed." /SD IDOK
    Abort
  ${EndIf}

  ; pnpm's package links cannot travel inside an archive on Windows; recreate them as junctions.
  DetailPrint "Linking packages..."
  nsExec::ExecToLog '"$INSTDIR\versions\${VERSION}\runtime\node.exe" "$INSTDIR\versions\${VERSION}\app\packaging\links.mjs" restore "$INSTDIR\versions\${VERSION}\app" "$INSTDIR\versions\${VERSION}\links.json"'
  Pop $0
  ${If} $0 != "0"
    MessageBox MB_ICONSTOP|MB_OK "Atelier could not finish linking its packages (code $0). Please run the installer again." /SD IDOK
    Abort
  ${EndIf}
  ${If} $OldCopy != ""
    nsExec::ExecToLog '"$INSTDIR\versions\${VERSION}\runtime\node.exe" "$INSTDIR\versions\${VERSION}\app\packaging\links.mjs" remove "$OldCopy"'
    Pop $0
  ${EndIf}

  SetOutPath "$INSTDIR"
  SetOverwrite try
  File "${STAGE}\${LAUNCHER}"
  File "${STAGE}\atelier.ico"
  SetOutPath "$INSTDIR\bin"
  File "${STAGE}\bin\atelier.cmd"
  File "${STAGE}\bin\atelier.ps1"
  File "${STAGE}\bin\path.ps1"
  SetOutPath "$INSTDIR"
  SetOverwrite on

  ${If} $UpdateMode == "1"
    FileOpen $1 "$INSTDIR\pending" w
    FileWrite $1 "${VERSION}"
    FileClose $1
  ${Else}
    ClearErrors
    FileOpen $1 "$INSTDIR\current" r
    ${IfNot} ${Errors}
      FileRead $1 $2
      FileClose $1
      ${If} $2 != ""
      ${AndIf} $2 != "${VERSION}"
        FileOpen $1 "$INSTDIR\previous" w
        FileWrite $1 $2
        FileClose $1
      ${EndIf}
    ${EndIf}
    FileOpen $1 "$INSTDIR\current" w
    FileWrite $1 "${VERSION}"
    FileClose $1
    Delete "$INSTDIR\pending"
  ${EndIf}

  CreateDirectory "${DATADIR}"
  ; Start menu: ARCITECH > Atelier Preview, Atelier (terminal), Uninstall Atelier
  CreateDirectory "${MENUDIR}"
  CreateShortCut "${MENUDIR}\Atelier Preview.lnk" "$INSTDIR\${LAUNCHER}" "" "$INSTDIR\atelier.ico" 0 SW_SHOWNORMAL "" "Atelier by ARCITECH, design assistant (preview)"
  CreateShortCut "${MENUDIR}\Atelier (terminal).lnk" "$SYSDIR\cmd.exe" '/k ""$INSTDIR\bin\atelier.cmd" help"' "$INSTDIR\atelier.ico" 0 SW_SHOWNORMAL "" "The atelier command in a terminal"
  CreateShortCut "${MENUDIR}\Uninstall Atelier.lnk" "$INSTDIR\uninstall.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "Atelier (preview)"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "ARCITECH"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\atelier.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegStr HKCU "${UNINSTKEY}" "URLInfoAbout" "https://github.com/arcitech-psp/atelier"
  WriteRegStr HKCU "${UNINSTKEY}" "Comments" "Powered by DSH (DeepSeek Harness) by DeepSeek-AI, MIT"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR\versions" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" $0
SectionEnd

Section "Desktop shortcut" SecDesktop
  ${If} $UpdateMode == "0"
    CreateShortCut "$DESKTOP\Atelier Preview.lnk" "$INSTDIR\${LAUNCHER}" "" "$INSTDIR\atelier.ico" 0 SW_SHOWNORMAL "" "Atelier by ARCITECH, design assistant (preview)"
  ${EndIf}
SectionEnd

Section "The atelier command for terminals (adds it to your PATH)" SecPath
  ${If} $UpdateMode == "0"
    ; path.ps1 edits only its own entry and keeps the rest of your PATH exactly as it was.
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\bin\path.ps1" add "$INSTDIR\bin"'
    Pop $0
  ${EndIf}
SectionEnd

; ---------------------------------------------------------------- uninstall

Section "un.Atelier" UnSecApp
  SectionIn RO
  ${If} ${FileExists} "$INSTDIR\${LAUNCHER}"
    ExecWait '"$INSTDIR\${LAUNCHER}" --quit'
  ${EndIf}
  ; Delete with a temporary copy of the bundled Node.js: it removes package links first (nothing is followed
  ; outside the install folder) and handles paths longer than 260 characters.
  InitPluginsDir
  StrCpy $3 ""
  FindFirst $0 $1 "$INSTDIR\versions\*"
  ${DoWhile} $1 != ""
    ${If} $3 == ""
    ${AndIf} ${FileExists} "$INSTDIR\versions\$1\runtime\node.exe"
    ${AndIf} ${FileExists} "$INSTDIR\versions\$1\app\packaging\links.mjs"
      CopyFiles /SILENT "$INSTDIR\versions\$1\runtime\node.exe" "$PLUGINSDIR\node.exe"
      CopyFiles /SILENT "$INSTDIR\versions\$1\app\packaging\links.mjs" "$PLUGINSDIR\links.mjs"
      StrCpy $3 "ok"
    ${EndIf}
    FindNext $0 $1
  ${Loop}
  FindClose $0
  ${If} $3 == "ok"
    nsExec::ExecToLog '"$PLUGINSDIR\node.exe" "$PLUGINSDIR\links.mjs" unlink "${DATADIR}\profiles"'
    Pop $2
    nsExec::ExecToLog '"$PLUGINSDIR\node.exe" "$PLUGINSDIR\links.mjs" remove "$INSTDIR\versions"'
    Pop $2
  ${EndIf}
  RMDir /r "$INSTDIR\versions"
  ${If} ${FileExists} "$INSTDIR\bin\path.ps1"
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\bin\path.ps1" remove "$INSTDIR\bin"'
    Pop $2
  ${EndIf}
  Delete "$INSTDIR\bin\atelier.cmd"
  Delete "$INSTDIR\bin\atelier.ps1"
  Delete "$INSTDIR\bin\path.ps1"
  RMDir "$INSTDIR\bin"
  Delete "$INSTDIR\${LAUNCHER}"
  Delete "$INSTDIR\atelier.ico"
  Delete "$INSTDIR\current"
  Delete "$INSTDIR\previous"
  Delete "$INSTDIR\pending"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "${MENUDIR}\Atelier Preview.lnk"
  Delete "${MENUDIR}\Atelier (terminal).lnk"
  Delete "${MENUDIR}\Uninstall Atelier.lnk"
  RMDir "${MENUDIR}"
  Delete "$DESKTOP\Atelier Preview.lnk"
  DeleteRegKey HKCU "${UNINSTKEY}"
SectionEnd

Section /o "un.Also remove my chats, settings and logs" UnSecData
  ; Your workspace folders are never touched; only Atelier's own data folder is removed.
  ${If} ${FileExists} "$PLUGINSDIR\node.exe"
    nsExec::ExecToLog '"$PLUGINSDIR\node.exe" "$PLUGINSDIR\links.mjs" remove "${DATADIR}"'
    Pop $2
  ${EndIf}
  RMDir /r "${DATADIR}"
SectionEnd
