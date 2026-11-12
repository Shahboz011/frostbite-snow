/**
 * Snow bulldozer, painted with Canvas2D, side view facing right (+x).
 * Origin: ground contact under the middle of the tracks. Units are layout px
 * at k = 1; the machine is about 162 × 104 units.
 *
 * The body is painted once per device scale into a cached layer (glossy
 * paint, ambient occlusion, rim light, soft shadow). Track links, wheels,
 * beacon, lights and the snow heap are drawn per frame.
 */

type G = CanvasRenderingContext2D;
type Box = [number, number, number, number];
type Pt = [number, number];

const Y_LIGHT = "#ffd84d";
const Y = "#f5b301";
const Y_MID = "#d99a00";
const Y_DARK = "#9a6a00";
const IRON = "#2a2d32";
const IRON_LIGHT = "#5b626c";
const CHROME_A = "#f4f7fa";
const CHROME_B = "#8d97a3";
const RIM = "rgba(255, 244, 214, 0.6)";

/** Leading edge of the blade (where snow is cut). */
export const BLADE_FRONT = 85;
/** Rear-most point (ripper). */
export const DOZER_BACK = -79;
export const DOZER_HEIGHT = 104;

// Track geometry.
const TX0 = -60;
const TX1 = 48;
const TR = 12; // chain-centre radius at the ends
const TCY = -3 - TR; // end-wheel centre height
const CX0 = TX0 + TR;
const CX1 = TX1 - TR;
const SHOE = 5.4; // link pitch

// ---------------------------------------------------------------- helpers

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

function deviceScale(ctx: G): number {
  const m = ctx.getTransform();
  return Math.max(0.5, Math.min(6, Math.ceil(Math.hypot(m.a, m.b) * 4) / 4));
}

