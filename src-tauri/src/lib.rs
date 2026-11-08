mod commands;
mod layout;
mod overlay;
mod poll;
mod settings;
mod state;
mod tray;

use tauri::{AppHandle, Emitter, Manager, WindowEvent, Wry};

pub use state::AppState;

use settings::Settings;

pub const OVERLAY_LABEL: &str = "overlay";

pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch (e.g. autostart + a manual start) just
        // turns the snow back on in the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let mut s = app.state::<AppState>().settings.lock().unwrap().clone();
            s.enabled = true;
            apply_settings(app, s);
        }))
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![commands::boot, commands::set_hit_regions])
        .setup(|app| {
            load_settings(app.handle());
            overlay::init(app.handle())?;
            tray::build(app.handle())?;
            poll::spawn(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // A window spanning monitors with different DPIs gets WM_DPICHANGED
            // when its "home" monitor changes, and the toolkit resizes it to the
            // suggested rect. Put it back to exactly cover the virtual screen.
            if let WindowEvent::ScaleFactorChanged { .. } = event {
                if window.label() == OVERLAY_LABEL {
                    let app = window.app_handle().clone();
                    overlay::reapply_bounds(&app);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Frostbite");
}

fn load_settings(app: &AppHandle<Wry>) {
    let state = app.state::<AppState>();
    let path = app.path().app_config_dir().ok().map(settings::path_in);
    let mut s = path.as_deref().map(Settings::load).unwrap_or_default();
    // The OS is the source of truth for autostart (the user may have changed
    // it elsewhere, e.g. reinstalled).
    if let Some(on) = state.platform.autostart_enabled() {
        s.launch_at_startup = on;
    }
    *state.settings_path.lock().unwrap() = path;
    *state.settings.lock().unwrap() = s;
}

/// Single entry point for settings changes: side effects, persist, notify.
pub fn apply_settings(app: &AppHandle<Wry>, mut next: Settings) {
    let state = app.state::<AppState>();
    let prev = state.settings.lock().unwrap().clone();

    if next.launch_at_startup != prev.launch_at_startup {
        if let Err(e) = state.platform.set_autostart(next.launch_at_startup) {
            eprintln!("frostbite: {e}");
            next.launch_at_startup = prev.launch_at_startup;
        }
    }

    *state.settings.lock().unwrap() = next.clone();
    if let Some(p) = state.settings_path.lock().unwrap().as_deref() {
        if let Err(e) = next.save(p) {
            eprintln!("frostbite: saving settings failed: {e}");
        }
    }
    tray::sync(app, &next);
    let _ = app.emit_to(OVERLAY_LABEL, "frostbite://settings", &next);
}
