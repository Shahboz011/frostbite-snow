; Tauri NSIS installer hooks (wired up in src-tauri/tauri.conf.json).

!macro NSIS_HOOK_PREUNINSTALL
  ; "Launch at startup" in the unpackaged build writes this value; don't leave
  ; a dangling startup entry behind after uninstalling.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Frostbite"

  ; Put back the wallpaper the user had before the winter wallpaper, but only
  ; if ours is still showing. Value names match
  ; crates/frostbite-platform/src/windows/wallpaper.rs.
  ClearErrors
  ReadRegStr $0 HKCU "Software\Frostbite" "PreviousWallpaper"
  IfErrors frostbite_wallpaper_done
  ReadRegStr $3 HKCU "Software\Frostbite" "AppliedWallpaper"
  ReadRegStr $4 HKCU "Control Panel\Desktop" "Wallpaper"
  StrCmp $3 $4 0 frostbite_wallpaper_done
  ReadRegStr $1 HKCU "Software\Frostbite" "PreviousWallpaperStyle"
  ReadRegStr $2 HKCU "Software\Frostbite" "PreviousTileWallpaper"
  StrCmp $1 "" +2
  WriteRegStr HKCU "Control Panel\Desktop" "WallpaperStyle" $1
  StrCmp $2 "" +2
  WriteRegStr HKCU "Control Panel\Desktop" "TileWallpaper" $2
  ; SPI_SETDESKWALLPAPER = 0x14; SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 3
  System::Call "user32::SystemParametersInfoW(i 0x14, i 0, w r0, i 3)"
  Delete $3
  frostbite_wallpaper_done:
  DeleteRegKey HKCU "Software\Frostbite"
!macroend
