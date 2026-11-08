//! System state: fullscreen apps, lock screen, power, autostart.

use std::ffi::c_void;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegGetValueW, RegOpenKeyExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_SZ, RRF_RT_REG_SZ,
};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, OpenInputDesktop, DESKTOP_ACCESS_FLAGS, DESKTOP_CONTROL_FLAGS,
    DESKTOP_SWITCHDESKTOP,
};
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
    QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowRect, ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE,
};

use crate::{NativeHandle, PlatformError, Result, SystemState};

const RUN_KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
const RUN_VALUE: PCWSTR = w!("Frostbite");

/// Desktop/shell windows that are "foreground" without being an app.
const SHELL_CLASSES: &[&str] = &["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

unsafe fn class_of(h: HWND, buf: &mut [u16; 64]) -> &[u16] {
    let n = GetClassNameW(h, buf);
    &buf[..n.max(0) as usize]
}

/// The shell's own idea of "a fullscreen app / game / presentation is running".
fn shell_says_fullscreen() -> bool {
    unsafe {
        matches!(
            SHQueryUserNotificationState(),
            Ok(s) if s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE
        )
    }
}

/// Foreground window covers its whole monitor (borderless-fullscreen games,
/// F11 browsers, video players). Catches cases the shell API misses.
fn foreground_covers_monitor(own: Option<NativeHandle>) -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_invalid() || own.map(|o| o.0) == Some(fg.0 as isize) {
            return false;
        }
        let mut buf = [0u16; 64];
        let cls = class_of(fg, &mut buf);
        if SHELL_CLASSES.iter().any(|c| c.encode_utf16().eq(cls.iter().copied())) {
            return false;
        }
        let mut r = RECT::default();
        if GetWindowRect(fg, &mut r).is_err() {
            return false;
        }
        let mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(mon, &mut mi).as_bool() {
            return false;
        }
        let m = mi.rcMonitor;
        r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
    }
}

/// Locked workstation (or the UAC secure desktop): the input desktop can't be opened.
fn session_locked() -> bool {
    unsafe {
        match OpenInputDesktop(
            DESKTOP_CONTROL_FLAGS(0),
            false,
            DESKTOP_ACCESS_FLAGS(DESKTOP_SWITCHDESKTOP.0),
        ) {
            Ok(h) => {
                let _ = CloseDesktop(h);
                false
            }
            Err(_) => true,
        }
    }
}

pub fn state(own: Option<NativeHandle>) -> SystemState {
    let mut ps = SYSTEM_POWER_STATUS::default();
    let (on_battery, saver) = if unsafe { GetSystemPowerStatus(&mut ps) }.is_ok() {
        (ps.ACLineStatus == 0, ps.SystemStatusFlag == 1)
    } else {
        (false, false)
    };
    SystemState {
        fullscreen: shell_says_fullscreen() || foreground_covers_monitor(own),
        locked: session_locked(),
        on_battery: on_battery || saver,
    }
}

pub fn set_visible(window: NativeHandle, visible: bool) {
    unsafe {
        let _ = ShowWindow(
            HWND(window.0 as *mut c_void),
            if visible { SW_SHOWNOACTIVATE } else { SW_HIDE },
        );
    }
}

// --- autostart (unpackaged builds: HKCU Run key) -------------------------------
// The MSIX build registers a StartupTask in its manifest instead (see M6).

pub fn autostart_enabled() -> bool {
    unsafe {
        RegGetValueW(HKEY_CURRENT_USER, RUN_KEY, RUN_VALUE, RRF_RT_REG_SZ, None, None, None).is_ok()
    }
}

pub fn set_autostart(enable: bool) -> Result<()> {
    unsafe {
        let mut key = HKEY::default();
        // The Run key exists on every Windows install.
        RegOpenKeyExW(HKEY_CURRENT_USER, RUN_KEY, None, KEY_SET_VALUE | KEY_QUERY_VALUE, &mut key)
        .ok()
        .map_err(|e| PlatformError(format!("open Run key: {e}")))?;
        let res = if enable {
            let exe = std::env::current_exe().map_err(|e| PlatformError(e.to_string()))?;
            let cmd = format!("\"{}\" --autostart", exe.display());
            let wide: Vec<u16> = cmd.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes = std::slice::from_raw_parts(wide.as_ptr() as *const u8, wide.len() * 2);
            RegSetValueExW(key, RUN_VALUE, None, REG_SZ, Some(bytes)).ok()
        } else {
            let r = RegDeleteValueW(key, RUN_VALUE);
            // Already absent is fine.
            if r.0 == 2 { Ok(()) } else { r.ok() }
        };
        let _ = RegCloseKey(key);
        res.map_err(|e| PlatformError(format!("autostart: {e}")))
    }
}
