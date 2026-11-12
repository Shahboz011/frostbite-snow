/**
 * Snow plow: every 10 minutes a bulldozer drives along the taskbar of the
 * primary monitor, left to right, and scrapes the real ground snow into a
 * heap in front of its blade, then pushes the heap off the screen.
 *
 * It drives behind snowmen with the blade raised, so they survive. It never
 * takes the mouse (no hit regions), so the taskbar stays clickable.
 * All positions are overlay layout (physical) px.
 */
import type { Layout, MonitorInfo, Surfaces } from "../types";
import { BLADE_FRONT, DOZER_BACK, EXHAUST_TIP, drawDozer, drawMound } from "./dozerRender";
import { groundY, type EmitClump, type LedgeSet } from "./ledges";

/** First run a few minutes in (after Santa and the polar chase), then every 10 minutes. */
export const PLOW_FIRST = 300;
export const PLOW_INTERVAL = 600;

/** Bulldozer size relative to the monitor's DPI scale. */
const DOZER_SCALE = 0.55;
/** Drive speed, px/s at scale 1. */
const SPEED = 105;
/** Snow left behind the blade (px at scale 1). */
const RESIDUAL = 0.8;

interface Run {
  m: MonitorInfo;
  /** Monitor DPI scale and the dozer's draw scale. */
  k: number;
  dk: number;
  x: number;
  dist: number;
  /** Snow in the heap, px² (layout). */
  mound: number;
  right: number;
  puffs: { x: number; y: number; vx: number; vy: number; r: number; life: number }[];
}

export class SnowPlow {
  run: Run | null = null;
  nextAt: number;
  dirty = false;
  time = 0;
  private layout: Layout | null = null;
  private surfaces: Surfaces = { windows: [], taskbars: [], icons: [] };

  constructor(
    private ledges: LedgeSet,
    private emit: EmitClump,
    /** Snowmen footprints [x0, x1] on the ground, to drive around. */
    private obstacles: () => [number, number][],
    now: number,
  ) {
    this.nextAt = now + PLOW_FIRST;
  }

  setLayout(l: Layout): void {
    this.layout = l;
  }

  setSurfaces(s: Surfaces): void {
    this.surfaces = s;
  }

  get busy(): boolean {
    return !!this.run;
  }

  clear(): void {
    if (this.run) this.dirty = true;
    this.run = null;
  }

  start(now: number): boolean {
    this.nextAt = now + PLOW_INTERVAL;
    const l = this.layout;
    const m = l?.monitors.find((mm) => mm.primary) ?? l?.monitors[0];
    if (!l || !m || this.run) return false;
    const k = m.scale;
    const dk = k * DOZER_SCALE;
    this.run = {
      m,
      k,
      dk,
      x: m.rect.x - BLADE_FRONT * dk - 4,
      dist: 0,
      mound: 0,
      right: m.rect.x + m.rect.w,
      puffs: [],
    };
    this.dirty = true;
    return true;
  }

  /** The taskbar line (top of the ground) under x. */
  private ground(x: number): number {
    const l = this.ledges.groundAt(x);
    if (l) return l.y;
    const r = this.run!;
    return groundY(r.m, this.surfaces.taskbars, this.layout?.height ?? 1e9);
  }

  private blocked(x: number): boolean {
    for (const [a, b] of this.obstacles()) if (x >= a && x <= b) return true;
    return false;
  }

