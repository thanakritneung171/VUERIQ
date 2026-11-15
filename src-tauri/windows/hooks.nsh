; VUERIQ installer hooks (bundle.windows.nsis.installerHooks).
; Tauri's own fileAssociations only set each extension's default class, which Windows 10/11
; ignore for "Open with". The app registers proper OpenWithProgids, SupportedTypes and
; Default-apps capabilities itself (HKLM for an all-users install, HKCU otherwise).

!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --register-associations'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-associations'
!macroend
