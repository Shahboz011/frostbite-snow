/**
 * Snowman building on the ground piles.
 *
 * - Rest the cursor on a thick ground pile for a moment ("arming"), then press
 *   and drag: a snowball forms, rolls along the pile and grows by taking snow
 *   from it (leaving a groove).
 * - Drag a loose ball (or the top ball of a stack) to carry it. Drop it onto a
 *   bigger ball to stack it; three stacked balls become a snowman.
 * - Click (no drag) a stack or ball to knock it over: it tips, then bursts
 *   into clumps that settle back into the piles.
 * - With "snowball fights" on, finished snowmen sometimes lob a snowball at
 *   the cursor.
 *
 * All coordinates are overlay-relative physical px. `k` is the monitor's DPI
 * scale at the ball's position.
 */
import type { Rect } from "../types";
import type { EmitClump, Ledge, LedgeSet } from "./ledges";

const R0 = 7; // starting radius, px @100%
const RMAX = 62;
/** Area gained per px rolled, per px of radius (before snow runs out). */
const GROW = 0.22;
const DWELL = 0.3; // s the cursor must rest on a pile before it's grabbable
const ARM_RANGE = 60; // px the cursor may wander before disarming
const MIN_GRAB_H = 5; // px of pile needed under the cursor
const GRAVITY = 1500; // px/s² for dropped balls
const THROW_GRAVITY = 900;
const KNOCK_TIME = 0.45;
const MAX_BALLS = 9;
const STACK_OVERLAP = 0.82; // fraction of the lower radius the next ball sits into
const SINK = 0.9; // a resting ball sits this fraction of r above the snow surface
const DRAG_THRESHOLD = 6;

export interface Ball {
  x: number;
  y: number;
  r: number;
  angle: number;
  k: number;
}

export interface Stack {
  /** Bottom first. */
  balls: Ball[];
  ledgeId: string;
  /** balls[0].y relative to the ledge's edge, fixed when it landed. */
  offset: number;
  /** Knock-over animation: <0 = standing. */
  knockT: number;
  knockDir: number;
  tilt: number;
  /** Accessory pop-in, 0..1 (snowmen only). */
  accT: number;
  /** Which way the face (and nose) points: -1 left, 1 right. */
  face: number;
  /** Throw animation timer (s left) and side of the throwing arm. */
  throwT: number;
  throwSide: number;
  throwCooldown: number;
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  T: number;
  k: number;
}

interface Falling {
  ball: Ball;
  vy: number;
  target: Stack | null;
}

interface Pending {
  stack: Stack;
  index: number;
  x0: number;
  y0: number;
}

export const THROW_ANIM = 0.5;

export class Yard {
  stacks: Stack[] = [];
  held: { ball: Ball; offY: number; tx: number; ty: number; rolling: boolean } | null = null;
  falling: Falling[] = [];
  shots: Shot[] = [];

  /** Building allowed (snowman setting, snow on, taskbar snow on). */
  enabled = true;
  /** Snowball fights. */
  throwing = false;

  cursorX = -1e6;
  cursorY = -1e6;
  armed = false;
  armX = 0;
  armY = 0;
  armK = 1;
  /** Something visible changed since the last render. */
  dirty = true;

  private dwell = 0;
  private dwellX = 0;
  private dwellY = 0;
  private pending: Pending | null = null;

  constructor(
    private ledges: LedgeSet,
    private emit: EmitClump,
  ) {}

  setCursor(x: number, y: number): void {
    this.cursorX = x;
    this.cursorY = y;
  }

  get ballCount(): number {
    let n = this.falling.length + (this.held ? 1 : 0);
    for (const s of this.stacks) n += s.balls.length;
    return n;
  }

  /** Needs frames (animation or interaction in progress). */
  get busy(): boolean {
    if (this.held || this.pending || this.falling.length || this.shots.length || this.dwell > 0) return true;
    for (const s of this.stacks) {
      if (s.knockT >= 0 || s.throwT > 0 || (s.balls.length === 3 && s.accT < 1)) return true;
      if (this.throwing && s.balls.length === 3) return true;
    }
    return false;
  }

