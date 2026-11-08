//! Background polling thread (~30 Hz): cursor position → frontend (for flake
//! repulsion), click-through toggling over interactive regions, and slow
//! housekeeping (monitor changes, topmost re-assert).

use std::time::Duration;

use frostbite_platform::Point;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::{overlay, AppState, OVERLAY_LABEL};

const TICK: Duration = Duration::from_millis(33);
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

    loop {
        std::thread::sleep(TICK);
        tick = tick.wrapping_add(1);
        let state = app.state::<AppState>();

        let cursor = state.platform.cursor_pos().or_else(|| {
            app.cursor_position()
                .ok()
                .map(|p| Point { x: p.x as i32, y: p.y as i32 })
        });

        if let Some(p) = cursor {
            let (ox, oy) = {
                let l = state.layout.lock().unwrap();
                (l.origin_x, l.origin_y)
            };
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

        if tick % SLOW_EVERY == 0 {
            overlay::refresh_layout(&app);
            let handle = *state.overlay.lock().unwrap();
            if let Some(h) = handle {
                state.platform.raise_overlay(h);
            }
        }
    }
}
