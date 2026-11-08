//! Virtual-screen layout: where the overlay sits and where each monitor is
//! inside it. Everything sent to the frontend is **overlay-relative physical
//! pixels**, so the frontend never has to care about negative virtual-screen
//! coordinates or mixed DPI.

use frostbite_platform::{MonitorInfo, Platform, Rect};
use serde::Serialize;
use tauri::{Runtime, WebviewWindow};

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    /// Overlay window origin in virtual-screen physical px.
    pub origin_x: i32,
    pub origin_y: i32,
    /// Overlay size in physical px.
    pub width: i32,
    pub height: i32,
    /// Monitors, relative to the overlay origin.
    pub monitors: Vec<MonitorInfo>,
}

impl Layout {
    pub fn from_monitors(mut monitors: Vec<MonitorInfo>) -> Option<Self> {
        let first = monitors.first()?.rect;
        let bounds = monitors.iter().fold(first, |acc, m| acc.union(&m.rect));
        for m in &mut monitors {
            m.rect = m.rect.offset(-bounds.x, -bounds.y);
            m.work = m.work.offset(-bounds.x, -bounds.y);
        }
        Some(Self {
            origin_x: bounds.x,
            origin_y: bounds.y,
            width: bounds.w,
            // One pixel short of the full height on purpose: a topmost window that
            // exactly covers a monitor is treated by the shell as a "fullscreen
            // app" (taskbar drops behind it, Focus Assist kicks in).
            height: bounds.h - 1,
            monitors,
        })
    }

    /// Overlay rect in virtual-screen coordinates.
    pub fn overlay_rect(&self) -> Rect {
        Rect::new(self.origin_x, self.origin_y, self.width, self.height)
    }
}

/// Monitor list from the platform backend, or the toolkit as a fallback.
pub fn compute<R: Runtime>(platform: &dyn Platform, win: &WebviewWindow<R>) -> Option<Layout> {
    let mut monitors = platform.monitors();
    if monitors.is_empty() {
        let primary = win.primary_monitor().ok().flatten().map(|m| *m.position());
        monitors = win
            .available_monitors()
            .unwrap_or_default()
            .into_iter()
            .map(|m| {
                let p = m.position();
                let s = m.size();
                let wa = m.work_area();
                MonitorInfo {
                    rect: Rect::new(p.x, p.y, s.width as i32, s.height as i32),
                    work: Rect::new(
                        wa.position.x,
                        wa.position.y,
                        wa.size.width as i32,
                        wa.size.height as i32,
                    ),
                    scale: m.scale_factor(),
                    primary: primary == Some(*p),
                }
            })
            .collect();
        monitors.sort_by_key(|m| (m.rect.x, m.rect.y));
    }
    Layout::from_monitors(monitors)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(x: i32, y: i32, w: i32, h: i32, scale: f64) -> MonitorInfo {
        MonitorInfo {
            rect: Rect::new(x, y, w, h),
            work: Rect::new(x, y, w, h - 48),
            scale,
            primary: x == 0 && y == 0,
        }
    }

    #[test]
    fn single_monitor() {
        let l = Layout::from_monitors(vec![mon(0, 0, 1920, 1080, 1.0)]).unwrap();
        assert_eq!((l.origin_x, l.origin_y, l.width, l.height), (0, 0, 1920, 1079));
        assert_eq!(l.monitors[0].rect, Rect::new(0, 0, 1920, 1080));
    }

    #[test]
    fn mixed_dpi_left_of_primary() {
        // 4K @150% to the left of a 1080p primary, bottom-aligned.
        let l = Layout::from_monitors(vec![
            mon(-3840, -1080, 3840, 2160, 1.5),
            mon(0, 0, 1920, 1080, 1.0),
        ])
        .unwrap();
        assert_eq!((l.origin_x, l.origin_y), (-3840, -1080));
        assert_eq!((l.width, l.height), (5760, 2159));
        assert_eq!(l.monitors[0].rect, Rect::new(0, 0, 3840, 2160));
        assert_eq!(l.monitors[1].rect, Rect::new(3840, 1080, 1920, 1080));
        assert_eq!(l.monitors[1].work.h, 1032);
    }

    #[test]
    fn empty() {
        assert!(Layout::from_monitors(vec![]).is_none());
    }
}
