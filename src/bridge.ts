/**
 * Thin layer over Tauri IPC. When the page runs in a plain browser (vite dev
 * server, for tuning visuals) it falls back to a mock that fakes a layout from
 * the window size and feeds cursor events from the DOM.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Boot, CursorPos, Layout, Rect } from "./types";

export interface Bridge {
  readonly native: boolean;
  boot(): Promise<Boot>;
  onLayout(cb: (l: Layout) => void): void;
  onCursor(cb: (c: CursorPos) => void): void;
  setHitRegions(regions: Rect[], capture: boolean): void;
}

export function createBridge(): Bridge {
  return "__TAURI_INTERNALS__" in window ? new TauriBridge() : new BrowserBridge();
}

class TauriBridge implements Bridge {
  readonly native = true;
  boot() {
    return invoke<Boot>("boot");
  }
  onLayout(cb: (l: Layout) => void) {
    void listen<Layout>("frostbite://layout", (e) => cb(e.payload));
  }
  onCursor(cb: (c: CursorPos) => void) {
    void listen<CursorPos>("frostbite://cursor", (e) => cb(e.payload));
  }
  setHitRegions(regions: Rect[], capture: boolean) {
    void invoke("set_hit_regions", { regions, capture });
  }
}

/**
 * Browser mock. `?monitors=2` splits the viewport into two fake monitors of
 * different heights and scales to exercise multi-monitor logic.
 */
class BrowserBridge implements Bridge {
  readonly native = false;
  private layoutCbs: ((l: Layout) => void)[] = [];

  constructor() {
    document.body.classList.add("preview");
    window.addEventListener("resize", () => {
      const l = this.fakeLayout();
      for (const cb of this.layoutCbs) cb(l);
    });
  }

  private fakeLayout(): Layout {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(window.innerWidth * dpr);
    const H = Math.round(window.innerHeight * dpr);
    const params = new URLSearchParams(location.search);
    const n = Number(params.get("monitors") ?? "1");
    const taskbar = Math.round(48 * dpr);
    const monitors =
      n >= 2
        ? [
            {
              rect: { x: 0, y: Math.round(H * 0.25), w: Math.round(W * 0.4), h: H - Math.round(H * 0.25) },
              work: { x: 0, y: Math.round(H * 0.25), w: Math.round(W * 0.4), h: H - Math.round(H * 0.25) },
              scale: dpr,
              primary: false,
            },
            {
              rect: { x: Math.round(W * 0.4), y: 0, w: W - Math.round(W * 0.4), h: H },
              work: { x: Math.round(W * 0.4), y: 0, w: W - Math.round(W * 0.4), h: H - taskbar },
              scale: dpr * 1.5,
              primary: true,
            },
          ]
        : [{ rect: { x: 0, y: 0, w: W, h: H }, work: { x: 0, y: 0, w: W, h: H - taskbar }, scale: dpr, primary: true }];
    return { originX: 0, originY: 0, width: W, height: H, monitors };
  }

  async boot(): Promise<Boot> {
    return { layout: this.fakeLayout(), debug: true, platform: "browser" };
  }
  onLayout(cb: (l: Layout) => void) {
    this.layoutCbs.push(cb);
  }
  onCursor(cb: (c: CursorPos) => void) {
    window.addEventListener("pointermove", (e) => {
      const dpr = window.devicePixelRatio || 1;
      cb({ x: e.clientX * dpr, y: e.clientY * dpr });
    });
    window.addEventListener("pointerleave", () => cb({ x: -1e6, y: -1e6 }));
  }
  setHitRegions() {}
}