  get cursorStyle(): string {
    if (this.held || this.pending) return "grabbing";
    if (this.stackAt(this.cursorX, this.cursorY)) return "grab";
    if (this.armed) return "grab";
    return "";
  }

  // --- geometry -------------------------------------------------------------

  private colAt(l: Ledge, x: number): number {
    return Math.max(0, Math.min(l.cols - 1, Math.floor((x - l.x) / l.colW)));
  }

  /** Snow surface y at x on the ground ledge, or undefined if there's no ground. */
  private surface(x: number): { l: Ledge; top: number } | undefined {
    const l = this.ledges.groundAt(x);
    if (!l) return undefined;
    return { l, top: l.y - l.h[this.colAt(l, x)] };
  }

  /** Cursor over a pile thick enough to grab? */
  private overPile(x: number, y: number): Ledge | undefined {
    const s = this.surface(x);
    if (!s) return undefined;
    const k = s.l.scale;
    if (s.l.y - s.top < MIN_GRAB_H * k) return undefined;
    if (y < s.top - 4 * k || y > s.l.y + 3 * k) return undefined;
    return s.l;
  }

  stackAt(x: number, y: number): { stack: Stack; index: number } | undefined {
    for (let si = this.stacks.length - 1; si >= 0; si--) {
      const s = this.stacks[si];
      if (s.knockT >= 0) continue;
      for (let i = s.balls.length - 1; i >= 0; i--) {
        const b = s.balls[i];
        const dx = x - b.x;
        const dy = y - b.y;
        if (dx * dx + dy * dy <= b.r * b.r) return { stack: s, index: i };
      }
    }
    return undefined;
  }

  /** Re-seat every ball of a standing stack from the ground ledge. */
  private seat(s: Stack): boolean {
    const l = this.ledges.get(s.ledgeId);
    if (!l) return false;
    let y = l.y + s.offset;
    for (let i = 0; i < s.balls.length; i++) {
      const b = s.balls[i];
      if (i > 0) {
        const below = s.balls[i - 1];
        y = below.y - below.r * STACK_OVERLAP - b.r;
        b.x = below.x;
      }
      if (b.y !== y) {
        b.y = y;
        this.dirty = true;
      }
    }
    return true;
  }

  // --- snow transfer ----------------------------------------------------------

  /** Take up to `want` px² of snow from under x±halfW. Returns what was taken. */
  private take(l: Ledge, x: number, halfW: number, want: number, maxFrac: number): number {
    const [c0, c1] = l.colRange(x - halfW, x + halfW);
    let avail = 0;
    for (let c = c0; c < c1; c++) avail += l.h[c] * l.colW;
    if (avail <= 0) return 0;
    const got = Math.min(want, avail * maxFrac);
    const f = got / avail;
    for (let c = c0; c < c1; c++) l.h[c] -= l.h[c] * f;
    l.markDirty(c0, c1);
    l.active = true;
    return got;
  }

  // --- input ----------------------------------------------------------------

  /** True if the overlay should take a press at (x, y). */
  wants(x: number, y: number): boolean {
    if (!this.enabled) return false;
    return !!this.stackAt(x, y) || (this.armed && Math.abs(x - this.armX) < ARM_RANGE * this.armK * 1.2);
  }

  pointerDown(x: number, y: number): boolean {
    if (!this.enabled) return false;
    const hit = this.stackAt(x, y);
    if (hit) {
      this.pending = { stack: hit.stack, index: hit.index, x0: x, y0: y };
      this.dirty = true;
      return true;
    }
    if (!this.armed || this.ballCount >= MAX_BALLS) return false;
    const s = this.surface(x);
    if (!s) return false;
    const k = s.l.scale;
    const r0 = R0 * k;
    const got = this.take(s.l, x, r0 * 1.5, Math.PI * r0 * r0, 0.7);
    if (got < Math.PI * r0 * r0 * 0.5) return false; // not enough snow here
    const r = Math.sqrt(got / Math.PI);
    const ball: Ball = { x, y: s.top - r * SINK, r, angle: 0, k };
    this.held = { ball, offY: ball.y - y, tx: x, ty: y, rolling: true };
    this.armed = false;
    this.dwell = 0;
    this.dirty = true;
    return true;
  }

