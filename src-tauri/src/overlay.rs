//! The snow overlay window: transparent, borderless, topmost, click-through,
//! covering every monitor.

use frostbite_platform::NativeHandle;
use raw_window_handle::HasWindowHandle;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

use crate::{layout, AppState, OVERLAY_LABEL};

pub fn window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(OVERLAY_LABEL)
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let win = window(app).ok_or("overlay window missing from tauri.conf.json")?;
    let state = app.state::<AppState>();

    let handle = win
        .window_handle()
        .ok()
        .and_then(|h| NativeHandle::from_raw(h.as_raw()));
    *state.overlay.lock().unwrap() = handle;

    let layout = layout::compute(state.platform.as_ref(), &win).ok_or("no monitors found")?;
    apply_bounds(&win, &layout.overlay_rect());
    *state.layout.lock().unwrap() = layout;

    // Click-through by default; the poll thread flips this when the cursor is
    // over something interactive.
    win.set_ignore_cursor_events(true)?;
    if let Some(h) = handle {
        state.platform.prepare_overlay(h)?;
    }
    win.show()?;
    if let Some(h) = handle {
        state.platform.raise_overlay(h);
    }
    Ok(())
}

pub fn apply_bounds<R: Runtime>(win: &WebviewWindow<R>, r: &frostbite_platform::Rect) {
    let _ = win.set_position(PhysicalPosition::new(r.x, r.y));
    let _ = win.set_size(PhysicalSize::new(r.w.max(1) as u32, r.h.max(1) as u32));
}

pub fn reapply_bounds<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = window(app) {
        let r = app.state::<AppState>().layout.lock().unwrap().overlay_rect();
        apply_bounds(&win, &r);
    }
}

/// Re-measure monitors; if anything changed, move/resize the overlay and tell
/// the frontend. Returns true if the layout changed.
pub fn refresh_layout<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(win) = window(app) else { return false };
    let state = app.state::<AppState>();
    let Some(new) = layout::compute(state.platform.as_ref(), &win) else { return false };
    {
        let mut cur = state.layout.lock().unwrap();
        if *cur == new {
            return false;
        }
        *cur = new.clone();
    }
    apply_bounds(&win, &new.overlay_rect());
    let _ = app.emit_to(OVERLAY_LABEL, "frostbite://layout", &new);
    true
}

/// Toggle click-through. Runs on the main thread so the toolkit's style
/// rewrite happens first and our extended styles are re-applied after it.
pub fn set_click_through<R: Runtime>(app: &AppHandle<R>, through: bool) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(win) = window(&app2) else { return };
        let _ = win.set_ignore_cursor_events(through);
        let state = app2.state::<AppState>();
        let handle = *state.overlay.lock().unwrap();
        if let Some(h) = handle {
            let _ = state.platform.prepare_overlay(h);
        }
    });
}
