/**
 * Santa's sleigh and reindeer team, painted with Canvas2D. The team faces left
 * (it flies right → left). Origin is the sleigh's center; units are layout px
 * at k = 1.
 *
 * Static parts (reindeer bodies, Santa, sack, sleigh) are painted once per
 * device scale into offscreen layers with lighting, fur texture, rim light and
 * a soft shadow; each frame only blits those and draws the moving bits (legs,
 * waving arm, hat, reins, lantern).
 */

type Pt = [number, number];
type Box = [number, number, number, number]; // x, y, w, h
type G = CanvasRenderingContext2D;

const NIGHT = "#16243a";
const GOLD_LIGHT = "#fff3c4";
const GOLD = "#e3a935";
const GOLD_DARK = "#7a4c0c";
const SUIT = "#c81f2e";
const LEATHER = "#4a2410";
const RIM = "rgba(200, 222, 255, 0.55)";

const GALLOP = 6.2; // rad/s

// ---------------------------------------------------------------- helpers

function mix(a: string, b: string, f: number): string {
  const p = parseInt(a.slice(1), 16);
  const q = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((p >> s) & 255) * (1 - f) + ((q >> s) & 255) * f);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Layer {
  c: HTMLCanvasElement;
  g: G;
}

function layer(scale: number, box: Box): Layer {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(box[2] * scale));
  c.height = Math.max(1, Math.ceil(box[3] * scale));
  const g = c.getContext("2d")!;
  g.setTransform(scale, 0, 0, scale, -box[0] * scale, -box[1] * scale);
  g.lineCap = "round";
  g.lineJoin = "round";
  return { c, g };
}

interface Sprite {
  c: HTMLCanvasElement;
  box: Box;
}

const sprites = new Map<string, Sprite>();

/** Paint once per (key, scale), with an optional soft drop shadow and night tint. */
function sprite(
  key: string,
  scale: number,
  box: Box,
  paint: (g: G, scale: number) => void,
  opts: { shadow?: boolean; tint?: number } = {},
): Sprite {
  const id = `${key}@${scale}`;
  const hit = sprites.get(id);
  if (hit) return hit;
  if (sprites.size > 40) sprites.clear();
  const inner = layer(scale, box);
  paint(inner.g, scale);
  if (opts.tint) {
    inner.g.globalCompositeOperation = "source-atop";
    inner.g.fillStyle = NIGHT;
    inner.g.globalAlpha = opts.tint;
    inner.g.fillRect(box[0], box[1], box[2], box[3]);
  }
  const out = layer(scale, box);
  out.g.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.shadow) {
    out.g.shadowColor = "rgba(4, 10, 24, 0.32)";
    out.g.shadowBlur = 3.5 * scale;
    out.g.shadowOffsetX = 1 * scale;
    out.g.shadowOffsetY = 2.5 * scale;
  }
  out.g.drawImage(inner.c, 0, 0);
  const s = { c: out.c, box };
  sprites.set(id, s);
  return s;
}

function blit(ctx: G, s: Sprite): void {
  ctx.drawImage(s.c, s.box[0], s.box[1], s.box[2], s.box[3]);
}

/** Thin light crescent along the edges facing the light (upper right). */
function rimLight(g: G, scale: number, box: Box, path: Path2D, color = RIM, dx = -1.4, dy = 1.8): void {
  const L = layer(scale, box);
  L.g.fillStyle = color;
  L.g.fill(path);
  L.g.globalCompositeOperation = "destination-out";
  L.g.translate(dx, dy);
  L.g.fillStyle = "#000";
  L.g.fill(path);
  // Soften, but keep it inside the shape.
  g.save();
  g.clip(path);
  g.filter = `blur(${0.5 * scale}px)`;
  g.drawImage(L.c, box[0], box[1], box[2], box[3]);
  g.restore();
}

/** Soft, blurred stroke (muscle lines, folds). */
function softStroke(g: G, scale: number, color: string, width: number, blur: number, draw: () => void): void {
  g.save();
  g.filter = `blur(${blur * scale}px)`;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  draw();
  g.stroke();
  g.restore();
}

function radial(g: G, x: number, y: number, r: number, color: string, alpha: number): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color.replace("ALPHA", String(alpha)));
  gr.addColorStop(1, color.replace("ALPHA", "0"));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** A tapered polyline: one trapezoid per segment plus round joints. */
function taper(g: G, pts: Pt[], widths: number[], color: string | CanvasGradient): void {
  g.fillStyle = color;
  const p = new Path2D();
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    const w0 = widths[i] / 2;
    const w1 = widths[i + 1] / 2;
    // Same winding as the joint arcs so nonzero fill never cancels overlaps.
    p.moveTo(x0 - nx * w0, y0 - ny * w0);
    p.lineTo(x1 - nx * w1, y1 - ny * w1);
    p.lineTo(x1 + nx * w1, y1 + ny * w1);
    p.lineTo(x0 + nx * w0, y0 + ny * w0);
    p.closePath();
    p.moveTo(x1 + w1, y1);
    p.arc(x1, y1, w1, 0, Math.PI * 2);
  }
  p.moveTo(pts[0][0] + widths[0] / 2, pts[0][1]);
  p.arc(pts[0][0], pts[0][1], widths[0] / 2, 0, Math.PI * 2);
  g.fill(p, "nonzero");
}

/** Walk (angle, length) segments; angle 0 = straight down, + = forward (left). */
function chain(x: number, y: number, segs: [number, number][]): Pt[] {
  const pts: Pt[] = [[x, y]];
  for (const [a, len] of segs) {
    x -= Math.sin(a) * len;
    y += Math.cos(a) * len;
    pts.push([x, y]);
  }
  return pts;
}

/** Fluffy fur along a polyline: shadowed puffs with a bright core. */
function fluff(g: G, pts: Pt[], r: number, seed = 1): void {
  const rnd = rng(seed);
  const dots: [number, number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (r * 0.55)));
    for (let j = 0; j < n; j++) {
      dots.push([x0 + ((x1 - x0) * j) / n, y0 + ((y1 - y0) * j) / n, r * (0.75 + rnd() * 0.4)]);
    }
  }
  const [lx, ly] = pts[pts.length - 1];
  dots.push([lx, ly, r]);
  g.fillStyle = "#aab3c2";
  for (const [x, y, rr] of dots) {
    g.beginPath();
    g.arc(x + 0.5, y + 0.9, rr, 0, Math.PI * 2);
    g.fill();
  }
  for (const [x, y, rr] of dots) {
    const gr = g.createRadialGradient(x - rr * 0.35, y - rr * 0.4, 0, x, y, rr);
    gr.addColorStop(0, "#ffffff");
    gr.addColorStop(0.7, "#f1f3f7");
    gr.addColorStop(1, "#d3d9e3");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, rr * 0.92, 0, Math.PI * 2);
    g.fill();
  }
}

