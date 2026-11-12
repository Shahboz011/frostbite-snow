/** All geometry is overlay-relative physical pixels (see src-tauri/src/layout.rs). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MonitorInfo {
  rect: Rect;
  work: Rect;
  scale: number;
  primary: boolean;
}

export interface Layout {
  originX: number;
  originY: number;
  width: number;
  height: number;
  monitors: MonitorInfo[];
}

/** A visible top-level window. `id` is stable for the window's lifetime (HWND). */
export interface WindowSurface {
  id: number;
  rect: Rect;
}

export interface Surfaces {
  /** Top of the z-order first. */
  windows: WindowSurface[];
  taskbars: Rect[];
  /** Desktop icon image rects (behind every window). */
  icons: Rect[];
}

/** Mirrors src-tauri/src/settings.rs. */
export interface Settings {
  enabled: boolean;
  intensity: Intensity;
  /** -1 (strong, blowing left) … 1 (strong, blowing right). */
  wind: number;
  snowOnWindows: boolean;
  snowOnTaskbar: boolean;
  snowOnIcons: boolean;
  snowman: boolean;
  icicles: boolean;
  snowballs: boolean;
  launchAtStartup: boolean;
  winterWallpaper: boolean;
  /** Santa flies over every 10 minutes and drops gifts. */
  santa: boolean;
  /** A polar bear chases a penguin that stole its fish, every 12 minutes. */
  polarChase: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  intensity: "normal",
  wind: 0,
  snowOnWindows: true,
  snowOnTaskbar: true,
  snowOnIcons: true,
  snowman: true,
  icicles: true,
  snowballs: false,
  launchAtStartup: false,
  winterWallpaper: true,
  santa: true,
  polarChase: true,
};

export interface Power {
  /** Fullscreen app or lock screen: render nothing. */
  paused: boolean;
  /** On battery / battery saver: 30 fps. */
  battery: boolean;
}

export interface Boot {
  layout: Layout;
  surfaces: Surfaces;
  settings: Settings;
  power: Power;
  debug: boolean;
  platform: string;
}

export interface CursorPos {
  x: number;
  y: number;
}

export type Intensity = "light" | "normal" | "blizzard";
