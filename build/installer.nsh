!include "getProcessInfo.nsh"

Var multimindProcessOwnerMode
Var multimindUninstallArgs
Var multimindUninstallOption
Var pid

!ifndef BUILD_UNINSTALLER
  Var multimindRepairRequired
  Var multimindLegacyInstallDir
!endif

# If a machine-wide installation already exists, an upgrade must stay
# machine-wide. Installing a new current-user copy would create a second
# Programs and Features entry and leave the old machine-wide version behind.
!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${If} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${EndIf}
  !endif
!macroend

!macro findMultiMindProcess EXECUTABLE RESULT
  ${If} $multimindProcessOwnerMode == "all"
    ${nsProcess::FindProcess} "${EXECUTABLE}" ${RESULT}
  ${Else}
    nsExec::Exec `"$SYSDIR\cmd.exe" /c tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${EXECUTABLE}" /FO csv | "$SYSDIR\find.exe" "${EXECUTABLE}"`
    Pop ${RESULT}
  ${EndIf}
!macroend

!macro stopMultiMindProcess EXECUTABLE FORCE
  ${If} $multimindProcessOwnerMode == "all"
    nsExec::Exec `taskkill ${FORCE} /im "${EXECUTABLE}" /fi "PID ne $pid"`
  ${Else}
    nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill ${FORCE} /im "${EXECUTABLE}" /fi "PID ne $pid" /fi "USERNAME eq %USERNAME%"`
  ${EndIf}
!macroend

!macro ensureMultiMindProcessClosed EXECUTABLE LABEL_SUFFIX
  !insertmacro findMultiMindProcess "${EXECUTABLE}" $R0
  ${If} $R0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDCANCEL IDOK multimind_stop_process_${LABEL_SUFFIX}
    Quit

    multimind_stop_process_${LABEL_SUFFIX}:
    DetailPrint `Closing running "${EXECUTABLE}"...`
    !insertmacro stopMultiMindProcess "${EXECUTABLE}" ""
    Sleep 1000

    !insertmacro findMultiMindProcess "${EXECUTABLE}" $R0
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY multimind_force_stop_process_${LABEL_SUFFIX}
      Quit

      multimind_force_stop_process_${LABEL_SUFFIX}:
      !insertmacro stopMultiMindProcess "${EXECUTABLE}" "/f"
      Sleep 1000

      !insertmacro findMultiMindProcess "${EXECUTABLE}" $R0
      ${If} $R0 == 0
        MessageBox MB_OK|MB_ICONSTOP "$(appCannotBeClosed)"
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

# electron-builder's assisted multi-user installer compiles its default process
# check as a current-user-only check when perMachine=false. At runtime the user
# can still choose an all-users installation, so an uninstall must check every
# user's instance. Historical executable names must also be checked because a
# broken old version can otherwise keep its installation directory locked.
!macro customCheckAppRunning
  StrCpy $multimindProcessOwnerMode "$installMode"
  ${GetParameters} $multimindUninstallArgs

  ClearErrors
  ${GetOptions} $multimindUninstallArgs "/allusers" $multimindUninstallOption
  ${IfNot} ${Errors}
    StrCpy $multimindProcessOwnerMode "all"
  ${EndIf}

  ClearErrors
  ${GetOptions} $multimindUninstallArgs "/currentuser" $multimindUninstallOption
  ${IfNot} ${Errors}
    StrCpy $multimindProcessOwnerMode "CurrentUser"
  ${EndIf}

  ${GetProcessInfo} 0 $pid $R1 $R2 $R3 $R4
  ${If} $R3 != "${APP_EXECUTABLE_FILENAME}"
    !insertmacro ensureMultiMindProcessClosed "${APP_EXECUTABLE_FILENAME}" current
    !insertmacro ensureMultiMindProcessClosed "MultiMind.exe" legacy_multimind
    !insertmacro ensureMultiMindProcessClosed "MultiMind Browser.exe" legacy_browser
  ${EndIf}
!macroend

!macro removeLegacyShortcuts
  Delete "$DESKTOP\MultiMind Flow.lnk"
  Delete "$DESKTOP\MultiMind.lnk"
  Delete "$DESKTOP\MultiMind Browser.lnk"
  Delete "$SMPROGRAMS\MultiMind Flow.lnk"
  Delete "$SMPROGRAMS\MultiMind.lnk"
  Delete "$SMPROGRAMS\MultiMind Browser.lnk"
  RMDir /r "$SMPROGRAMS\MultiMind Flow"
  RMDir /r "$SMPROGRAMS\MultiMind"
  RMDir /r "$SMPROGRAMS\MultiMind Browser"
!macroend

!ifndef BUILD_UNINSTALLER
  !macro validateLegacyInstallDirectory
    StrCpy $multimindRepairRequired "0"
    ${If} ${Errors}
      StrCpy $multimindRepairRequired "1"
    ${ElseIf} $R0 != 0
      StrCpy $multimindRepairRequired "1"
    ${EndIf}
  !macroend

  # Recover from historical uninstallers that cannot launch or return an error.
  # The directory comes from MultiMind's stable appId registry key and is deleted
  # only after the validation above, so custom installation paths are supported
  # without allowing an unsafe recursive delete.
  !macro repairBrokenUninstall REGISTRY_ROOT
    !insertmacro validateLegacyInstallDirectory

    ${If} $multimindRepairRequired == "1"
      ReadRegStr $multimindLegacyInstallDir ${REGISTRY_ROOT} "${INSTALL_REGISTRY_KEY}" InstallLocation

      # Never recursively delete a registry-provided directory unless it still
      # contains a recognizable MultiMind application artifact. A missing or
      # already-cleaned directory only needs its stale registration removed.
      ${If} ${FileExists} "$multimindLegacyInstallDir\MultiMind Flow.exe"
      ${OrIf} ${FileExists} "$multimindLegacyInstallDir\MultiMind.exe"
      ${OrIf} ${FileExists} "$multimindLegacyInstallDir\MultiMind Browser.exe"
      ${OrIf} ${FileExists} "$multimindLegacyInstallDir\resources\app.asar"
        DetailPrint "Repairing the damaged previous MultiMind installation at $multimindLegacyInstallDir"
        RMDir /r "$multimindLegacyInstallDir"
        ${If} ${FileExists} "$multimindLegacyInstallDir\*.*"
          MessageBox MB_OK|MB_ICONSTOP "Setup could not completely remove the previous MultiMind installation: $multimindLegacyInstallDir"
          SetErrorLevel 2
          Quit
        ${EndIf}
      ${Else}
        DetailPrint "Removing stale MultiMind installation registration; no verified application payload remains."
      ${EndIf}

      !insertmacro removeLegacyShortcuts
      DeleteRegKey ${REGISTRY_ROOT} "${UNINSTALL_REGISTRY_KEY}"
      !ifdef UNINSTALL_REGISTRY_KEY_2
        DeleteRegKey ${REGISTRY_ROOT} "${UNINSTALL_REGISTRY_KEY_2}"
      !endif
      DeleteRegKey ${REGISTRY_ROOT} "${INSTALL_REGISTRY_KEY}"

      StrCpy $R0 0
      ClearErrors
    ${EndIf}
  !macroend

  !macro customUnInstallCheck
    !insertmacro repairBrokenUninstall SHELL_CONTEXT
  !macroend

  !macro customUnInstallCheckCurrentUser
    SetShellVarContext current
    !insertmacro repairBrokenUninstall HKEY_CURRENT_USER
    SetShellVarContext all
  !macroend
!endif

# Remove shortcut names left by any historical product name during a normal
# uninstall too. electron-builder handles the active shortcut and registry keys.
!macro customUnInstall
  !insertmacro removeLegacyShortcuts
  ${If} $installMode == "all"
    SetShellVarContext current
    !insertmacro removeLegacyShortcuts
    SetShellVarContext all
  ${EndIf}

  # Retry removal with reboot scheduling for files temporarily held by Windows,
  # antivirus software, or a late Electron child-process shutdown.
  RMDir /r /REBOOTOK "$INSTDIR"
!macroend
