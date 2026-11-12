use frostbite_platform::{Rect, Surfaces};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State, Wry};

use crate::{layout::Layout, settings::Settings, state::Power, AppState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Boot {
    layout: Layout,
    surfaces: Surfaces,
    settings: Settings,
    power: Power,
    debug: bool,
    platform: &'static str,
}

/// Everything the frontend needs to start.
#[tauri::command]
pub fn boot(state: State<'_, AppState>) -> Boot {
    Boot {
        layout: state.layout.lock().unwrap().clone(),
        surfaces: state.surfaces.lock().unwrap().clone(),
        settings: state.settings.lock().unwrap().clone(),
        power: *state.power.lock().unwrap(),
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

/// What the Settings window shows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    settings: Settings,
    /// "Launch at startup" works on this platform.
    autostart_supported: bool,
    version: String,
}

#[tauri::command]
pub fn get_settings(app: AppHandle<Wry>, state: State<'_, AppState>) -> SettingsView {
    SettingsView {
        settings: state.settings.lock().unwrap().clone(),
        autostart_supported: state.platform.autostart_enabled().is_some(),
        version: app.package_info().version.to_string(),
    }
}

/// The Settings window changed something.
#[tauri::command]
pub fn update_settings(app: AppHandle<Wry>, settings: Settings) {
    crate::apply_settings(&app, settings.sanitize());
}

#[tauri::command]
pub fn send_santa(app: AppHandle<Wry>) {
    let _ = app.emit_to(crate::OVERLAY_LABEL, "frostbite://santa", ());
}

#[tauri::command]
pub fn send_polar(app: AppHandle<Wry>) {
    let _ = app.emit_to(crate::OVERLAY_LABEL, "frostbite://polar", ());
}

#[tauri::command]
pub fn send_plow(app: AppHandle<Wry>) {
    let _ = app.emit_to(crate::OVERLAY_LABEL, "frostbite://plow", ());
}

#[tauri::command]
pub fn shake_snow(app: AppHandle<Wry>) {
    let _ = app.emit_to(crate::OVERLAY_LABEL, "frostbite://shake", ());
}

#[tauri::command]
pub fn quit_app(app: AppHandle<Wry>) {
    app.exit(0);
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
