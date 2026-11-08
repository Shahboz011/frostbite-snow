/**
 * Thin layer over Tauri IPC. When the page runs in a plain browser (vite dev
 * server, for tuning visuals) it falls back to a mock that fakes a monitor
 * layout, draggable "windows" and a taskbar, and feeds cursor events from the DOM.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_SETTINGS } from "./types";
import type { Boot, CursorPos, Intensity, Layout, Power, Rect, Settings, Surfaces } from "./types";

export interface Bridge {
  readonly native: boolean;
  boot(): Promise<Boot>;
  onLayout(cb: (l: Layout) => void): void;
  onSurfaces(cb: (s: Surfaces) => void): void;
  onCursor(cb: (c: CursorPos) => void): void;
  onSettings(cb: (s: Settings) => void): void;
  onPower(cb: (p: Power) => void): void;
  /** Tray "Shake off all snow". */
  onShake(cb: () => void): void;
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
  onSettings(cb: (s: Settings) => void) {
    void listen<Settings>("frostbite://settings", (e) => cb(e.payload));
  }
  onPower(cb: (p: Power) => void) {
    void listen<Power>("frostbite://power", (e) => cb(e.payload));
  }
  onShake(cb: () => void) {
    void listen("frostbite://shake", () => cb());
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
 * - Keys stand in for the tray menu: S snow, 1/2/3 intensity, ←/→ wind,
 *   W windows, T taskbar, I icicles, X shake off, P pause (fullscreen), B battery.
 */
class BrowserBridge implements Bridge {
  readonly native = false;
  private layoutCbs: ((l: Layout) => void)[] = [];
  private surfaceCbs: ((s: Surfaces) => void)[] = [];
  private desk = document.createElement("div");
  private taskbar = document.createElement("div");
  private nextId = 1;
  private emitQueued = false;
  private settings: Settings = { ...DEFAULT_SETTINGS, wind: 0.15 };
  private power: Power = { paused: false, battery: false };
  private settingsCbs: ((s: Settings) => void)[] = [];
  private powerCbs: ((p: Power) => void)[] = [];
  private shakeCbs: (() => void)[] = [];

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
    const q = new URLSearchParams(location.search);
    const qi = q.get("intensity");
    if (qi === "light" || qi === "normal" || qi === "blizzard") this.settings.intensity = qi;
    const qw = q.get("wind");
    if (qw !== null) this.settings.wind = Math.max(-1, Math.min(1, Number(qw)));
    window.addEventListener("keydown", (e) => this.onKey(e));
    const n = Number(q.get("windows") ?? "3");
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

  private onKey(e: KeyboardEvent): void {
    const s = { ...this.settings };
    const levels: Intensity[] = ["light", "normal", "blizzard"];
    switch (e.key.toLowerCase()) {
      case "s": s.enabled = !s.enabled; break;
      case "1": case "2": case "3": s.intensity = levels[Number(e.key) - 1]; break;
      case "arrowleft": s.wind = Math.max(-1, Math.round(s.wind * 3 - 1) / 3); break;
      case "arrowright": s.wind = Math.min(1, Math.round(s.wind * 3 + 1) / 3); break;
      case "w": s.snowOnWindows = !s.snowOnWindows; break;
      case "t": s.snowOnTaskbar = !s.snowOnTaskbar; break;
      case "i": s.icicles = !s.icicles; break;
      case "x": for (const cb of this.shakeCbs) cb(); return;
      case "p": this.setPower({ ...this.power, paused: !this.power.paused }); return;
      case "b": this.setPower({ ...this.power, battery: !this.power.battery }); return;
      default: return;
    }
    this.settings = s;
    for (const cb of this.settingsCbs) cb(s);
  }

  private setPower(p: Power): void {
    this.power = p;
    // Mirror the native overlay being hidden while paused.
    for (const c of document.querySelectorAll<HTMLCanvasElement>("canvas")) c.style.visibility = p.paused ? "hidden" : "";
    for (const cb of this.powerCbs) cb(p);
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
    return {
      layout,
      surfaces: this.surfaces(),
      settings: { ...this.settings },
      power: { ...this.power },
      debug: true,
      platform: "browser",
    };
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
  onSettings(cb: (s: Settings) => void) {
    this.settingsCbs.push(cb);
  }
  onPower(cb: (p: Power) => void) {
    this.powerCbs.push(cb);
  }
  onShake(cb: () => void) {
    this.shakeCbs.push(cb);
  }
  setHitRegions() {}
}
