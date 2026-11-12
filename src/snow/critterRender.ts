/**
 * Emperor penguin, polar bear and an arctic char, painted with Canvas2D in a
 * natural style (real proportions, layered shading, fur and feather texture,
 * rim light). Side view facing right; origin on the ground under the animal.
 * Units are layout px at k = 1: the penguin stands ~42 tall, the bear is
 * ~100 long. `dir` -1 mirrors to face left.
 */

type G = CanvasRenderingContext2D;
type Pt = [number, number];

export type PenguinPose = "stand" | "sneak" | "run" | "slide" | "jump" | "grab";
export type BearPose = "walk" | "run" | "sit" | "tumble" | "shake" | "roar";

export interface PenguinOpts {
  scared?: boolean;
  /** Carrying a fish in its beak. */
  fish?: boolean;
  /** Seconds since the current pose started (jump arc). */
  poseT?: number;
}

export interface BearOpts {
  spin?: number;
  angry?: boolean;
  /** Fish held in the jaws. */
  fish?: boolean;
  /** Eyes closed, content (sitting with its meal). */
  content?: boolean;
}

// ---------------------------------------------------------------- helpers

function lin(g: G, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function rad(g: G, x: number, y: number, r: number, stops: [number, string][]): CanvasGradient {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tapered limb through `pts`, one trapezoid per segment plus round joints. */
function limbPath(pts: Pt[], widths: number[]): Path2D {
  const p = new Path2D();
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const l = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / l;
    const ny = (x1 - x0) / l;
    const a = widths[i] / 2;
    const b = widths[i + 1] / 2;
    p.moveTo(x0 - nx * a, y0 - ny * a);
    p.lineTo(x1 - nx * b, y1 - ny * b);
    p.lineTo(x1 + nx * b, y1 + ny * b);
    p.lineTo(x0 + nx * a, y0 + ny * a);
    p.closePath();
    p.moveTo(x1 + b, y1);
    p.arc(x1, y1, b, 0, Math.PI * 2);
  }
  p.moveTo(pts[0][0] + widths[0] / 2, pts[0][1]);
  p.arc(pts[0][0], pts[0][1], widths[0] / 2, 0, Math.PI * 2);
  return p;
}

/** Walk (angle, length) segments; angle 0 = straight down, + = forward. */
function chain(x: number, y: number, segs: [number, number][]): Pt[] {
  const out: Pt[] = [[x, y]];
  for (const [a, len] of segs) {
    x -= Math.sin(a) * len;
    y += Math.cos(a) * len;
    out.push([x, y]);
  }
  return out;
}

function groundShadow(g: G, w: number, a = 0.3): void {
  g.save();
  g.scale(1, 0.13);
  g.fillStyle = rad(g, 0, 0, w, [
    [0, `rgba(10, 25, 50, ${a})`],
    [1, "rgba(10, 25, 50, 0)"],
  ]);
  g.beginPath();
  g.arc(0, 0, w, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Short strokes following a direction, clipped to `clip`, for fur/feathers. */
function texture(g: G, clip: Path2D, box: [number, number, number, number], n: number, seed: number, colors: string[], len: number, angle: (x: number, y: number) => number, width = 0.45): void {
  const r = rng(seed);
  g.save();
  g.clip(clip);
  g.lineWidth = width;
  g.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const x = box[0] + r() * box[2];
    const y = box[1] + r() * box[3];
    const a = angle(x, y) + (r() - 0.5) * 0.5;
    const l = len * (0.6 + r() * 0.8);
    g.strokeStyle = colors[i % colors.length];
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 0.4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------- fish

/** Arctic char, ~17 long, centred at (x, y), nose toward +x after `a`. */
export function drawFish(g: G, x: number, y: number, k: number, a: number, t: number, wiggle = 1): void {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.rotate(a + Math.sin(t * 11) * 0.1 * wiggle);
  const tail = Math.sin(t * 14) * 0.25 * wiggle;
  const body = new Path2D();
  body.moveTo(8.5, 0);
  body.bezierCurveTo(7, -3.2, 1, -3.6, -4, -2.2);
  body.bezierCurveTo(-6, -1.6, -7, -0.6, -7.4, 0);
  body.bezierCurveTo(-7, 0.6, -6, 1.4, -4, 1.9);
  body.bezierCurveTo(1, 3.1, 7, 2.6, 8.5, 0);
  body.closePath();
  g.save();
  g.translate(-7, 0);
  g.rotate(tail);
  g.fillStyle = lin(g, -4, 0, 0, 0, [[0, "#6c8696"], [1, "#9fb5c2"]]);
  g.beginPath();
  g.moveTo(0.5, 0);
  g.lineTo(-4.2, -3.4);
  g.quadraticCurveTo(-3, 0, -4.2, 3.2);
  g.closePath();
  g.fill();
  g.restore();
  g.fillStyle = "#7f97a6";
  g.beginPath();
  g.moveTo(0.5, -3.1);
  g.lineTo(-2.5, -4.6);
  g.lineTo(-2.8, -2.6);
  g.fill();
  g.fillStyle = "rgba(230, 150, 120, 0.85)";
  g.beginPath();
  g.moveTo(2, 2.4);
  g.lineTo(-0.5, 4);
  g.lineTo(-1, 2.3);
  g.fill();
  g.fillStyle = lin(g, 0, -3.4, 0, 2.8, [
    [0, "#3f5a63"],
    [0.35, "#8fa8b3"],
    [0.6, "#dfe8ec"],
    [1, "#f7e8e0"],
  ]);
  g.fill(body);
  g.save();
  g.clip(body);
  g.fillStyle = "rgba(240, 140, 130, 0.35)";
  g.fillRect(-7, 0.6, 15, 2.5);
  g.fillStyle = "rgba(255, 255, 255, 0.6)";
  g.fillRect(-5, -1.1, 12, 0.6);
  g.fillStyle = "rgba(230, 240, 235, 0.55)";
  for (const [sx, sy] of [[-3, -1.8], [-0.5, -2.3], [2, -2], [4.5, -1.6], [-1.8, -0.6], [1, -0.9]] as Pt[]) {
    g.beginPath();
    g.arc(sx, sy, 0.35, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  g.strokeStyle = "rgba(60, 80, 90, 0.6)";
  g.lineWidth = 0.4;
  g.beginPath();
  g.arc(5.2, 0, 2, -1.1, 1.1);
  g.stroke();
  g.fillStyle = "#f2e2a0";
  g.beginPath();
  g.arc(6.6, -0.7, 0.75, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#101418";
  g.beginPath();
  g.arc(6.7, -0.7, 0.45, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

// ---------------------------------------------------------------- penguin

let _pen: { body: Path2D; belly: Path2D } | null = null;

function penguinPaths(): { body: Path2D; belly: Path2D } {
  if (_pen) return _pen;
  const body = new Path2D();
  body.moveTo(1, -42);
  body.bezierCurveTo(5.8, -42, 8.6, -39.4, 9, -36.2);
  body.bezierCurveTo(9.6, -33.4, 9.8, -30.8, 10.8, -27);
  body.bezierCurveTo(13, -20, 12.8, -11, 9.8, -5);
  body.bezierCurveTo(7.8, -1.4, 4, 0, 0, 0);
  body.bezierCurveTo(-4, 0, -7.5, -0.8, -12.5, -0.3);
  body.bezierCurveTo(-10.4, -3, -9.8, -6, -9.7, -10);
  body.bezierCurveTo(-9.5, -20, -8.8, -29.5, -5.8, -36);
  body.bezierCurveTo(-4.2, -39.8, -1.6, -42, 1, -42);
  body.closePath();
  const belly = new Path2D();
  belly.moveTo(8.4, -33.5);
  belly.bezierCurveTo(9.5, -31, 9.9, -29, 10.9, -26.5);
  belly.bezierCurveTo(13, -19.5, 12.8, -11, 9.8, -5);
  belly.bezierCurveTo(7.8, -1.4, 4, 0, 0, 0);
  belly.bezierCurveTo(-1.6, -0.1, -3, -0.6, -3.6, -1.5);
  belly.bezierCurveTo(-2, -8, -1, -18, 1.5, -25);
  belly.bezierCurveTo(3, -29, 5.5, -32.5, 8.4, -33.5);
  belly.closePath();
  _pen = { body, belly };
  return _pen;
}

function penguinFoot(g: G, x: number, y: number, a: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = lin(g, 0, -2, 0, 1.5, [[0, "#4a4a52"], [1, "#1c1c20"]]);
  g.beginPath();
  g.moveTo(-2.2, -1.6);
  g.quadraticCurveTo(4.2, -2.2, 5.4, -0.2);
  g.quadraticCurveTo(5.6, 0.8, 4.6, 0.9);
  g.lineTo(-2.4, 0.8);
  g.closePath();
  g.fill();
  g.fillStyle = "#0e0e10";
  for (const cx of [4.8, 3.6, 2.4]) {
    g.beginPath();
    g.arc(cx + 0.8, 0.2, 0.35, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function flipper(g: G, x: number, y: number, a: number, far: boolean): void {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  const p = new Path2D();
  p.moveTo(-1.6, -0.6);
  p.bezierCurveTo(-3.6, 4, -3, 10, -0.8, 15.5);
  p.bezierCurveTo(0.6, 11, 1.8, 5, 1.9, -0.2);
  p.closePath();
  g.fillStyle = far ? "#141820" : lin(g, -3, 0, 2, 15, [[0, "#38455a"], [0.6, "#1b212d"], [1, "#0e1118"]]);
  g.fill(p);
  if (!far) {
    g.strokeStyle = "rgba(235, 240, 248, 0.85)";
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(1.7, 0.5);
    g.bezierCurveTo(1.6, 6, 0.6, 11, -0.6, 15);
    g.stroke();
  }
  g.restore();
}

function penguinBody(g: G, t: number, flap: number, scared: boolean, fish: boolean): void {
  const P = penguinPaths();

  flipper(g, -1, -27, 0.45 + flap * 0.9, true);

  // Back: blue-black with a grey-blue sheen on the shoulders.
  g.fillStyle = lin(g, -10, -40, 8, -2, [
    [0, "#4a5a72"],
    [0.3, "#27303f"],
    [0.7, "#131820"],
    [1, "#0a0d12"],
  ]);
  g.fill(P.body);
  g.save();
  g.clip(P.body);
  g.fillStyle = rad(g, -6, -26, 12, [
    [0, "rgba(150, 170, 200, 0.35)"],
    [1, "rgba(150, 170, 200, 0)"],
  ]);
  g.fillRect(-14, -40, 20, 30);

  // White front with a soft yellow upper chest.
  g.fillStyle = lin(g, 4, -33, 4, 0, [
    [0, "#ffe7a8"],
    [0.22, "#fff6de"],
    [0.5, "#ffffff"],
    [1, "#d6dee8"],
  ]);
  g.fill(P.belly);
  g.save();
  g.clip(P.belly);
  g.fillStyle = lin(g, -3, 0, 6, 0, [
    [0, "rgba(120, 140, 170, 0.5)"],
    [1, "rgba(120, 140, 170, 0)"],
  ]);
  g.fillRect(-4, -34, 10, 34);
  g.restore();
  g.strokeStyle = "rgba(10, 12, 18, 0.65)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(8.4, -33.5);
  g.bezierCurveTo(5.5, -32.5, 3, -29, 1.5, -25);
  g.bezierCurveTo(-1, -18, -2, -8, -3.6, -1.5);
  g.stroke();
  g.restore();

  // Feather texture.
  texture(g, P.belly, [-4, -32, 17, 32], 70, 11, ["rgba(150, 165, 190, 0.22)", "rgba(255, 255, 255, 0.5)"], 1.2, () => 1.4);
  texture(g, P.body, [-12, -40, 12, 38], 60, 7, ["rgba(120, 140, 170, 0.18)", "rgba(0, 0, 0, 0.25)"], 1.4, () => 1.5);

  // Ear patch: an orange comma curving from behind the eye down the neck.
  const ear = new Path2D();
  ear.moveTo(1.4, -37.2);
  ear.bezierCurveTo(4, -38, 5, -35.5, 4.6, -33);
  ear.bezierCurveTo(4.3, -30.5, 5.5, -28.5, 7.5, -27.6);
  ear.bezierCurveTo(4.2, -27.2, 2, -29.5, 1.6, -32);
  ear.bezierCurveTo(1.2, -34, 0.4, -36.2, 1.4, -37.2);
  ear.closePath();
  g.fillStyle = lin(g, 2, -38, 6, -27, [[0, "#ffb02e"], [0.6, "#ffd36a"], [1, "#fff0b8"]]);
  g.fill(ear);

  // Eye.
  g.fillStyle = "#050608";
  g.beginPath();
  g.ellipse(5.6, -37.4, scared ? 1.35 : 1.1, scared ? 1.35 : 0.95, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255, 255, 255, 0.9)";
  g.beginPath();
  g.arc(6, -37.8, 0.38, 0, Math.PI * 2);
  g.fill();
  if (scared) {
    g.strokeStyle = "rgba(255, 255, 255, 0.5)";
    g.lineWidth = 0.4;
    g.beginPath();
    g.arc(5.6, -37.4, 1.9, 0, Math.PI * 2);
    g.stroke();
  }

  // Beak: long and slightly curved, black above, orange-pink plate below.
  g.fillStyle = lin(g, 9, -37, 17, -33, [[0, "#1f2228"], [1, "#0d0f12"]]);
  g.beginPath();
  g.moveTo(8.4, -37.6);
  g.bezierCurveTo(12, -37.4, 15.5, -35.6, 18.2, -33.6);
  g.bezierCurveTo(15, -34, 12, -34.6, 8.8, -34.8);
  g.closePath();
  g.fill();
  g.fillStyle = lin(g, 9, 0, 16, 0, [[0, "#ff8a3c"], [1, "#f5b07a"]]);
  g.beginPath();
  g.moveTo(9, -35.2);
  g.bezierCurveTo(12, -35, 14.5, -34.4, 16.6, -33.7);
  g.bezierCurveTo(14, -33.6, 11.5, -33.9, 9.2, -34.2);
  g.closePath();
  g.fill();

  if (fish) drawFish(g, 19.5, -32.2, 1, 1.25 + Math.sin(t * 7) * 0.08, t, 1);

  flipper(g, 0, -27, 0.3 + flap, false);

  // Rim light.
  g.save();
  g.clip(P.body);
  g.strokeStyle = "rgba(200, 220, 255, 0.35)";
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(-9.2, -14);
  g.bezierCurveTo(-9, -27, -7, -36, 1, -41.4);
  g.stroke();
  g.restore();
}

/** Penguin standing at (x, ground). `phase` advances with distance (step cycle). */
export function drawPenguin(ctx: G, x: number, groundY: number, k: number, t: number, pose: PenguinPose, phase: number, dir: 1 | -1 = 1, opts: PenguinOpts = {}): void {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(k * dir, k);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (pose === "slide") {
    groundShadow(ctx, 22);
    const kick = Math.sin(t * 16) * 0.4;
    ctx.save();
    ctx.translate(-4, -9.6);
    ctx.rotate(Math.PI / 2 - 0.06);
    ctx.translate(-1, 20);
    penguinFoot(ctx, -2.5, 1.5, 0.9 + kick);
    penguinFoot(ctx, 1.5, 1.8, 0.6 - kick);
    penguinBody(ctx, t, 1.6, false, false);
    ctx.restore();
    // The stolen fish stays in its beak, trailing along the snow.
    if (opts.fish) drawFish(ctx, 28, -5, 1, 0.12 + Math.sin(t * 9) * 0.06, t, 1);
    ctx.restore();
    return;
  }

  groundShadow(ctx, 14);
  const run = pose === "run";
  const sneak = pose === "sneak";
  const s = Math.sin(phase);
  const hop = pose === "jump" ? 16 : run ? Math.abs(s) * 2.4 : sneak ? Math.abs(s) * 0.8 : 0;
  const lean = run ? 0.22 + s * 0.12 : sneak ? 0.32 + s * 0.04 : pose === "grab" ? 0.75 : pose === "jump" ? 0.04 : 0.02;
  const flap = run ? 0.75 + Math.sin(phase * 2) * 0.35 : sneak ? 0.55 : pose === "jump" ? -0.9 + Math.sin(t * 20) * 0.3 : pose === "grab" ? 0.6 : 0.05;
  const stride = run ? 4.6 : sneak ? 3 : 0;
  const lift = run ? 2.8 : sneak ? 2.2 : 0;
  const footY = (o: number) => (pose === "jump" ? -hop + 2 : -Math.max(0, Math.cos(phase + o)) * lift);

  penguinFoot(ctx, -1.6 - s * stride, footY(0), 0);
  ctx.save();
  ctx.translate(0, -hop);
  if (sneak) ctx.scale(1, 0.93);
  ctx.rotate(lean);
  penguinBody(ctx, t, flap, !!opts.scared, !!opts.fish);
  ctx.restore();
  penguinFoot(ctx, 1.6 + s * stride, footY(Math.PI), 0);
  ctx.restore();
}

// ---------------------------------------------------------------- polar bear

let _bear: Path2D | null = null;

function bearPath(): Path2D {
  if (_bear) return _bear;
  const p = new Path2D();
  p.moveTo(-46, -32);
  p.bezierCurveTo(-47, -40, -42, -45.5, -34, -46);
  p.bezierCurveTo(-18, -46.5, -2, -42.5, 10, -40.5);
  p.bezierCurveTo(18, -39.4, 24, -41.2, 30, -41.8);
  p.bezierCurveTo(36, -42.8, 42, -41.2, 46, -38.3);
  p.bezierCurveTo(49, -36.8, 52, -35.8, 53.6, -34);
  p.bezierCurveTo(54.6, -32.6, 53.6, -30.9, 51.6, -30.7);
  p.bezierCurveTo(48, -29.6, 45, -28.7, 42, -28.9);
  p.bezierCurveTo(37, -29.1, 33, -28.1, 29, -26.1);
  p.bezierCurveTo(24, -23, 20, -19, 15, -17.2);
  p.bezierCurveTo(5, -15.2, -12, -15.6, -24, -17.2);
  p.bezierCurveTo(-34, -18.2, -42, -22, -46, -27);
  p.bezierCurveTo(-47, -29, -46.5, -31, -46, -32);
  p.closePath();
  _bear = p;
  return p;
}

const FUR = {
  top: "#fffbf1",
  mid: "#f1e8d2",
  low: "#cdbf9e",
  shade: "rgba(150, 128, 88, 0.45)",
  far: ["#e3d8bd", "#bfb091"] as const,
  near: ["#e6d9be", "#c6b693"] as const,
};

function paw(g: G, x: number, y: number, w: number, far: boolean): void {
  g.fillStyle = far ? "#cfc2a2" : lin(g, 0, y - w * 0.4, 0, y + w * 0.3, [[0, "#f7f0de"], [1, "#c9ba98"]]);
  g.beginPath();
  g.ellipse(x + w * 0.22, y, w * 0.62, w * 0.36, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#3a332a";
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.ellipse(x + w * 0.72 + i * 0.4, y + w * 0.12 - i * 0.6, 0.9, 0.5, 0.4, 0, Math.PI * 2);
    g.fill();
  }
}

function bearLeg(g: G, hip: Pt, segs: [number, number, number][], far: boolean): void {
  const pts = chain(hip[0], hip[1], segs.map(([a, l]) => [a, l] as [number, number]));
  const widths = [segs[0][2], ...segs.map(([, , w]) => w * 0.86)];
  const [c0, c1] = far ? FUR.far : FUR.near;
  const path = limbPath(pts, widths);
  if (far) {
    // Only the far legs get an edge; near legs blend into the body.
    g.strokeStyle = "rgba(110, 95, 70, 0.35)";
    g.lineWidth = 1.2;
    g.stroke(path);
  }
  g.fillStyle = lin(g, 0, hip[1], 0, pts[pts.length - 1][1], [[0, c0], [1, c1]]);
  g.fill(path);
  if (!far) {
    texture(g, path, [hip[0] - 10, hip[1] - 4, 22, 34], 26, Math.round(Math.abs(hip[0]) * 7), ["rgba(150, 130, 95, 0.22)", "rgba(255, 255, 255, 0.55)"], 2.2, () => Math.PI / 2 + 0.25);
  }
  const end = pts[pts.length - 1];
  paw(g, end[0], end[1] - 1, segs[segs.length - 1][2] * 1.35, far);
}

/** Leg segment lists [angle, length, width] for the pose and gait phase. */
function legs(pose: BearPose, p: number, far: boolean): { front: [number, number, number][]; hind: [number, number, number][] } {
  const o = far ? 0.55 : 0;
  const s = Math.sin(p - o);
  const c = Math.cos(p - o);
  let f1: number, f2: number, h1: number, h2: number, h3: number;
  if (pose === "run") {
    f1 = 0.75 * s;
    f2 = f1 + (s < 0 ? -1.5 * -s : 0.35 * s) - 0.1;
    const hs = Math.sin(p - o + 2.4);
    h1 = -0.25 - 0.7 * hs;
    h2 = h1 + 0.55 + 0.6 * Math.max(0, hs);
    h3 = h2 - 0.75 - 0.4 * Math.max(0, -hs);
  } else if (pose === "walk") {
    f1 = 0.32 * s;
    f2 = f1 - 0.55 * Math.max(0, -c);
    h1 = -0.3 * s - 0.1;
    h2 = h1 + 0.55 + 0.25 * Math.max(0, c);
    h3 = h2 - 0.6;
  } else if (pose === "sit") {
    f1 = 0.08;
    f2 = 0.05;
    h1 = 1.35;
    h2 = -0.25;
    h3 = 1.45;
  } else if (pose === "tumble" || pose === "shake") {
    f1 = 0.9 + 0.5 * s;
    f2 = 1.4 + 0.4 * c;
    h1 = -0.9 + 0.4 * c;
    h2 = -0.4 + 0.4 * s;
    h3 = -1;
  } else {
    f1 = 0.22;
    f2 = 0.12;
    h1 = -0.2;
    h2 = 0.5;
    h3 = -0.3;
  }
  return {
    front: [
      [f1, 12.5, 12.5],
      [f2, 11.5, 9.6],
    ],
    hind: [
      [h1, 12.5, 16],
      [h2, 10, 9],
      [h3, 6.5, 8],
    ],
  };
}

function bearBody(g: G, t: number, pose: BearPose, phase: number, opts: BearOpts): void {
  const body = bearPath();
  const farL = legs(pose, phase, true);
  const nearL = legs(pose, phase, false);
  const roar = pose === "roar";

  bearLeg(g, [13, -27], farL.front, true);
  bearLeg(g, [-33, -31], farL.hind, true);

  // Ear (behind the head outline).
  g.fillStyle = FUR.mid;
  g.beginPath();
  g.arc(31, -42.6, 3.3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = FUR.shade;
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = "#b9a988";
  g.beginPath();
  g.arc(31.3, -42.2, 1.6, 0, Math.PI * 2);
  g.fill();

  // Tail.
  g.fillStyle = FUR.mid;
  g.beginPath();
  g.ellipse(-46.5, -35, 3.6, 2.6, -0.6, 0, Math.PI * 2);
  g.fill();

  // Body.
  g.strokeStyle = FUR.shade;
  g.lineWidth = 1.5;
  g.stroke(body);
  g.fillStyle = lin(g, 0, -47, 0, -15, [
    [0, FUR.top],
    [0.45, FUR.mid],
    [1, FUR.low],
  ]);
  g.fill(body);

  g.save();
  g.clip(body);
  g.fillStyle = rad(g, -32, -36, 16, [[0, "rgba(255, 255, 250, 0.6)"], [1, "rgba(255, 255, 250, 0)"]]);
  g.fillRect(-50, -50, 40, 34);
  g.fillStyle = rad(g, 12, -32, 13, [[0, "rgba(255, 255, 250, 0.45)"], [1, "rgba(255, 255, 250, 0)"]]);
  g.fillRect(-4, -46, 30, 30);
  g.fillStyle = lin(g, 0, -22, 0, -15, [[0, "rgba(150, 125, 80, 0)"], [1, "rgba(150, 125, 80, 0.4)"]]);
  g.fillRect(-50, -22, 110, 8);
  for (const [x0, y0, x1, y1, x2, y2] of [
    [4, -38, 1, -29, 5, -19],
    [-22, -41, -26, -31, -22, -19],
  ]) {
    g.save();
    g.filter = "blur(1.2px)";
    g.strokeStyle = "rgba(150, 125, 85, 0.35)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo(x1, y1, x2, y2);
    g.stroke();
    g.restore();
  }
  g.restore();

  // Fur flowing back and down.
  texture(g, body, [-48, -47, 102, 32], 260, 3, ["rgba(160, 138, 98, 0.2)", "rgba(255, 255, 255, 0.55)", "rgba(190, 170, 130, 0.18)"], 2.6, (x, y) => (x > 26 ? 0.25 + Math.PI : y < -36 ? Math.PI - 0.15 : Math.PI / 2 + 0.6));
  // Shaggy belly fringe.
  g.save();
  g.strokeStyle = "rgba(205, 190, 160, 0.9)";
  g.lineWidth = 0.9;
  const r = rng(5);
  for (let x = -26; x < 14; x += 1.6) {
    const y = -16.4 + Math.sin(x * 0.09) * 0.6;
    g.beginPath();
    g.moveTo(x, y - 1);
    g.lineTo(x - 0.8, y + 1.2 + r() * 1.6);
    g.stroke();
  }
  g.restore();

  bearLeg(g, [-32, -30], nearL.hind, false);
  bearLeg(g, [13, -26], nearL.front, false);

  // Mouth (open when roaring or chasing angry).
  const open = roar ? 1 : pose === "run" && opts.angry ? 0.45 + Math.abs(Math.sin(phase)) * 0.25 : 0;
  if (open > 0) {
    g.fillStyle = "#3b1d1b";
    g.beginPath();
    g.moveTo(51.4, -30.6);
    g.lineTo(37, -29.2);
    g.lineTo(47, -30.4 + 5.5 * open);
    g.closePath();
    g.fill();
    g.fillStyle = "#c46a6a";
    g.beginPath();
    g.ellipse(44, -29.8 + 3.2 * open, 3.4, 1.2 * open, -0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f6f2e6";
    for (const [tx, ty, up] of [[49.6, -30.4, 1], [46.6, -30.1, 1], [47.6, -30.4 + 4.6 * open, -1]] as [number, number, number][]) {
      g.beginPath();
      g.moveTo(tx - 0.7, ty);
      g.lineTo(tx + 0.7, ty);
      g.lineTo(tx, ty + 1.6 * up);
      g.fill();
    }
    g.fillStyle = lin(g, 0, -29, 0, -24, [[0, FUR.mid], [1, FUR.low]]);
    g.beginPath();
    g.moveTo(37, -29);
    g.quadraticCurveTo(42, -28 + 5 * open, 48, -30 + 5.5 * open);
    g.quadraticCurveTo(44, -27 + 6.5 * open, 37, -27.4);
    g.closePath();
    g.fill();
  } else {
    g.strokeStyle = "#3a2f28";
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(51.6, -30.7);
    g.quadraticCurveTo(46, -29.6, 40.5, -29.9);
    g.stroke();
  }

  // Nose: big, black, glossy.
  g.fillStyle = rad(g, 52, -34.2, 3.4, [[0, "#5a514a"], [0.5, "#1c1815"], [1, "#0a0807"]]);
  g.beginPath();
  g.ellipse(52.4, -33, 2.7, 2.1, 0.25, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255, 255, 255, 0.55)";
  g.beginPath();
  g.ellipse(51.6, -34, 0.9, 0.45, 0.3, 0, Math.PI * 2);
  g.fill();

  // Eye.
  if (opts.content) {
    g.strokeStyle = "#2a221c";
    g.lineWidth = 0.8;
    g.beginPath();
    g.arc(40.6, -38.4, 1.3, 0.2, Math.PI - 0.2);
    g.stroke();
  } else {
    g.fillStyle = "#120e0b";
    g.beginPath();
    g.ellipse(40.6, -38.2, 1.25, 1.05, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255, 255, 255, 0.8)";
    g.beginPath();
    g.arc(41, -38.6, 0.36, 0, Math.PI * 2);
    g.fill();
    if (opts.angry || roar) {
      g.strokeStyle = "rgba(90, 75, 55, 0.9)";
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(38.2, -41);
      g.lineTo(42.4, -39.6);
      g.stroke();
    }
  }

  if (opts.fish) drawFish(g, 50, -27.6, 1, 2.6, t, 0.6);

  // Rim light along the back.
  g.save();
  g.clip(body);
  g.strokeStyle = "rgba(255, 255, 255, 0.9)";
  g.lineWidth = 1.2;
  g.filter = "blur(0.5px)";
  g.beginPath();
  g.moveTo(-45, -36);
  g.bezierCurveTo(-42, -45, -30, -46, -18, -45.5);
  g.bezierCurveTo(-2, -42, 18, -39, 30, -41.2);
  g.stroke();
  g.restore();
}

/** Polar bear at (x, ground). `phase` advances with distance (gait cycle). */
export function drawBear(ctx: G, x: number, groundY: number, k: number, t: number, pose: BearPose, phase: number, dir: 1 | -1 = 1, opts: BearOpts = {}): void {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(k * dir, k);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  groundShadow(ctx, 50);
  if (pose === "tumble") {
    ctx.translate(0, -30);
    ctx.rotate(opts.spin ?? 0);
    ctx.translate(0, 30);
    bearBody(ctx, t, pose, t * 18, opts);
  } else if (pose === "shake") {
    ctx.translate(0, -16);
    ctx.rotate(Math.sin(t * 42) * 0.07);
    ctx.translate(Math.sin(t * 42 + 1) * 1.2, 16);
    bearBody(ctx, t, "shake", 0, opts);
  } else if (pose === "sit") {
    ctx.translate(-34, -4);
    ctx.rotate(-0.5);
    ctx.translate(34, 4);
    bearBody(ctx, t, pose, 0, opts);
  } else {
    const run = pose === "run";
    const bob = run ? Math.abs(Math.sin(phase)) * 3.2 : pose === "walk" ? Math.abs(Math.sin(phase)) * 0.9 : 0;
    const pitch = run ? Math.sin(phase + 0.6) * 0.07 : pose === "roar" ? -0.12 : 0;
    ctx.translate(0, -bob);
    ctx.rotate(pitch);
    bearBody(ctx, t, pose, phase, opts);
  }
  ctx.restore();
}

/** A heart that floats up. */
export function drawHeart(ctx: G, x: number, y: number, size: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(size / 10, size / 10);
  ctx.fillStyle = lin(ctx, 0, -6, 0, 6, [[0, "#ff7a8a"], [1, "#e0263c"]]);
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(-9, -2, -5, -9, 0, -4.5);
  ctx.bezierCurveTo(5, -9, 9, -2, 0, 4);
  ctx.fill();
  ctx.restore();
}

/** "!" bubble above an animal that just noticed something. */
export function drawAlert(ctx: G, x: number, y: number, k: number, pop: number): void {
  ctx.save();
  ctx.translate(x, y);
  const s = k * (0.6 + 0.4 * Math.min(1, pop * 4)) * (1 + Math.sin(Math.min(1, pop * 3) * Math.PI) * 0.2);
  ctx.scale(s, s);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.moveTo(-3, 6);
  ctx.lineTo(-6, 11);
  ctx.lineTo(2, 7);
  ctx.fill();
  ctx.fillStyle = "#e0263c";
  ctx.font = "bold 12px 'Segoe UI', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", 0, 0.5);
  ctx.restore();
}
