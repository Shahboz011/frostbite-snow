mod commands;
mod layout;
mod overlay;
mod poll;
mod settings;
mod settings_window;
mod state;
mod tray;

use tauri::{AppHandle, Emitter, Manager, WindowEvent, Wry};

pub use state::AppState;

use settings::Settings;

pub const OVERLAY_LABEL: &str = "overlay";

pub fn run() {
    tauri::Builder::default()
        // Must be first: launching again (clicking the app icon while it runs)
        // opens Settings in the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|a| a == "--autostart") {
                settings_window::show(app);
            }
        }))
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::boot,
            commands::set_hit_regions,
            commands::get_settings,
            commands::update_settings,
            commands::send_santa,
            commands::shake_snow,
            commands::quit_app,
        ])
        .setup(|app| {
            load_settings(app.handle());
            overlay::init(app.handle())?;
            tray::build(app.handle())?;
            poll::spawn(app.handle().clone());
            // Opened by the user (Start menu, desktop icon): show Settings.
            // Started at sign-in: stay quietly in the tray.
            if !app.state::<AppState>().platform.launched_at_login() {
                settings_window::show(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            settings_window::on_event(window, event);
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
    // The wallpaper has never been offered when there's no settings file yet
    // (fresh install) or the file predates the setting (upgrade from an older
    // build; uninstalling keeps the settings file).
    let first_run = path.as_deref().is_some_and(|p| {
        std::fs::read_to_string(p).map_or(true, |t| !t.contains("\"winterWallpaper\""))
    });
    let mut s = path.as_deref().map(Settings::load).unwrap_or_default();
    // The OS is the source of truth for autostart (the user may have changed
    // it elsewhere, e.g. reinstalled).
    if let Some(on) = state.platform.autostart_enabled() {
        s.launch_at_startup = on;
    }
    *state.settings_path.lock().unwrap() = path.clone();
    *state.settings.lock().unwrap() = s.clone();

    if first_run {
        // Save now (with the new key) so this happens only once.
        if let Some(p) = path.as_deref() {
            if let Err(e) = s.save(p) {
                eprintln!("frostbite: saving settings failed: {e}");
            }
        }
        if s.winter_wallpaper {
            set_wallpaper(app, true);
        }
    }
}

/// Bundled with the app (see `bundle.resources` in tauri.conf.json).
const WALLPAPER_RESOURCE: &str = "resources/wallpaper.jpg";

/// Apply or restore the wallpaper off the UI thread: Windows broadcasts the
/// change to every top-level window, which can take a moment.
fn set_wallpaper(app: &AppHandle<Wry>, on: bool) {
    use tauri::path::BaseDirectory;
    let image = app.path().resolve(WALLPAPER_RESOURCE, BaseDirectory::Resource).ok();
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let platform = &state.platform;
        let res = match (on, image) {
            (true, Some(img)) => platform.set_wallpaper(&img),
            (true, None) => Err(frostbite_platform::PlatformError("wallpaper resource missing".into())),
            (false, _) => platform.restore_wallpaper(),
        };
        if let Err(e) = res {
            eprintln!("frostbite: {e}");
        }
    });
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

    if next.winter_wallpaper != prev.winter_wallpaper {
        set_wallpaper(app, next.winter_wallpaper);
    }

    *state.settings.lock().unwrap() = next.clone();
    if let Some(p) = state.settings_path.lock().unwrap().as_deref() {
        if let Err(e) = next.save(p) {
            eprintln!("frostbite: saving settings failed: {e}");
        }
    }
    tray::sync(app, &next);
    // Overlay and Settings window both listen.
    let _ = app.emit("frostbite://settings", &next);
}
