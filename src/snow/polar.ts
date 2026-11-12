/**
 * "The fish thief": now and then a polar bear walks along the taskbar snow
 * of the primary monitor with a fish, sits down to enjoy it, and a penguin
 * sneaks in and steals it. The bear chases the penguin; the penguin
 * belly-slides (carving a groove in the snow), the bear trips and rolls. It
 * ends one of three ways: the penguin escapes, drops the fish back to the
 * bear, or shares it.
 *
 * Click the bear to make it trip, the penguin to make it jump.
 * All positions are overlay layout (physical) px.
 */
import type { Layout, MonitorInfo, Rect, Surfaces } from "../types";
import { drawAlert, drawFish, drawHeart, type BearPose, type PenguinPose } from "./critterRender";
import { drawBearSprite, drawPenguinSprite } from "./critterSprites";
import { groundY, type EmitClump, type LedgeSet } from "./ledges";

/** First show a while after start (Santa comes first), then every 12 minutes. */
export const POLAR_FIRST = 150;
export const POLAR_INTERVAL = 12 * 60;

type Ending = "escape" | "share" | "drop";

interface Pen { x: number; dir: 1 | -1; pose: PenguinPose; phase: number; speed: number; t: number; fish: boolean; scared: boolean }
interface Bear { x: number; dir: 1 | -1; pose: BearPose; phase: number; speed: number; t: number; spin: number; angry: boolean; fish: boolean; content: boolean }
interface FreeFish { x: number; y: number; vx: number; vy: number; a: number; flying: boolean; half: boolean }
interface Heart { x: number; y: number; t: number }

interface Scene {
  m: MonitorInfo;
  k: number;
  left: number;
  right: number;
  ending: Ending;
  stage: string;
  stageT: number;
  slid: boolean;
  tripped: boolean;
  alertT: number;
  pen: Pen;
  bear: Bear;
  fishes: FreeFish[];
  hearts: Heart[];
}

export class PolarChase {
  scene: Scene | null = null;
  nextAt: number;
  dirty = false;
  time = 0;
  private layout: Layout | null = null;
  private surfaces: Surfaces = { windows: [], taskbars: [], icons: [] };

  constructor(
    private ledges: LedgeSet,
    private emit: EmitClump,
    now: number,
  ) {
    this.nextAt = now + POLAR_FIRST;
  }

  setLayout(l: Layout): void {
    this.layout = l;
  }

  setSurfaces(s: Surfaces): void {
    this.surfaces = s;
  }

  get busy(): boolean {
    return !!this.scene;
  }

  clear(): void {
    if (this.scene) this.dirty = true;
    this.scene = null;
  }

  /** Start the show now. False if there's nowhere to play it. */
  start(now: number): boolean {
    this.nextAt = now + POLAR_INTERVAL;
    const l = this.layout;
    const m = l?.monitors.find((mm) => mm.primary) ?? l?.monitors[0];
    if (!l || !m || this.scene) return false;
    const k = m.scale;
    const left = m.rect.x;
    const right = m.rect.x + m.rect.w;
    const endings: Ending[] = ["escape", "share", "drop"];
    this.scene = {
      m,
      k,
      left,
      right,
      ending: endings[Math.floor(Math.random() * endings.length)],
      stage: "walkIn",
      stageT: 0,
      slid: false,
      tripped: false,
      alertT: -1,
      bear: { x: left - 70 * k, dir: 1, pose: "walk", phase: 0, speed: 70 * k, t: 0, spin: 0, angry: false, fish: true, content: false },
      pen: { x: right + 40 * k, dir: -1, pose: "stand", phase: 0, speed: 0, t: 0, fish: false, scared: false },
      fishes: [],
      hearts: [],
    };
    this.dirty = true;
    return true;
  }

  /** Surface the animals stand on at x: the snow top, or the taskbar line. */
  private floor(x: number): number {
    const S = this.scene!;
    const l = this.ledges.groundAt(x);
    if (l) {
      const c = Math.max(0, Math.min(l.cols - 1, Math.floor((x - l.x) / l.colW)));
      // Feet sink a little into the snow.
      return l.y - l.h[c] * 0.6;
    }
    return groundY(S.m, this.surfaces.taskbars, this.layout?.height ?? 1e9);
  }

  private frac(f: number): number {
    const S = this.scene!;
    return S.left + (S.right - S.left) * f;
  }

