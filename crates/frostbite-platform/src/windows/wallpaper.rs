//! Desktop wallpaper: apply Frostbite's winter wallpaper and put the user's
//! own one back afterwards.
//!
//! What the user had is remembered under `HKCU\Software\Frostbite` so both the
//! app (toggle off) and the NSIS uninstaller (packaging/nsis/hooks.nsh) can
//! restore it. Keep the value names in sync with that hook.

use std::ffi::c_void;
use std::path::{Path, PathBuf};

use windows::core::{w, PCWSTR};
use windows::Win32::System::Registry::{
    RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ,
};
use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_GETDESKWALLPAPER,
    SPI_SETDESKWALLPAPER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};

use crate::{PlatformError, Result};

const OUR_KEY: PCWSTR = w!("Software\\Frostbite");
const DESKTOP_KEY: PCWSTR = w!("Control Panel\\Desktop");
const PREV_PATH: PCWSTR = w!("PreviousWallpaper");
const PREV_STYLE: PCWSTR = w!("PreviousWallpaperStyle");
const PREV_TILE: PCWSTR = w!("PreviousTileWallpaper");
const APPLIED: PCWSTR = w!("AppliedWallpaper");

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn read_sz(key: PCWSTR, name: PCWSTR) -> Option<String> {
    unsafe {
        let mut bytes = 0u32;
        RegGetValueW(HKEY_CURRENT_USER, key, name, RRF_RT_REG_SZ, None, None, Some(&mut bytes)).ok().ok()?;
        let mut buf = vec![0u16; (bytes as usize).div_ceil(2).max(1)];
        RegGetValueW(
            HKEY_CURRENT_USER,
            key,
            name,
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut c_void),
            Some(&mut bytes),
        )
        .ok()
        .ok()?;
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..end]))
    }
}

fn write_sz(key: PCWSTR, name: PCWSTR, value: &str) -> Result<()> {
    let data = wide(value);
    unsafe {
        RegSetKeyValueW(
            HKEY_CURRENT_USER,
            key,
            name,
            REG_SZ.0,
            Some(data.as_ptr() as *const c_void),
            (data.len() * 2) as u32,
        )
        .ok()
        .map_err(|e| PlatformError(format!("registry write: {e}")))
    }
}

fn delete_value(key: PCWSTR, name: PCWSTR) {
    unsafe {
        let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, key, name);
    }
}

/// The wallpaper path Windows is showing now ("" = solid color).
fn current() -> Option<String> {
    let mut buf = [0u16; 1024];
    unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr() as *mut c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .ok()?;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..end]))
}

fn set_current(path: &str) -> Result<()> {
    let data = wide(path);
    unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            Some(data.as_ptr() as *mut c_void),
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
        .map_err(|e| PlatformError(format!("set wallpaper: {e}")))
    }
}

/// `%USERPROFILE%\Pictures\Frostbite`: a real folder Explorer can always read
/// (not virtualized for MSIX, and it outlives the app's install folder).
fn wallpaper_dir() -> Result<PathBuf> {
    let home = std::env::var_os("USERPROFILE").ok_or_else(|| PlatformError("USERPROFILE not set".into()))?;
    Ok(PathBuf::from(home).join("Pictures").join("Frostbite"))
}

/// Windows often reports the wallpaper as its own cache file
/// (`...\Themes\TranscodedWallpaper`), and overwrites that file the moment a
/// new wallpaper is set. Copy it somewhere safe first so restore gets the
/// real picture back. Other paths are the user's own files: keep them as is.
fn keep_copy_if_cached(path: &str, dir: &Path) -> String {
    let is_cache = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.to_ascii_lowercase().starts_with("transcodedwallpaper"));
    if !is_cache {
        return path.to_string();
    }
    let backup = dir.join("Previous Wallpaper.jpg");
    match std::fs::copy(path, &backup) {
        Ok(_) => backup.to_string_lossy().into_owned(),
        Err(_) => path.to_string(),
    }
}

pub fn apply(image: &Path) -> Result<()> {
    let dir = wallpaper_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| PlatformError(format!("wallpaper folder: {e}")))?;
    let ext = image.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
    let dest = dir.join(format!("Frostbite Winter Night.{ext}"));
    std::fs::copy(image, &dest).map_err(|e| PlatformError(format!("copy wallpaper: {e}")))?;
    let dest_s = dest.to_string_lossy().into_owned();

    // Remember the user's own wallpaper once; never overwrite it with ours.
    let now = current().unwrap_or_default();
    if read_sz(OUR_KEY, PREV_PATH).is_none() && !now.eq_ignore_ascii_case(&dest_s) {
        write_sz(OUR_KEY, PREV_PATH, &keep_copy_if_cached(&now, &dir))?;
        if let Some(style) = read_sz(DESKTOP_KEY, w!("WallpaperStyle")) {
            write_sz(OUR_KEY, PREV_STYLE, &style)?;
        }
        if let Some(tile) = read_sz(DESKTOP_KEY, w!("TileWallpaper")) {
            write_sz(OUR_KEY, PREV_TILE, &tile)?;
        }
    }

    // "Fill" so the picture covers any screen shape without bars.
    write_sz(DESKTOP_KEY, w!("WallpaperStyle"), "10")?;
    write_sz(DESKTOP_KEY, w!("TileWallpaper"), "0")?;
    write_sz(OUR_KEY, APPLIED, &dest_s)?;
    set_current(&dest_s)
}

pub fn restore() -> Result<()> {
    let applied = read_sz(OUR_KEY, APPLIED);
    let prev = read_sz(OUR_KEY, PREV_PATH);
    let still_ours = match (&applied, current()) {
        (Some(a), Some(now)) => a.eq_ignore_ascii_case(&now),
        _ => false,
    };
    // If the user has picked another wallpaper since, leave theirs alone.
    if still_ours {
        if let Some(prev) = &prev {
            if let Some(style) = read_sz(OUR_KEY, PREV_STYLE) {
                write_sz(DESKTOP_KEY, w!("WallpaperStyle"), &style)?;
            }
            if let Some(tile) = read_sz(OUR_KEY, PREV_TILE) {
                write_sz(DESKTOP_KEY, w!("TileWallpaper"), &tile)?;
            }
            set_current(prev)?;
        }
    }
    for name in [PREV_PATH, PREV_STYLE, PREV_TILE, APPLIED] {
        delete_value(OUR_KEY, name);
    }
    Ok(())
}