  update(dt: number): void {
    this.time += dt;
    const r = this.run;
    if (!r) return;
    this.dirty = true;
    const step = SPEED * r.k * dt;
    const prevBlade = r.x + BLADE_FRONT * r.dk;
    r.x += step;
    r.dist += step / r.dk;
    const blade = r.x + BLADE_FRONT * r.dk;

    // Scrape the ground snow between the old and new blade positions.
    const bladeUp = this.blocked(blade) || this.blocked(blade + 20 * r.k);
    if (!bladeUp && blade < r.right) {
      for (let x = Math.max(prevBlade, r.m.rect.x); x < Math.min(blade, r.right); ) {
        const l = this.ledges.groundAt(x);
        if (!l) {
          x += 2;
          continue;
        }
        const [c0, c1] = l.colRange(x, Math.min(blade, r.right));
        const keep = RESIDUAL * r.k;
        for (let c = c0; c <= c1; c++) {
          const take = l.h[c] - keep;
          if (take > 0) {
            r.mound += take * l.colW;
            l.h[c] = keep;
          }
        }
        l.markDirty(c0, c1);
        l.active = true;
        x = l.x + (c1 + 1) * l.colW;
      }
    } else if (bladeUp && r.mound > 0) {
      // Blade raised around a snowman: the heap stays put on the ground.
      this.dropHeap(r, blade);
    }

    // Snow tumbling off the top of the heap.
    if (r.mound > 60 * r.k * r.k && Math.random() < 0.5) {
      const h = Math.min(44, Math.sqrt(r.mound / (r.dk * r.dk)) * 0.6) * r.dk;
      this.emit(blade + (4 + Math.random() * 16) * r.dk, this.ground(blade) - h, (30 + Math.random() * 70) * r.k, (-50 - Math.random() * 80) * r.k, 2.5 * r.k * r.k, r.k);
    }

    // Exhaust.
    if (Math.random() < 0.35) {
      r.puffs.push({
        x: r.x + EXHAUST_TIP.x * r.dk,
        y: this.ground(r.x) + EXHAUST_TIP.y * r.dk,
        vx: (-12 + Math.random() * 8) * r.k,
        vy: (-22 - Math.random() * 12) * r.k,
        r: 2.4 * r.dk,
        life: 1,
      });
    }
    for (let i = r.puffs.length - 1; i >= 0; i--) {
      const p = r.puffs[i];
      p.life -= dt * 0.6;
      if (p.life <= 0) {
        r.puffs.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += 7 * r.k * dt;
    }

    // Heap pushed off the edge, then the dozer drives off too.
    if (blade >= r.right) r.mound = 0;
    if (r.x + DOZER_BACK * r.dk > r.right + 10) this.clear();
  }

  /** Leave the heap as a drift on the ground in front of the blade. */
  private dropHeap(r: Run, x: number): void {
    const l = this.ledges.groundAt(x + 10 * r.k);
    if (!l) {
      r.mound = 0;
      return;
    }
    const w = Math.max(8, Math.min(46, Math.sqrt(r.mound) * 0.9)) * r.k;
    const [c0, c1] = l.colRange(x, x + w);
    const per = r.mound / Math.max(1, c1 - c0 + 1) / l.colW;
    for (let c = c0; c <= c1; c++) l.h[c] = Math.min(l.maxH, l.h[c] + per);
    l.markDirty(c0, c1);
    l.active = true;
    r.mound = 0;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const r = this.run;
    if (!r) return;
    const g = this.ground(r.x);
    for (const p of r.puffs) {
      ctx.fillStyle = `rgba(80, 86, 96, ${0.32 * p.life})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    drawDozer(ctx, r.x, g, r.dk, r.dist, this.time, 1);
    const blade = r.x + BLADE_FRONT * r.dk;
    if (blade < r.right + 60 * r.k) drawMound(ctx, blade, this.ground(blade), r.dk, r.mound / (r.dk * r.dk), this.time, 1);
  }
}

/** Canvas for the plow, under the snowmen so it drives behind them. */
export class PlowLayer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private had = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: true })!;
  }

  resize(pxWidth: number, pxHeight: number, layoutToCanvas: number): void {
    this.canvas.width = pxWidth;
    this.canvas.height = pxHeight;
    this.scale = layoutToCanvas;
  }

  render(p: SnowPlow): void {
    if (!p.run && !this.had) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.had = !!p.run;
    if (!p.run) return;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    p.draw(ctx);
  }
}
