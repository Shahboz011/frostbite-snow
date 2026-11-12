/**
 * Draws Santa's flight, the sparkle trail, gifts and gift bursts on their own
 * canvas. Redrawn only while something changes.
 */
import { GIFT_COLORS, type Gift, type Santa } from "./santa";
import { drawSantaTeam } from "./santaRender";

const GIFT_SIZE = 20;

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const t = f < 0 ? 0 : 255;
  const a = Math.abs(f);
  const ch = (v: number) => Math.round(v + (t - v) * a);
  return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

export class SantaLayer {
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

  render(s: Santa): void {
    const ctx = this.ctx;
    const empty = !s.flight && !s.gifts.length && !s.sparks.length && !s.bursts.length;
    if (empty && !this.hadContent) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.hadContent = !empty;
    if (empty) return;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);

    for (const g of s.gifts) this.gift(g, s.time);

    ctx.globalCompositeOperation = "lighter";
    for (const p of s.sparks) {
      const tw = 0.65 + 0.35 * Math.sin(s.time * 18 + p.x * 0.1);
      ctx.fillStyle = `rgba(${p.color}, ${Math.min(1, p.life) * tw})`;
      if (p.star) this.star(p.x, p.y, p.size * 3 * p.life);
      else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + p.life * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";

    if (s.flight) drawSantaTeam(ctx, s.flight.x, s.flight.y, s.flight.k, s.time);

    for (const b of s.bursts) {
      const u = b.t / 1.8;
      const rise = (1 - Math.pow(1 - Math.min(1, b.t / 0.6), 3)) * 46 * b.k;
      const pop = b.t < 0.25 ? b.t / 0.25 : 1;
      const alpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      const size = 30 * b.k * (0.6 + 0.4 * pop) * (1 + Math.sin(Math.min(1, b.t / 0.35) * Math.PI) * 0.25);
      // Soft glow behind the prize.
      const gy = b.y - rise;
      const glow = ctx.createRadialGradient(b.x, gy, 0, b.x, gy, size * 1.4);
      glow.addColorStop(0, `rgba(255, 236, 170, ${0.55 * alpha})`);
      glow.addColorStop(1, "rgba(255, 236, 170, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(b.x, gy, size * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.font = `${Math.round(size)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.prize, b.x, gy);
      ctx.globalAlpha = 1;
    }
  }

  private star(x: number, y: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rr = i % 2 ? r * 0.28 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  private gift(g: Gift, time: number): void {
    const ctx = this.ctx;
    const k = g.k;
    const s = GIFT_SIZE * k;
    const [box, rib] = GIFT_COLORS[g.color];
    const fade = g.age > 9 * 60 - 2 ? Math.max(0, (9 * 60 - g.age) / 2) : 1;
    const wob = g.hover * Math.sin(time * 14) * 0.08;
    const sq = g.squash;
    const sx = 1 + sq * 0.18;
    const sy = 1 - sq * 0.16;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rot + wob);
    ctx.scale(sx * (1 + g.hover * 0.08), sy * (1 + g.hover * 0.08));

    // Hover glow so it reads as clickable.
    if (g.hover > 0.02) {
      const glow = ctx.createRadialGradient(0, -s / 2, 0, 0, -s / 2, s * 1.2);
      glow.addColorStop(0, `rgba(255, 230, 150, ${0.45 * g.hover})`);
      glow.addColorStop(1, "rgba(255, 230, 150, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-s * 1.2, -s * 1.7, s * 2.4, s * 2.4);
    }

    // Contact shadow.
    if (g.landed) {
      ctx.fillStyle = "rgba(10, 20, 40, 0.25)";
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.6, s * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Box: lit front, darker side.
    const gr = ctx.createLinearGradient(-s / 2, -s, s / 2, 0);
    gr.addColorStop(0, shade(box, 0.25));
    gr.addColorStop(1, shade(box, -0.3));
    ctx.fillStyle = gr;
    ctx.fillRect(-s / 2, -s, s, s);
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(s / 2 - s * 0.18, -s, s * 0.18, s);
    // Lid.
    ctx.fillStyle = shade(box, 0.12);
    ctx.fillRect(-s / 2 - s * 0.06, -s - s * 0.08, s * 1.12, s * 0.24);
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.fillRect(-s / 2 - s * 0.06, -s - s * 0.08, s * 1.12, s * 0.05);
    // Ribbon.
    ctx.fillStyle = rib;
    ctx.fillRect(-s * 0.08, -s - s * 0.08, s * 0.16, s * 1.08);
    ctx.fillRect(-s / 2, -s * 0.58, s, s * 0.14);
    // Bow.
    ctx.beginPath();
    ctx.ellipse(-s * 0.17, -s * 1.14, s * 0.2, s * 0.12, 0.5, 0, Math.PI * 2);
    ctx.ellipse(s * 0.17, -s * 1.14, s * 0.2, s * 0.12, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(rib, -0.25);
    ctx.beginPath();
    ctx.arc(0, -s * 1.1, s * 0.07, 0, Math.PI * 2);
    ctx.fill();
    // Snow cap on the lid once it has landed.
    if (g.landed) {
      ctx.fillStyle = "rgba(250, 252, 255, 0.95)";
      ctx.beginPath();
      ctx.ellipse(-s * 0.28, -s - s * 0.07, s * 0.22, s * 0.06, 0, Math.PI, 0);
      ctx.ellipse(s * 0.3, -s - s * 0.07, s * 0.18, s * 0.05, 0, Math.PI, 0);
      ctx.fill();
    }
    ctx.restore();
  }
}
