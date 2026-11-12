//! Development stub for non-Windows hosts. Lets the app compile and run (with
//! toolkit fallbacks) on a Mac or Linux dev machine. A real macOS backend will
//! replace this later.

use crate::{
    MonitorInfo, NativeHandle, Platform, PlatformError, Point, Rect, Result, Surfaces, SystemState,
};

pub struct StubPlatform;

impl Platform for StubPlatform {
    fn name(&self) -> &'static str {
        "stub"
    }
    fn monitors(&self) -> Vec<MonitorInfo> {
        Vec::new()
    }
    fn cursor_pos(&self) -> Option<Point> {
        None
    }
    fn prepare_overlay(&self, _window: NativeHandle) -> Result<()> {
        Ok(())
    }
    fn raise_overlay(&self, _window: NativeHandle) {}
    fn surfaces(&self, _own: Option<NativeHandle>) -> Surfaces {
        Surfaces::default()
    }
    fn system_state(&self, _own: Option<NativeHandle>) -> SystemState {
        SystemState::default()
    }
    fn set_overlay_visible(&self, _window: NativeHandle, _visible: bool) -> bool {
        false
    }
    fn autostart_enabled(&self) -> Option<bool> {
        None
    }
    fn set_autostart(&self, _enable: bool) -> Result<()> {
        Err(PlatformError("autostart not supported on this platform yet".into()))
    }
    fn desktop_icons(&self) -> Option<Vec<Rect>> {
        None
    }
    fn set_wallpaper(&self, _image: &std::path::Path) -> Result<()> {
        Err(PlatformError("wallpaper not supported on this platform yet".into()))
    }
    fn restore_wallpaper(&self) -> Result<()> {
        Ok(())
    }
    fn launched_at_login(&self) -> bool {
        std::env::args().any(|a| a == "--autostart")
    }
}
