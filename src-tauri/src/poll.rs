//! Background polling thread (~30 Hz): cursor position → frontend (for flake
//! repulsion), click-through toggling over interactive regions, surface
//! detection (windows/taskbars), and slow housekeeping.

use std::time::Duration;

use frostbite_platform::{Point, Rect};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::{overlay, state::Power, AppState, OVERLAY_LABEL};

const TICK: Duration = Duration::from_millis(33);
/// Surfaces every 3rd tick (~100 ms) when the desktop is still...
const SURFACE_EVERY: u32 = 3;
/// ...and every tick for this many ticks (~1 s) after something changed, so
/// snow riding a slowly moving window doesn't stutter.
const HOT_TICKS: u32 = 30;
/// Desktop icons every ~1 s (they rarely move; reading them is cross-process).
const ICON_EVERY: u32 = 30;
/// Fullscreen / lock / battery every ~0.5 s.
const SYSTEM_EVERY: u32 = 15;
/// Housekeeping every ~2 s.
const SLOW_EVERY: u32 = 60;

#[derive(Serialize, Clone, Copy, PartialEq)]
struct CursorMsg {
    x: i32,
    y: i32,
}

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    std::thread::Builder::new()
        .name("frostbite-poll".into())
        .spawn(move || run(app))
        .expect("spawn poll thread");
}

fn run<R: Runtime>(app: AppHandle<R>) {
    let mut last_cursor: Option<CursorMsg> = None;
    let mut click_through = true;
    let mut tick: u32 = 0;
    let mut hot: u32 = 0;
    let mut icons: Vec<Rect> = Vec::new();
    let mut icons_failed = false;

    loop {
        std::thread::sleep(TICK);
        tick = tick.wrapping_add(1);
        let state = app.state::<AppState>();

        // --- fullscreen / lock / power ---------------------------------------
        if tick % SYSTEM_EVERY == 1 {
            let own = *state.overlay.lock().unwrap();
            let next = Power::from_system(state.platform.system_state(own));
            let prev = std::mem::replace(&mut *state.power.lock().unwrap(), next);
            if next != prev {
                if next.paused != prev.paused {
                    overlay::set_visible(&app, !next.paused);
                }
                let _ = app.emit_to(OVERLAY_LABEL, "frostbite://power", next);
            }
        }
        if state.power.lock().unwrap().paused {
            // Nothing to track while hidden; just wait for the pause to end.
            continue;
        }

        let (ox, oy) = {
            let l = state.layout.lock().unwrap();
            (l.origin_x, l.origin_y)
        };

        // --- cursor + click-through ---------------------------------------
        let cursor = state.platform.cursor_pos().or_else(|| {
            app.cursor_position()
                .ok()
                .map(|p| Point { x: p.x as i32, y: p.y as i32 })
        });
        if let Some(p) = cursor {
            let rel = Point { x: p.x - ox, y: p.y - oy };
            let msg = CursorMsg { x: rel.x, y: rel.y };
            if last_cursor != Some(msg) {
                last_cursor = Some(msg);
                let _ = app.emit_to(OVERLAY_LABEL, "frostbite://cursor", msg);
            }
            let want_input = {
                let hit = state.hit.lock().unwrap();
                hit.capture || hit.regions.iter().any(|r| r.contains(rel))
            };
            if want_input == click_through {
                click_through = !want_input;
                overlay::set_click_through(&app, click_through);
            }
        }

        // --- desktop icons ----------------------------------------------------
        let mut icons_changed = false;
        if tick % ICON_EVERY == 0 || (hot > 0 && tick % SURFACE_EVERY == 0) {
            let want = state.settings.lock().unwrap().snow_on_icons;
            let next = if want {
                match state.platform.desktop_icons() {
                    Some(v) => {
                        icons_failed = false;
                        v
                    }
                    None => {
                        if !icons_failed {
                            eprintln!("frostbite: desktop icons unavailable; skipping icon snow");
                            icons_failed = true;
                        }
                        Vec::new()
                    }
                }
            } else {
                Vec::new()
            };
            if next != icons {
                icons = next;
                icons_changed = true;
            }
        }

        // --- surfaces -------------------------------------------------------
        if icons_changed || hot > 0 || tick % SURFACE_EVERY == 0 {
            hot = hot.saturating_sub(1);
            let own = *state.overlay.lock().unwrap();
            let mut s = state.platform.surfaces(own);
            s.icons.clone_from(&icons);
            let s = s.offset(-ox, -oy);
            let changed = {
                let mut cur = state.surfaces.lock().unwrap();
                if *cur != s {
                    *cur = s.clone();
                    true
                } else {
                    false
                }
            };
            if changed {
                hot = HOT_TICKS;
                let _ = app.emit_to(OVERLAY_LABEL, "frostbite://surfaces", &s);
            }
        }

        // --- housekeeping ---------------------------------------------------
        if tick % SLOW_EVERY == 0 {
            overlay::refresh_layout(&app);
            let handle = *state.overlay.lock().unwrap();
            if let Some(h) = handle {
                state.platform.raise_overlay(h);
            }
        }
    }
}
