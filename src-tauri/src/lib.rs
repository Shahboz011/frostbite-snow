mod commands;
mod layout;
mod overlay;
mod poll;
mod state;

use tauri::{Manager, WindowEvent};

pub use state::AppState;

pub const OVERLAY_LABEL: &str = "overlay";

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![commands::boot, commands::set_hit_regions])
        .setup(|app| {
            overlay::init(app.handle())?;
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
