//! Development stub for non-Windows hosts. Lets the app compile and run (with
//! toolkit fallbacks) on a Mac or Linux dev machine. A real macOS backend will
//! replace this later.

use crate::{MonitorInfo, NativeHandle, Platform, Point, Result, Surfaces};

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
}
