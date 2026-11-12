//! Tray icon and menu. Left-click opens Settings; right-click opens the menu.

use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::settings::{Intensity, Settings, WIND_STEPS};
use crate::{apply_settings, AppState};

pub struct TrayItems {
    snow: CheckMenuItem<Wry>,
    intensity: [(Intensity, CheckMenuItem<Wry>); 3],
    wind: Vec<(i32, CheckMenuItem<Wry>)>,
    windows: CheckMenuItem<Wry>,
    taskbar: CheckMenuItem<Wry>,
    icons: CheckMenuItem<Wry>,
    snowman: CheckMenuItem<Wry>,
    icicles: CheckMenuItem<Wry>,
    snowballs: CheckMenuItem<Wry>,
    wallpaper: CheckMenuItem<Wry>,
    santa: CheckMenuItem<Wry>,
    polar: CheckMenuItem<Wry>,
    startup: Option<CheckMenuItem<Wry>>,
}

fn wind_label(step: i32) -> &'static str {
    match step {
        -3 => "← Strong",
        -2 => "← Moderate",
        -1 => "← Light",
        0 => "Calm",
        1 => "Light →",
        2 => "Moderate →",
        _ => "Strong →",
    }
}

pub fn build(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let s = app.state::<AppState>().settings.lock().unwrap().clone();
    let check = |id: &str, label: &str, on: bool| CheckMenuItemBuilder::with_id(id, label).checked(on).build(app);

    let snow = check("snow", "Snow", s.enabled)?;
    let intensity = [
        (Intensity::Light, check("int:light", "Light", s.intensity == Intensity::Light)?),
        (Intensity::Normal, check("int:normal", "Normal", s.intensity == Intensity::Normal)?),
        (Intensity::Blizzard, check("int:blizzard", "Blizzard", s.intensity == Intensity::Blizzard)?),
    ];
    let mut wind = Vec::new();
    for step in -WIND_STEPS..=WIND_STEPS {
        wind.push((step, check(&format!("wind:{step}"), wind_label(step), s.wind_step() == step)?));
    }
    let windows = check("on:windows", "Snow on windows", s.snow_on_windows)?;
    let taskbar = check("on:taskbar", "Snow on taskbar", s.snow_on_taskbar)?;
    let icons = check("on:icons", "Snow on desktop icons", s.snow_on_icons)?;
    let snowman = check("snowman", "Snowman", s.snowman)?;
    let icicles = check("icicles", "Icicles", s.icicles)?;
    let snowballs = check("snowballs", "Snowball fights", s.snowballs)?;
    let wallpaper = check("wallpaper", "Winter wallpaper", s.winter_wallpaper)?;
    let santa = check("santa", "Santa (every 10 min)", s.santa)?;
    let santa_now = MenuItemBuilder::with_id("santa-now", "Send Santa now").build(app)?;
    let polar = check("polar", "Fish thief (every 12 min)", s.polar_chase)?;
    let open_settings = MenuItemBuilder::with_id("settings", "Settings…").build(app)?;
    let platform_autostart = app.state::<AppState>().platform.autostart_enabled();
    let startup = match platform_autostart {
        Some(on) => Some(check("startup", "Launch at startup", on)?),
        None => None,
    };

    let mut int_sub = SubmenuBuilder::new(app, "Intensity");
    for (_, item) in &intensity {
        int_sub = int_sub.item(item);
    }
    let mut wind_sub = SubmenuBuilder::new(app, "Wind");
    for (_, item) in &wind {
        wind_sub = wind_sub.item(item);
    }
    let shake = MenuItemBuilder::with_id("shake", "Shake off all snow").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit Frostbite").build(app)?;

    let mut menu = MenuBuilder::new(app)
        .item(&open_settings)
        .separator()
        .item(&snow)
        .item(&int_sub.build()?)
        .item(&wind_sub.build()?)
        .separator()
        .item(&windows)
        .item(&taskbar)
        .item(&icons)
        .separator()
        .item(&snowman)
        .item(&icicles)
        .item(&snowballs)
        .item(&santa)
        .item(&santa_now)
        .item(&polar)
        .separator()
        .item(&wallpaper);
    if let Some(st) = &startup {
        menu = menu.item(st);
    }
    let menu = menu.item(&shake).separator().item(&quit).build()?;

    let mut tray = TrayIconBuilder::with_id("frostbite")
        .tooltip("Frostbite")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| on_menu(app, ev.id().as_ref()))
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                crate::settings_window::show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    app.manage(TrayItems {
        snow,
        intensity,
        wind,
        windows,
        taskbar,
        icons,
        snowman,
        icicles,
        snowballs,
        wallpaper,
        santa,
        polar,
        startup,
    });
    Ok(())
}

