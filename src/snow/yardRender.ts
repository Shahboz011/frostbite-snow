/**
 * Draws snowballs, snowmen, thrown snowballs and the "grab here" hint on
 * their own canvas. Redrawn only when the yard says something changed.
 */
import { THROW_ANIM, type Ball, type Stack, type Yard } from "./yard";

const COAL = "#1f2228";
const TWIG = "#5b3d22";
const CARROT = "#f0862a";
const CARROT_EDGE = "#b85a12";

/** Overshooting ease for the accessory pop-in. */
function easeOutBack(t: number): number {
  const c = 1.7;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
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
    const empty = !y.stacks.length && !y.held && !y.falling.length && !y.shots.length && !y.armed;
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
      const raise = s.throwT > 0 ? Math.sin((1 - s.throwT / THROW_ANIM) * Math.PI) : 0;
      this.arm(yard, s, -1, s.throwSide === -1 ? raise : 0, pop);
      this.arm(yard, s, 1, s.throwSide === 1 ? raise : 0, pop);
    }
    for (const b of s.balls) this.ball(b);
    if (snowman && pop > 0) this.face(s, pop);
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
    const dot = (x: number, y: number, rad: number) => {
      ctx.beginPath();
      ctx.arc(x, y, rad * pop, 0, Math.PI * 2);
      ctx.fill();
    };
    ctx.fillStyle = COAL;
    // Eyes, shifted slightly toward where he's looking.
    const look = s.face * r * 0.08;
    dot(t.x - r * 0.3 + look, t.y - r * 0.22, r * 0.11);
    dot(t.x + r * 0.3 + look, t.y - r * 0.22, r * 0.11);
    // Smile.
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.22 + i * 0.14);
      dot(t.x + look + Math.cos(a) * r * 0.48, t.y + r * 0.02 + Math.sin(a) * r * 0.4, r * 0.055);
    }
    // Buttons.
    for (let i = 0; i < 3; i++) dot(m.x, m.y - m.r * 0.5 + i * m.r * 0.45, m.r * 0.08);
    // Carrot nose, pointing at the cursor's side.
    const nx = t.x + look;
    const ny = t.y + r * 0.02;
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
}
