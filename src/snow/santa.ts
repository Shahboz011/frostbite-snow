/**
 * Santa's flights: every FLIGHT_INTERVAL the team crosses the screen right →
 * left near the top of the primary monitor and drops a few gifts. Gifts fall,
 * land on window tops or the ground (riding along when a window moves), and
 * open with a burst and a little prize when clicked.
 *
 * All positions are overlay layout (physical) px.
 */
import type { Layout, MonitorInfo, Rect, Surfaces } from "../types";
import { groundY, type EmitClump, type LedgeSet } from "./ledges";
import { TEAM_EXTENT } from "./santaRender";

/** First flight this long after start, so a new user sees him soon. */
export const FIRST_FLIGHT = 60;
/** Then every 10 minutes. */
export const FLIGHT_INTERVAL = 600;

/** Team scale relative to the monitor's DPI scale. */
const TEAM_SCALE = 0.62;
/** Horizontal speed, px/s at scale 1. */
const SPEED = 230;
const GIFT_SIZE = 20;
const GRAVITY = 520;
const DRAG = 1.1;
const MAX_GIFTS = 8;
/** Unopened gifts fade away after this long. */
const GIFT_LIFE = 9 * 60;

export const PRIZES = ["⭐", "🍬", "🍪", "🔔", "🧸", "🍭", "❄️", "🎄", "🧦", "☃️"];

export const GIFT_COLORS: [string, string][] = [
  ["#d6283a", "#f2c14e"],
  ["#2f8f5b", "#f7f4ee"],
  ["#3a6fd8", "#f2c14e"],
  ["#f0b429", "#d6283a"],
  ["#8a4fd1", "#f7f4ee"],
  ["#f7f4ee", "#d6283a"],
];

export interface Gift {
  x: number;
  y: number; // bottom
  vx: number;
  vy: number;
  k: number;
  rot: number;
  vr: number;
  color: number;
  /** Ledge it sits on, and x offset from the ledge's left edge. */
  ledgeId: string | null;
  offset: number;
  landed: boolean;
  /** Fixed floor when there's no ledge (snow on taskbar off). */
  floor: number;
  age: number;
  hover: number;
  /** Landing squash, 1 → 0. */
  squash: number;
}

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  star: boolean;
  color: string;
}

export interface Burst {
  x: number;
  y: number;
  k: number;
  t: number;
  prize: string;
}

export interface Flight {
  x: number;
  y: number;
  baseY: number;
  k: number;
  t: number;
  x1: number;
  /** Screen x positions still to drop a gift at (descending). */
  drops: number[];
}

export class Santa {
  flight: Flight | null = null;
  gifts: Gift[] = [];
  sparks: Spark[] = [];
  bursts: Burst[] = [];
  /** performance.now()/1000 of the next scheduled flight. */
  nextAt: number;
  dirty = false;
  cursorX = -1e6;
  cursorY = -1e6;

  private layout: Layout | null = null;
  private surfaces: Surfaces = { windows: [], taskbars: [], icons: [] };
  /** Clock that only runs while frames run (animations); wall time is separate. */
  time = 0;

  constructor(
    private ledges: LedgeSet,
    private emit: EmitClump,
    now: number,
  ) {
    this.nextAt = now + FIRST_FLIGHT;
  }

  setLayout(l: Layout): void {
    this.layout = l;
  }

  setSurfaces(s: Surfaces): void {
    this.surfaces = s;
    if (this.gifts.length) this.dirty = true;
  }

  setCursor(x: number, y: number): void {
    this.cursorX = x;
    this.cursorY = y;
  }

  /** Needs frames. */
  get busy(): boolean {
    return (
      !!this.flight ||
      this.sparks.length > 0 ||
      this.bursts.length > 0 ||
      this.gifts.some((g) => !g.landed || g.squash > 0 || g.hover > 0.01 || g.age > GIFT_LIFE - 2)
    );
  }

  private primary(): MonitorInfo | undefined {
    const ms = this.layout?.monitors ?? [];
    return ms.find((m) => m.primary) ?? ms[0];
  }

