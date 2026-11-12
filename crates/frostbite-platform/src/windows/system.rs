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

// --- autostart ------------------------------------------------------------------
// Packaged (MSIX/Store): the `windows.startupTask` declared in AppxManifest.xml,
// toggled through the WinRT StartupTask API. The Run key is virtualized inside
// a package, so it wouldn't work there anyway.
// Unpackaged (NSIS / dev): HKCU\...\Run.

/// Must match `TaskId` in packaging/msix/AppxManifest.template.xml.
const STARTUP_TASK_ID: &str = "FrostbiteStartup";

/// Running from an MSIX package?
pub fn is_packaged() -> bool {
    use windows::Win32::Foundation::APPMODEL_ERROR_NO_PACKAGE;
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
    let mut len = 0u32;
    let r = unsafe { GetCurrentPackageFullName(&mut len, None) };
    r != APPMODEL_ERROR_NO_PACKAGE
}

/// WinRT calls block on async operations; run them on a fresh (MTA) thread so
/// the tray's UI (STA) thread never waits on itself.
fn on_worker<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    std::thread::spawn(f)
        .join()
        .unwrap_or_else(|_| Err(PlatformError("startup task worker panicked".into())))
}

fn startup_task() -> Result<windows::ApplicationModel::StartupTask> {
    use windows::core::HSTRING;
    windows::ApplicationModel::StartupTask::GetAsync(&HSTRING::from(STARTUP_TASK_ID))
        .and_then(|op| op.get())
        .map_err(|e| PlatformError(format!("StartupTask: {e}")))
}

fn packaged_autostart_enabled() -> bool {
    use windows::ApplicationModel::StartupTaskState as S;
    on_worker(|| {
        let st = startup_task()?.State().map_err(|e| PlatformError(e.to_string()))?;
        Ok(st == S::Enabled || st == S::EnabledByPolicy)
    })
    .unwrap_or(false)
}

fn set_packaged_autostart(enable: bool) -> Result<()> {
    use windows::ApplicationModel::StartupTaskState as S;
    on_worker(move || {
        let task = startup_task()?;
        if !enable {
            return task.Disable().map_err(|e| PlatformError(e.to_string()));
        }
        let st = task
            .RequestEnableAsync()
            .and_then(|op| op.get())
            .map_err(|e| PlatformError(e.to_string()))?;
        match st {
            S::Enabled | S::EnabledByPolicy => Ok(()),
            // Only the user can undo these, in Settings → Apps → Startup.
            S::DisabledByUser => Err(PlatformError(
                "startup was turned off in Windows Settings → Apps → Startup".into(),
            )),
            _ => Err(PlatformError("startup is disabled by policy".into())),
        }
    })
}

/// Started at sign-in: the Run-key entry passes `--autostart`; a packaged
/// app is activated through its StartupTask.
pub fn launched_at_login() -> bool {
    if std::env::args().any(|a| a == "--autostart") {
        return true;
    }
    if !is_packaged() {
        return false;
    }
    use windows::ApplicationModel::Activation::ActivationKind;
    on_worker(|| {
        let args = windows::ApplicationModel::AppInstance::GetActivatedEventArgs()
            .map_err(|e| PlatformError(format!("activation args: {e}")))?;
        let kind = args.Kind().map_err(|e| PlatformError(e.to_string()))?;
        Ok(kind == ActivationKind::StartupTask)
    })
    .unwrap_or(false)
}

pub fn autostart_enabled() -> bool {
    if is_packaged() {
        return packaged_autostart_enabled();
    }
    unsafe {
        RegGetValueW(HKEY_CURRENT_USER, RUN_KEY, RUN_VALUE, RRF_RT_REG_SZ, None, None, None).is_ok()
    }
}

pub fn set_autostart(enable: bool) -> Result<()> {
    if is_packaged() {
        return set_packaged_autostart(enable);
    }
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
