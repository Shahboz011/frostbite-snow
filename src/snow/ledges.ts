/**
 * Ledges: horizontal edges where snow accumulates (window tops, the ground on
 * top of each monitor's taskbar). Each ledge holds a 1D height map, one column
 * per ~2 px. Allocation happens only when surfaces change, never per frame.
 */
import type { Layout, MonitorInfo, Rect, Surfaces, WindowSurface } from "../types";

export const enum LedgeKind {
  Ground = 0,
  Window = 1,
}

/** Windows moving faster than this (px/s at 100% scale) shake their snow off. */
const FOLLOW_MAX_SPEED = 420;
/** Window tops this close to their monitor's top (maximized) don't catch snow. */
const MIN_TOP_GAP = 6;
const GROUND_MAX_H = 38;
const WINDOW_MAX_H = 15;
/** Max height difference between neighbouring columns, in column widths (~40°). */
const REPOSE = 0.85;
/** Spill volume (px²) collected at a window's end before a clump falls off. */
const SPILL_CLUMP = 14;
/** Upper bound on clumps from one shed event. */
const MAX_SHED_CLUMPS = 700;
const BUCKET = 128;
/** Icicle spacing and max length, px at 100% scale. */
const ICICLE_SPACING = 46;
const ICICLE_MAX_LEN = 17;
/** Snow off: piles melt away in about this many seconds. */
const MELT_SECONDS = 4;
/**
 * Flakes nearer than this fall in front of windows and only settle on the
 * ground. Without it every window shelters everything below it.
 */
const WINDOW_CATCH_MAX_DEPTH = 0.6;
/**
 * Chance a catchable flake settles on a given window edge (decided per
 * flake+window, so it's stable). Lets windows lower on screen get snow too.
 */
const WINDOW_CATCH_P = 0.65;
const MIN_VISIBLE_H = 0.35;

/** Called to launch a falling clump of snow (vx, vy in px/s, mass in px²). */
export type EmitClump = (x: number, y: number, vx: number, vy: number, mass: number, scale: number) => void;

export class Ledge {
  x: number;
  y: number;
  /** Index in the window z-order (0 = top). Grounds: -1. */
  z = -1;
  readonly cols: number;
  readonly h: Float32Array;
  /** 1 where the edge is visible (on a monitor, not under a higher window). */
  readonly mask: Uint8Array;
  /** Per-column height limit (uneven drift shape, a higher window just above). */
  readonly ceil: Float32Array;
  /** The drift shape alone: max height per column before other limits. */
  readonly cap: Float32Array;
  readonly maxH: number;
  /** Needs slope relaxation. */
  active = false;
  /** Column span changed since last pile redraw (inclusive), or d1 < d0. */
  d0 = 1 << 30;
  d1 = -1;
  private spillL = 0;
  private spillR = 0;
  /** Ground over a bottom taskbar: icicles may hang below the edge. */
  hang = false;
  /** Icicles: column index and length/width factors (ground ledges only). */
  readonly icCol: Int32Array;
  readonly icLen: Float32Array;
  readonly icW: Float32Array;

  constructor(
    readonly id: string,
    readonly kind: LedgeKind,
    x: number,
    y: number,
    width: number,
    readonly scale: number,
    readonly colW: number,
  ) {
    this.x = x;
    this.y = y;
    this.cols = Math.max(1, Math.ceil(width / colW));
    this.h = new Float32Array(this.cols);
    this.mask = new Uint8Array(this.cols).fill(1);
    this.maxH = (kind === LedgeKind.Ground ? GROUND_MAX_H : WINDOW_MAX_H) * scale;
    this.cap = new Float32Array(this.cols);
    // Smooth, irregular drift profile from a few incommensurate sines, keyed on
    // screen x so neighbouring ledges don't share one pattern.
    const lo = kind === LedgeKind.Ground ? 0.55 : 0.75;
    const ph = Math.random() * 100;
    for (let c = 0; c < this.cols; c++) {
      const u = (x + c * colW) / scale + ph;
      const n =
        0.5 +
        0.25 * Math.sin(u * 0.011) +
        0.15 * Math.sin(u * 0.029 + 1.3) +
        0.1 * Math.sin(u * 0.071 + 2.1);
      this.cap[c] = this.maxH * (lo + (1 - lo) * n);
    }
    this.ceil = this.cap.slice();

    const nIc = kind === LedgeKind.Ground ? Math.floor(width / (ICICLE_SPACING * scale)) : 0;
    this.icCol = new Int32Array(nIc);
    this.icLen = new Float32Array(nIc);
    this.icW = new Float32Array(nIc);
    for (let i = 0; i < nIc; i++) {
      const jitter = (Math.random() - 0.5) * 0.7;
      this.icCol[i] = Math.min(this.cols - 1, Math.floor(((i + 0.5 + jitter) * ICICLE_SPACING * scale) / colW));
      this.icLen[i] = 0.35 + 0.65 * Math.random() * Math.random();
      this.icW[i] = 0.7 + 0.6 * Math.random();
    }
  }

