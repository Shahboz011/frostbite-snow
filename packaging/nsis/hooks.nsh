; Tauri NSIS installer hooks (wired up in src-tauri/tauri.conf.json).

!macro NSIS_HOOK_PREUNINSTALL
  ; "Launch at startup" in the unpackaged build writes this value; don't leave
  ; a dangling startup entry behind after uninstalling.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Frostbite"
!macroend