  /** Start a flight now (scheduled, or "Send Santa now"). */
  launch(now: number): boolean {
    const l = this.layout;
    const m = this.primary();
    this.nextAt = now + FLIGHT_INTERVAL;
    if (!l || !m || this.flight) return false;
    const k = m.scale * TEAM_SCALE;
    const baseY = m.rect.y + Math.max(70 * m.scale, m.rect.h * 0.13) + 60 * k;
    const x0 = l.width + -TEAM_EXTENT.left * k + 20;
    const x1 = -TEAM_EXTENT.right * k - 20;

    // Two or three drops spread over the monitors he crosses.
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    const spans = l.monitors.map((mm) => [mm.rect.x + mm.rect.w * 0.08, mm.rect.x + mm.rect.w * 0.92]);
    const drops: number[] = [];
    for (let i = 0; i < n; i++) {
      const [a, b] = spans[Math.floor(Math.random() * spans.length)];
      // The sack sits ~55 units behind the sleigh origin.
      drops.push(a + Math.random() * (b - a) - 55 * k);
    }
    drops.sort((a, b) => b - a);
    this.flight = { x: x0, y: baseY, baseY, k, t: 0, x1, drops };
    this.dirty = true;
    return true;
  }

  /** Stop flights and clear everything (snow off, Santa off, shake). */
  clear(): void {
    this.flight = null;
    this.gifts = [];
    this.sparks = [];
    this.bursts = [];
    this.dirty = true;
  }

  update(dt: number): void {
    this.time += dt;
    const f = this.flight;
    if (f) {
      f.t += dt;
      f.x -= SPEED * f.k * dt;
      f.y = f.baseY + Math.sin(f.t * 0.9) * 18 * f.k;
      this.trail(f, dt);
      while (f.drops.length && f.x <= f.drops[0]) {
        f.drops.shift();
        this.dropGift(f);
      }
      if (f.x < f.x1) this.flight = null;
      this.dirty = true;
    }
    this.updateGifts(dt);
    this.updateFx(dt);
  }

