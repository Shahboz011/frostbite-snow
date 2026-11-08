import type { CursorPos, Intensity, Layout, MonitorInfo } from "../types";
import { LedgeSet } from "./ledges";
import { FlakePool } from "./pool";

/** Target on-screen flakes per megapixel. */
const DENSITY: Record<Intensity, number> = {
  light: 140,
  normal: 480,
  blizzard: 1900,
};
/** Mean fall speed at scale 1, px/s. Used to turn density into a spawn rate. */
const MEAN_FALL = 75;
export const MAX_FLAKES = 16000;

const REPEL_RADIUS = 110; // px at scale 1
const REPEL_FORCE = 900; // px/s² at the cursor centre
/** Fraction of a flake's disc area that ends up as pile volume. */
const ACCUM = 0.15;

export interface SimSettings {
  enabled: boolean;
  intensity: Intensity;
  /** -1 (strong left) … 1 (strong right). */
  wind: number;
}

export class SnowSim {
  readonly pool = new FlakePool(MAX_FLAKES);
  readonly ledges = new LedgeSet((x, y, vx, vy, mass, scale) => this.emitClump(x, y, vx, vy, mass, scale));
  settings: SimSettings = { enabled: true, intensity: "normal", wind: 0.15 };

  private monitors: MonitorInfo[] = [];
  private width = 0;
  private height = 0;
  private spawnAcc: Float64Array = new Float64Array(16);
  private cursorX = -1e6;
  private cursorY = -1e6;
  private cursorScale = 1;
  private time = 0;
  /** Current gusty wind in px/s at scale 1 (exposed for debug). */
  windNow = 0;

  setLayout(l: Layout): void {
    this.monitors = l.monitors;
    this.width = l.width;
    this.height = l.height;
    if (this.spawnAcc.length < l.monitors.length) this.spawnAcc = new Float64Array(l.monitors.length);
    // Kill flakes that no longer belong to any screen.
    const p = this.pool;
    for (let i = p.count - 1; i >= 0; i--) {
      if (p.x[i] < -100 || p.x[i] > l.width + 100 || p.y[i] > l.height + 50) p.kill(i);
    }
  }

  setCursor(c: CursorPos): void {
    this.cursorX = c.x;
    this.cursorY = c.y;
    const m = this.monitorAt(c.x, c.y);
    this.cursorScale = m ? m.scale : 1;
  }

  /** True when nothing would change if we skipped frames. */
  get idle(): boolean {
    return !this.settings.enabled && this.pool.count === 0 && !this.ledges.busy;
  }

  private monitorAt(x: number, y: number): MonitorInfo | undefined {
    for (const m of this.monitors) {
      const r = m.rect;
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return m;
    }
    return undefined;
  }