function lin(g: G, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function poly(pts: Pt[]): Path2D {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

function rrect(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
  return p;
}

function rimLight(g: G, scale: number, box: Box, path: Path2D, color = RIM, dx = -1.1, dy = 1.5): void {
  const L = layer(scale, box);
  L.g.fillStyle = color;
  L.g.fill(path);
  L.g.globalCompositeOperation = "destination-out";
  L.g.translate(dx, dy);
  L.g.fillStyle = "#000";
  L.g.fill(path);
  g.save();
  g.clip(path);
  g.filter = `blur(${0.45 * scale}px)`;
  g.drawImage(L.c, box[0], box[1], box[2], box[3]);
  g.restore();
}

/** Glossy yellow paint: base gradient, a soft specular band and grime at the bottom. */
function paint(g: G, scale: number, path: Path2D, y0: number, y1: number, opts: { spec?: number; grime?: number } = {}): void {
  g.fillStyle = lin(g, 0, y0, 0, y1, [
    [0, Y_LIGHT],
    [0.3, Y],
    [0.75, Y_MID],
    [1, Y_DARK],
  ]);
  g.fill(path);
  g.save();
  g.clip(path);
  const h = y1 - y0;
  const sy = y0 + h * 0.18;
  g.filter = `blur(${1.1 * scale}px)`;
  g.fillStyle = `rgba(255, 255, 240, ${opts.spec ?? 0.42})`;
  g.fillRect(-200, sy, 400, Math.max(1.2, h * 0.07));
  g.filter = "none";
  g.fillStyle = lin(g, 0, y1 - h * 0.35, 0, y1, [
    [0, "rgba(60, 40, 10, 0)"],
    [1, `rgba(60, 40, 10, ${opts.grime ?? 0.35})`],
  ]);
  g.fillRect(-200, y1 - h * 0.35, 400, h * 0.35 + 1);
  g.restore();
}

function softStroke(g: G, scale: number, color: string, w: number, blur: number, draw: () => void): void {
  g.save();
  g.filter = `blur(${blur * scale}px)`;
  g.strokeStyle = color;
  g.lineWidth = w;
  g.beginPath();
  draw();
  g.stroke();
  g.restore();
}

function hazard(g: G, path: Path2D, x0: number, y0: number, w: number, h: number): void {
  g.save();
  g.clip(path);
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();
  g.fillStyle = "#1c1c1c";
  g.fillRect(x0, y0, w, h);
  g.fillStyle = Y;
  for (let x = x0 - h * 2; x < x0 + w + h; x += h * 1.6) {
    g.beginPath();
    g.moveTo(x, y0 + h);
    g.lineTo(x + h * 0.8, y0 + h);
    g.lineTo(x + h * 1.8, y0);
    g.lineTo(x + h, y0);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function bolt(g: G, x: number, y: number, r = 0.75): void {
  g.fillStyle = "rgba(40, 26, 0, 0.55)";
  g.beginPath();
  g.arc(x + 0.25, y + 0.3, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255, 245, 200, 0.8)";
  g.beginPath();
  g.arc(x - 0.1, y - 0.1, r * 0.6, 0, Math.PI * 2);
  g.fill();
}

function snowCap(g: G, x0: number, x1: number, y: number, h: number, seed: number): void {
  const n = Math.max(3, Math.round((x1 - x0) / 4));
  const p = new Path2D();
  p.moveTo(x0, y + 0.6);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const bump = h * (0.55 + 0.45 * Math.sin(i * 1.9 + seed)) * Math.sin((Math.PI * i) / n) ** 0.4;
    p.lineTo(x, y - bump);
  }
  p.lineTo(x1, y + 0.6);
  p.closePath();
  g.fillStyle = lin(g, 0, y - h, 0, y + 0.6, [
    [0, "#ffffff"],
    [1, "#d6e2f0"],
  ]);
  g.fill(p);
  g.fillStyle = "rgba(120, 150, 190, 0.35)";
  g.fillRect(x0 + 1, y - 0.2, x1 - x0 - 2, 0.8);
}

function chrome(g: G, a: Pt, b: Pt, w: number): void {
  g.lineCap = "round";
  g.strokeStyle = "#5d6670";
  g.lineWidth = w + 0.8;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
  g.strokeStyle = CHROME_B;
  g.lineWidth = w;
  g.stroke();
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * w * 0.22;
  const ny = (dx / l) * w * 0.22;
  g.strokeStyle = CHROME_A;
  g.lineWidth = w * 0.35;
  g.beginPath();
  g.moveTo(a[0] - nx, a[1] - ny);
  g.lineTo(b[0] - nx, b[1] - ny);
  g.stroke();
}

function bar(g: G, a: Pt, b: Pt, w: number, light: string, dark: string): void {
  g.lineCap = "round";
  g.strokeStyle = dark;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
  g.strokeStyle = light;
  g.lineWidth = w * 0.55;
  g.beginPath();
  g.moveTo(a[0], a[1] - w * 0.15);
  g.lineTo(b[0], b[1] - w * 0.15);
  g.stroke();
}

// ---------------------------------------------------------------- body (cached)

const BODY_BOX: Box = [-84, -112, 176, 108];

function paintBody(g: G, scale: number): void {
  const box = BODY_BOX;

  // ---- Rear ripper (behind everything else).
  bar(g, [-58, -27], [-73, -22], 4.5, Y, Y_DARK);
  bar(g, [-58, -19], [-72, -15], 3.6, Y, Y_DARK);
  const shank = poly([[-75, -27], [-70, -27], [-71, -6], [-74, -1.5], [-77, -6]]);
  paint(g, scale, shank, -27, -2, { spec: 0.25 });
  g.fillStyle = lin(g, 0, -8, 0, -1, [[0, "#b9c1ca"], [1, "#4b535c"]]);
  g.fill(poly([[-71.3, -8], [-71, -6], [-74, -1.5], [-76.6, -6], [-76.4, -8]]));
  hazard(g, shank, -78, -24, 10, 3.2);

  // ---- Push arm (C-frame) and blade lift cylinder, behind the hood/fender.
  bar(g, [-2, -15], [68, -10], 5, Y_LIGHT, Y_DARK);
  g.fillStyle = IRON;
  g.beginPath();
  g.arc(-2, -15, 2.8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = IRON_LIGHT;
  g.beginPath();
  g.arc(-2.4, -15.4, 1.2, 0, Math.PI * 2);
  g.fill();
  // Tilt brace.
  bar(g, [40, -28], [69, -20], 3.4, Y, Y_DARK);

  // ---- Fender/deck over the track.
  const fender = rrect(TX0 - 3, -34.5, TX1 - TX0 + 6, 5.5, 2);
  paint(g, scale, fender, -34.5, -29, { spec: 0.5, grime: 0.2 });
  g.fillStyle = "rgba(20, 14, 0, 0.55)";
  g.fillRect(TX0 - 2, -29.4, TX1 - TX0 + 4, 1.2);

  // ---- Engine hood.
  const hood = poly([
    [-13, -34],
    [-13, -63],
    [44, -63],
    [50, -60.5],
    [54.5, -55],
    [56, -40],
    [56, -34],
  ]);
  paint(g, scale, hood, -63, -34);
  g.save();
  g.clip(hood);
  // Side access doors.
  g.strokeStyle = "rgba(80, 52, 0, 0.6)";
  g.lineWidth = 0.7;
  g.strokeRect(-9, -58, 22, 21);
  g.strokeRect(15, -58, 22, 21);
  // Louvers.
  for (let i = 0; i < 7; i++) {
    const x = 22.5 + i * 2.2;
    g.fillStyle = "rgba(30, 20, 0, 0.65)";
    g.fillRect(x, -55, 1.3, 11);
    g.fillStyle = "rgba(255, 245, 200, 0.45)";
    g.fillRect(x, -55, 1.3, 0.6);
  }
  // Brand stripe and name.
  g.fillStyle = "#1d1d1d";
  g.fillRect(-13, -40.5, 70, 1.6);
  g.font = "bold 5.2px 'Segoe UI', Arial, sans-serif";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#1d1d1d";
  g.fillText("FROSTBITE", -7.5, -44);
  g.font = "bold 3.2px 'Segoe UI', Arial, sans-serif";
  g.fillText("SNOW 900", -7.3, -50.5);
  // Front: dark radiator grille with mesh.
  const grille = poly([[50.5, -59], [54, -55], [55.3, -41], [51.6, -41]]);
  g.fillStyle = "#16181b";
  g.fill(grille);
  g.strokeStyle = "rgba(255, 255, 255, 0.12)";
  g.lineWidth = 0.4;
  for (let y = -58; y < -41; y += 1.4) {
    g.beginPath();
    g.moveTo(50.6, y);
    g.lineTo(55.4, y);
    g.stroke();
  }
  // Ambient occlusion along the bottom of the hood.
  softStroke(g, scale, "rgba(40, 25, 0, 0.45)", 3, 1.4, () => {
    g.moveTo(-13, -35);
    g.lineTo(56, -35);
  });
  g.restore();
  for (const [x, y] of [[-8, -57], [12, -57], [-8, -38], [12, -38], [16, -57], [36, -57]] as Pt[]) bolt(g, x, y, 0.55);
  rimLight(g, scale, box, hood);
  // Hood-top grab rail.
  g.strokeStyle = "#1c1d20";
  g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(-6, -63);
  g.lineTo(-6, -67);
  g.lineTo(42, -67);
  g.lineTo(42, -63);
  g.moveTo(18, -63);
  g.lineTo(18, -67);
  g.stroke();
  g.strokeStyle = "rgba(255, 255, 255, 0.35)";
  g.lineWidth = 0.4;
  g.beginPath();
  g.moveTo(-6, -67.4);
  g.lineTo(42, -67.4);
  g.stroke();
  snowCap(g, -12, 44, -63, 3.6, 1);

  // Air pre-cleaner and exhaust stack.
  g.fillStyle = lin(g, 9, 0, 17, 0, [[0, "#22252a"], [0.45, "#6a727c"], [1, "#22252a"]]);
  g.fillRect(9.5, -71, 7, 8);
  g.fillStyle = "#121315";
  g.fillRect(8.5, -72.6, 9, 2);
  g.fillStyle = "rgba(255, 190, 60, 0.75)";
  g.fillRect(9.5, -66, 7, 1.2);
  const stack = new Path2D();
  stack.moveTo(34, -63);
  stack.lineTo(34, -84);
  stack.quadraticCurveTo(34, -88, 38, -88.5);
  stack.lineTo(39.5, -88.5);
  stack.lineTo(39.5, -86);
  stack.quadraticCurveTo(38.6, -85.4, 38.6, -83);
  stack.lineTo(38.6, -63);
  stack.closePath();
  g.fillStyle = lin(g, 34, 0, 38.6, 0, [[0, "#1d2024"], [0.4, "#757d87"], [1, "#1d2024"]]);
  g.fill(stack);
  // Heat shield.
  g.fillStyle = lin(g, 33, 0, 40, 0, [[0, "#3a3f46"], [0.5, "#9aa3ad"], [1, "#3a3f46"]]);
  g.fillRect(33.2, -78, 6.2, 8);
  g.strokeStyle = "rgba(0, 0, 0, 0.45)";
  g.lineWidth = 0.4;
  for (let y = -77; y < -70; y += 1.6) {
    g.beginPath();
    g.moveTo(33.4, y);
    g.lineTo(39.2, y);
    g.stroke();
  }

  // ---- Cab.
  const cab = poly([
    [-58, -34],
    [-58, -88],
    [-55, -92],
    [-20, -92],
    [-16, -88],
    [-11, -34],
  ]);
  paint(g, scale, cab, -92, -34);
  const glassSide = poly([[-54, -40], [-54, -86], [-36.5, -86], [-36.5, -40]]);
  const glassFront = poly([[-33.5, -40], [-33.5, -86], [-20.5, -86], [-16.5, -78], [-14.5, -40]]);
  for (const glass of [glassSide, glassFront]) {
    g.fillStyle = lin(g, -54, -86, -20, -40, [
      [0, "#a9c9e8"],
      [0.45, "#47709b"],
      [1, "#162a42"],
    ]);
    g.fill(glass);
  }
  g.save();
  g.clip(glassFront);
  g.clip(new Path2D());
  g.restore();
  // Operator, seen through the front glass.
  g.save();
  g.clip(glassFront);
  g.fillStyle = "#355e3f";
  g.beginPath();
  g.ellipse(-25, -42, 10, 9, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = "#2a4a32";
  g.fillRect(-27, -50, 2, 8);
  const face = g.createRadialGradient(-23, -57, 0.5, -22.5, -56, 6);
  face.addColorStop(0, "#f8d3b3");
  face.addColorStop(1, "#d79b78");
  g.fillStyle = face;
  g.beginPath();
  g.arc(-22.5, -56, 5.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#1a1210";
  g.beginPath();
  g.arc(-19.2, -56.8, 0.75, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(230, 110, 110, 0.4)";
  g.beginPath();
  g.arc(-19.5, -54.4, 1.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#c81f2c";
  g.beginPath();
  g.ellipse(-23, -60.2, 6, 4, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = "#f2f2f2";
  g.fillRect(-29, -61, 12, 2.2);
  g.beginPath();
  g.arc(-23.5, -64.8, 1.9, 0, Math.PI * 2);
  g.fill();
  // Joystick.
  g.strokeStyle = "#151515";
  g.lineWidth = 1.1;
  g.beginPath();
  g.moveTo(-17, -40);
  g.lineTo(-18.5, -47);
  g.stroke();
  g.restore();
  // Glass reflections.
  for (const glass of [glassSide, glassFront]) {
    g.save();
    g.clip(glass);
    g.fillStyle = "rgba(255, 255, 255, 0.26)";
    g.beginPath();
    g.moveTo(-56, -62);
    g.lineTo(-38, -88);
    g.lineTo(-31, -88);
    g.lineTo(-56, -52);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255, 255, 255, 0.12)";
    g.beginPath();
    g.moveTo(-30, -88);
    g.lineTo(-26, -88);
    g.lineTo(-44, -38);
    g.lineTo(-48, -38);
    g.closePath();
    g.fill();
    g.restore();
  }
  // Wiper and door handle.
  g.strokeStyle = "#141414";
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(-24, -41);
  g.lineTo(-19, -58);
  g.stroke();
  g.fillStyle = "#151515";
  g.fillRect(-40, -63, 3, 1.2);
  rimLight(g, scale, box, cab);
  // Roof with overhang, work lights.
  const roof = rrect(-61, -97.5, 48, 6.5, 2);
  g.fillStyle = lin(g, 0, -97.5, 0, -91, [[0, "#4a4f57"], [0.4, "#2a2d32"], [1, "#121315"]]);
  g.fill(roof);
  g.fillStyle = "rgba(255, 255, 255, 0.25)";
  g.fillRect(-59, -97, 44, 0.8);
  for (const x of [-18, -56]) {
    g.fillStyle = "#1b1c1f";
    g.fillRect(x - 2.4, -100.5, 4.8, 3.2);
    g.fillStyle = "#fff6d8";
    g.fillRect(x + (x > -30 ? 1.4 : -2.4), -100, 1, 2.2);
  }
  snowCap(g, -60, -14, -97.5, 4.6, 3);
  // Mirror on the front pillar.
  g.strokeStyle = "#1b1b1b";
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(-16.5, -78);
  g.lineTo(-10, -82);
  g.stroke();
  g.fillStyle = "#202226";
  g.fill(rrect(-11, -87, 3, 7, 1));
  g.fillStyle = "rgba(170, 200, 230, 0.7)";
  g.fillRect(-10.4, -86, 1.2, 5);
  // Step and grab handle under the door.
  g.fillStyle = "#1c1d20";
  g.fillRect(-46, -33, 9, 1.4);
  g.strokeStyle = "#1c1d20";
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(-59.5, -70);
  g.lineTo(-59.5, -46);
  g.stroke();

  // ---- Rear counterweight / fuel tank with hazard stripes and tail light.
  const rear = poly([[-58, -34], [-58, -53], [-64, -50], [-65, -34]]);
  g.fillStyle = lin(g, 0, -53, 0, -34, [[0, "#3c4047"], [1, "#16181b"]]);
  g.fill(rear);
  hazard(g, rear, -66, -38, 9, 3.4);
  g.fillStyle = "#c4141e";
  g.fillRect(-65.2, -48, 1.6, 4.4);
  g.fillStyle = "rgba(255, 120, 120, 0.8)";
  g.fillRect(-65.2, -48, 1.6, 1);

  // ---- Lift cylinder to the blade (in front of the hood).
  bar(g, [47, -50], [60, -44], 5.2, Y, Y_DARK);
  chrome(g, [59, -44.5], [70, -40], 2.4);

  // ---- Blade.
  const blade = new Path2D();
  blade.moveTo(66, -57);
  blade.quadraticCurveTo(61, -26, 65, 1);
  blade.lineTo(85, 1);
  blade.quadraticCurveTo(70, -22, 80, -55);
  blade.lineTo(81.5, -58.5);
  blade.quadraticCurveTo(74, -61.5, 66, -57);
  blade.closePath();
  paint(g, scale, blade, -60, 1, { spec: 0.35 });
  g.save();
  g.clip(blade);
  // The concave working face, in shadow.
  g.fillStyle = lin(g, 84, 0, 66, 0, [[0, "rgba(70, 45, 0, 0.55)"], [0.6, "rgba(70, 45, 0, 0.12)"], [1, "rgba(70, 45, 0, 0)"]]);
  g.fillRect(60, -62, 28, 66);
  // Stiffener plates.
  g.strokeStyle = "rgba(85, 55, 0, 0.6)";
  g.lineWidth = 0.9;
  for (const y of [-45, -31, -17]) {
    g.beginPath();
    g.moveTo(62, y);
    g.lineTo(80, y + 0.8);
    g.stroke();
    g.strokeStyle = "rgba(255, 240, 190, 0.45)";
    g.beginPath();
    g.moveTo(62, y - 0.8);
    g.lineTo(80, y);
    g.stroke();
    g.strokeStyle = "rgba(85, 55, 0, 0.6)";
  }
  g.restore();
  hazard(g, blade, 64, -60, 20, 3.4);
  // Steel cutting edge with bolts.
  const edge = poly([[64.3, -5], [72.3, -5], [86, 1.6], [65, 1.6]]);
  g.fillStyle = lin(g, 0, -5, 0, 1.6, [[0, "#d7dde4"], [0.5, "#9aa4af"], [1, "#4b535c"]]);
  g.fill(edge);
  for (const x of [67, 71, 75]) {
    g.fillStyle = "#3a4048";
    g.beginPath();
    g.arc(x, -1.8, 0.55, 0, Math.PI * 2);
    g.fill();
  }
  rimLight(g, scale, box, blade);
  snowCap(g, 66, 81, -59, 3.2, 5);

  // Crisp outlines.
  g.strokeStyle = "rgba(40, 26, 0, 0.6)";
  g.lineWidth = 0.6;
  g.stroke(hood);
  g.stroke(cab);
  g.stroke(blade);
}

const sprites = new Map<number, HTMLCanvasElement>();

function bodySprite(scale: number): HTMLCanvasElement {
  let c = sprites.get(scale);
  if (c) return c;
  if (sprites.size > 6) sprites.clear();
  const inner = layer(scale, BODY_BOX);
  paintBody(inner.g, scale);
  const out = layer(scale, BODY_BOX);
  out.g.setTransform(1, 0, 0, 1, 0, 0);
  out.g.shadowColor = "rgba(4, 10, 24, 0.4)";
  out.g.shadowBlur = 3.5 * scale;
  out.g.shadowOffsetX = 1 * scale;
  out.g.shadowOffsetY = 2 * scale;
  out.g.drawImage(inner.c, 0, 0);
  c = out.c;
  sprites.set(scale, c);
  return c;
}

// ---------------------------------------------------------------- tracks (per frame)

/** Point and tangent angle at distance s along the track chain (clockwise from the top-rear). */
function chainAt(s: number): [number, number, number] {
  const S = CX1 - CX0;
  const L = 2 * S + 2 * Math.PI * TR;
  s = ((s % L) + L) % L;
  if (s < S) return [CX0 + s, TCY - TR, 0];
  s -= S;
  if (s < Math.PI * TR) {
    const a = -Math.PI / 2 + s / TR;
    return [CX1 + TR * Math.cos(a), TCY + TR * Math.sin(a), a + Math.PI / 2];
  }
  s -= Math.PI * TR;
  if (s < S) return [CX1 - s, TCY + TR, Math.PI];
  s -= S;
  const a = Math.PI / 2 + s / TR;
  return [CX0 + TR * Math.cos(a), TCY + TR * Math.sin(a), a + Math.PI / 2];
}

function wheel(ctx: G, x: number, y: number, r: number, angle: number, kind: "roller" | "idler" | "sprocket"): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (kind === "sprocket") {
    ctx.fillStyle = "#24272b";
    ctx.beginPath();
    const n = 11;
    for (let i = 0; i < n * 2; i++) {
      const a = (i * Math.PI) / n;
      const rr = i % 2 ? r * 0.88 : r * 1.08;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, 0, 0, 0, r);
  g.addColorStop(0, "#7a828c");
  g.addColorStop(0.7, "#3d4249");
  g.addColorStop(1, "#202327");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, kind === "sprocket" ? r * 0.86 : r, 0, Math.PI * 2);
  ctx.fill();
  if (kind !== "roller") {
    // Yellow hub with lightening holes.
    ctx.fillStyle = Y_MID;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2b2e33";
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = "#16181b";
  ctx.beginPath();
  ctx.arc(0, 0, r * (kind === "roller" ? 0.3 : 0.2), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
  ctx.beginPath();
  ctx.arc(-r * 0.08, -r * 0.08, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function tracks(ctx: G, dist: number): void {
  // The chain band.
  const loop = new Path2D();
  loop.moveTo(CX0, TCY - TR);
  loop.lineTo(CX1, TCY - TR);
  loop.arc(CX1, TCY, TR, -Math.PI / 2, Math.PI / 2);
  loop.lineTo(CX0, TCY + TR);
  loop.arc(CX0, TCY, TR, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.strokeStyle = "#141517";
  ctx.lineWidth = 6;
  ctx.stroke(loop);

  // Inner window behind the wheels.
  ctx.fillStyle = "#17181b";
  ctx.beginPath();
  ctx.moveTo(CX0, TCY - TR + 2);
  ctx.lineTo(CX1, TCY - TR + 2);
  ctx.arc(CX1, TCY, TR - 2, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(CX0, TCY + TR - 2);
  ctx.arc(CX0, TCY, TR - 2, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.fill();

  // Track roller frame.
  const frame = rrect(CX0 + 5, TCY - 5, CX1 - CX0 - 10, 8, 2);
  ctx.fillStyle = lin(ctx, 0, TCY - 5, 0, TCY + 3, [[0, Y_LIGHT], [0.4, Y], [1, Y_DARK]]);
  ctx.fill(frame);
  ctx.fillStyle = "rgba(30, 20, 0, 0.5)";
  ctx.fillRect(CX0 + 7, TCY + 1.6, CX1 - CX0 - 14, 0.8);

  // Wheels turn with the distance driven.
  const roll = dist / 4.2;
  for (let i = 0; i < 6; i++) wheel(ctx, CX0 + 13 + i * 12.4, -8.2, 4.2, roll, "roller");
  wheel(ctx, (CX0 + CX1) / 2, TCY - TR + 4.4, 2.6, -dist / 2.6, "roller");
  wheel(ctx, CX1, TCY, TR - 2.6, dist / (TR - 2.6), "idler");
  wheel(ctx, CX0, TCY, TR - 1.6, dist / (TR - 1.6), "sprocket");

  // Track shoes: one plate per link, moving along the chain.
  const L = 2 * (CX1 - CX0) + 2 * Math.PI * TR;
  const n = Math.round(L / SHOE);
  const pitch = L / n;
  for (let i = 0; i < n; i++) {
    const [x, y, a] = chainAt(i * pitch + dist);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    // Outward is local -y (the chain runs clockwise).
    ctx.fillStyle = "#2c2f34";
    ctx.fillRect(-pitch / 2 + 0.35, -3.6, pitch - 0.7, 4.4);
    ctx.fillStyle = "#4a5058";
    ctx.fillRect(-pitch / 2 + 0.35, -3.6, pitch - 0.7, 0.9);
    // Grouser bar.
    ctx.fillStyle = "#121315";
    ctx.fillRect(-0.9, -4.4, 1.8, 1.6);
    ctx.restore();
  }
  // Snow packed on the top run and dirt-dark bottom.
  ctx.fillStyle = "rgba(245, 249, 255, 0.85)";
  for (let x = CX0 + 4; x < CX1 - 4; x += 7) {
    ctx.beginPath();
    ctx.ellipse(x + ((x * 7) % 3), TCY - TR - 3.6, 2.2, 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- lights

function beacon(ctx: G, t: number): void {
  const x = -37;
  const y = -101;
  const a = t * 7;
  const on = 0.55 + 0.45 * Math.max(0, Math.cos(a));
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 26);
  glow.addColorStop(0, `rgba(255, 168, 30, ${0.6 * on})`);
  glow.addColorStop(1, "rgba(255, 150, 20, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1f2124";
  ctx.fillRect(x - 4.5, y + 2.4, 9, 2.2);
  const sx = Math.sin(a) * 0.5 + 0.5;
  const dome = ctx.createLinearGradient(x - 4, 0, x + 4, 0);
  dome.addColorStop(0, "#c25e00");
  dome.addColorStop(Math.max(0.01, Math.min(0.99, sx)), `rgba(255, 238, 170, ${0.65 + 0.35 * on})`);
  dome.addColorStop(1, "#c25e00");
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.moveTo(x - 4, y + 2.6);
  ctx.lineTo(x - 3.5, y - 2.6);
  ctx.quadraticCurveTo(x, y - 6, x + 3.5, y - 2.6);
  ctx.lineTo(x + 4, y + 2.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillRect(x - 2.6, y - 2, 0.8, 3.4);
}

function beams(ctx: G): void {
  const list: [number, number, number, number][] = [
    [55, -53, 0.08, 90], // hood headlight
    [-16, -99, 0.22, 110], // roof work light
  ];
  for (const [x, y, tilt, len] of list) {
    const g = ctx.createLinearGradient(x, y, x + len, y + len * tilt);
    g.addColorStop(0, "rgba(255, 247, 215, 0.4)");
    g.addColorStop(1, "rgba(255, 247, 215, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y - 1.6);
    ctx.lineTo(x + len, y + len * tilt - 18);
    ctx.lineTo(x + len, y + len * tilt + 18);
    ctx.lineTo(x, y + 1.6);
    ctx.closePath();
    ctx.fill();
  }
  // Headlight housing.
  ctx.fillStyle = "#1b1c1f";
  ctx.fillRect(52.5, -55.5, 3.6, 5);
  const hl = ctx.createRadialGradient(55, -53, 0, 55, -53, 2.6);
  hl.addColorStop(0, "#ffffff");
  hl.addColorStop(1, "#ffe9a8");
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.arc(55, -53, 1.9, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draw the bulldozer standing on `groundY` with the track centre at x.
 * `dir` 1 = facing right, -1 = facing left. `dist` is how far it has driven
 * (moves the tracks); `t` is seconds (beacon, engine idle shake).
 */
export function drawDozer(ctx: G, x: number, groundY: number, k: number, dist: number, t: number, dir: 1 | -1 = 1): void {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(k * dir, k);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const scale = deviceScale(ctx);
  const shake = Math.sin(t * 46) * 0.3 + Math.sin(t * 17) * 0.15;

  // Soft contact shadow on the snow.
  const sh = ctx.createRadialGradient(-5, 0, 0, -5, 0, 80);
  sh.addColorStop(0, "rgba(10, 20, 40, 0.28)");
  sh.addColorStop(1, "rgba(10, 20, 40, 0)");
  ctx.fillStyle = sh;
  ctx.save();
  ctx.scale(1, 0.08);
  ctx.beginPath();
  ctx.arc(-5, 0, 80, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  beams(ctx);
  tracks(ctx, dist);
  ctx.save();
  ctx.translate(0, shake);
  ctx.drawImage(bodySprite(scale), BODY_BOX[0], BODY_BOX[1], BODY_BOX[2], BODY_BOX[3]);
  beacon(ctx, t);
  ctx.restore();
  ctx.restore();
}

/** Exhaust stack tip, for smoke (dozer space at k = 1). */
export const EXHAUST_TIP = { x: 39, y: -89 };

/**
 * Snow heap pushed in front of the blade. `mass` is the snow collected (px²
 * at k = 1); the heap grows with it and rolls over as it moves.
 */
export function drawMound(ctx: G, bladeX: number, groundY: number, k: number, mass: number, t: number, dir: 1 | -1 = 1): void {
  if (mass <= 1) return;
  const h = Math.min(44, Math.sqrt(mass) * 0.6) * k;
  const w = Math.min(52, 6 + Math.sqrt(mass) * 0.95) * k;
  ctx.save();
  ctx.translate(bladeX, groundY);
  ctx.scale(dir, 1);

  // Main heap: leaning against the blade, sloping forward.
  const heap = new Path2D();
  heap.moveTo(-3 * k, 0);
  heap.lineTo(-4 * k, -h);
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = -4 * k + u * (w + 4 * k);
    const y = -h * Math.pow(Math.cos((u * Math.PI) / 2), 0.75);
    heap.lineTo(x, Math.min(0, y));
  }
  heap.lineTo(w, 0);
  heap.closePath();
  ctx.fillStyle = (() => {
    const g = ctx.createLinearGradient(0, -h, w * 0.6, 0);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.6, "#e9f0f8");
    g.addColorStop(1, "#b8cade");
    return g;
  })();
  ctx.fill(heap);

  // Rolling clumps on the surface (they tumble forward as it pushes).
  const roll = (t * 2.2) % 1;
  for (let i = 0; i < 7; i++) {
    const u = ((i / 7 + roll * 0.14) % 1) * 0.92;
    const x = -4 * k + u * (w + 4 * k);
    const y = -h * Math.pow(Math.cos((u * Math.PI) / 2), 0.75);
    const r = (2.2 + ((i * 37) % 5) * 0.5) * k * Math.min(1, h / (14 * k));
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, 0, x, y, r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#c7d6e8");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y + r * 0.3, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Shadow where it meets the blade, and a blue-ish underside.
  ctx.save();
  ctx.clip(heap);
  ctx.fillStyle = "rgba(90, 120, 160, 0.3)";
  ctx.fillRect(-6 * k, -h, 6 * k, h);
  ctx.fillStyle = "rgba(110, 140, 180, 0.25)";
  ctx.fillRect(-6 * k, -h * 0.25, w + 8 * k, h * 0.25);
  ctx.restore();
  // Glints.
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (let i = 0; i < 5; i++) {
    const x = ((i * 53 + Math.floor(t * 3) * 17) % 100) / 100 * w * 0.8;
    const y = -h * 0.75 * Math.pow(Math.cos((x / Math.max(1, w)) * Math.PI / 2), 0.75);
    ctx.fillRect(x, y, 0.9 * k, 0.9 * k);
  }
  ctx.restore();
}