  /** How far below the edge this ledge may draw (icicles). */
  get below(): number {
    return this.hang ? (ICICLE_MAX_LEN + 3) * this.scale : 3 * this.scale;
  }

  /** Current length of icicle i: grows with the snow above it. */
  icicleLength(i: number): number {
    const c = this.icCol[i];
    const fill = Math.min(1, this.h[c] / (this.maxH * 0.55));
    return fill * fill * this.icLen[i] * ICICLE_MAX_LEN * this.scale;
  }

  /** Lower every column; returns true while any snow is left. */
  melt(dt: number): boolean {
    const d = (this.maxH / MELT_SECONDS) * dt;
    let left = false;
    for (let c = 0; c < this.cols; c++) {
      const v = this.h[c];
      if (v <= 0) continue;
      this.h[c] = v > d ? v - d : 0;
      left = true;
    }
    if (left) this.markDirty(0, this.cols - 1);
    return left;
  }

  get width(): number {
    return this.cols * this.colW;
  }

  markDirty(c0: number, c1: number): void {
    if (c0 < this.d0) this.d0 = Math.max(0, c0);
    if (c1 > this.d1) this.d1 = Math.min(this.cols - 1, c1);
  }

  /** Column range [c0, c1) covering screen x range [x0, x1). */
  colRange(x0: number, x1: number): [number, number] {
    const c0 = Math.max(0, Math.min(this.cols, Math.floor((x0 - this.x) / this.colW)));
    const c1 = Math.max(0, Math.min(this.cols, Math.ceil((x1 - this.x) / this.colW)));
    return [c0, c1];
  }

  /** Whether any visible snow is on this ledge. */
  hasSnow(): boolean {
    for (let c = 0; c < this.cols; c++) if (this.h[c] > MIN_VISIBLE_H) return true;
    return false;
  }

  private add(c: number, v: number): void {
    if (c < 0 || c >= this.cols || !this.mask[c]) return;
    const n = this.h[c] + v;
    this.h[c] = n < this.ceil[c] ? n : this.ceil[c];
  }

  deposit(c: number, mass: number): void {
    const dh = mass / this.colW;
    this.add(c, dh * 0.5);
    this.add(c - 1, dh * 0.25);
    this.add(c + 1, dh * 0.25);
    this.active = true;
    this.markDirty(c - 1, c + 1);
  }

  /** One pass of angle-of-repose relaxation. Returns true if anything moved. */
  relax(emit: EmitClump): boolean {
    const h = this.h;
    const ceil = this.ceil;
    const s = this.colW * REPOSE;
    const n = this.cols;
    let lo = n;
    let hi = -1;
    for (let c = 0; c < n - 1; c++) {
      const d = h[c] - h[c + 1];
      if (d > s) {
        const t = (d - s) * 0.5;
        h[c] -= t;
        h[c + 1] = Math.min(ceil[c + 1], h[c + 1] + t);
      } else if (d < -s) {
        const t = (-d - s) * 0.5;
        h[c + 1] -= t;
        h[c] = Math.min(ceil[c], h[c] + t);
      } else continue;
      if (c < lo) lo = c;
      hi = c + 1;
    }
    // Window ends: snow beyond the slope limit slides off and falls.
    if (this.kind === LedgeKind.Window) {
      if (h[0] > s) {
        this.spillL += (h[0] - s) * this.colW;
        h[0] = s;
        lo = 0;
        if (hi < 0) hi = 0;
        if (this.spillL > SPILL_CLUMP * this.scale) {
          emit(this.x - this.colW, this.y - s, -8 * this.scale, 10 * this.scale, this.spillL, this.scale);
          this.spillL = 0;
        }
      }
      const e = n - 1;
      if (h[e] > s) {
        this.spillR += (h[e] - s) * this.colW;
        h[e] = s;
        hi = e;
        if (lo > e) lo = e;
        if (this.spillR > SPILL_CLUMP * this.scale) {
          emit(this.x + this.width + this.colW, this.y - s, 8 * this.scale, 10 * this.scale, this.spillR, this.scale);
          this.spillR = 0;
        }
      }
    }
    if (hi < 0) return false;
    this.markDirty(lo, hi);
    return true;
  }

