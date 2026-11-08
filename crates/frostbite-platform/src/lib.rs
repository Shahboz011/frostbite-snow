//! OS integration layer for Frostbite.
//!
//! Everything that talks to the operating system directly lives behind the
//! [`Platform`] trait so a macOS backend can be added later without touching
//! the app or the frontend. All coordinates are **physical pixels in virtual
//! screen space** (the same space `GetCursorPos` / `EnumDisplayMonitors` use on
//! a per-monitor-DPI-aware process).

use raw_window_handle::RawWindowHandle;
use serde::Serialize;

#[cfg(windows)]
mod windows;
#[cfg(not(windows))]
mod stub;

/// Axis-aligned rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        Self { x, y, w, h }
    }
    pub const fn right(&self) -> i32 {
        self.x + self.w
    }
    pub const fn bottom(&self) -> i32 {
        self.y + self.h
    }
    pub const fn contains(&self, p: Point) -> bool {
        p.x >= self.x && p.y >= self.y && p.x < self.right() && p.y < self.bottom()
    }
    pub fn union(&self, o: &Rect) -> Rect {
        let x = self.x.min(o.x);
        let y = self.y.min(o.y);
        Rect::new(x, y, self.right().max(o.right()) - x, self.bottom().max(o.bottom()) - y)
    }
    pub const fn offset(&self, dx: i32, dy: i32) -> Rect {
        Rect::new(self.x + dx, self.y + dy, self.w, self.h)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// One physical display.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// Full monitor bounds.
    pub rect: Rect,
    /// Bounds minus taskbar / app bars.
    pub work: Rect,
    /// DPI scale (1.0 = 96 DPI).
    pub scale: f64,
    pub primary: bool,
}

/// An opaque, `Send`-able native window handle (HWND on Windows, NSView* on macOS).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeHandle(pub isize);

impl NativeHandle {
    pub fn from_raw(raw: RawWindowHandle) -> Option<Self> {
        match raw {
            RawWindowHandle::Win32(h) => Some(Self(h.hwnd.get())),
            RawWindowHandle::AppKit(h) => Some(Self(h.ns_view.as_ptr() as isize)),
            _ => None,
        }
    }
}

#[derive(Debug)]
pub struct PlatformError(pub String);

impl std::fmt::Display for PlatformError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for PlatformError {}

pub type Result<T> = std::result::Result<T, PlatformError>;

/// The OS backend. Implementations must be cheap to call from a polling thread.
pub trait Platform: Send + Sync {
    fn name(&self) -> &'static str;

    /// All active monitors. Returning an empty list means "not supported here",
    /// and the app falls back to the windowing toolkit's monitor list.
    fn monitors(&self) -> Vec<MonitorInfo>;

    /// Cursor position in virtual-screen physical pixels, or `None` if
    /// unavailable (the app then falls back to the toolkit).
    fn cursor_pos(&self) -> Option<Point>;

    /// Turn a freshly created window into a snow overlay: hidden from the
    /// taskbar and Alt-Tab, never takes focus, excluded from Aero Peek, topmost.
    /// Safe to call repeatedly (the toolkit may rewrite extended styles when
    /// click-through is toggled, so the app re-applies after each toggle).
    fn prepare_overlay(&self, window: NativeHandle) -> Result<()>;

    /// Re-assert topmost z-order without activating. Called periodically so
    /// the overlay stays above the taskbar after the user clicks it.
    fn raise_overlay(&self, window: NativeHandle);
}

/// The backend for the current OS.
pub fn current() -> Box<dyn Platform> {
    #[cfg(windows)]
    {
        Box::new(windows::WindowsPlatform::new())
    }
    #[cfg(not(windows))]
    {
        Box::new(stub::StubPlatform)
    }
}
