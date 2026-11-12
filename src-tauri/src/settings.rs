//! User settings, persisted as JSON at
//! `%APPDATA%\app.frostbite.desktop\settings.json`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Intensity {
    Light,
    #[default]
    Normal,
    Blizzard,
}

/// Every field has a default so older/partial files keep loading.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub enabled: bool,
    pub intensity: Intensity,
    /// -1 (strong, blowing left) … 1 (strong, blowing right).
    pub wind: f32,
    pub snow_on_windows: bool,
    pub snow_on_taskbar: bool,
    pub snow_on_icons: bool,
    pub snowman: bool,
    pub icicles: bool,
    pub snowballs: bool,
    pub launch_at_startup: bool,
    /// Show the bundled winter wallpaper (applied on first run; turning it off
    /// restores the user's own).
    pub winter_wallpaper: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: true,
            intensity: Intensity::Normal,
            wind: 0.0,
            snow_on_windows: true,
            snow_on_taskbar: true,
            snow_on_icons: true,
            snowman: true,
            icicles: true,
            snowballs: false,
            launch_at_startup: false,
            winter_wallpaper: true,
        }
    }
}

/// Wind menu positions (a "slider" in a tray menu): -3..=3 → -1..=1.
pub const WIND_STEPS: i32 = 3;

impl Settings {
    pub fn sanitize(mut self) -> Self {
        if !self.wind.is_finite() {
            self.wind = 0.0;
        }
        self.wind = self.wind.clamp(-1.0, 1.0);
        self
    }

    pub fn wind_step(&self) -> i32 {
        (self.wind * WIND_STEPS as f32).round() as i32
    }

    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .unwrap_or_default()
            .sanitize()
    }

    /// Write via a temp file + rename so a crash never leaves a half-written file.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(tmp, path)
    }
}

pub fn path_in(dir: PathBuf) -> PathBuf {
    dir.join("settings.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_file_uses_defaults() {
        let s: Settings = serde_json::from_str(r#"{"intensity":"blizzard","wind":5}"#).unwrap();
        let s = s.sanitize();
        assert_eq!(s.intensity, Intensity::Blizzard);
        assert_eq!(s.wind, 1.0);
        assert!(s.enabled && s.snow_on_windows);
    }

    #[test]
    fn roundtrip() {
        let dir = std::env::temp_dir().join(format!("frostbite-test-{}", std::process::id()));
        let p = path_in(dir.clone());
        let s = Settings { intensity: Intensity::Light, wind: -0.33, icicles: false, ..Default::default() };
        s.save(&p).unwrap();
        assert_eq!(Settings::load(&p), s);
        assert_eq!(Settings::load(&p).wind_step(), -1);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn garbage_file_falls_back() {
        let dir = std::env::temp_dir().join(format!("frostbite-test-g{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = path_in(dir.clone());
        std::fs::write(&p, "not json").unwrap();
        assert_eq!(Settings::load(&p), Settings::default());
        let _ = std::fs::remove_dir_all(dir);
    }
}