  /** Smooth gusty wind from a few incommensurate sines (no allocation, no noise tables). */
  private gust(t: number): number {
    const base = this.settings.wind * 140;
    const g =
      Math.sin(t * 0.11) * 0.55 +
      Math.sin(t * 0.29 + 1.7) * 0.3 +
      Math.sin(t * 0.83 + 0.4) * 0.15;
    return base + g * (25 + Math.abs(base) * 0.45);
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    const wind = (this.windNow = this.gust(t));

    if (this.settings.enabled) this.spawn(dt, wind);

    const p = this.pool;
    const cx = this.cursorX;
    const cy = this.cursorY;
    const rr = REPEL_RADIUS * this.cursorScale;
    const rr2 = rr * rr;
    const relaxX = Math.min(1, dt * 1.2);
    const relaxY = Math.min(1, dt * 2.0);
    const xMin = -60;
    const xMax = this.width + 60;
    const ledges = this.ledges;

    for (let i = p.count - 1; i >= 0; i--) {
      const d = p.depth[i];
      const k = p.k[i];

      // Approach terminal velocity and the local wind; far flakes respond less.
      const localWind = wind * (0.35 + 0.65 * d) + Math.sin(p.y[i] * 0.004 + t * 0.6 + p.phase[i]) * 12;
      p.vx[i] += (localWind * k - p.vx[i]) * relaxX;
      const term = (28 + 85 * d) * k;
      p.vy[i] += (term - p.vy[i]) * relaxY;

      // Cursor repulsion.
      const dx = p.x[i] - cx;
      const dy = p.y[i] - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr2) {
        const dist = Math.sqrt(d2) + 0.001;
        const f = (1 - dist / rr) * REPEL_FORCE * this.cursorScale * dt;
        p.vx[i] += (dx / dist) * f;
        p.vy[i] += (dy / dist) * f * 0.6;
      }

      const sway = Math.sin(t * p.swayF[i] + p.phase[i]) * p.swayA[i] * k;
      const prevY = p.y[i];
      p.x[i] += (p.vx[i] + sway) * dt;
      p.y[i] += p.vy[i] * dt;
      p.rot[i] += p.rotV[i] * dt;

      if (
        p.y[i] > p.floor[i] ||
        p.x[i] < xMin ||
        p.x[i] > xMax ||
        ledges.collide(p.x[i], prevY, p.y[i], p.mass[i], p.shape[i] === 1 ? 0 : d, p.phase[i])
      ) {
        p.kill(i);
      }
    }
    ledges.step();
  }

  /** A clump of pile snow knocked loose (window moved/closed, end spill). */
  private emitClump(x: number, y: number, vx: number, vy: number, mass: number, k: number): void {
    const p = this.pool;
    const i = p.alloc();
    if (i < 0) return;
    p.x[i] = x;
    p.y[i] = y;
    p.vx[i] = vx;
    p.vy[i] = vy;
    p.depth[i] = 1;
    p.k[i] = k;
    p.size[i] = Math.min(12 * k, Math.max(2.5 * k, Math.sqrt(mass) * 1.3));
    p.phase[i] = Math.random() * Math.PI * 2;
    p.swayF[i] = 1;
    p.swayA[i] = 2;
    p.alpha[i] = 0.97;
    p.rot[i] = 0;
    p.rotV[i] = 0;
    p.floor[i] = this.height + 40;
    p.mass[i] = mass;
    p.shape[i] = 1;
  }

  private spawn(dt: number, wind: number): void {
    const density = DENSITY[this.settings.intensity] * 1e-6;
    for (let mi = 0; mi < this.monitors.length; mi++) {
      const m = this.monitors[mi];
      const r = m.rect;
      // Flakes/s needed to keep `density` on screen: density * area / lifetime.
      const rate = density * r.w * MEAN_FALL * m.scale;
      let acc = this.spawnAcc[mi] + rate * dt;
      // With wind, some flakes must enter from the upwind side or that edge looks empty.
      const fallTime = r.h / (MEAN_FALL * m.scale);
      const drift = Math.abs(wind) * m.scale * fallTime;
      const sideFrac = Math.min(0.6, drift / (r.w + drift));

      while (acc >= 1) {
        acc -= 1;
        const i = this.pool.alloc();
        if (i < 0) {
          acc = 0;
          break;
        }
        let x: number;
        let y: number;
        if (Math.random() < sideFrac) {
          x = wind > 0 ? r.x - 8 : r.x + r.w + 8;
          y = r.y + Math.random() * r.h * 0.85;
        } else {
          x = r.x + Math.random() * r.w;
          y = r.y - 10 - Math.random() * 30;
        }
        this.initFlake(i, x, y, m);
      }
      this.spawnAcc[mi] = acc;
    }
  }

  private initFlake(i: number, x: number, y: number, m: MonitorInfo): void {
    const p = this.pool;
    // Skew toward small, distant flakes; a few big near ones.
    const d = 0.25 + 0.75 * Math.pow(Math.random(), 1.5);
    const k = m.scale;
    p.x[i] = x;
    p.y[i] = y;
    p.depth[i] = d;
    p.k[i] = k;
    p.size[i] = (2.2 + d * d * 10 + Math.random() * 1.5) * k;
    p.vx[i] = 0;
    p.vy[i] = (20 + 60 * d) * k;
    p.phase[i] = Math.random() * Math.PI * 2;
    p.swayF[i] = 0.6 + Math.random() * 1.4;
    p.swayA[i] = 6 + Math.random() * 22 * d;
    p.alpha[i] = 0.45 + 0.55 * d;
    p.rot[i] = Math.random() * Math.PI;
    p.rotV[i] = (Math.random() - 0.5) * 1.6;
    p.floor[i] = m.rect.y + m.rect.h + 4;
    p.mass[i] = p.size[i] * p.size[i] * 0.785 * ACCUM;
    p.shape[i] = 0;
  }
}