function goldGrad(g: G, y0: number, y1: number): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, GOLD_LIGHT);
  gr.addColorStop(0.35, "#f5cf63");
  gr.addColorStop(0.6, GOLD);
  gr.addColorStop(1, GOLD_DARK);
  return gr;
}

function deviceScale(ctx: G): number {
  const m = ctx.getTransform();
  const s = Math.hypot(m.a, m.b);
  return Math.max(0.5, Math.min(6, Math.ceil(s * 4) / 4));
}

// ---------------------------------------------------------------- reindeer

let _deer: Path2D | null = null;
function deerPath(): Path2D {
  if (_deer) return _deer;
  const p = new Path2D();
  p.moveTo(30, -14);
  p.bezierCurveTo(12, -19, -8, -18, -22, -19.5);
  p.bezierCurveTo(-30, -21, -38, -30, -42, -40);
  p.bezierCurveTo(-44, -44.5, -50, -46.5, -54.5, -43.5);
  p.bezierCurveTo(-58.5, -40.5, -64, -35, -67.5, -31.5);
  p.bezierCurveTo(-70, -28.5, -68.5, -25, -64.5, -24.5);
  p.bezierCurveTo(-60, -24, -56, -25, -52, -26);
  p.bezierCurveTo(-48.5, -26.5, -46.5, -27, -45.5, -25);
  p.bezierCurveTo(-44.5, -16, -42.5, -6, -40.5, 2);
  p.bezierCurveTo(-39.5, 8, -34, 13, -26, 13);
  p.bezierCurveTo(-12, 12.5, 8, 10, 20, 11);
  p.bezierCurveTo(30, 12, 38.5, 6, 38.5, -2);
  p.bezierCurveTo(38.5, -9, 35, -13, 30, -14);
  p.closePath();
  _deer = p;
  return p;
}

function antler(g: G, dx: number, dy: number, base: string, tip: string): void {
  g.save();
  g.translate(dx, dy);
  const gr = g.createLinearGradient(0, -42, 0, -104);
  gr.addColorStop(0, base);
  gr.addColorStop(1, tip);
  const T = (pts: Pt[], w: number[]) => taper(g, pts, w, gr);
  T([[-46, -41], [-44, -55], [-38.5, -68], [-34.5, -82], [-36, -94], [-42, -101]], [5, 4.3, 3.6, 3, 2.1, 1]);
  T([[-46, -46], [-53, -50], [-60, -54.5]], [3.2, 2.5, 1.2]);
  T([[-53, -50], [-58, -46]], [2.1, 1]);
  T([[-43, -57], [-50.5, -62], [-54.5, -69.5]], [2.8, 2, 1]);
  T([[-37.5, -71], [-29.5, -75], [-24, -82.5]], [2.6, 1.9, 0.9]);
  T([[-35, -88], [-28.5, -93.5], [-25, -100.5]], [2.2, 1.5, 0.8]);
  T([[-36.5, -95], [-33, -103]], [1.7, 0.8]);
  g.restore();
}

