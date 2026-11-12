/** Dev-only preview of the snow bulldozer (open /dozer-preview.html). */
import { BLADE_FRONT, DOZER_BACK, EXHAUST_TIP, drawDozer, drawMound } from "./snow/dozerRender";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let mode: "plow" | "close" = "plow";
const plowBtn = document.getElementById("plow")!;
const closeBtn = document.getElementById("close")!;
plowBtn.onclick = () => setMode("plow");
closeBtn.onclick = () => setMode("close");
function setMode(m: typeof mode): void {
  mode = m;
  plowBtn.classList.toggle("on", m === "plow");
  closeBtn.classList.toggle("on", m === "close");
  reset();
}

let W = 0;
let H = 0;
let dpr = 1;
const TASKBAR = 48;
/** Snow height per px column on top of the taskbar. */
let snow = new Float32Array(0);

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  reset();
}

let dozerX = 0;
let dist = 0;
let mound = 0;
let wait = 0;
interface Bit { x: number; y: number; vx: number; vy: number; r: number; life: number }
interface Puff { x: number; y: number; vx: number; vy: number; r: number; life: number }
const bits: Bit[] = [];
const puffs: Puff[] = [];
const flakes = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), r: 0.8 + Math.random() * 1.8, v: 0.03 + Math.random() * 0.05 }));

function reset(): void {
  snow = new Float32Array(Math.max(1, Math.ceil(W)));
  for (let i = 0; i < snow.length; i++) {
    snow[i] = 9 + 4 * Math.sin(i * 0.031) + 2.5 * Math.sin(i * 0.11 + 1) + Math.random() * 1.5;
  }
  const k = kNow();
  dozerX = mode === "close" ? W * 0.3 : -BLADE_FRONT * k - 10;
  dist = 0;
  mound = 0;
  wait = 0.6;
  bits.length = 0;
}

function kNow(): number {
  return mode === "close" ? Math.min(2.4, (W - 60) / 240) : 1;
}

window.addEventListener("resize", resize);
resize();

function background(ground: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0b1b30");
  g.addColorStop(1, "#2d5a86");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  if (mode === "plow") {
    ctx.fillStyle = "rgba(240, 244, 250, 0.92)";
    ctx.fillRect(W * 0.15, H * 0.25, W * 0.45, H * 0.4);
    ctx.fillStyle = "rgba(200, 210, 225, 0.95)";
    ctx.fillRect(W * 0.15, H * 0.25, W * 0.45, 28);
  }
  ctx.fillStyle = "rgba(20, 24, 32, 0.95)";
  ctx.fillRect(0, ground, W, H - ground);
}

function drawSnow(ground: number): void {
  ctx.beginPath();
  ctx.moveTo(0, ground);
  for (let x = 0; x < snow.length; x += 2) ctx.lineTo(x, ground - snow[x]);
  ctx.lineTo(W, ground);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, ground - 16, 0, ground);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(1, "#cfdcec");
  ctx.fillStyle = g;
  ctx.fill();
}

let last = performance.now() / 1000;
const start = last;
function frame(): void {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  const t = now - start;
  const k = kNow();
  const ground = mode === "close" ? H * 0.72 : H - TASKBAR;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  background(ground);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (const f of flakes) {
    f.y = (f.y + f.v * dt) % 1;
    ctx.beginPath();
    ctx.arc(f.x * W, f.y * H, f.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Drive, cutting the snow at the blade into the mound.
  if (wait > 0) wait -= dt;
  else {
    const speed = 95 * k;
    const prevBlade = dozerX + BLADE_FRONT * k;
    dozerX += speed * dt;
    dist += (speed * dt) / k;
    const blade = dozerX + BLADE_FRONT * k;
    for (let x = Math.max(0, Math.floor(prevBlade)); x < Math.min(snow.length, Math.floor(blade)); x++) {
      const take = Math.max(0, snow[x] - 0.6);
      mound += take;
      snow[x] -= take;
    }
    // Snow spills over the mound's sides and gets thrown up a little.
    if (mound > 40 && Math.random() < 0.6) {
      bits.push({
        x: blade + (6 + Math.random() * 18) * k,
        y: ground - Math.min(40, Math.sqrt(mound) * 0.55) * k,
        vx: (40 + Math.random() * 80) * k,
        vy: (-60 - Math.random() * 90) * k,
        r: (1 + Math.random() * 2) * k,
        life: 1,
      });
    }
    // Exhaust puffs.
    if (Math.random() < 0.35) {
      puffs.push({ x: dozerX + EXHAUST_TIP.x * k, y: ground + EXHAUST_TIP.y * k, vx: (-15 + Math.random() * 10) * k, vy: (-25 - Math.random() * 15) * k, r: 3 * k, life: 1 });
    }
    // Off the right edge: start over.
    if (dozerX + DOZER_BACK * k > W + 40) reset();
  }

  drawSnow(ground);

  // Exhaust (behind the dozer).
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.life -= dt * 0.6;
    if (p.life <= 0) { puffs.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.r += 9 * k * dt;
    ctx.fillStyle = `rgba(70, 76, 86, ${0.35 * p.life})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawDozer(ctx, dozerX, ground, k, dist, t, 1);
  drawMound(ctx, dozerX + BLADE_FRONT * k, ground, k, mound / k, t, 1);

  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.life -= dt * 1.2;
    b.vy += 500 * k * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y > ground - 1 || b.life <= 0) { bits.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, b.life * 1.5)})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
