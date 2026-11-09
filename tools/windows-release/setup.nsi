Unicode true
RequestExecutionLevel user
Name "Buji V3 Preview"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\CBN.Ai\Buji"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CBNAiBujiV3" "InstallLocation"
SetCompressor /SOLID lzma
SetCompressorDictSize 32
VIProductVersion "3.0.0.2"
VIAddVersionKey "ProductName" "Buji V3 Preview"
VIAddVersionKey "CompanyName" "CBN.Ai"
VIAddVersionKey "FileDescription" "Buji V3 Windows x64 Setup"
VIAddVersionKey "LegalCopyright" "Copyright 2026 Dr Chandrasen Pandey and Buji contributors"
VIAddVersionKey "FileVersion" "3.0.0-preview.2"
VIAddVersionKey "ProductVersion" "3.0.0-preview.2"

!include "MUI2.nsh"
!include "x64.nsh"
!define MUI_ICON "${PAYLOAD}\buji.ico"
!define MUI_UNICON "${PAYLOAD}\buji.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Set up Buji V3"
!define MUI_WELCOMEPAGE_TEXT "Install your local AI workspace for Windows. Setup adds Buji and its local CPU runtime to this account. The first launch downloads and verifies the 5.63 GB text model. Keep about 12 GB free during that step.$\r$\n$\r$\nOptional Hindi speech, visual computer use, and NVIDIA acceleration are available from the Buji V3 Start menu folder."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open Buji and download the text model"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchBuji
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CBNAiBujiV3"
!define STARTMENU "$SMPROGRAMS\Buji V3"
!define POWERSHELL "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
!define LAUNCH '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\Start-Buji.ps1"'

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Buji V3 requires 64-bit Windows on an x64 processor."
    Abort
  ${EndIf}
  SetShellVarContext current
  ; Only install into a new directory or a directory already owned by this setup.
  IfFileExists "$INSTDIR\cbn-buji-install.marker" valid
  IfFileExists "$INSTDIR\*.*" invalid valid
  invalid:
    MessageBox MB_ICONSTOP "This folder already contains files from another installation."
    Abort
  valid:
FunctionEnd

Function LaunchBuji
  ExecShell "open" "${POWERSHELL}" '${LAUNCH}'
FunctionEnd

Section "Buji V3"
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "${STARTMENU}"
  CreateShortCut "${STARTMENU}\Buji.lnk" "${POWERSHELL}" '${LAUNCH}' "$INSTDIR\buji.ico"
  CreateShortCut "${STARTMENU}\Set up Hindi speech.lnk" "${POWERSHELL}" '${LAUNCH} -Hindi' "$INSTDIR\buji.ico"
  CreateShortCut "${STARTMENU}\Set up visual computer use.lnk" "${POWERSHELL}" '${LAUNCH} -Vision' "$INSTDIR\buji.ico"
  CreateShortCut "${STARTMENU}\Set up NVIDIA acceleration.lnk" "${POWERSHELL}" '${LAUNCH} -Cuda' "$INSTDIR\buji.ico"
  CreateShortCut "${STARTMENU}\Switch to CPU mode.lnk" "${POWERSHELL}" '${LAUNCH} -Cpu' "$INSTDIR\buji.ico"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "Buji V3 Preview"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "3.0.0-preview.2"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "CBN.Ai"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\buji.ico"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNKEY}" "URLInfoAbout" "https://devchandrasen.github.io/CBN.ai/"
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  ReadRegStr $0 HKCU "${UNKEY}" "InstallLocation"
  StrCmp $0 "$INSTDIR" 0 invalid
  IfFileExists "$INSTDIR\cbn-buji-install.marker" valid invalid
  invalid:
    MessageBox MB_ICONSTOP "This folder does not match the registered Buji installation."
    Abort
  valid:
  ; Delete only the application and components owned by the installer.
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\tools"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\wsp"
  RMDir /r "$INSTDIR\voice"
  RMDir /r "$INSTDIR\notices"
  Delete "$INSTDIR\Start-Buji.ps1"
  Delete "$INSTDIR\Start-Buji-V2-Backend.ps1"
  Delete "$INSTDIR\release-assets.json"
  Delete "$INSTDIR\hindi-wheels.txt"
  Delete "$INSTDIR\vision-wheels.txt"
  Delete "$INSTDIR\buji.ico"
  Delete "$INSTDIR\cbn-buji-install.marker"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "${STARTMENU}\Buji.lnk"
  Delete "${STARTMENU}\Set up Hindi speech.lnk"
  Delete "${STARTMENU}\Set up visual computer use.lnk"
  Delete "${STARTMENU}\Set up NVIDIA acceleration.lnk"
  Delete "${STARTMENU}\Switch to CPU mode.lnk"
  RMDir "${STARTMENU}"
  DeleteRegKey HKCU "${UNKEY}"
  RMDir "$INSTDIR"
SectionEnd