function paintDeer(g: G, scale: number): void {
  const box: Box = [-82, -112, 132, 136];
  const body = deerPath();

  // Far antler, behind the head.
  antler(g, 6, 1.5, "#3e2a18", "#8f7a5c");

  // Base coat.
  g.fillStyle = "#7a5131";
  g.fill(body);

  g.save();
  g.clip(body);
  // Dark back → mid → pale belly.
  let gr = g.createLinearGradient(0, -22, 0, 14);
  gr.addColorStop(0, "rgba(36, 20, 8, 0.75)");
  gr.addColorStop(0.35, "rgba(60, 35, 15, 0.25)");
  gr.addColorStop(0.6, "rgba(0, 0, 0, 0)");
  gr.addColorStop(0.82, "rgba(225, 205, 170, 0.55)");
  gr.addColorStop(1, "rgba(240, 228, 205, 0.95)");
  g.fillStyle = gr;
  g.fillRect(-80, -50, 125, 70);
  // Head: darker face, pale grey-brown muzzle.
  gr = g.createLinearGradient(-44, -44, -66, -28);
  gr.addColorStop(0, "rgba(40, 22, 10, 0.55)");
  gr.addColorStop(0.7, "rgba(40, 22, 10, 0.15)");
  gr.addColorStop(1, "rgba(200, 180, 155, 0.5)");
  g.fillStyle = gr;
  g.fillRect(-72, -48, 30, 26);
  // Neck: pale throat side.
  gr = g.createLinearGradient(-30, -24, -46, -10);
  gr.addColorStop(0, "rgba(0,0,0,0)");
  gr.addColorStop(1, "rgba(230, 215, 190, 0.45)");
  g.fillStyle = gr;
  g.fillRect(-50, -40, 26, 50);
  // Muscle light and shadow.
  radial(g, -25, -6, 15, "rgba(255, 220, 180, ALPHA)", 0.28);
  radial(g, 24, -5, 14, "rgba(255, 220, 180, ALPHA)", 0.24);
  radial(g, -37, -22, 9, "rgba(255, 220, 180, ALPHA)", 0.18);
  radial(g, 36, -4, 8, "rgba(245, 235, 220, ALPHA)", 0.6); // pale rump
  softStroke(g, scale, "rgba(30, 15, 5, 0.35)", 2.6, 1.6, () => {
    g.moveTo(-14, -12);
    g.quadraticCurveTo(-12, 0, -20, 9); // behind the shoulder
    g.moveTo(12, -14);
    g.quadraticCurveTo(10, 0, 16, 10); // flank
    g.moveTo(-36, -6);
    g.quadraticCurveTo(-30, 0, -30, 10); // chest
  });
  softStroke(g, scale, "rgba(20, 10, 4, 0.4)", 3, 2, () => {
    g.moveTo(-50, -38);
    g.quadraticCurveTo(-56, -36, -60, -31);
  });
  // Fur texture: short strokes flowing back along the body, down the neck.
  const rnd = rng(7);
  g.lineWidth = 0.55;
  for (let i = 0; i < 900; i++) {
    const x = -70 + rnd() * 110;
    const y = -48 + rnd() * 62;
    const neck = x < -30 && y < 0;
    const a = neck ? 1.15 + rnd() * 0.4 : 0.25 + rnd() * 0.35;
    const len = 1.8 + rnd() * 2.6;
    g.strokeStyle = rnd() < 0.5 ? "rgba(255, 228, 195, 0.13)" : "rgba(30, 14, 4, 0.18)";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  g.restore();

  // Shaggy pale mane hanging off the throat.
  const mane = new Path2D();
  const rm = rng(3);
  mane.moveTo(-46, -27);
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    const bx = -46 + f * 7;
    const by = -27 + f * 34;
    const out = 4 + Math.sin(f * Math.PI) * 4;
    mane.lineTo(bx - out - rm() * 2.5, by + 1.5);
    mane.lineTo(bx - out * 0.45, by + 2.8);
  }
  mane.lineTo(-34, 8);
  mane.lineTo(-38, -4);
  mane.lineTo(-42, -18);
  mane.closePath();
  gr = g.createLinearGradient(-50, -26, -40, 10);
  gr.addColorStop(0, "#e9dfcc");
  gr.addColorStop(1, "#c9b597");
  g.fillStyle = gr;
  g.fill(mane);
  g.strokeStyle = "rgba(120, 100, 75, 0.45)";
  g.lineWidth = 0.6;
  for (let i = 0; i < 16; i++) {
    const f = i / 16;
    const x = -46 + f * 7 - 2;
    const y = -25 + f * 32;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x - 3, y + 3, x - 4 - rm() * 2, y + 5);
    g.stroke();
  }

  // Harness: back pad, girth and side strap, clipped to the body.
  g.save();
  g.clip(body);
  const leather = g.createLinearGradient(0, -20, 0, 14);
  leather.addColorStop(0, "#d8303e");
  leather.addColorStop(1, "#7a0f19");
  g.fillStyle = leather;
  g.save();
  g.translate(4, -3);
  g.rotate(0.07);
  g.fillRect(-3.5, -18, 7, 34);
  g.fillStyle = goldGrad(g, -18, 16);
  g.fillRect(-3.5, -18, 0.8, 34);
  g.fillRect(2.7, -18, 0.8, 34);
  g.restore();
  g.strokeStyle = leather;
  g.lineWidth = 3.2;
  g.beginPath();
  g.moveTo(-38, -5);
  g.quadraticCurveTo(0, -2, 39, -5);
  g.stroke();
  g.fillStyle = GOLD_LIGHT;
  for (const bx of [-24, -14, 16, 26, 34]) {
    g.beginPath();
    g.arc(bx, -3.4 + Math.abs(bx) * 0.012, 1.1, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  // Saddle pad on top of the back.
  g.fillStyle = leather;
  g.beginPath();
  g.ellipse(4, -17.5, 9, 3.6, 0.04, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = goldGrad(g, -21, -14);
  g.lineWidth = 0.9;
  g.stroke();
  g.fillStyle = goldGrad(g, -24, -19);
  g.beginPath();
  g.arc(4, -21, 1.8, 0, Math.PI * 2);
  g.fill();

  // Padded collar with bells.
  g.lineCap = "round";
  g.strokeStyle = "#5a0a12";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(-27, -21);
  g.quadraticCurveTo(-34, -8, -45, -2);
  g.stroke();
  g.strokeStyle = leather;
  g.lineWidth = 5.6;
  g.stroke();
  g.strokeStyle = goldGrad(g, -24, 0);
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(-25.4, -22);
  g.quadraticCurveTo(-32.5, -9, -44, -4.6);
  g.moveTo(-28.8, -19.6);
  g.quadraticCurveTo(-35.5, -6.5, -45.8, 0.4);
  g.stroke();
  for (const [bx, by] of [[-31, -10], [-35.5, -5], [-40.5, -1], [-27.5, -15]] as Pt[]) {
    const b = g.createRadialGradient(bx - 1, by - 1, 0.2, bx, by + 1.5, 3.2);
    b.addColorStop(0, GOLD_LIGHT);
    b.addColorStop(0.5, GOLD);
    b.addColorStop(1, GOLD_DARK);
    g.fillStyle = b;
    g.beginPath();
    g.arc(bx, by + 2.5, 2.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#3a2405";
    g.beginPath();
    g.arc(bx, by + 4, 0.7, 0, Math.PI * 2);
    g.fill();
  }

  // Ear.
  const ear = new Path2D();
  ear.moveTo(-44, -38);
  ear.quadraticCurveTo(-38, -50.5, -29, -49.5);
  ear.quadraticCurveTo(-33.5, -41, -41, -35.5);
  ear.closePath();
  g.fillStyle = "#5d3b21";
  g.fill(ear);
  g.fillStyle = "rgba(220, 190, 165, 0.75)";
  g.beginPath();
  g.moveTo(-42.2, -38.6);
  g.quadraticCurveTo(-37, -47.5, -31.5, -48);
  g.quadraticCurveTo(-35, -42, -40.5, -37.5);
  g.fill();

  // Eye with pale eye ring and lid.
  radial(g, -53, -36.5, 4.6, "rgba(230, 215, 190, ALPHA)", 0.55);
  g.fillStyle = "#0b0603";
  g.beginPath();
  g.ellipse(-53, -36.8, 2.6, 1.9, -0.32, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#4a2a14";
  g.beginPath();
  g.ellipse(-53.6, -36.6, 1.1, 1.1, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255, 255, 255, 0.9)";
  g.beginPath();
  g.arc(-54.1, -37.6, 0.6, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(20, 10, 4, 0.8)";
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(-50.2, -38.2);
  g.quadraticCurveTo(-53, -39.8, -55.9, -37.6);
  g.stroke();

  // Muzzle, nose leather, nostril, mouth.
  radial(g, -63, -28, 6.5, "rgba(205, 190, 170, ALPHA)", 0.6);
  const nose = g.createRadialGradient(-68.4, -30.6, 0.2, -67.6, -29.6, 3.4);
  nose.addColorStop(0, "#5a4a44");
  nose.addColorStop(1, "#1b1210");
  g.fillStyle = nose;
  g.beginPath();
  g.ellipse(-67.4, -29.4, 2.9, 2.5, 0.25, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#0a0605";
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(-68.6, -29.8);
  g.quadraticCurveTo(-67.6, -28.5, -66.3, -28.9);
  g.stroke();
  g.strokeStyle = "rgba(30, 15, 8, 0.7)";
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(-66.5, -25.6);
  g.quadraticCurveTo(-62, -24.9, -58.5, -25.9);
  g.stroke();

  // Near antler with a bone highlight.
  antler(g, 0, 0, "#5a3c22", "#d8c39c");
  g.strokeStyle = "rgba(255, 245, 225, 0.5)";
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(-46.6, -44);
  g.lineTo(-44.8, -55);
  g.lineTo(-39.4, -68);
  g.lineTo(-35.5, -82);
  g.lineTo(-37, -93);
  g.stroke();

  // Tail tuft.
  g.fillStyle = "#efe7d8";
  g.beginPath();
  g.ellipse(38.5, -10, 5, 2.8, -0.7, 0, Math.PI * 2);
  g.fill();

  rimLight(g, scale, box, body);
  g.strokeStyle = "rgba(18, 8, 2, 0.45)";
  g.lineWidth = 0.7;
  g.stroke(body);
}

interface DeerSlot {
  x: number;
  y: number;
  phase: number;
  far: boolean;
  lead: boolean;
}

const TEAM: DeerSlot[] = [
  { x: -138, y: -18, phase: 1.1, far: true, lead: false },
  { x: -240, y: -29, phase: 2.5, far: true, lead: false },
  { x: -152, y: -4, phase: 0.0, far: false, lead: false },
  { x: -254, y: -15, phase: 1.8, far: false, lead: false },
  { x: -358, y: -27, phase: 0.7, far: false, lead: true },
];

const COLLAR: Pt = [-40, -6];

function deerBob(d: DeerSlot, t: number): number {
  return Math.sin(t * GALLOP + d.phase) * 3;
}

function legGrad(g: G, a: Pt, b: Pt, top: string, sock: string): CanvasGradient {
  const gr = g.createLinearGradient(a[0], a[1], b[0], b[1]);
  gr.addColorStop(0, top);
  gr.addColorStop(0.55, top);
  gr.addColorStop(0.85, sock);
  gr.addColorStop(1, sock);
  return gr;
}

function hoof(g: G, p: Pt, a: number, dim: number): void {
  g.save();
  g.translate(p[0], p[1]);
  g.rotate(-a);
  g.fillStyle = mix("#e6dccb", NIGHT, dim);
  g.beginPath();
  g.ellipse(0, -0.5, 3.2, 2.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = mix("#2b2420", NIGHT, dim);
  g.beginPath();
  g.moveTo(-3.6, 1);
  g.quadraticCurveTo(0, 5.2, 3.6, 1);
  g.quadraticCurveTo(0, 2.2, -3.6, 1);
  g.fill();
  g.restore();
}

function frontLeg(g: G, u: number, dim: number): void {
  const a1 = 0.3 + 0.95 * u;
  const a2 = -1.5 + 2.85 * u;
  const a3 = a2 - 0.5 * (1 - u) - 0.1;
  const pts = chain(-27, 5, [[a1, 15], [a2, 13], [a3, 5]]);
  const top = mix("#5f3b20", NIGHT, dim);
  const sock = mix("#d9ccb5", NIGHT, dim);
  taper(g, pts, [11, 5.6, 4, 3.4], legGrad(g, pts[0], pts[3], top, sock));
  // Knee highlight.
  g.fillStyle = `rgba(255, 225, 190, ${0.18 * (1 - dim)})`;
  g.beginPath();
  g.arc(pts[1][0], pts[1][1], 2.4, 0, Math.PI * 2);
  g.fill();
  hoof(g, pts[3], a3, dim);
}

function hindLeg(g: G, u: number, dim: number): void {
  const a1 = 0.45 - 1.65 * u;
  const a2 = -0.5 - 0.85 * u;
  const a3 = a2 + 0.4;
  const pts = chain(25, 6, [[a1, 15], [a2, 15], [a3, 5]]);
  const top = mix("#5f3b20", NIGHT, dim);
  const sock = mix("#d9ccb5", NIGHT, dim);
  taper(g, pts, [13, 5.6, 4, 3.4], legGrad(g, pts[0], pts[3], top, sock));
  hoof(g, pts[3], a3, dim);
}

function reindeer(ctx: G, t: number, d: DeerSlot, scale: number): void {
  const w = t * GALLOP + d.phase;
  const s = Math.sin(w);
  const u = (s + 1) / 2;
  const uFar = (Math.sin(w - 0.45) + 1) / 2;
  const dim = d.far ? 0.4 : 0;

  ctx.save();
  ctx.translate(d.x, d.y + deerBob(d, t));
  ctx.rotate(-0.03 + 0.05 * s);

  // Legs go under the body so it covers their tops.
  frontLeg(ctx, uFar, Math.max(dim, 0.28));
  hindLeg(ctx, uFar, Math.max(dim, 0.28));
  frontLeg(ctx, u, dim);
  hindLeg(ctx, u, dim);

  const spr = sprite(d.far ? "deer-far" : "deer", scale, [-82, -112, 132, 136], paintDeer, {
    shadow: true,
    tint: d.far ? 0.38 : 0,
  });
  blit(ctx, spr);

  if (d.lead) {
    const pulse = 0.7 + 0.3 * Math.sin(t * 4);
    const glow = ctx.createRadialGradient(-67.5, -29.5, 0, -67.5, -29.5, 20);
    glow.addColorStop(0, `rgba(255, 90, 70, ${0.65 * pulse})`);
    glow.addColorStop(0.35, `rgba(255, 60, 50, ${0.25 * pulse})`);
    glow.addColorStop(1, "rgba(255, 60, 50, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(-67.5, -29.5, 20, 0, Math.PI * 2);
    ctx.fill();
    const n = ctx.createRadialGradient(-68.6, -30.8, 0.3, -67.5, -29.5, 3.8);
    n.addColorStop(0, "#ffd0c4");
    n.addColorStop(0.3, "#ff4a3a");
    n.addColorStop(1, "#9a0d0a");
    ctx.fillStyle = n;
    ctx.beginPath();
    ctx.arc(-67.6, -29.5, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- sleigh

let _panel: Path2D | null = null;
function panelPath(): Path2D {
  if (_panel) return _panel;
  const p = new Path2D();
  p.moveTo(80, -52);
  p.quadraticCurveTo(90, -11, 70, 11);
  p.lineTo(-42, 11);
  p.quadraticCurveTo(-76, 8, -81, -20);
  p.quadraticCurveTo(-85, -44, -67, -44);
  p.quadraticCurveTo(-54, -43, -60, -31);
  p.quadraticCurveTo(-53, -18, -28, -18);
  p.lineTo(42, -18);
  p.quadraticCurveTo(59, -21, 62, -50);
  p.quadraticCurveTo(71, -58, 80, -52);
  p.closePath();
  _panel = p;
  return p;
}

function runner(g: G, dark: boolean): void {
  const path = () => {
    g.beginPath();
    g.moveTo(-30, 9);
    g.bezierCurveTo(-26, 15, -36, 20, -32, 27);
    g.moveTo(46, 9);
    g.bezierCurveTo(50, 15, 42, 20, 46, 27);
    g.moveTo(84, 27);
    g.quadraticCurveTo(94, 27, 95, 20);
    g.moveTo(86, 27);
    g.lineTo(-64, 27);
    g.bezierCurveTo(-90, 27, -102, 18, -100, 4);
    g.bezierCurveTo(-98, -6, -86, -6, -85, 1);
    g.bezierCurveTo(-84, 6, -91, 7, -91, 2);
  };
  g.strokeStyle = dark ? "#3a2406" : GOLD_DARK;
  g.lineWidth = 5.6;
  path();
  g.stroke();
  g.strokeStyle = dark ? mix(GOLD, NIGHT, 0.45) : goldGrad(g, -6, 30);
  g.lineWidth = 3.8;
  path();
  g.stroke();
  if (!dark) {
    g.strokeStyle = "rgba(255, 252, 230, 0.85)";
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(84, 25.6);
    g.lineTo(-64, 25.6);
    g.bezierCurveTo(-88, 25.6, -99.5, 17, -98.6, 4);
    g.stroke();
  }
}

function paintSleighBack(g: G): void {
  g.save();
  g.translate(9, -6);
  runner(g, true);
  g.restore();

  // Far wall's inner face, visible above the near panel.
  const wall = new Path2D();
  wall.moveTo(-60, -31);
  wall.quadraticCurveTo(-50, -25, -28, -25);
  wall.lineTo(44, -25);
  wall.quadraticCurveTo(60, -30, 65, -56);
  wall.quadraticCurveTo(73, -63, 84, -57);
  wall.lineTo(84, -10);
  wall.lineTo(-60, -10);
  wall.closePath();
  const gr = g.createLinearGradient(0, -60, 0, -10);
  gr.addColorStop(0, "#7a0f1a");
  gr.addColorStop(1, "#3a050b");
  g.fillStyle = gr;
  g.fill(wall);
  g.strokeStyle = mix(GOLD, NIGHT, 0.3);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-60, -31);
  g.quadraticCurveTo(-50, -25, -28, -25);
  g.lineTo(44, -25);
  g.quadraticCurveTo(60, -30, 65, -56);
  g.quadraticCurveTo(73, -63, 84, -57);
  g.stroke();

  // Green velvet seat back with tufting.
  const cush = g.createLinearGradient(40, -52, 80, -18);
  cush.addColorStop(0, "#2f7a4f");
  cush.addColorStop(1, "#0f3a22");
  g.fillStyle = cush;
  g.beginPath();
  g.moveTo(40, -20);
  g.quadraticCurveTo(52, -44, 70, -54);
  g.quadraticCurveTo(80, -50, 80, -20);
  g.closePath();
  g.fill();
  g.fillStyle = "#c9a548";
  for (const [bx, by] of [[58, -38], [70, -44], [70, -30], [58, -26]] as Pt[]) {
    g.beginPath();
    g.arc(bx, by, 1, 0, Math.PI * 2);
    g.fill();
  }
}

function paintSleighFront(g: G, scale: number): void {
  const box: Box = [-112, -72, 222, 108];
  const panel = panelPath();
  runner(g, false);

  // Lacquered red panel.
  let gr = g.createLinearGradient(0, -58, 0, 12);
  gr.addColorStop(0, "#f2505e");
  gr.addColorStop(0.35, "#cf2233");
  gr.addColorStop(0.75, "#8c0f1d");
  gr.addColorStop(1, "#4a0610");
  g.fillStyle = gr;
  g.fill(panel);

  g.save();
  g.clip(panel);
  // Inset gold border: a wide gold stroke, then the lacquer over its outer part.
  g.strokeStyle = goldGrad(g, -55, 12);
  g.lineWidth = 10;
  g.stroke(panel);
  g.strokeStyle = gr;
  g.lineWidth = 7.4;
  g.stroke(panel);
  // Depth: darker toward the back, light from the front-top.
  const side = g.createLinearGradient(-80, 0, 90, 0);
  side.addColorStop(0, "rgba(255, 255, 255, 0.08)");
  side.addColorStop(0.6, "rgba(0, 0, 0, 0)");
  side.addColorStop(1, "rgba(30, 0, 5, 0.35)");
  g.fillStyle = side;
  g.fillRect(-90, -60, 180, 75);
  // Specular reflections.
  softStroke(g, scale, "rgba(255, 255, 255, 0.55)", 3, 1.4, () => {
    g.moveTo(-70, -12);
    g.quadraticCurveTo(-60, -4, -36, -6);
    g.lineTo(52, -6);
    g.quadraticCurveTo(66, -8, 72, -30);
  });
  softStroke(g, scale, "rgba(255, 255, 255, 0.35)", 6, 3, () => {
    g.moveTo(-76, -30);
    g.quadraticCurveTo(-76, -40, -68, -40);
  });
  g.restore();

  // Ornament: mirrored gold scrolls around a star medallion.
  const scrollAt = (cx: number, dir: number) => {
    g.beginPath();
    g.moveTo(cx, -2);
    g.bezierCurveTo(cx + dir * 10, -14, cx + dir * 24, -10, cx + dir * 26, -2);
    g.bezierCurveTo(cx + dir * 27, 3, cx + dir * 21, 5, cx + dir * 19, 1);
    g.bezierCurveTo(cx + dir * 18, -2, cx + dir * 22, -3, cx + dir * 22.5, -1);
    g.moveTo(cx + dir * 8, -6);
    g.bezierCurveTo(cx + dir * 14, 0, cx + dir * 30, 4, cx + dir * 40, -2);
    g.stroke();
  };
  for (const [stroke, off] of [["rgba(60, 20, 0, 0.55)", 0.8], [null, 0]] as const) {
    g.save();
    g.translate(off, off);
    g.strokeStyle = stroke ?? goldGrad(g, -14, 6);
    g.lineWidth = 1.5;
    scrollAt(6, -1);
    scrollAt(6, 1);
    g.restore();
  }
  const med = g.createRadialGradient(4, -6, 0.5, 6, -4, 7);
  med.addColorStop(0, GOLD_LIGHT);
  med.addColorStop(0.6, GOLD);
  med.addColorStop(1, GOLD_DARK);
  g.fillStyle = med;
  g.beginPath();
  g.ellipse(6, -4, 6.5, 6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#b3141f";
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 1.7 : 4.2;
    g.lineTo(6 + Math.cos(a) * r, -4 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();

  // Gold rim with a bright top edge.
  g.strokeStyle = GOLD_DARK;
  g.lineWidth = 4;
  g.stroke(panel);
  g.strokeStyle = goldGrad(g, -58, 12);
  g.lineWidth = 2.6;
  g.stroke(panel);

  // Front curl spiral.
  g.lineWidth = 2;
  g.strokeStyle = goldGrad(g, -48, -20);
  g.beginPath();
  for (let a = 0; a < Math.PI * 3.4; a += 0.15) {
    const r = 7.5 * (1 - a / (Math.PI * 3.8));
    const px = -69 + Math.cos(a + 0.3) * r;
    const py = -33 + Math.sin(a + 0.3) * r;
    if (a === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.stroke();

  rimLight(g, scale, box, panel, "rgba(255, 220, 220, 0.5)");
}

function lantern(ctx: G, t: number): void {
  ctx.strokeStyle = goldGrad(ctx, -62, -40);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-66, -42);
  ctx.bezierCurveTo(-72, -56, -84, -62, -94, -60);
  ctx.stroke();
  const sway = Math.sin(t * 3) * 0.14;
  ctx.save();
  ctx.translate(-93, -60);
  ctx.rotate(sway);
  ctx.strokeStyle = GOLD_DARK;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 4);
  ctx.stroke();
  const flicker = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3);
  const glow = ctx.createRadialGradient(0, 11, 0, 0, 11, 30);
  glow.addColorStop(0, `rgba(255, 205, 120, ${0.6 * flicker})`);
  glow.addColorStop(0.4, `rgba(255, 180, 80, ${0.18 * flicker})`);
  glow.addColorStop(1, "rgba(255, 180, 80, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 11, 30, 0, Math.PI * 2);
  ctx.fill();
  const flame = ctx.createRadialGradient(0, 11, 0, 0, 11, 5);
  flame.addColorStop(0, "#fffbe8");
  flame.addColorStop(0.5, `rgba(255, 214, 120, ${flicker})`);
  flame.addColorStop(1, "rgba(255, 150, 60, 0.6)");
  ctx.fillStyle = flame;
  ctx.fillRect(-3.4, 5.5, 6.8, 10);
  ctx.strokeStyle = goldGrad(ctx, 4, 16);
  ctx.lineWidth = 1.1;
  ctx.strokeRect(-3.4, 5.5, 6.8, 10);
  ctx.beginPath();
  ctx.moveTo(0, 5.5);
  ctx.lineTo(0, 15.5);
  ctx.stroke();
  ctx.fillStyle = goldGrad(ctx, 2, 6);
  ctx.beginPath();
  ctx.moveTo(-5, 5.6);
  ctx.lineTo(0, 1.8);
  ctx.lineTo(5, 5.6);
  ctx.fill();
  ctx.fillRect(-4.4, 15.3, 8.8, 2);
  ctx.restore();
}

// ---------------------------------------------------------------- sack

function paintSack(g: G, scale: number): void {
  // Candy cane and gifts poking out of the top.
  g.save();
  g.translate(50, -78);
  g.rotate(-0.35);
  taper(g, [[0, 10], [0, -14]], [3.4, 3.4], "#f6f2ea");
  g.strokeStyle = "#d4202f";
  g.lineWidth = 1.6;
  for (let y = 8; y > -14; y -= 4) {
    g.beginPath();
    g.moveTo(-1.7, y);
    g.lineTo(1.7, y - 2.4);
    g.stroke();
  }
  g.strokeStyle = "#f6f2ea";
  g.lineWidth = 3.4;
  g.beginPath();
  g.arc(-4.5, -14, 4.5, 0, Math.PI, true);
  g.stroke();
  g.restore();

  const gifts: [number, number, number, number, number, string, string][] = [
    [42, -83, 15, 13, -0.22, "#2f8f5b", "#f2c14e"],
    [61, -90, 13, 15, 0.12, "#3a6fd8", "#f7f4ee"],
    [74, -80, 12, 11, 0.4, "#f0b429", "#c8202e"],
  ];
  for (const [x, y, w, h, rot, col, rib] of gifts) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    gr.addColorStop(0, mix(col, "#ffffff", 0.3));
    gr.addColorStop(1, mix(col, "#000000", 0.4));
    g.fillStyle = gr;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = "rgba(0, 0, 0, 0.25)";
    g.fillRect(w / 2 - 3, -h / 2, 3, h);
    g.fillStyle = rib;
    g.fillRect(-1.5, -h / 2, 3, h);
    g.fillRect(-w / 2, -1.5, w, 3);
    g.beginPath();
    g.ellipse(-3, -h / 2 - 1.8, 3.4, 2, 0.5, 0, Math.PI * 2);
    g.ellipse(3, -h / 2 - 1.8, 3.4, 2, -0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255, 255, 255, 0.35)";
    g.fillRect(-w / 2, -h / 2, w, 1);
    g.restore();
  }

  const sack = new Path2D();
  sack.moveTo(32, -74);
  sack.bezierCurveTo(46, -67, 66, -67, 82, -76);
  sack.bezierCurveTo(95, -56, 93, -30, 80, -16);
  sack.lineTo(34, -16);
  sack.bezierCurveTo(22, -34, 22, -58, 32, -74);
  sack.closePath();
  g.fillStyle = "#8a6638";
  g.fill(sack);
  g.save();
  g.clip(sack);
  const shade = g.createRadialGradient(46, -56, 3, 58, -44, 44);
  shade.addColorStop(0, "rgba(255, 225, 170, 0.45)");
  shade.addColorStop(0.55, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(30, 15, 0, 0.6)");
  g.fillStyle = shade;
  g.fillRect(20, -80, 80, 66);
  // Burlap weave.
  g.lineWidth = 0.5;
  g.strokeStyle = "rgba(60, 40, 15, 0.16)";
  for (let x = 20; x < 100; x += 2.2) {
    g.beginPath();
    g.moveTo(x, -80);
    g.lineTo(x + 6, -14);
    g.stroke();
  }
  g.strokeStyle = "rgba(255, 235, 200, 0.1)";
  for (let y = -80; y < -14; y += 2.2) {
    g.beginPath();
    g.moveTo(20, y);
    g.lineTo(100, y - 3);
    g.stroke();
  }
  softStroke(g, scale, "rgba(40, 22, 5, 0.55)", 2.2, 1.4, () => {
    g.moveTo(44, -68);
    g.quadraticCurveTo(39, -48, 46, -26);
    g.moveTo(68, -69);
    g.quadraticCurveTo(75, -52, 70, -32);
    g.moveTo(57, -66);
    g.quadraticCurveTo(59, -58, 55, -50);
  });
  g.restore();
  // Twisted rope.
  g.strokeStyle = "#6d5426";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(33, -71);
  g.bezierCurveTo(48, -64, 64, -64, 81, -72.5);
  g.stroke();
  g.strokeStyle = "#e3cd96";
  g.lineWidth = 2;
  g.setLineDash([2, 1.4]);
  g.stroke();
  g.setLineDash([]);
  rimLight(g, scale, [16, -112, 90, 100], sack, "rgba(255, 235, 200, 0.45)");
}

// ---------------------------------------------------------------- Santa

const REIN_HAND: Pt = [-34, -41];

function glove(g: G, x: number, y: number, rot: number, open: boolean): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  const gr = g.createRadialGradient(-1.5, -2, 0.5, 0, 0, 6);
  gr.addColorStop(0, "#4a4440");
  gr.addColorStop(1, "#0f0d0c");
  g.fillStyle = gr;
  g.beginPath();
  if (open) {
    g.ellipse(0, -1, 4.2, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(-4.6, 1.2, 1.9, 3.4, -0.7, 0, Math.PI * 2);
  } else {
    g.ellipse(0, 0, 4.8, 4.6, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(-3.6, -2.4, 2, 2.6, -0.4, 0, Math.PI * 2);
  }
  g.fill();
  g.restore();
}

function sleeve(g: G, pts: Pt[], widths: number[], base: string, light: string): void {
  taper(g, pts, widths, base);
  const hi = pts.map(([x, y]) => [x - 0.6, y - 1.6] as Pt);
  taper(g, hi, widths.map((w) => w * 0.42), light);
}

function paintSanta(g: G, scale: number): void {
  const box: Box = [-56, -102, 100, 92];

  // Far arm, reaching forward with the reins.
  sleeve(g, [[20, -58], [2, -45], [-26, -42]], [11, 9.5, 8.5], "#7a0f1b", "rgba(255, 120, 120, 0.18)");
  fluff(g, [[-25, -46.5], [-26.5, -37.5]], 2.6, 11);
  glove(g, REIN_HAND[0], REIN_HAND[1], -1.6, false);

  // Torso.
  const torso = new Path2D();
  torso.moveTo(-17, -17);
  torso.bezierCurveTo(-32, -26, -32, -49, -17, -61);
  torso.bezierCurveTo(-6, -69, 15, -69, 25, -61);
  torso.bezierCurveTo(35, -50, 35, -30, 31, -17);
  torso.closePath();
  g.fillStyle = SUIT;
  g.fill(torso);
  g.save();
  g.clip(torso);
  radial(g, -16, -46, 30, "rgba(255, 110, 115, ALPHA)", 0.55);
  const back = g.createLinearGradient(-5, 0, 34, 0);
  back.addColorStop(0, "rgba(0, 0, 0, 0)");
  back.addColorStop(1, "rgba(50, 0, 8, 0.6)");
  g.fillStyle = back;
  g.fillRect(-40, -72, 80, 60);
  softStroke(g, scale, "rgba(60, 0, 10, 0.5)", 2.4, 1.6, () => {
    g.moveTo(-26, -24);
    g.quadraticCurveTo(-10, -20, 6, -24);
    g.moveTo(6, -56);
    g.quadraticCurveTo(14, -46, 10, -38);
    g.moveTo(18, -30);
    g.quadraticCurveTo(24, -24, 30, -26);
  });
  // Belt with gloss.
  g.fillStyle = "#141212";
  g.beginPath();
  g.moveTo(-40, -37);
  g.quadraticCurveTo(0, -40, 40, -36);
  g.lineTo(40, -29);
  g.quadraticCurveTo(0, -33, -40, -30);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(255, 255, 255, 0.28)";
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(-40, -36);
  g.quadraticCurveTo(0, -39, 40, -35);
  g.stroke();
  g.restore();
  // Buckle.
  g.fillStyle = goldGrad(g, -41, -27);
  g.fillRect(-30, -41, 11, 12);
  g.fillStyle = "#141212";
  g.fillRect(-27, -38, 5, 6);
  g.fillStyle = "rgba(255, 255, 240, 0.7)";
  g.fillRect(-30, -41, 11, 0.9);

  // Fur trim down the coat front.
  fluff(g, [[-11, -63], [-20, -54], [-25, -42], [-26, -30], [-22, -18]], 3.2, 5);

  // Head.
  const hx = -8;
  const hy = -77;
  g.fillStyle = "#e9edf3";
  g.beginPath();
  g.ellipse(hx + 8, hy + 1, 6.5, 9.5, 0.2, 0, Math.PI * 2);
  g.fill();
  const face = g.createRadialGradient(hx - 5, hy - 3, 1, hx, hy, 13);
  face.addColorStop(0, "#fbe0c6");
  face.addColorStop(0.7, "#efbf9b");
  face.addColorStop(1, "#d39374");
  g.fillStyle = face;
  g.beginPath();
  g.arc(hx, hy, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#d48f74";
  g.beginPath();
  g.ellipse(hx + 6, hy + 0.5, 2.8, 3.8, 0.15, 0, Math.PI * 2);
  g.fill();
  radial(g, hx - 6, hy + 1.5, 5, "rgba(240, 95, 100, ALPHA)", 0.5);

  // Beard, flowing back a little in the wind.
  const beard = new Path2D();
  beard.moveTo(hx + 7, hy - 1);
  beard.bezierCurveTo(hx + 12, hy + 12, hx + 9, hy + 26, hx + 2, hy + 33);
  beard.bezierCurveTo(hx - 5, hy + 39, hx - 15, hy + 36, hx - 19, hy + 27);
  beard.bezierCurveTo(hx - 23, hy + 19, hx - 20, hy + 11, hx - 15, hy + 6);
  beard.bezierCurveTo(hx - 8, hy + 8, hx - 1, hy + 6, hx + 7, hy - 1);
  beard.closePath();
  const bg = g.createLinearGradient(hx - 10, hy, hx + 6, hy + 38);
  bg.addColorStop(0, "#ffffff");
  bg.addColorStop(1, "#c3cad6");
  g.fillStyle = bg;
  g.fill(beard);
  g.save();
  g.clip(beard);
  g.lineWidth = 0.8;
  const rb = rng(21);
  for (let i = 0; i < 40; i++) {
    const x = hx - 20 + rb() * 30;
    const y = hy + 6 + rb() * 30;
    g.strokeStyle = rb() < 0.5 ? "rgba(140, 150, 170, 0.45)" : "rgba(255, 255, 255, 0.8)";
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x - 3, y + 3, x + 2, y + 6, x - 1, y + 9);
    g.stroke();
  }
  g.restore();
  fluff(g, [[hx - 19, hy + 26], [hx - 12, hy + 36], [hx - 2, hy + 37], [hx + 6, hy + 30]], 2.6, 9);

  // Nose, mustache, eye, glasses, brow.
  fluff(g, [[hx - 19, hy + 7], [hx - 13, hy + 4], [hx - 7, hy + 4.5], [hx - 1, hy + 7.5], [hx + 2, hy + 10]], 2.9, 13);
  const nose = g.createRadialGradient(hx - 15, hy - 1.2, 0.3, hx - 13.5, hy + 0.5, 4.4);
  nose.addColorStop(0, "#ffd3c0");
  nose.addColorStop(0.5, "#ec9a82");
  nose.addColorStop(1, "#c76d58");
  g.fillStyle = nose;
  g.beginPath();
  g.arc(hx - 13.5, hy + 0.8, 4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#1e1410";
  g.beginPath();
  g.ellipse(hx - 8, hy - 4, 1.4, 1.8, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(hx - 8.5, hy - 4.6, 0.55, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = goldGrad(g, hy - 8, hy);
  g.lineWidth = 0.9;
  g.beginPath();
  g.ellipse(hx - 8.4, hy - 3.6, 3.8, 3.3, 0, 0, Math.PI * 2);
  g.moveTo(hx - 4.6, hy - 4);
  g.lineTo(hx + 5, hy - 2.5);
  g.stroke();
  g.fillStyle = "rgba(220, 235, 255, 0.18)";
  g.fill();
  g.strokeStyle = "rgba(255, 255, 255, 0.8)";
  g.lineWidth = 0.6;
  g.beginPath();
  g.arc(hx - 8.4, hy - 3.6, 2.6, -2.6, -1.8);
  g.stroke();
  fluff(g, [[hx - 12, hy - 9], [hx - 4, hy - 9.6]], 1.7, 17);

  rimLight(g, scale, box, torso, "rgba(255, 200, 200, 0.45)");
}

function hat(ctx: G, t: number): void {
  const hx = -8;
  const hy = -77;
  const flap = Math.sin(t * 8) * 2.6;
  const flap2 = Math.sin(t * 8 - 0.8) * 3;
  const gr = ctx.createLinearGradient(hx - 4, hy - 34, hx + 16, hy - 6);
  gr.addColorStop(0, "#f04a57");
  gr.addColorStop(0.6, "#c41e2d");
  gr.addColorStop(1, "#7a0f1a");
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.moveTo(hx - 13, hy - 10);
  ctx.bezierCurveTo(hx - 11, hy - 29, hx + 10, hy - 33, hx + 25, hy - 24 + flap * 0.5);
  ctx.bezierCurveTo(hx + 34, hy - 19 + flap, hx + 38, hy - 10 + flap2, hx + 40, hy - 3 + flap2);
  ctx.bezierCurveTo(hx + 31, hy - 12, hx + 22, hy - 15, hx + 13, hy - 9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(80, 5, 15, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(hx + 3, hy - 22);
  ctx.quadraticCurveTo(hx + 18, hy - 22, hx + 32, hy - 10 + flap);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 170, 170, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 9, hy - 22);
  ctx.quadraticCurveTo(hx + 2, hy - 30, hx + 18, hy - 27 + flap * 0.4);
  ctx.stroke();
  fluff(ctx, [[hx - 14, hy - 10], [hx - 5, hy - 12.5], [hx + 6, hy - 12], [hx + 14, hy - 9]], 3.7, 23);
  fluff(ctx, [[hx + 39, hy - 3 + flap2], [hx + 41, hy - 1 + flap2]], 4.6, 29);
}

function wavingArm(ctx: G, t: number): void {
  const wave = Math.sin(t * 6) * 0.3;
  const sh: Pt = [-2, -58];
  const el: Pt = [-31, -61];
  const th = -0.42 + wave;
  const at = (d: number): Pt => [el[0] + Math.sin(th) * d, el[1] - Math.cos(th) * d];
  sleeve(ctx, [sh, el, at(16)], [12, 10, 9], SUIT, "rgba(255, 140, 140, 0.35)");
  const [cx, cy] = at(16);
  const nx = Math.cos(th) * 4.5;
  const ny = Math.sin(th) * 4.5;
  fluff(ctx, [[cx - nx, cy - ny], [cx + nx, cy + ny]], 3, 31);
  const [gx, gy] = at(23);
  glove(ctx, gx, gy, th, true);
}

// ---------------------------------------------------------------- team

/**
 * Draw the whole team at (x, y) with scale k. `t` is seconds and drives the
 * gallop, the bob, the wave, the lantern and the hat.
 */
export function drawSantaTeam(ctx: G, x: number, y: number, k: number, t: number): void {
  ctx.save();
  ctx.translate(x, y + Math.sin(t * 1.6) * 4 * k);
  ctx.scale(k, k);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const scale = deviceScale(ctx);

  const sleighBob = Math.sin(t * 3) * 1.4;
  const rein = (d: DeerSlot) => {
    const c = Math.cos(-0.03 + 0.05 * Math.sin(t * GALLOP + d.phase));
    const cx = d.x + COLLAR[0] * c;
    const cy = d.y + deerBob(d, t) + COLLAR[1];
    const hx = REIN_HAND[0];
    const hy = REIN_HAND[1] + sleighBob;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.quadraticCurveTo((hx + cx) / 2, Math.max(hy, cy) + 8, cx, cy);
    ctx.stroke();
  };

  const far = TEAM.filter((d) => d.far);
  const near = TEAM.filter((d) => !d.far);
  for (const d of far) reindeer(ctx, t, d, scale);
  ctx.strokeStyle = mix(LEATHER, NIGHT, 0.4);
  ctx.lineWidth = 1.2;
  for (const d of far) rein(d);
  for (const d of near) reindeer(ctx, t, d, scale);
  ctx.strokeStyle = LEATHER;
  ctx.lineWidth = 1.6;
  for (const d of near) rein(d);
  ctx.strokeStyle = "rgba(255, 210, 160, 0.35)";
  ctx.lineWidth = 0.5;
  for (const d of near) rein(d);

  ctx.save();
  ctx.translate(0, sleighBob);
  blit(ctx, sprite("sleigh-back", scale, [-112, -72, 210, 108], paintSleighBack));
  blit(ctx, sprite("sack", scale, [16, -112, 90, 100], paintSack, { shadow: true }));
  blit(ctx, sprite("santa", scale, [-56, -102, 100, 92], paintSanta, { shadow: true }));
  hat(ctx, t);
  blit(ctx, sprite("sleigh-front", scale, [-112, -72, 222, 108], paintSleighFront, { shadow: true }));
  wavingArm(ctx, t);
  lantern(ctx, t);
  ctx.restore();

  ctx.restore();
}

/** Point just behind the sleigh, for a sparkle trail (sleigh space, k = 1). */
export const SLEIGH_TAIL = { x: 92, y: 18 };
/** Extent of the team in sleigh space, k = 1. */
export const TEAM_EXTENT = { left: -440, right: 100, top: -145, bottom: 35 };