  /** Turn all visible snow into falling clumps (window moved fast or closed). */
  shed(vx: number, vy: number, emit: EmitClump): void {
    const n = this.cols;
    const st = Math.max(2, Math.ceil(n / (MAX_SHED_CLUMPS / 2)));
    const k = this.scale;
    let budget = MAX_SHED_CLUMPS;
    for (let c = 0; c < n && budget > 0; c += st) {
      let hv = 0;
      for (let j = c; j < c + st && j < n; j++) if (this.mask[j] && this.h[j] > hv) hv = this.h[j];
      if (hv < MIN_VISIBLE_H) continue;
      const pieces = Math.min(budget, 1 + Math.floor(hv / (5 * k)));
      const m = (hv * this.colW * st) / pieces;
      for (let p = 0; p < pieces; p++) {
        emit(
          this.x + (c + Math.random() * st) * this.colW,
          this.y - Math.random() * hv,
          vx * 0.6 + (Math.random() - 0.5) * 40 * k,
          vy * 0.6 + Math.random() * 25 * k,
          m,
          k,
        );
      }
      budget -= pieces;
    }
    this.h.fill(0);
    this.spillL = this.spillR = 0;
    this.markDirty(0, n - 1);
  }
}

/** Where a monitor's snow ground is: the top of a bottom taskbar, else the screen bottom. */
export function groundY(m: MonitorInfo, taskbars: Rect[], layoutH: number): number {
  const r = m.rect;
  const bottom = Math.min(r.y + r.h, layoutH);
  if (taskbars.length === 0) {
    // No taskbar info (dev stub / browser): trust the work area.
    return Math.min(m.work.y + m.work.h, bottom);
  }
  for (const t of taskbars) {
    const overlap = Math.min(t.x + t.w, r.x + r.w) - Math.max(t.x, r.x);
    const isBottomBar = overlap > r.w * 0.5 && Math.abs(t.y + t.h - (r.y + r.h)) <= 4 && t.y > r.y + r.h * 0.5;
    if (isBottomBar) return Math.min(t.y, bottom);
  }
  return bottom;
}

export class LedgeSet {
  list: Ledge[] = [];
  private byId = new Map<string, Ledge>();
  private monitors: MonitorInfo[] = [];
  private windows: WindowSurface[] = [];
  private layoutW = 0;
  private layoutH = 0;
  private lastSync = 0;
  /** Screen regions (x, y, w, h flattened) needing a pile redraw: moves and removals. */
  readonly boxes: number[] = [];
  // CSR bucket index: ledges overlapping each BUCKET-px column strip.
  private bStart = new Int32Array(1);
  private bItems = new Int32Array(0);
  private nb = 0;

  /** Which surfaces collect snow, and whether icicles show. */
  opts = { windows: true, ground: true, icicles: true };
  private surfaces: Surfaces = { windows: [], taskbars: [] };
  private melting = false;

  constructor(private emit: EmitClump) {}

  setOptions(o: { windows: boolean; ground: boolean; icicles: boolean }, now: number): void {
    const iciclesChanged = o.icicles !== this.opts.icicles;
    this.opts = { ...o };
    this.sync(this.surfaces, now);
    if (iciclesChanged) for (const l of this.list) if (l.kind === LedgeKind.Ground) this.pushBox(l);
  }

  /** Snow switched off: melt everything. Call each frame; cheap when done. */
  melt(dt: number): void {
    let any = false;
    for (const l of this.list) if (l.melt(dt)) any = true;
    this.melting = any;
  }

