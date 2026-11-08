use frostbite_platform::{Rect, Surfaces};
use serde::Serialize;
use tauri::State;

use crate::{layout::Layout, AppState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Boot {
    layout: Layout,
    surfaces: Surfaces,
    debug: bool,
    platform: &'static str,
}

/// Everything the frontend needs to start.
#[tauri::command]
pub fn boot(state: State<'_, AppState>) -> Boot {
    Boot {
        layout: state.layout.lock().unwrap().clone(),
        surfaces: state.surfaces.lock().unwrap().clone(),
        debug: state.debug,
        platform: state.platform.name(),
    }
}

#[derive(serde::Deserialize)]
pub struct RectIn {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// Overlay-relative regions that should receive the mouse (snowman, a pile
/// being dug). `capture` keeps the mouse during a drag.
#[tauri::command]
pub fn set_hit_regions(state: State<'_, AppState>, regions: Vec<RectIn>, capture: bool) {
    let mut hit = state.hit.lock().unwrap();
    hit.regions = regions
        .into_iter()
        .map(|r| Rect::new(r.x, r.y, r.w, r.h))
        .collect();
    hit.capture = capture;
}
