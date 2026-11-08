/**
 * Settled snow lives on its own 2D canvas under the falling flakes. It's
 * redrawn only where something changed (a dirty column span or a moved
 * ledge's box), so a still desktop with full piles costs nothing to draw.
 */
import { Ledge, LedgeSet } from "./ledges";

const MIN_H = 0.35;
const ICICLE_GRADIENT_LEN = 18;

export class PileRenderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private full = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: true })!;
  }

  resize(pxWidth: number, pxHeight: number, layoutToCanvas: number): void {
    this.canvas.width = pxWidth;
    this.canvas.height = pxHeight;
    this.scale = layoutToCanvas;
    this.full = true;
  }

  /** Redraw changed regions. Returns true if anything was drawn. */
  render(set: LedgeSet): boolean {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (this.full) {
      this.full = false;
      ctx.clearRect(0, 0, this.canvas.width / this.scale, this.canvas.height / this.scale);
      for (const l of set.list) this.drawLedge(l);
      set.boxes.length = 0;
      for (const l of set.list) l.d1 = -1, (l.d0 = 1 << 30);
      return true;
    }
    let drew = false;
    const b = set.boxes;
    for (let i = 0; i < b.length; i += 4) {
      this.redrawBox(set, b[i], b[i + 1], b[i + 2], b[i + 3]);
      drew = true;
    }
    b.length = 0;
    for (const l of set.list) {
      if (l.d1 < l.d0) continue;
      const pad = 3 * l.scale;
      this.redrawBox(
        set,
        l.x + (l.d0 - 2) * l.colW,
        l.y - l.maxH - pad,
        (l.d1 - l.d0 + 5) * l.colW,
        l.maxH + pad + l.below,
      );
      l.d0 = 1 << 30;
      l.d1 = -1;
      drew = true;
    }
    return drew;
  }

  private redrawBox(set: LedgeSet, x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    // Snap to whole canvas pixels so clearRect leaves no antialiased seams.
    const s = this.scale;
    const x0 = Math.floor(x * s) / s;
    const y0 = Math.floor(y * s) / s;
    const x1 = Math.ceil((x + w) * s) / s;
    const y1 = Math.ceil((y + h) * s) / s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    for (const l of set.list) {
      const pad = 4 * l.scale;
      if (l.x + l.width + pad < x0 || l.x - pad > x1 || l.y + l.below < y0 || l.y - l.maxH - pad > y1) continue;
      this.drawLedge(l);
    }
    ctx.restore();
  }

  private drawLedge(l: Ledge): void {
    const ctx = this.ctx;
    const h = l.h;
    const m = l.mask;
    const cw = l.colW;
    const base = l.y + 0.5; // tuck the pile half a pixel onto the edge: no gap
    let open = false;
    let any = false;
    ctx.beginPath();
    for (let c = 0; c < l.cols; c++) {
      const vis = m[c] === 1 && h[c] > MIN_H;
      const cx = l.x + (c + 0.5) * cw;
      if (vis) {
        if (!open) {
          ctx.moveTo(l.x + c * cw, base);
          open = true;
          any = true;
        }
        ctx.lineTo(cx, l.y - h[c]);
      } else if (open) {
        ctx.lineTo(l.x + c * cw, base);
        ctx.closePath();
        open = false;
      }
    }
    if (open) {
      ctx.lineTo(l.x + l.cols * cw, base);
      ctx.closePath();
    }
    if (!any) return;
    const g = ctx.createLinearGradient(0, l.y - l.maxH, 0, base);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.7, "#f3f7fc");
    g.addColorStop(1, "#cfdbea");
    ctx.fillStyle = g;
    ctx.fill();
    // Thin cool outline: keeps piles readable on white windows.
    ctx.lineWidth = 1.25 * l.scale;
    ctx.strokeStyle = "rgba(92, 115, 150, 0.75)";
    ctx.lineJoin = "round";
    ctx.stroke();
    if (l.hang) this.drawIcicles(l);
  }

  /** Icicles hanging from the taskbar's top edge; length tracks the snow above. */
  private drawIcicles(l: Ledge): void {
    const ctx = this.ctx;
    const k = l.scale;
    ctx.beginPath();
    let any = false;
    for (let i = 0; i < l.icCol.length; i++) {
      const len = l.icicleLength(i);
      if (len < 2 * k) continue;
      const cx = l.x + (l.icCol[i] + 0.5) * l.colW;
      const hw = (1.6 + len * 0.12) * l.icW[i] * k;
      ctx.moveTo(cx - hw, l.y);
      ctx.quadraticCurveTo(cx - hw * 0.35, l.y + len * 0.55, cx, l.y + len);
      ctx.quadraticCurveTo(cx + hw * 0.35, l.y + len * 0.55, cx + hw, l.y);
      ctx.closePath();
      any = true;
    }
    if (!any) return;
    const g = ctx.createLinearGradient(0, l.y, 0, l.y + ICICLE_GRADIENT_LEN * k);
    g.addColorStop(0, "rgba(240, 248, 255, 0.95)");
    g.addColorStop(1, "rgba(190, 220, 250, 0.45)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 0.8 * k;
    ctx.strokeStyle = "rgba(150, 185, 225, 0.8)";
    ctx.stroke();
  }
}
