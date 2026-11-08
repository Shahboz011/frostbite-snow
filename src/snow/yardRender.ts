/**
 * Draws snowballs, snowmen (with outfits and expressions), flying clothes,
 * thrown snowballs and the "grab here" hint on their own canvas. Redrawn only
 * when the yard says something changed.
 */
import { DEBRIS_LIFE, THROW_ANIM, type Ball, type Debris, type Outfit, type Stack, type Yard } from "./yard";

const COAL = "#1f2228";
const TWIG = "#5b3d22";
const CARROT = "#f0862a";
const CARROT_EDGE = "#b85a12";
const CHEEK = "rgba(240, 120, 140, 0.32)";
const POMPOM = "#f7f4ee";

/** Overshooting ease for the accessory pop-in. */
function easeOutBack(t: number): number {
  const c = 1.7;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** Darken a #rrggbb color by `f` (0..1). */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * (1 - f));
  return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

export class YardRenderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private hadContent = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: true })!;
  }

  resize(pxWidth: number, pxHeight: number, layoutToCanvas: number): void {
    this.canvas.width = pxWidth;
    this.canvas.height = pxHeight;
    this.scale = layoutToCanvas;
  }

  render(y: Yard): void {
    const ctx = this.ctx;
    const empty =
      !y.stacks.length && !y.held && !y.falling.length && !y.shots.length && !y.debris.length && !y.armed;
    if (empty && !this.hadContent) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.hadContent = !empty;
    if (empty) return;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);

    if (y.armed) this.hint(y.armX, y.armY, y.armK);
    for (const s of y.stacks) this.stack(y, s);
    for (const f of y.falling) this.ball(f.ball);
    if (y.held) this.ball(y.held.ball);
    for (const d of y.debris) this.debris(d);
    for (const p of y.shots) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = "#f7fbff";
      ctx.fill();
      ctx.lineWidth = p.k;
      ctx.strokeStyle = "rgba(90, 110, 140, 0.6)";
      ctx.stroke();
    }
  }

  private hint(x: number, yy: number, k: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, yy, 13 * k, 0, Math.PI * 2);
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.setLineDash([4 * k, 3 * k]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, yy, 13 * k, 0, Math.PI * 2);
    ctx.lineWidth = 3.5 * k;
    ctx.strokeStyle = "rgba(60, 90, 130, 0.25)";
    ctx.stroke();
  }

  private ball(b: Ball): void {
    const ctx = this.ctx;
    const { x, y, r } = b;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.6, "#f1f5fb");
    g.addColorStop(1, "#c6d3e4");
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.2 * b.k;
    ctx.strokeStyle = "rgba(88, 108, 140, 0.6)";
    ctx.stroke();
    // Speckles that turn with the ball, so rolling reads as rolling.
    ctx.fillStyle = "rgba(160, 182, 210, 0.55)";
    for (let i = 0; i < 6; i++) {
      const a = b.angle + i * 1.047 + (i % 2) * 0.4;
      const d = r * (i % 2 ? 0.35 : 0.62);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.8 * b.k, r * 0.055), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private stack(yard: Yard, s: Stack): void {
    const ctx = this.ctx;
    ctx.save();
    if (s.tilt !== 0) {
      const base = s.balls[0];
      const px = base.x;
      const py = base.y + base.r;
      ctx.translate(px, py);
      ctx.rotate(s.tilt);
      ctx.translate(-px, -py);
    }
    const snowman = s.balls.length === 3;
    const pop = snowman ? Math.max(0, easeOutBack(s.accT)) : 0;
    // Arms go behind the middle ball.
    if (snowman && pop > 0) {
      const throwRaise = s.throwT > 0 ? Math.sin((1 - s.throwT / THROW_ANIM) * Math.PI) : 0;
      // Wave with the arm on the cursor's side.
      const wave = s.hover * (0.6 + 0.4 * Math.sin(s.wavePhase));
      for (const side of [-1, 1]) {
        const raise = Math.max(side === s.throwSide ? throwRaise : 0, side === s.face ? wave : 0);
        this.arm(yard, s, side, raise, pop);
      }
    }
    for (const b of s.balls) this.ball(b);
    if (snowman && pop > 0) {
      const top = s.balls[2];
      this.face(s, pop);
      if (s.outfit.scarf) this.scarf(s.outfit, top.x, top.y + top.r * 0.86, top.r, pop, true);
      if (s.outfit.hat !== "none") {
        ctx.save();
        ctx.translate(top.x, top.y - top.r * (s.outfit.hat === "top" ? 0.72 : 0.55));
        ctx.rotate(s.outfit.hatTilt);
        ctx.scale(pop, pop);
        this.hat(s.outfit, top.r);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private arm(yard: Yard, s: Stack, side: number, raise: number, pop: number): void {
    const ctx = this.ctx;
    const m = s.balls[1];
    const sx = m.x + side * m.r * 0.85;
    const sy = m.y - m.r * 0.3;
    let [ex, ey] = yard.armTip(s, side, raise);
    ex = sx + (ex - sx) * pop;
    ey = sy + (ey - sy) * pop;
    ctx.strokeStyle = TWIG;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2 * m.k, m.r * 0.07);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    // Two little twigs near the end.
    const fx = sx + (ex - sx) * 0.72;
    const fy = sy + (ey - sy) * 0.72;
    const len = m.r * 0.32 * pop;
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + side * len * 0.5, fy - len);
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + side * len, fy + len * 0.15);
    ctx.stroke();
  }

  private face(s: Stack, pop: number): void {
    const ctx = this.ctx;
    const t = s.balls[2];
    const m = s.balls[1];
    const r = t.r;
    const o = s.outfit;
    const dot = (x: number, y: number, rad: number) => {
      ctx.beginPath();
      ctx.arc(x, y, rad * pop, 0, Math.PI * 2);
      ctx.fill();
    };
    // The whole face shifts a little toward where he's looking.
    const fx = t.x + s.lookX * r * 0.1;
    const fy = t.y + s.lookY * r * 0.06;

    if (o.cheeks) {
      ctx.fillStyle = CHEEK;
      dot(fx - r * 0.5, fy + r * 0.08, r * 0.14);
      dot(fx + r * 0.5, fy + r * 0.08, r * 0.14);
    }

    // Eyes: coal, with the pupil-ish dot following the cursor; a line when blinking.
    ctx.fillStyle = COAL;
    ctx.strokeStyle = COAL;
    const ex = r * 0.3;
    const ey = fy - r * 0.22;
    if (s.blinkT > 0) {
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(fx - ex - r * 0.1, ey);
      ctx.lineTo(fx - ex + r * 0.1, ey);
      ctx.moveTo(fx + ex - r * 0.1, ey);
      ctx.lineTo(fx + ex + r * 0.1, ey);
      ctx.stroke();
    } else {
      const px = s.lookX * r * 0.035;
      const py = s.lookY * r * 0.035;
      dot(fx - ex + px, ey + py, r * 0.11);
      dot(fx + ex + px, ey + py, r * 0.11);
      // Tiny highlight makes them read as eyes, not holes.
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      dot(fx - ex + px - r * 0.035, ey + py - r * 0.035, r * 0.03);
      dot(fx + ex + px - r * 0.035, ey + py - r * 0.035, r * 0.03);
      ctx.fillStyle = COAL;
    }

    // Smile: deeper and wider while he's happy to see you.
    const smile = 0.4 + s.hover * 0.1;
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.22 + i * 0.14);
      dot(fx + Math.cos(a) * r * (0.46 + s.hover * 0.06), fy + r * 0.02 + Math.sin(a) * r * smile, r * 0.055);
    }

    // Buttons.
    for (let i = 0; i < 3; i++) dot(m.x, m.y - m.r * 0.5 + i * m.r * 0.45, m.r * 0.08);

    // Nose.
    const nx = fx;
    const ny = fy + r * 0.02;
    if (o.nose === "coal") {
      ctx.fillStyle = "#3a2c25";
      dot(nx + s.face * r * 0.04, ny, r * 0.1);
      return;
    }
    const len = r * 0.85 * pop;
    ctx.beginPath();
    ctx.moveTo(nx, ny - r * 0.1);
    ctx.lineTo(nx + s.face * len, ny + r * 0.06);
    ctx.lineTo(nx, ny + r * 0.12);
    ctx.closePath();
    ctx.fillStyle = CARROT;
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    ctx.strokeStyle = CARROT_EDGE;
    ctx.stroke();
  }

  /** Hat in local coords: origin where it sits on the head, r = head radius. */
  private hat(o: Outfit, r: number): void {
    const ctx = this.ctx;
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    if (o.hat === "top") {
      const dark = "#23262d";
      ctx.fillStyle = dark;
      ctx.strokeStyle = "#0f1114";
      // Crown.
      ctx.beginPath();
      ctx.roundRect(-r * 0.5, -r * 1.02, r * 1.0, r * 0.98, r * 0.06);
      ctx.fill();
      ctx.stroke();
      // Band.
      ctx.fillStyle = o.hatColor;
      ctx.fillRect(-r * 0.5, -r * 0.3, r * 1.0, r * 0.17);
      // Brim.
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.roundRect(-r * 0.8, -r * 0.1, r * 1.6, r * 0.17, r * 0.08);
      ctx.fill();
      ctx.stroke();
      // Sheen.
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fillRect(-r * 0.38, -r * 0.95, r * 0.12, r * 0.6);
      return;
    }
    // Beanie: knit dome, ribbed cuff, pom-pom.
    ctx.fillStyle = o.hatColor;
    ctx.strokeStyle = shade(o.hatColor, 0.35);
    ctx.beginPath();
    ctx.arc(0, -r * 0.05, r * 0.82, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = shade(o.hatColor, 0.2);
    ctx.beginPath();
    for (const f of [-0.45, -0.15, 0.15, 0.45]) {
      ctx.moveTo(r * f, -r * 0.08);
      ctx.quadraticCurveTo(r * f * 0.8, -r * 0.55, r * f * 0.3, -r * 0.82);
    }
    ctx.stroke();
    ctx.fillStyle = shade(o.hatColor, 0.18);
    ctx.strokeStyle = shade(o.hatColor, 0.4);
    ctx.beginPath();
    ctx.roundRect(-r * 0.9, -r * 0.12, r * 1.8, r * 0.3, r * 0.1);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = POMPOM;
    ctx.strokeStyle = "rgba(120, 120, 130, 0.6)";
    ctx.beginPath();
    ctx.arc(0, -r * 0.92, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /** Scarf around the neck at (x, y); `tail` adds the hanging end. */
  private scarf(o: Outfit, x: number, y: number, r: number, pop: number, tail: boolean): void {
    const ctx = this.ctx;
    const c = o.scarf!;
    const edge = shade(c, 0.35);
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    // Hanging tail first, so the wrap overlaps it.
    if (tail) {
      ctx.save();
      ctx.translate(x + o.scarfSide * r * 0.38, y + r * 0.05);
      ctx.rotate(o.scarfSide * -0.18);
      ctx.scale(pop, pop);
      const w = r * 0.32;
      const h = r * 1.05;
      ctx.fillStyle = c;
      ctx.strokeStyle = edge;
      ctx.beginPath();
      ctx.roundRect(-w / 2, 0, w, h, r * 0.05);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = o.scarfStripe;
      for (const f of [0.35, 0.6]) ctx.fillRect(-w / 2, h * f, w, h * 0.09);
      // Fringe.
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(0.8, r * 0.04);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const fx = -w / 2 + (w * (i + 0.5)) / 4;
        ctx.moveTo(fx, h);
        ctx.lineTo(fx, h + r * 0.14);
      }
      ctx.stroke();
      ctx.restore();
    }
    // The wrap around the neck.
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pop, pop);
    ctx.fillStyle = c;
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    ctx.beginPath();
    ctx.roundRect(-r * 0.86, -r * 0.16, r * 1.72, r * 0.32, r * 0.15);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = o.scarfStripe;
    for (const f of [-0.45, 0.15]) ctx.fillRect(r * f, -r * 0.16, r * 0.14, r * 0.32);
    ctx.restore();
  }

  private debris(d: Debris): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(1, d.life / (DEBRIS_LIFE * 0.3));
    if (d.kind === "hat") {
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      this.hat(d.outfit, d.r);
    } else {
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      this.scarf(d.outfit, 0, 0, d.r, 1, false);
    }
    ctx.restore();
  }
}
