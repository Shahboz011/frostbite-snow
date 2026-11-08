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
}

export interface Boot {
  layout: Layout;
  surfaces: Surfaces;
  debug: boolean;
  platform: string;
}

export interface CursorPos {
  x: number;
  y: number;
}

export type Intensity = "light" | "normal" | "blizzard";
