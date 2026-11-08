use std::sync::Mutex;

use frostbite_platform::{NativeHandle, Platform, Rect};

use crate::layout::Layout;

/// Regions (overlay-relative physical px) where the overlay should accept
/// mouse input instead of passing it through. Set by the frontend.
#[derive(Default)]
pub struct HitState {
    pub regions: Vec<Rect>,
    /// While true (e.g. mid-drag) the overlay keeps the mouse regardless of position.
    pub capture: bool,
}

pub struct AppState {
    pub platform: Box<dyn Platform>,
    pub layout: Mutex<Layout>,
    pub hit: Mutex<HitState>,
    pub overlay: Mutex<Option<NativeHandle>>,
    pub debug: bool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            platform: frostbite_platform::current(),
            layout: Mutex::new(Layout::default()),
            hit: Mutex::new(HitState::default()),
            overlay: Mutex::new(None),
            debug: std::env::var_os("FROSTBITE_DEBUG").is_some() || cfg!(debug_assertions),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
