//! Windows 10/11 backend (Win32 via the `windows` crate).
//!
//! The process is per-monitor-DPI-aware v2 (Tauri/tao sets this), so every
//! coordinate here is in physical pixels.

use std::ffi::c_void;

mod surfaces;
mod system;

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_DISALLOW_PEEK, DWMWA_EXCLUDED_FROM_PEEK,
};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
    MONITORINFOF_PRIMARY, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
    SWP_NOSIZE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use crate::{
    MonitorInfo, NativeHandle, Platform, PlatformError, Point, Rect, Result, Surfaces, SystemState,
};

pub struct WindowsPlatform;

impl WindowsPlatform {
    pub fn new() -> Self {
        Self
    }
}

fn hwnd(h: NativeHandle) -> HWND {
    HWND(h.0 as *mut c_void)
}

fn rect_from(r: RECT) -> Rect {
    Rect::new(r.left, r.top, r.right - r.left, r.bottom - r.top)
}

unsafe extern "system" fn monitor_cb(hmon: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
    let out = &mut *(data.0 as *mut Vec<MonitorInfo>);
    let mut mi = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if GetMonitorInfoW(hmon, &mut mi).as_bool() {
        let (mut dx, mut dy) = (96u32, 96u32);
        let scale = if GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy).is_ok() {
            dx as f64 / 96.0
        } else {
            1.0
        };
        out.push(MonitorInfo {
            rect: rect_from(mi.rcMonitor),
            work: rect_from(mi.rcWork),
            scale,
            primary: mi.dwFlags & MONITORINFOF_PRIMARY != 0,
        });
    }
    BOOL(1) // continue enumeration
}

impl Platform for WindowsPlatform {
    fn name(&self) -> &'static str {
        "windows"
    }

    fn monitors(&self) -> Vec<MonitorInfo> {
        let mut out: Vec<MonitorInfo> = Vec::with_capacity(4);
        unsafe {
            let _ = EnumDisplayMonitors(
                None,
                None,
                Some(monitor_cb),
                LPARAM(&mut out as *mut Vec<MonitorInfo> as isize),
            );
        }
        // Stable order so layout comparisons don't flap.
        out.sort_by_key(|m| (m.rect.x, m.rect.y));
        out
    }

    fn cursor_pos(&self) -> Option<Point> {
        let mut p = POINT::default();
        unsafe { GetCursorPos(&mut p).ok()? };
        Some(Point { x: p.x, y: p.y })
    }

    fn prepare_overlay(&self, window: NativeHandle) -> Result<()> {
        let h = hwnd(window);
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let want = (ex | WS_EX_TOOLWINDOW.0 as isize | WS_EX_NOACTIVATE.0 as isize)
                & !(WS_EX_APPWINDOW.0 as isize);
            if want != ex {
                SetWindowLongPtrW(h, GWL_EXSTYLE, want);
                SetWindowPos(
                    h,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                )
                .map_err(|e| PlatformError(format!("SetWindowPos: {e}")))?;
            }
            // Keep snow visible during Aero Peek (Win+, / hovering "show desktop").
            let yes = BOOL(1);
            let sz = std::mem::size_of::<BOOL>() as u32;
            let p = &yes as *const BOOL as *const c_void;
            let _ = DwmSetWindowAttribute(h, DWMWA_EXCLUDED_FROM_PEEK, p, sz);
            let _ = DwmSetWindowAttribute(h, DWMWA_DISALLOW_PEEK, p, sz);
        }
        Ok(())
    }

    fn raise_overlay(&self, window: NativeHandle) {
        unsafe {
            let _ = SetWindowPos(
                hwnd(window),
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            );
        }
    }

    fn surfaces(&self, own: Option<NativeHandle>) -> Surfaces {
        surfaces::surfaces(own)
    }

    fn system_state(&self, own: Option<NativeHandle>) -> SystemState {
        system::state(own)
    }

    fn set_overlay_visible(&self, window: NativeHandle, visible: bool) -> bool {
        system::set_visible(window, visible);
        true
    }

    fn autostart_enabled(&self) -> Option<bool> {
        Some(system::autostart_enabled())
    }

    fn set_autostart(&self, enable: bool) -> Result<()> {
        system::set_autostart(enable)
    }
}