  /** Tray "shake off": window piles fall as clumps, ground snow vanishes. */
  shakeAll(): void {
    for (const l of this.list) {
      this.pushBox(l);
      if (l.kind === LedgeKind.Window) l.shed(0, 0, this.emit);
      else {
        l.h.fill(0);
        l.markDirty(0, l.cols - 1);
      }
    }
  }

  setLayout(l: Layout, s: Surfaces, now: number): void {
    this.monitors = l.monitors;
    this.layoutW = l.width;
    this.layoutH = l.height;
    this.sync(s, now);
  }

  private pushBox(l: Ledge): void {
    const pad = 4 * l.scale;
    this.boxes.push(l.x - pad - l.colW, l.y - l.maxH - pad, l.width + 2 * pad + 2 * l.colW, l.maxH + pad + l.below);
  }

  private monitorForEdge(r: Rect): MonitorInfo | undefined {
    const cx = r.x + r.w / 2;
    let best: MonitorInfo | undefined;
    let bestOverlap = 0;
    for (const m of this.monitors) {
      const mr = m.rect;
      if (r.y < mr.y || r.y >= mr.y + mr.h) continue;
      const o = Math.min(r.x + r.w, mr.x + mr.w) - Math.max(r.x, mr.x);
      if (o > bestOverlap || (o === bestOverlap && cx >= mr.x && cx < mr.x + mr.w)) {
        best = m;
        bestOverlap = o;
      }
    }
    return best;
  }

  /** Reconcile ledges with the latest windows/taskbars. `now` in seconds. */
  sync(s: Surfaces, now: number): void {
    const dt = Math.min(0.25, Math.max(0.03, now - this.lastSync));
    this.lastSync = now;
    this.surfaces = s;
    this.windows = s.windows;
    const next: Ledge[] = [];
    const seen = new Set<string>();

    const upsert = (id: string, kind: LedgeKind, x: number, y: number, w: number, scale: number, z: number) => {
      seen.add(id);
      const colW = Math.max(2, Math.round(2 * scale));
      let l = this.byId.get(id);
      const cols = Math.max(1, Math.ceil(w / colW));
      if (l && (l.cols !== cols || l.colW !== colW)) {
        // Resized: the old pile no longer fits, so it falls.
        this.pushBox(l);
        l.shed(0, 0, this.emit);
        l = undefined;
      }
      if (!l) {
        l = new Ledge(id, kind, x, y, w, scale, colW);
        this.byId.set(id, l);
        this.pushBox(l);
      } else if (l.x !== x || l.y !== y) {
        const dx = x - l.x;
        const dy = y - l.y;
        this.pushBox(l);
        if (kind === LedgeKind.Window && Math.hypot(dx, dy) / dt > FOLLOW_MAX_SPEED * scale) {
          // Snow keeps a little of the window's sideways motion; a window
          // yanked upward just leaves its snow behind to fall.
          const lim = 500 * scale;
          const vx = Math.max(-lim, Math.min(lim, dx / dt));
          const vy = Math.max(-60 * scale, Math.min(lim, dy / dt));
          l.shed(vx, vy, this.emit);
        }
        l.x = x;
        l.y = y;
        this.pushBox(l);
      }
      l.z = z;
      next.push(l);
      return l;
    };

    if (this.opts.ground) {
      this.monitors.forEach((m, i) => {
        const gy = groundY(m, s.taskbars, this.layoutH);
        const l = upsert(`g${i}`, LedgeKind.Ground, m.rect.x, gy, m.rect.w, m.scale, -1);
        const hang = this.opts.icicles && gy < m.rect.y + m.rect.h - 12 * m.scale;
        if (hang !== l.hang) {
          if (l.hang) this.pushBox(l);
          l.hang = hang;
          this.pushBox(l);
        }
      });
    }
    if (this.opts.windows) s.windows.forEach((w, z) => {
      const m = this.monitorForEdge(w.rect);
      if (!m || w.rect.y < m.rect.y + MIN_TOP_GAP * m.scale) return;
      upsert(`w${w.id}`, LedgeKind.Window, w.rect.x, w.rect.y, w.rect.w, m.scale, z);
    });

    // Closed, minimized, maximized or gone off-screen: its snow falls.
    for (const l of this.list) {
      if (seen.has(l.id)) continue;
      this.pushBox(l);
      l.shed(0, 0, this.emit);
      this.byId.delete(l.id);
    }
    this.list = next;
    for (const l of next) if (l.kind === LedgeKind.Window) this.computeMask(l);
    this.buildBuckets();
  }