  private set(stage: string): void {
    this.scene!.stage = stage;
    this.scene!.stageT = 0;
  }

  private puff(x: number, n: number, power: number): void {
    const S = this.scene!;
    const K = S.k;
    const y = this.floor(x) - 2 * K;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * Math.random();
      const sp = (40 + Math.random() * 140) * K * power;
      this.emit(x + (Math.random() - 0.5) * 30 * K, y, Math.cos(a) * sp, Math.sin(a) * sp, 5 * K * K, K);
    }
  }

  /** Belly slide: press a groove into the ground snow under the penguin. */
  private carve(x: number): void {
    const S = this.scene!;
    const l = this.ledges.groundAt(x);
    if (!l) return;
    const half = 12 * S.k;
    const [c0, c1] = l.colRange(x - half, x + half);
    for (let c = c0; c <= c1; c++) l.h[c] *= 0.55;
    l.markDirty(c0, c1);
  }

  private trip(): void {
    const S = this.scene;
    if (!S || S.stage !== "chase" || S.bear.pose !== "run" || S.tripped) return;
    S.tripped = true;
    S.bear.pose = "tumble";
    S.bear.t = 0;
    this.puff(S.bear.x + 30 * S.k * S.bear.dir, 28, 1);
  }

  update(dt: number): void {
    this.time += dt;
    const S = this.scene;
    if (!S) return;
    this.dirty = true;
    const K = S.k;
    const { pen, bear } = S;
    S.stageT += dt;
    pen.t += dt;
    bear.t += dt;
    if (S.alertT >= 0) S.alertT += dt;

    switch (S.stage) {
      case "walkIn":
        if (bear.x >= this.frac(0.28)) {
          bear.pose = "sit";
          bear.speed = 0;
          bear.fish = false;
          bear.content = true;
          S.fishes.push({ x: bear.x + 62 * K, y: 0, vx: 0, vy: 0, a: 0.05, flying: false, half: false });
          this.set("rest");
        }
        break;
      case "rest":
        if (S.stageT > 0.8 && pen.pose === "stand") {
          pen.pose = "run";
          pen.speed = 140 * K;
        }
        // Waddle in quickly, then tiptoe the last stretch.
        if (pen.pose === "run" && S.fishes[0] && pen.x < S.fishes[0].x + 150 * K) {
          pen.pose = "sneak";
          pen.speed = 48 * K;
        }
        if (S.fishes[0] && pen.x <= S.fishes[0].x + 20 * K) {
          pen.pose = "grab";
          pen.speed = 0;
          this.set("grab");
        }
        break;
      case "grab":
        if (S.stageT > 0.35 && !pen.fish) {
          pen.fish = true;
          S.fishes.length = 0;
        }
        if (S.stageT > 0.7) {
          pen.dir = 1;
          pen.pose = "run";
          pen.speed = 165 * K;
          pen.scared = true;
          bear.content = false;
          S.alertT = 0;
          this.set("notice");
        }
        break;
      case "notice":
        if (S.stageT > 0.25 && bear.pose === "sit") bear.pose = "roar";
        if (S.stageT > 0.9) {
          bear.pose = "run";
          bear.angry = true;
          bear.speed = 176 * K;
          S.alertT = -1;
          this.set("chase");
        }
        break;
      case "chase":
        if (!S.slid && pen.x > this.frac(0.55)) {
          S.slid = true;
          pen.pose = "slide";
          pen.t = 0;
        }
        if (!S.tripped && bear.x > this.frac(0.52)) this.trip();
        if (S.tripped && bear.pose === "run" && pen.x > this.frac(0.8)) {
          if (S.ending === "share") {
            pen.pose = "stand";
            pen.speed = 0;
            pen.dir = -1;
            pen.scared = false;
            this.set("shareWait");
          } else if (S.ending === "drop") {
            pen.pose = "jump";
            pen.t = 0;
            pen.fish = false;
            S.fishes.push({ x: pen.x + 18 * K, y: this.floor(pen.x) - 34 * K, vx: -(pen.x - bear.x) * 0.9, vy: -260 * K, a: 0, flying: true, half: false });
            this.set("dropped");
          } else {
            this.set("escape");
          }
        }
        break;
      case "escape":
        if (pen.x > S.right + 40 * K && bear.pose === "run") {
          bear.pose = "sit";
          bear.speed = 0;
          bear.angry = false;
        }
        if (bear.pose === "sit" && S.stageT > 2.6) {
          bear.dir = -1;
          bear.pose = "walk";
          bear.speed = 95 * K;
        }
        break;
      case "shareWait":
        if (bear.x > pen.x - 120 * K) {
          bear.pose = "sit";
          bear.speed = 0;
          bear.angry = false;
          this.set("share");
        }
        break;
      case "share":
        if (S.stageT > 0.5 && S.stageT - dt <= 0.5) {
          S.fishes.push({ x: pen.x - 16 * K, y: this.floor(pen.x) - 34 * K, vx: -(pen.x - (bear.x + 52 * K)) / 0.55, vy: -150 * K, a: 0, flying: true, half: true });
        }
        if (S.stageT > 1.1 && S.hearts.length < 5 && Math.random() < 0.08) {
          S.hearts.push({ x: (pen.x + bear.x + 40 * K) / 2 + (Math.random() - 0.5) * 40 * K, y: this.floor(pen.x) - 60 * K, t: 0 });
        }
        if (S.stageT > 3.6) {
          pen.dir = 1;
          pen.pose = "run";
          pen.speed = 90 * K;
          bear.pose = "walk";
          bear.speed = 90 * K;
          bear.content = false;
          this.set("walkOff");
        }
        break;
      case "dropped":
        if (pen.pose === "jump" && pen.t > 0.45) {
          pen.pose = "run";
          pen.scared = true;
          pen.speed = 190 * K;
        }
        break;
    }

    // Penguin.
    if (pen.pose === "jump" && pen.t > 0.45 && S.stage !== "dropped") pen.pose = S.stage === "share" || S.stage === "shareWait" ? "stand" : "run";
    if (pen.pose === "slide") {
      pen.speed = (270 - 110 * Math.min(1, pen.t / 1.5)) * K;
      this.carve(pen.x);
      if (Math.random() < 0.5) this.emit(pen.x - 20 * K * pen.dir, this.floor(pen.x) - 2 * K, -pen.dir * (30 + Math.random() * 70) * K, (-30 - Math.random() * 60) * K, 3 * K * K, K);
      if (pen.t > 1.5) {
        pen.pose = "run";
        pen.speed = 165 * K;
      }
    }
    pen.x += pen.dir * pen.speed * dt;
    if (pen.pose === "run" || pen.pose === "sneak") pen.phase += (pen.speed * dt) / ((pen.pose === "sneak" ? 4 : 6) * K);

    // Bear.
    if (bear.pose === "tumble") {
      bear.spin = Math.min(1, bear.t / 0.9) * Math.PI * 2;
      bear.speed = 170 * K * Math.max(0, 1 - bear.t / 0.9);
      if (bear.t > 0.9) {
        bear.pose = "shake";
        bear.t = 0;
        bear.speed = 0;
        this.puff(bear.x, 18, 0.8);
      }
    } else if (bear.pose === "shake") {
      if (Math.random() < 0.6) this.emit(bear.x + (Math.random() - 0.5) * 70 * K, this.floor(bear.x) - (18 + Math.random() * 26) * K, (Math.random() - 0.5) * 240 * K, (-40 - Math.random() * 100) * K, 3 * K * K, K);
      if (bear.t > 0.9) {
        bear.pose = "run";
        bear.speed = 196 * K;
      }
    }
    bear.x += bear.dir * bear.speed * dt;
    if (bear.pose === "run" || bear.pose === "walk") bear.phase += (bear.speed * dt) / ((bear.pose === "walk" ? 9 : 13) * K);

    // Loose fish.
    for (let i = S.fishes.length - 1; i >= 0; i--) {
      const f = S.fishes[i];
      const g = this.floor(f.x);
      if (!f.flying) {
        f.y = g - 2.5 * K;
        continue;
      }
      f.vy += 520 * K * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.a += dt * 9;
      const mouthX = bear.x + 50 * K * bear.dir;
      if ((S.stage === "dropped" || S.stage === "share") && Math.abs(f.x - mouthX) < 18 * K && f.y > g - 40 * K) {
        S.fishes.splice(i, 1);
        bear.fish = true;
        bear.content = true;
        bear.angry = false;
        if (bear.pose === "run" || bear.pose === "tumble" || bear.pose === "shake") {
          bear.pose = "sit";
          bear.speed = 0;
        }
        continue;
      }
      if (f.y > g - 2.5 * K) {
        f.y = g - 2.5 * K;
        f.flying = false;
        f.a = 0.05;
      }
    }
    if (S.stage === "dropped" && !bear.fish && bear.pose === "run") {
      const lying = S.fishes.find((f) => !f.flying);
      // Turn back for it if it landed behind.
      if (lying) bear.dir = lying.x >= bear.x ? 1 : -1;
      if (lying && Math.abs(bear.x + 50 * K * bear.dir - lying.x) < 20 * K) {
        S.fishes.splice(S.fishes.indexOf(lying), 1);
        bear.fish = true;
        bear.content = true;
        bear.angry = false;
        bear.pose = "sit";
        bear.speed = 0;
      }
    }

    for (let i = S.hearts.length - 1; i >= 0; i--) {
      S.hearts[i].t += dt;
      S.hearts[i].y -= 22 * K * dt;
      if (S.hearts[i].t > 2) S.hearts.splice(i, 1);
    }

    // Done once both have left the monitor (or the bear has settled with its fish).
    const gone = (x: number, m: number) => x > S.right + m * K || x < S.left - m * K;
    const early = S.stage === "walkIn" || S.stage === "rest";
    if (!early && gone(pen.x, 60) && (gone(bear.x, 110) || (S.stage === "dropped" && bear.pose === "sit" && S.stageT > 5))) this.clear();
    if (S.stage === "escape" && bear.dir === -1 && bear.x < S.left - 110 * K) this.clear();
    // Safety net: never linger.
    if (S.stageT > 40) this.clear();
  }

  // --- interaction ----------------------------------------------------------

  private bearRect(): Rect | null {
    const S = this.scene;
    if (!S) return null;
    const K = S.k;
    const g = this.floor(S.bear.x);
    return { x: Math.floor(S.bear.x - 55 * K), y: Math.floor(g - 62 * K), w: Math.ceil(110 * K), h: Math.ceil(64 * K) };
  }

  private penRect(): Rect | null {
    const S = this.scene;
    if (!S) return null;
    const K = S.k;
    const g = this.floor(S.pen.x);
    return { x: Math.floor(S.pen.x - 18 * K), y: Math.floor(g - 50 * K), w: Math.ceil(36 * K), h: Math.ceil(52 * K) };
  }

  hitRegions(): Rect[] {
    if (!this.scene) return [];
    return [this.bearRect()!, this.penRect()!];
  }

  /** A click on one of the animals. True if it was handled. */
  click(x: number, y: number): boolean {
    const S = this.scene;
    if (!S) return false;
    const inside = (r: Rect | null) => !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    if (inside(this.penRect()) && (S.pen.pose === "run" || S.pen.pose === "stand")) {
      S.pen.pose = "jump";
      S.pen.t = 0;
      return true;
    }
    if (inside(this.bearRect())) {
      this.trip();
      return true;
    }
    return false;
  }

  cursorAt(x: number, y: number): string {
    const S = this.scene;
    if (!S) return "";
    for (const r of this.hitRegions()) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return "pointer";
    return "";
  }

  // --- drawing --------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D): void {
    const S = this.scene;
    if (!S) return;
    const K = S.k;
    const t = this.time;
    const { pen, bear } = S;
    for (const f of S.fishes) drawFish(ctx, f.x, f.y, K * (f.half ? 0.7 : 1), f.a, t, f.flying ? 1 : 0.15);
    drawBearSprite(ctx, bear.x, this.floor(bear.x), K, t, bear.pose, bear.phase, bear.dir, { spin: bear.spin, angry: bear.angry, fish: bear.fish, content: bear.content });
    drawPenguinSprite(ctx, pen.x, this.floor(pen.x), K, t, pen.pose, pen.phase, pen.dir, { scared: pen.scared && S.stage === "chase", fish: pen.fish, poseT: pen.t });
    if (S.alertT >= 0) drawAlert(ctx, bear.x + 34 * K * bear.dir, this.floor(bear.x) - 66 * K, K, S.alertT);
    for (const h of S.hearts) drawHeart(ctx, h.x, h.y, 9 * K * (0.6 + Math.min(1, h.t * 3) * 0.4), Math.max(0, 1 - h.t / 2));
  }
}

/** Canvas for the chase, redrawn only while it plays. */
export class PolarLayer {
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

  render(p: PolarChase): void {
    if (!p.scene && !this.had) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.had = !!p.scene;
    if (!p.scene) return;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    p.draw(ctx);
  }
}