  pointerMove(x: number, y: number): void {
    this.setCursor(x, y);
    const p = this.pending;
    if (p && Math.hypot(x - p.x0, y - p.y0) > DRAG_THRESHOLD) {
      this.pending = null;
      const s = p.stack;
      // Only the top ball can be lifted off a stack.
      const top = s.balls.length - 1;
      if (p.index === top && s.knockT < 0) {
        const ball = s.balls.pop()!;
        if (s.balls.length === 0) this.stacks.splice(this.stacks.indexOf(s), 1);
        else s.accT = 0;
        this.held = { ball, offY: ball.y - p.y0, tx: x, ty: y, rolling: false };
      }
      this.dirty = true;
    }
    if (this.held) {
      this.held.tx = x;
      this.held.ty = y;
    }
  }

  pointerUp(x: number): void {
    if (this.pending) {
      const s = this.pending.stack;
      this.pending = null;
      this.knock(s, x < s.balls[0].x ? 1 : -1);
      return;
    }
    if (this.held) {
      const b = this.held.ball;
      this.held = null;
      this.drop(b);
    }
  }

  get capturing(): boolean {
    return !!(this.held || this.pending);
  }

  // --- actions --------------------------------------------------------------

  private drop(b: Ball): void {
    let target: Stack | null = null;
    for (const s of this.stacks) {
      if (s.knockT >= 0 || s.balls.length >= 3) continue;
      const t = s.balls[s.balls.length - 1];
      if (Math.abs(b.x - t.x) < t.r * 0.75 && b.r < t.r * 0.97 && b.y < t.y) {
        target = s;
        break;
      }
    }
    if (!target) {
      // Don't drop into another stack's footprint: slide off to its side.
      for (const s of this.stacks) {
        const base = s.balls[0];
        const gap = base.r + b.r + 2 * b.k;
        if (Math.abs(b.x - base.x) < gap) b.x = base.x + (b.x < base.x ? -gap : gap);
      }
    }
    this.falling.push({ ball: b, vy: 0, target });
    this.dirty = true;
  }

  knock(s: Stack, dir: number): void {
    if (s.knockT >= 0) return;
    s.knockT = 0;
    s.knockDir = dir;
    this.dirty = true;
  }

  /** Ball positions after the stack's tilt (pivot: where the base touches the ground). */
  tilted(s: Stack, b: Ball): [number, number] {
    const base = s.balls[0];
    const px = base.x;
    const py = base.y + base.r;
    const c = Math.cos(s.tilt);
    const sn = Math.sin(s.tilt);
    const dx = b.x - px;
    const dy = b.y - py;
    return [px + dx * c - dy * sn, py + dx * sn + dy * c];
  }

