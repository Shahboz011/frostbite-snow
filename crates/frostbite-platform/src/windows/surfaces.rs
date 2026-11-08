//! Window and taskbar enumeration.

use std::ffi::c_void;

use windows::core::{w, BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETTASKBARPOS, APPBARDATA};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, GetClassNameW, GetWindowLongPtrW, GetWindowRect, IsIconic,
    IsWindowVisible, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

use crate::{NativeHandle, Rect, Surfaces, WindowSurface};

/// Smaller than this (physical px) isn't worth piling snow on, and is usually
/// an invisible helper window.
const MIN_W: i32 = 60;
const MIN_H: i32 = 30;

/// Shell and system windows that are never snow surfaces. The taskbars are
/// reported separately.
const SKIP_CLASSES: &[&str] = &[
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "Shell_SecondaryTrayWnd",
    "Shell_InputSwitchTopLevelWindow",
    "XamlExplorerHostIslandWindow",
    "TopLevelWindowForOverflowXamlIsland",
    "NotifyIconOverflowWindow",
    "Windows.UI.Core.CoreWindow",
    "ForegroundStaging",
    "MultitaskingViewFrame",
    "TaskListThumbnailWnd",
];

struct Ctx {
    own: Option<HWND>,
    out: Vec<WindowSurface>,
}

fn rect_from(r: RECT) -> Rect {
    Rect::new(r.left, r.top, r.right - r.left, r.bottom - r.top)
}

unsafe fn class_is_skipped(h: HWND) -> bool {
    let mut buf = [0u16; 64];
    let n = GetClassNameW(h, &mut buf);
    if n <= 0 {
        return false;
    }
    let name = &buf[..n as usize];
    SKIP_CLASSES
        .iter()
        .any(|c| c.encode_utf16().eq(name.iter().copied()))
}

unsafe fn is_cloaked(h: HWND) -> bool {
    let mut cloaked: u32 = 0;
    DwmGetWindowAttribute(
        h,
        DWMWA_CLOAKED,
        &mut cloaked as *mut u32 as *mut c_void,
        std::mem::size_of::<u32>() as u32,
    )
    .is_ok()
        && cloaked != 0
}

unsafe fn frame_bounds(h: HWND) -> Option<Rect> {
    let mut r = RECT::default();
    if DwmGetWindowAttribute(
        h,
        DWMWA_EXTENDED_FRAME_BOUNDS,
        &mut r as *mut RECT as *mut c_void,
        std::mem::size_of::<RECT>() as u32,
    )
    .is_ok()
    {
        return Some(rect_from(r));
    }
    GetWindowRect(h, &mut r).ok().map(|_| rect_from(r))
}

unsafe extern "system" fn enum_cb(h: HWND, data: LPARAM) -> BOOL {
    let ctx = &mut *(data.0 as *mut Ctx);
    if Some(h) == ctx.own || !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() {
        return BOOL(1);
    }
    let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
    // Tool windows, click-through overlays (game/recording HUDs) and
    // never-activate popups are not things a user thinks of as "a window".
    if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0 | WS_EX_NOACTIVATE.0) != 0 {
        return BOOL(1);
    }
    if is_cloaked(h) || class_is_skipped(h) {
        return BOOL(1);
    }
    if let Some(rect) = frame_bounds(h) {
        if rect.w >= MIN_W && rect.h >= MIN_H {
            ctx.out.push(WindowSurface { id: h.0 as usize as u64, rect });
        }
    }
    BOOL(1)
}

pub fn windows(own: Option<NativeHandle>) -> Vec<WindowSurface> {
    let mut ctx = Ctx {
        own: own.map(|h| HWND(h.0 as *mut c_void)),
        out: Vec::with_capacity(32),
    };
    unsafe {
        // EnumWindows walks top-level windows in z-order, topmost first.
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut ctx as *mut Ctx as isize));
    }
    ctx.out
}

pub fn taskbars() -> Vec<Rect> {
    let mut out = Vec::with_capacity(2);
    unsafe {
        let mut abd = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            ..Default::default()
        };
        if SHAppBarMessage(ABM_GETTASKBARPOS, &mut abd) != 0 {
            out.push(rect_from(abd.rc));
        }
        // Taskbars on secondary monitors (Windows 10/11 "show taskbar on all displays").
        let mut prev: Option<HWND> = None;
        while let Ok(h) =
            FindWindowExW(None, prev, w!("Shell_SecondaryTrayWnd"), PCWSTR::null())
        {
            if h.is_invalid() {
                break;
            }
            prev = Some(h);
            let mut r = RECT::default();
            if IsWindowVisible(h).as_bool() && GetWindowRect(h, &mut r).is_ok() {
                out.push(rect_from(r));
            }
        }
    }
    out
}

pub fn surfaces(own: Option<NativeHandle>) -> Surfaces {
    Surfaces { windows: windows(own), taskbars: taskbars() }
}
