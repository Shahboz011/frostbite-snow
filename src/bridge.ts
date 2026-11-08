/**
 * Thin layer over Tauri IPC. When the page runs in a plain browser (vite dev
 * server, for tuning visuals) it falls back to a mock that fakes a monitor
 * layout, draggable "windows" and a taskbar, and feeds cursor events from the DOM.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Boot, CursorPos, Layout, Rect, Surfaces } from "./types";

export interface Bridge {
  readonly native: boolean;
  boot(): Promise<Boot>;
  onLayout(cb: (l: Layout) => void): void;
  onSurfaces(cb: (s: Surfaces) => void): void;
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
  onSurfaces(cb: (s: Surfaces) => void) {
    void listen<Surfaces>("frostbite://surfaces", (e) => cb(e.payload));
  }
  onCursor(cb: (c: CursorPos) => void) {
    void listen<CursorPos>("frostbite://cursor", (e) => cb(e.payload));
  }
  setHitRegions(regions: Rect[], capture: boolean) {
    void invoke("set_hit_regions", { regions, capture });
  }
}

/**
 * Browser mock.
 * - `?monitors=2`: two fake monitors of different heights and DPI.
 * - `?windows=N` (default 3): draggable fake windows (drag the title bar,
 *   click to raise, × to close, double-click the desktop to add one).
 */
class BrowserBridge implements Bridge {
  readonly native = false;
  private layoutCbs: ((l: Layout) => void)[] = [];
  private surfaceCbs: ((s: Surfaces) => void)[] = [];
  private desk = document.createElement("div");
  private taskbar = document.createElement("div");
  private nextId = 1;
  private emitQueued = false;

  constructor() {
    document.body.classList.add("preview");
    this.desk.id = "fake-desktop";
    document.body.prepend(this.desk);
    this.taskbar.className = "fake-taskbar";
    document.body.prepend(this.taskbar);
    window.addEventListener("resize", () => {
      const l = this.fakeLayout();
      this.placeTaskbar(l);
      for (const cb of this.layoutCbs) cb(l);
      this.queueSurfaces();
    });
    document.addEventListener("dblclick", (e) => {
      if (e.target === document.body || e.target === this.desk) this.addWindow(e.clientX - 150, e.clientY);
    });
    const n = Number(new URLSearchParams(location.search).get("windows") ?? "3");
    const W = window.innerWidth;
    const H = window.innerHeight;
    const presets = [
      [0.08, 0.3, 0.42, 0.4],
      [0.45, 0.42, 0.4, 0.33],
      [0.3, 0.62, 0.3, 0.2],
      [0.6, 0.15, 0.3, 0.2],
    ];
    for (let i = 0; i < n; i++) {
      const p = presets[i % presets.length];
      this.addWindow(W * p[0], H * p[1], W * p[2], H * p[3]);
    }
  }

  private dpr() {
    return window.devicePixelRatio || 1;
  }

  private addWindow(x: number, y: number, w = 300, h = 200): void {
    const win = document.createElement("div");
    win.className = "fake-win";
    win.dataset.id = String(this.nextId++);
    Object.assign(win.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    const bar = document.createElement("div");
    bar.className = "fake-title";
    bar.textContent = `Window ${win.dataset.id}`;
    const close = document.createElement("button");
    close.textContent = "×";
    close.addEventListener("pointerdown", (e) => e.stopPropagation());
    close.addEventListener("click", () => {
      win.remove();
      this.queueSurfaces();
    });
    bar.appendChild(close);
    win.appendChild(bar);
    win.addEventListener("pointerdown", () => {
      this.desk.appendChild(win); // raise to top
      this.queueSurfaces();
    });
    bar.addEventListener("pointerdown", (e) => {
      const sx = e.clientX - win.offsetLeft;
      const sy = e.clientY - win.offsetTop;
      bar.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        win.style.left = `${ev.clientX - sx}px`;
        win.style.top = `${ev.clientY - sy}px`;
        this.queueSurfaces();
      };
      const up = () => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
    });
    this.desk.appendChild(win);
    this.queueSurfaces();
  }

  /** Coalesce to ~30 Hz like the Rust poller's hot rate. */
  private queueSurfaces(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    setTimeout(() => {
      this.emitQueued = false;
      const s = this.surfaces();
      for (const cb of this.surfaceCbs) cb(s);
    }, 33);
  }

  private surfaces(): Surfaces {
    const d = this.dpr();
    const wins = Array.from(this.desk.querySelectorAll<HTMLDivElement>(".fake-win")).reverse();
    const tb = this.taskbar.getBoundingClientRect();
    return {
      windows: wins.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: Number(el.dataset.id),
          rect: { x: Math.round(r.left * d), y: Math.round(r.top * d), w: Math.round(r.width * d), h: Math.round(r.height * d) },
        };
      }),
      taskbars: [{ x: Math.round(tb.left * d), y: Math.round(tb.top * d), w: Math.round(tb.width * d), h: Math.round(tb.height * d) }],
    };
  }

  private placeTaskbar(l: Layout): void {
    const d = this.dpr();
    const m = l.monitors.find((x) => x.primary) ?? l.monitors[0];
    Object.assign(this.taskbar.style, {
      left: `${m.work.x / d}px`,
      top: `${(m.work.y + m.work.h) / d}px`,
      width: `${m.work.w / d}px`,
      height: `${(m.rect.y + m.rect.h - m.work.y - m.work.h) / d}px`,
    });
  }

  private fakeLayout(): Layout {
    const dpr = this.dpr();
    const W = Math.round(window.innerWidth * dpr);
    const H = Math.round(window.innerHeight * dpr);
    const n = Number(new URLSearchParams(location.search).get("monitors") ?? "1");
    const taskbar = Math.round(48 * dpr);
    const split = Math.round(W * 0.4);
    const top2 = Math.round(H * 0.25);
    const monitors =
      n >= 2
        ? [
            { rect: { x: 0, y: top2, w: split, h: H - top2 }, work: { x: 0, y: top2, w: split, h: H - top2 }, scale: dpr, primary: false },
            { rect: { x: split, y: 0, w: W - split, h: H }, work: { x: split, y: 0, w: W - split, h: H - taskbar }, scale: dpr * 1.5, primary: true },
          ]
        : [{ rect: { x: 0, y: 0, w: W, h: H }, work: { x: 0, y: 0, w: W, h: H - taskbar }, scale: dpr, primary: true }];
    return { originX: 0, originY: 0, width: W, height: H, monitors };
  }

  async boot(): Promise<Boot> {
    const layout = this.fakeLayout();
    this.placeTaskbar(layout);
    return { layout, surfaces: this.surfaces(), debug: true, platform: "browser" };
  }
  onLayout(cb: (l: Layout) => void) {
    this.layoutCbs.push(cb);
  }
  onSurfaces(cb: (s: Surfaces) => void) {
    this.surfaceCbs.push(cb);
  }
  onCursor(cb: (c: CursorPos) => void) {
    window.addEventListener("pointermove", (e) => {
      const dpr = this.dpr();
      cb({ x: e.clientX * dpr, y: e.clientY * dpr });
    });
    window.addEventListener("pointerleave", () => cb({ x: -1e6, y: -1e6 }));
  }
  setHitRegions() {}
}