fn on_menu(app: &AppHandle<Wry>, id: &str) {
    match id {
        "quit" => app.exit(0),
        "settings" => crate::settings_window::show(app),
        "santa-now" => {
            use tauri::Emitter;
            let _ = app.emit_to(crate::OVERLAY_LABEL, "frostbite://santa", ());
        }
        "santa" => update(app, |s| s.santa = !s.santa),
        "polar" => update(app, |s| s.polar_chase = !s.polar_chase),
        "shake" => {
            use tauri::Emitter;
            let _ = app.emit_to(crate::OVERLAY_LABEL, "frostbite://shake", ());
        }
        "snow" => update(app, |s| s.enabled = !s.enabled),
        "on:windows" => update(app, |s| s.snow_on_windows = !s.snow_on_windows),
        "on:taskbar" => update(app, |s| s.snow_on_taskbar = !s.snow_on_taskbar),
        "on:icons" => update(app, |s| s.snow_on_icons = !s.snow_on_icons),
        "snowman" => update(app, |s| s.snowman = !s.snowman),
        "icicles" => update(app, |s| s.icicles = !s.icicles),
        "snowballs" => update(app, |s| s.snowballs = !s.snowballs),
        "wallpaper" => update(app, |s| s.winter_wallpaper = !s.winter_wallpaper),
        "startup" => update(app, |s| s.launch_at_startup = !s.launch_at_startup),
        "int:light" => update(app, |s| s.intensity = Intensity::Light),
        "int:normal" => update(app, |s| s.intensity = Intensity::Normal),
        "int:blizzard" => update(app, |s| s.intensity = Intensity::Blizzard),
        other => {
            if let Some(step) = other.strip_prefix("wind:").and_then(|v| v.parse::<i32>().ok()) {
                update(app, |s| s.wind = step as f32 / WIND_STEPS as f32);
            }
        }
    }
}

fn update(app: &AppHandle<Wry>, f: impl FnOnce(&mut Settings)) {
    let next = {
        let mut s = app.state::<AppState>().settings.lock().unwrap().clone();
        f(&mut s);
        s
    };
    apply_settings(app, next);
}

/// Make every check mark match `s` (menus toggle their own check on click,
/// which is wrong for radio groups and for failed changes).
pub fn sync(app: &AppHandle<Wry>, s: &Settings) {
    let Some(t) = app.try_state::<TrayItems>() else { return };
    let _ = t.snow.set_checked(s.enabled);
    for (i, item) in &t.intensity {
        let _ = item.set_checked(*i == s.intensity);
    }
    for (step, item) in &t.wind {
        let _ = item.set_checked(*step == s.wind_step());
    }
    let _ = t.windows.set_checked(s.snow_on_windows);
    let _ = t.taskbar.set_checked(s.snow_on_taskbar);
    let _ = t.icons.set_checked(s.snow_on_icons);
    let _ = t.snowman.set_checked(s.snowman);
    let _ = t.icicles.set_checked(s.icicles);
    let _ = t.snowballs.set_checked(s.snowballs);
    let _ = t.wallpaper.set_checked(s.winter_wallpaper);
    let _ = t.santa.set_checked(s.santa);
    let _ = t.polar.set_checked(s.polar_chase);
    if let Some(st) = &t.startup {
        let _ = st.set_checked(s.launch_at_startup);
    }
    if let Some(tray) = app.tray_by_id("frostbite") {
        let _ = tray.set_tooltip(Some(if s.enabled { "Frostbite" } else { "Frostbite (paused)" }));
    }
}
