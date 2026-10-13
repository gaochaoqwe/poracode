; Custom NSIS hooks for the AgentEmployee Windows installer.
;
; Registers the bundled CPython interpreter's directory in the *system* PATH
; (HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment) so a bare
; `python` resolves to AgentEmployee's runtime for every user and every shell the
; user opens afterwards -- including the AgentEmployee terminal tab, whose PATH is
; rebuilt from the registry at spawn time.
;
; Writing HKLM requires elevation, so this rides on the per-machine installer
; (`nsis.perMachine: true` in scripts/build-desktop-artifact.mjs). Uninstall
; removes the entry again.
;
; electron-builder includes this file automatically (nsis.include defaults to
; build/installer.nsh) and calls the macros below at the end of install /
; uninstall.

!include "LogicLib.nsh"
!include "WinMessages.nsh"

!define AGENTEMPLOYEE_ENV_KEY "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
!define AGENTEMPLOYEE_PYTHON_SUBDIR "resources\python\win32-x64"

; Case-insensitive index of $1 inside $0. Sets $2 to the 0-based index, or -1
; when not found; also leaves $3 = length of $1 and $4 = length of $0.
; Clobbers $5, $6. Pure built-ins (`StrCmp` is case-insensitive), inlined as a
; macro so it works in both the installer and the uninstaller pass.
!macro AgentEmployeeStrIndex
  StrLen $3 $1
  StrLen $4 $0
  StrCpy $2 -1
  StrCpy $5 0
  ${If} $3 > 0
    ${DoWhile} $5 <= $4
      StrCpy $6 $0 $3 $5
      ${If} $6 == $1
        StrCpy $2 $5
        ${Break}
      ${EndIf}
      IntOp $5 $5 + 1
    ${Loop}
  ${EndIf}
!macroend

; Tell the shell the environment changed. Processes already running keep their
; old environment until they restart; newly started ones pick up the change.
!macro AgentEmployeeBroadcastEnvChange
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customInstall
  ; Only register the interpreter when this architecture actually shipped one.
  IfFileExists "$INSTDIR\${AGENTEMPLOYEE_PYTHON_SUBDIR}\python.exe" 0 agentemployee_install_done

  ReadRegStr $0 HKLM "${AGENTEMPLOYEE_ENV_KEY}" "Path"
  StrCpy $1 "$INSTDIR\${AGENTEMPLOYEE_PYTHON_SUBDIR}"

  ; Skip when the entry is already present (install-over-install / repair).
  !insertmacro AgentEmployeeStrIndex
  StrCmp $2 -1 0 agentemployee_install_done

  StrCmp $0 "" agentemployee_install_empty
    WriteRegExpandStr HKLM "${AGENTEMPLOYEE_ENV_KEY}" "Path" "$0;$1"
    Goto agentemployee_install_broadcast

agentemployee_install_empty:
  WriteRegExpandStr HKLM "${AGENTEMPLOYEE_ENV_KEY}" "Path" "$1"

agentemployee_install_broadcast:
  !insertmacro AgentEmployeeBroadcastEnvChange

agentemployee_install_done:
!macroend

!macro customUnInstall
  ReadRegStr $0 HKLM "${AGENTEMPLOYEE_ENV_KEY}" "Path"
  StrCpy $1 "$INSTDIR\${AGENTEMPLOYEE_PYTHON_SUBDIR}"

  !insertmacro AgentEmployeeStrIndex
  StrCmp $2 -1 0 agentemployee_un_write   ; entry absent -> leave PATH untouched

  ; Prefix: everything before the entry. When a ';' precedes it, drop that
  ; separator too and remember that we did ($9), so the suffix keeps its own.
  StrCpy $5 $2
  StrCpy $9 0
  StrCmp $2 0 agentemployee_un_prefix
    IntOp $6 $2 - 1
    StrCpy $7 $0 1 $6
    StrCmp $7 ";" 0 agentemployee_un_prefix
      StrCpy $5 $6
      StrCpy $9 1

agentemployee_un_prefix:
  StrCpy $8 $0 $5

  ; Suffix: everything after the entry. Drop a following ';' only when we did
  ; not already drop the preceding one -- otherwise "a;entry;b" would collapse
  ; to "ab" instead of "a;b".
  IntOp $5 $2 + $3
  StrCmp $9 1 agentemployee_un_suffix
    StrCmp $5 $4 agentemployee_un_suffix
      StrCpy $7 $0 1 $5
      StrCmp $7 ";" 0 agentemployee_un_suffix
        IntOp $5 $5 + 1

agentemployee_un_suffix:
  StrCpy $6 $0 "" $5
  StrCpy $0 "$8$6"

agentemployee_un_write:
  WriteRegExpandStr HKLM "${AGENTEMPLOYEE_ENV_KEY}" "Path" "$0"
  !insertmacro AgentEmployeeBroadcastEnvChange
!macroend
