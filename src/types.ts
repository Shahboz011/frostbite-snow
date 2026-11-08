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

export interface Boot {
  layout: Layout;
  debug: boolean;
  platform: string;
}

export interface CursorPos {
  x: number;
  y: number;
}

export type Intensity = "light" | "normal" | "blizzard";
