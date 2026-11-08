use std::path::PathBuf;
use std::sync::Mutex;

use frostbite_platform::{NativeHandle, Platform, Rect, Surfaces, SystemState};
use serde::Serialize;

use crate::layout::Layout;
use crate::settings::Settings;

/// Regions (overlay-relative physical px) where the overlay should accept
/// mouse input instead of passing it through. Set by the frontend.
#[derive(Default)]
pub struct HitState {
    pub regions: Vec<Rect>,
    /// While true (e.g. mid-drag) the overlay keeps the mouse regardless of position.
    pub capture: bool,
}

/// Why the snow is paused (if it is) and how fast it may render.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Power {
    pub paused: bool,
    pub battery: bool,
}

impl Power {
    pub fn from_system(s: SystemState) -> Self {
        Self { paused: s.fullscreen || s.locked, battery: s.on_battery }
    }
}

pub struct AppState {
    pub platform: Box<dyn Platform>,
    pub layout: Mutex<Layout>,
    pub hit: Mutex<HitState>,
    /// Latest surfaces, overlay-relative.
    pub surfaces: Mutex<Surfaces>,
    pub overlay: Mutex<Option<NativeHandle>>,
    pub settings: Mutex<Settings>,
    pub settings_path: Mutex<Option<PathBuf>>,
    pub power: Mutex<Power>,
    pub debug: bool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            platform: frostbite_platform::current(),
            layout: Mutex::new(Layout::default()),
            hit: Mutex::new(HitState::default()),
            surfaces: Mutex::new(Surfaces::default()),
            overlay: Mutex::new(None),
            settings: Mutex::new(Settings::default()),
            settings_path: Mutex::new(None),
            power: Mutex::new(Power::default()),
            debug: std::env::var_os("FROSTBITE_DEBUG").is_some() || cfg!(debug_assertions),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