  private burstBall(x: number, y: number, r: number, k: number, dir: number): void {
    const n = Math.max(8, Math.min(48, Math.round(r / (1.2 * k))));
    const mass = (Math.PI * r * r * 0.45) / n;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r * 0.8;
      const sp = (40 + Math.random() * 90) * k;
      this.emit(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * sp + dir * 60 * k, Math.sin(a) * sp - 40 * k, mass, k);
    }
  }

  private burstStack(s: Stack): void {
    for (const b of s.balls) {
      const [x, y] = this.tilted(s, b);
      this.burstBall(x, y, b.r, b.k, s.knockDir);
    }
    this.stacks.splice(this.stacks.indexOf(s), 1);
    this.dirty = true;
  }

  /** Remove everything as falling snow (settings off, shake). */
  clear(): void {
    for (const s of [...this.stacks]) this.burstStack(s);
    for (const f of this.falling) this.burstBall(f.ball.x, f.ball.y, f.ball.r, f.ball.k, 0);
    if (this.held) this.burstBall(this.held.ball.x, this.held.ball.y, this.held.ball.r, this.held.ball.k, 0);
    this.falling = [];
    this.held = null;
    this.pending = null;
    this.shots = [];
    this.armed = false;
    this.dwell = 0;
    this.dirty = true;
  }

  // --- simulation -----------------------------------------------------------

  update(dt: number): void {
    if (!this.enabled && (this.stacks.length || this.held || this.falling.length)) this.clear();

    for (const s of [...this.stacks]) {
      if (s.knockT >= 0) {
        s.knockT += dt;
        const u = Math.min(1, s.knockT / KNOCK_TIME);
        s.tilt = s.knockDir * 1.45 * u * u;
        this.dirty = true;
        if (u >= 1) this.burstStack(s);
        continue;
      }
      if (!this.seat(s)) {
        this.burstStack(s); // its ground vanished (monitor or taskbar change)
        continue;
      }
      if (s.balls.length === 3) {
        if (s.accT < 1) {
          s.accT = Math.min(1, s.accT + dt * 2.5);
          this.dirty = true;
        }
        const top = s.balls[2];
        const face = this.cursorX < top.x ? -1 : 1;
        if (face !== s.face) {
          s.face = face;
          this.dirty = true;
        }
        if (s.throwT > 0) {
          s.throwT = Math.max(0, s.throwT - dt);
          this.dirty = true;
        }
        if (this.throwing) this.maybeThrow(s, dt);
      }
    }

    this.updateHeld();
    this.updateFalling(dt);
    this.updateShots(dt);
    this.updateArming(dt);
  }

  private updateArming(dt: number): void {
    if (!this.enabled || this.held || this.pending || this.ballCount >= MAX_BALLS) {
      if (this.armed) this.dirty = true;
      this.armed = false;
      this.dwell = 0;
      return;
    }
    const x = this.cursorX;
    const y = this.cursorY;
    const pile = this.stackAt(x, y) ? undefined : this.overPile(x, y);
    if (this.armed) {
      if (!pile || Math.abs(x - this.armX) > ARM_RANGE * this.armK) {
        this.armed = false;
        this.dwell = 0;
        this.dirty = true;
      }
      return;
    }
    if (!pile) {
      this.dwell = 0;
      return;
    }
    const k = pile.scale;
    if (Math.abs(x - this.dwellX) + Math.abs(y - this.dwellY) > 12 * k) {
      this.dwellX = x;
      this.dwellY = y;
      this.dwell = 0;
    }
    this.dwell += dt;
    if (this.dwell >= DWELL) {
      this.armed = true;
      this.armX = x;
      this.armY = y;
      this.armK = k;
      this.dwell = 0;
      this.dirty = true;
    }
  }

  private updateHeld(): void {
    const h = this.held;
    if (!h) return;
    const b = h.ball;
    const nx = h.tx;
    const s = this.surface(nx);
    const want = h.ty + h.offY;
    const rest = s ? s.top - b.r * SINK : Infinity;
    const dx = nx - b.x;
    const ny = Math.min(want, rest);
    h.rolling = !!s && want >= rest - 1;
    if (h.rolling && s && dx !== 0) {
      b.angle += dx / b.r;
      const got = this.take(s.l, nx, b.r * 0.6, Math.abs(dx) * b.r * GROW, 0.6);
      if (got > 0) b.r = Math.min(RMAX * b.k, Math.sqrt(b.r * b.r + got / Math.PI));
    }
    if (nx !== b.x || ny !== b.y) this.dirty = true;
    b.x = nx;
    b.y = ny;
  }

  private updateFalling(dt: number): void {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      const b = f.ball;
      if (f.target && (f.target.knockT >= 0 || !this.stacks.includes(f.target) || f.target.balls.length >= 3)) {
        f.target = null;
      }
      f.vy += GRAVITY * b.k * dt;
      b.y += f.vy * dt;
      this.dirty = true;
      if (f.target) {
        const t = f.target.balls[f.target.balls.length - 1];
        b.x += (t.x - b.x) * Math.min(1, dt * 14);
        const land = t.y - t.r * STACK_OVERLAP - b.r;
        if (b.y >= land) {
          b.x = t.x;
          b.y = land;
          f.target.balls.push(b);
          if (f.target.balls.length === 3) f.target.accT = 0;
          this.falling.splice(i, 1);
        }
        continue;
      }
      const s = this.surface(b.x);
      if (!s) {
        this.burstBall(b.x, b.y, b.r, b.k, 0);
        this.falling.splice(i, 1);
        continue;
      }
      const rest = s.top - b.r * SINK;
      if (b.y >= rest) {
        b.y = rest;
        this.stacks.push({
          balls: [b],
          ledgeId: s.l.id,
          offset: rest - s.l.y,
          knockT: -1,
          knockDir: 1,
          tilt: 0,
          accT: 0,
          face: 1,
          throwT: 0,
          throwSide: 1,
          throwCooldown: 3 + Math.random() * 4,
        });
        this.falling.splice(i, 1);
      }
    }
  }

  /** Where the snowman's arm on `side` ends (also the throw origin). */
  armTip(s: Stack, side: number, raise: number): [number, number] {
    const m = s.balls[1];
    const len = m.r * 1.35;
    const a = (25 + 50 * raise) * (Math.PI / 180);
    const sx = m.x + side * m.r * 0.85;
    const sy = m.y - m.r * 0.3;
    return [sx + side * Math.cos(a) * len, sy - Math.sin(a) * len];
  }

  private maybeThrow(s: Stack, dt: number): void {
    s.throwCooldown -= dt;
    if (s.throwCooldown > 0) return;
    s.throwCooldown = 7 + Math.random() * 9;
    const k = s.balls[0].k;
    const side = this.cursorX < s.balls[1].x ? -1 : 1;
    const [x, y] = this.armTip(s, side, 1);
    const dx = this.cursorX - x;
    const dy = this.cursorY - y;
    const dist = Math.hypot(dx, dy);
    if (dist < 80 * k || dist > 1500 * k) return;
    const T = Math.max(0.45, Math.min(1.3, dist / (650 * k)));
    const g = THROW_GRAVITY * k;
    this.shots.push({ x, y, vx: dx / T, vy: dy / T - 0.5 * g * T, r: 5 * k, t: 0, T, k });
    s.throwT = THROW_ANIM;
    s.throwSide = side;
  }

  private updateShots(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i];
      p.t += dt;
      p.vy += THROW_GRAVITY * p.k * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this.dirty = true;
      const s = this.surface(p.x);
      const hitGround = s ? p.y + p.r >= s.top : false;
      if (p.t >= p.T || hitGround) {
        // Splat: a little puff of clumps that settle as snow.
        for (let j = 0; j < 10; j++) {
          const a = Math.random() * Math.PI * 2;
          const sp = (50 + Math.random() * 110) * p.k;
          this.emit(p.x, p.y, Math.cos(a) * sp, Math.sin(a) * sp - 60 * p.k, (Math.PI * p.r * p.r) / 14, p.k);
        }
        this.shots.splice(i, 1);
      }
    }
  }

  // --- click-through regions ------------------------------------------------

  /** Regions where the overlay must take the mouse. */
  hitRegions(): Rect[] {
    const out: Rect[] = [];
    if (!this.enabled) return out;
    for (const s of this.stacks) {
      if (s.knockT >= 0) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const b of s.balls) {
        x0 = Math.min(x0, b.x - b.r);
        x1 = Math.max(x1, b.x + b.r);
        y0 = Math.min(y0, b.y - b.r);
        y1 = Math.max(y1, b.y + b.r);
      }
      out.push({ x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) });
    }
    if (this.armed) {
      const s = this.surface(this.armX);
      if (s) {
        const k = this.armK;
        const w = ARM_RANGE * k * 2.4;
        const top = Math.min(s.top, this.armY) - 14 * k;
        out.push({ x: Math.floor(this.armX - w / 2), y: Math.floor(top), w: Math.ceil(w), h: Math.ceil(s.l.y + 4 * k - top) });
      }
    }
    return out;
  }
}