  private trail(f: Flight, dt: number): void {
    const n = Math.round(90 * dt) + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.sparks.push({
        x: f.x + 92 * f.k + Math.random() * 10 * f.k,
        y: f.y + 18 * f.k + (Math.random() - 0.5) * 18 * f.k,
        vx: (20 + Math.random() * 40) * f.k,
        vy: (10 + Math.random() * 30) * f.k,
        life: 1,
        size: (0.8 + Math.random() * 1.6) * f.k * 1.6,
        star: Math.random() < 0.12,
        color: Math.random() < 0.8 ? "255, 224, 150" : "200, 230, 255",
      });
    }
  }

  private dropGift(f: Flight): void {
    if (this.gifts.length >= MAX_GIFTS) {
      // Oldest unopened gift makes room.
      this.gifts.shift();
    }
    const k = f.k / TEAM_SCALE;
    this.gifts.push({
      x: f.x + 55 * f.k,
      y: f.y - 30 * f.k,
      vx: -SPEED * f.k * 0.55,
      vy: -60 * k,
      k,
      rot: (Math.random() - 0.5) * 0.5,
      vr: (Math.random() - 0.5) * 4,
      color: Math.floor(Math.random() * GIFT_COLORS.length),
      ledgeId: null,
      offset: 0,
      landed: false,
      floor: this.floorAt(f.x),
      age: 0,
      hover: 0,
      squash: 0,
    });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparks.push({
        x: f.x + 55 * f.k,
        y: f.y - 30 * f.k,
        vx: Math.cos(a) * 60 * k,
        vy: Math.sin(a) * 60 * k,
        life: 0.8,
        size: 1.6 * k,
        star: i % 3 === 0,
        color: "255, 236, 170",
      });
    }
  }

  /** Bottom of the usable screen under x (taskbar top), for when ledges are off. */
  private floorAt(x: number): number {
    const l = this.layout;
    if (!l) return 1e9;
    const m = l.monitors.find((mm) => x >= mm.rect.x && x < mm.rect.x + mm.rect.w) ?? this.primary();
    return m ? groundY(m, this.surfaces.taskbars, l.height) : l.height;
  }

  private updateGifts(dt: number): void {
    const l = this.layout;
    for (let i = this.gifts.length - 1; i >= 0; i--) {
      const g = this.gifts[i];
      g.age += dt;
      const near = Math.hypot(this.cursorX - g.x, this.cursorY - (g.y - GIFT_SIZE * g.k * 0.5)) < 26 * g.k;
      const hv = near ? 1 : 0;
      if (Math.abs(g.hover - hv) > 0.001) {
        g.hover += (hv - g.hover) * Math.min(1, dt * 10);
        this.dirty = true;
      }
      if (g.squash > 0) {
        g.squash = Math.max(0, g.squash - dt * 3);
        this.dirty = true;
      }
      if (g.age > GIFT_LIFE) {
        this.gifts.splice(i, 1);
        this.dirty = true;
        continue;
      }
      if (g.age > GIFT_LIFE - 2) this.dirty = true;

      if (g.landed) {
        if (g.ledgeId === null) continue;
        const led = this.ledges.get(g.ledgeId);
        const c = led ? Math.floor(g.offset / led.colW) : -1;
        if (!led || c < 0 || c >= led.cols || !led.mask[c]) {
          // The window closed, moved off, or got covered: fall again.
          g.landed = false;
          g.ledgeId = null;
          g.vy = 0;
          g.vx = 0;
          g.floor = this.floorAt(g.x);
          this.dirty = true;
          continue;
        }
        const nx = led.x + g.offset;
        const ny = led.y - led.h[c];
        if (nx !== g.x || ny !== g.y) {
          g.x = nx;
          g.y = ny;
          this.dirty = true;
        }
        continue;
      }

      // Falling.
      const prevY = g.y;
      g.vy += GRAVITY * g.k * dt;
      g.vx -= g.vx * DRAG * dt;
      g.vy -= g.vy * 0.35 * DRAG * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.rot += g.vr * dt;
      this.dirty = true;

      const hit = this.ledges.landingAt(g.x, prevY, g.y);
      if (hit) {
        this.land(g, hit.top);
        g.ledgeId = hit.ledge.id;
        g.offset = g.x - hit.ledge.x;
      } else if (g.y >= g.floor) {
        this.land(g, g.floor);
      } else if (l && (g.y > l.height + 100 || g.x < -200)) {
        this.gifts.splice(i, 1);
      }
    }
  }

  private land(g: Gift, y: number): void {
    g.y = y;
    g.landed = true;
    g.rot = 0;
    g.squash = 1;
    // A puff of snow where it lands.
    for (let i = 0; i < 6; i++) {
      this.emit(g.x + (Math.random() - 0.5) * 16 * g.k, y - 2 * g.k, (Math.random() - 0.5) * 120 * g.k, -60 * g.k - Math.random() * 80 * g.k, 6 * g.k * g.k, g.k);
    }
  }

  private updateFx(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt * 0.85;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 20 * dt;
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      if (b.t > 1.8) this.bursts.splice(i, 1);
    }
    if (this.sparks.length || this.bursts.length) this.dirty = true;
  }

  // --- interaction ----------------------------------------------------------

  private giftRect(g: Gift): Rect {
    const s = GIFT_SIZE * g.k;
    const pad = 6 * g.k;
    return {
      x: Math.floor(g.x - s / 2 - pad),
      y: Math.floor(g.y - s - 8 * g.k - pad),
      w: Math.ceil(s + pad * 2),
      h: Math.ceil(s + 8 * g.k + pad * 2),
    };
  }

  giftAt(x: number, y: number): Gift | undefined {
    for (let i = this.gifts.length - 1; i >= 0; i--) {
      const g = this.gifts[i];
      if (!g.landed) continue;
      const r = this.giftRect(g);
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return g;
    }
    return undefined;
  }

  get cursorStyle(): string {
    return this.giftAt(this.cursorX, this.cursorY) ? "pointer" : "";
  }

  /** Click: open the gift with a burst and a prize. */
  open(g: Gift): void {
    const i = this.gifts.indexOf(g);
    if (i < 0) return;
    this.gifts.splice(i, 1);
    const cy = g.y - GIFT_SIZE * g.k * 0.5;
    const [box, rib] = GIFT_COLORS[g.color];
    const colors = [box, rib, "#ffffff", "#ffd86b"].map((c) => {
      const n = parseInt(c.slice(1), 16);
      return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`;
    });
    for (let j = 0; j < 46; j++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      const sp = (80 + Math.random() * 220) * g.k;
      this.sparks.push({
        x: g.x,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        size: (1.2 + Math.random() * 2) * g.k,
        star: j % 4 === 0,
        color: colors[j % colors.length],
      });
    }
    this.bursts.push({ x: g.x, y: cy, k: g.k, t: 0, prize: PRIZES[Math.floor(Math.random() * PRIZES.length)] });
    this.dirty = true;
  }

  /** Landed gifts take clicks. */
  hitRegions(): Rect[] {
    return this.gifts.filter((g) => g.landed).map((g) => this.giftRect(g));
  }
}
