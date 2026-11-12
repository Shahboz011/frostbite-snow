//! The Settings window (settings.html). Declared hidden in tauri.conf.json;
//! opening the app from its icon, a second launch, or the tray shows it, and
//! closing it only hides it (the app keeps snowing from the tray).

use tauri::{AppHandle, Manager, Runtime, Window, WindowEvent};

pub const SETTINGS_LABEL: &str = "settings";

pub fn show<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Close button → hide instead of destroying the window.
pub fn on_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != SETTINGS_LABEL {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}