  /** Visible columns and per-column ceilings from monitors and higher windows. */
  private computeMask(l: Ledge): void {
    const mask = l.mask;
    const ceil = l.ceil;
    const prevMask = mask.slice();
    mask.fill(0);
    ceil.set(l.cap);
    for (const m of this.monitors) {
      const r = m.rect;
      if (l.y < r.y || l.y >= r.y + r.h) continue;
      const [c0, c1] = l.colRange(r.x, r.x + r.w);
      mask.fill(1, c0, c1);
    }
    for (let j = 0; j < l.z; j++) {
      const r = this.windows[j].rect;
      const bottom = r.y + r.h;
      if (r.y <= l.y && l.y < bottom) {
        const [c0, c1] = l.colRange(r.x, r.x + r.w);
        mask.fill(0, c0, c1);
      } else if (bottom <= l.y && bottom > l.y - l.maxH) {
        const [c0, c1] = l.colRange(r.x, r.x + r.w);
        const lim = l.y - bottom;
        for (let c = c0; c < c1; c++) if (ceil[c] > lim) ceil[c] = lim;
      }
    }
    for (let c = 0; c < l.cols; c++) {
      if (l.h[c] > ceil[c]) l.h[c] = ceil[c];
      if (mask[c] !== prevMask[c]) l.markDirty(c, c);
    }
  }

  private buildBuckets(): void {
    const nb = (this.nb = Math.max(1, Math.ceil(this.layoutW / BUCKET) + 1));
    const counts = new Int32Array(nb + 1);
    const span = (l: Ledge): [number, number] => [
      Math.max(0, Math.floor(l.x / BUCKET)),
      Math.min(nb - 1, Math.floor((l.x + l.width) / BUCKET)),
    ];
    for (const l of this.list) {
      const [b0, b1] = span(l);
      for (let b = b0; b <= b1; b++) counts[b + 1]++;
    }
    for (let b = 0; b < nb; b++) counts[b + 1] += counts[b];
    const items = new Int32Array(counts[nb]);
    const fill = counts.slice(0, nb);
    // Higher ledges (smaller y) first so a flake hits the top-most surface.
    const order = this.list.map((_, i) => i).sort((a, b) => this.list[a].y - this.list[b].y);
    for (const i of order) {
      const [b0, b1] = span(this.list[i]);
      for (let b = b0; b <= b1; b++) items[fill[b]++] = i;
    }
    this.bStart = counts;
    this.bItems = items;
  }

  /**
   * If a flake moving from prevY to y at x lands on a pile, deposit `mass` and
   * return true.
   */
  collide(x: number, prevY: number, y: number, mass: number, depth: number, seed: number): boolean {
    const passesWindows = depth > WINDOW_CATCH_MAX_DEPTH;
    const b = (x / BUCKET) | 0;
    if (b < 0 || b >= this.nb) return false;
    const end = this.bStart[b + 1];
    for (let k = this.bStart[b]; k < end; k++) {
      const l = this.list[this.bItems[k]];
      if (l.kind === LedgeKind.Window) {
        if (passesWindows) continue;
        const r = seed * 7.31 + l.z * 0.618;
        if (r - Math.floor(r) > WINDOW_CATCH_P) continue;
      }
      const rx = x - l.x;
      if (rx < 0 || rx >= l.width) continue;
      const c = (rx / l.colW) | 0;
      if (!l.mask[c]) continue;
      if (y >= l.y - l.h[c] && prevY <= l.y + 0.5) {
        l.deposit(c, mass);
        return true;
      }
    }
    return false;
  }

  /** Slope relaxation for ledges that recently changed. */
  step(): void {
    for (const l of this.list) {
      if (!l.active) continue;
      const a = l.relax(this.emit);
      const b = a && l.relax(this.emit);
      l.active = b;
    }
  }

  get busy(): boolean {
    if (this.melting) return true;
    for (const l of this.list) if (l.active || l.d1 >= l.d0) return true;
    return this.boxes.length > 0;
  }
}
