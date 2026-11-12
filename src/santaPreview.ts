/** Dev-only preview page for the Santa team (open /santa-preview.html). */
import { drawSantaTeam, SLEIGH_TAIL } from "./snow/santaRender";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let mode: "fly" | "close" = "fly";
const flyBtn = document.getElementById("fly")!;
const closeBtn = document.getElementById("close")!;
flyBtn.onclick = () => setMode("fly");
closeBtn.onclick = () => setMode("close");
function setMode(m: typeof mode): void {
  mode = m;
  flyBtn.classList.toggle("on", m === "fly");
  closeBtn.classList.toggle("on", m === "close");
  sparks.length = 0;
}

let W = 0;
let H = 0;
let dpr = 1;
function resize(): void {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
}
window.addEventListener("resize", resize);
resize();

interface Spark { x: number; y: number; vx: number; vy: number; life: number; size: number; star: boolean }
const sparks: Spark[] = [];
const flakes = Array.from({ length: 140 }, () => ({
  x: Math.random(), y: Math.random(), r: 0.8 + Math.random() * 2, v: 0.03 + Math.random() * 0.05,
}));

function background(): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0b1b30");
  g.addColorStop(1, "#2d5a86");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(240, 244, 250, 0.92)";
  ctx.fillRect(W * 0.2, H * 0.5, W * 0.4, H * 0.36);
  ctx.fillStyle = "rgba(200, 210, 225, 0.95)";
  ctx.fillRect(W * 0.2, H * 0.5, W * 0.4, 28);
  ctx.fillStyle = "rgba(20, 24, 32, 0.9)";
  ctx.fillRect(0, H - 44, W, 44);
}

function star(x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 ? r * 0.28 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

let last = performance.now() / 1000;
const start = last;
function frame(): void {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  const t = now - start;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  background();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (const f of flakes) {
    f.y = (f.y + f.v * dt) % 1;
    ctx.beginPath();
    ctx.arc(f.x * W, f.y * H, f.r, 0, Math.PI * 2);
    ctx.fill();
  }

  let x: number;
  let y: number;
  let k: number;
  if (mode === "fly") {
    const dur = 13;
    const p = (t % dur) / dur;
    k = 0.7;
    x = W + 100 - p * (W + 560);
    y = H * 0.28 + Math.sin(p * Math.PI * 2) * 30;
  } else {
    k = Math.min(2.3, (W - 40) / 560);
    x = W / 2 + 170 * k;
    y = H / 2 + 50 * k;
  }

  // Magic dust behind the sleigh.
  for (let i = 0; i < 4; i++) {
    sparks.push({
      x: x + SLEIGH_TAIL.x * k,
      y: y + SLEIGH_TAIL.y * k + (Math.random() - 0.5) * 16 * k,
      vx: (mode === "fly" ? 0 : 70) + Math.random() * 30,
      vy: 8 + Math.random() * 22,
      life: 1,
      size: (0.8 + Math.random() * 1.8) * k,
      star: Math.random() < 0.15,
    });
  }
  ctx.globalCompositeOperation = "lighter";
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt * 0.8;
    if (s.life <= 0) { sparks.splice(i, 1); continue; }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const tw = 0.6 + 0.4 * Math.sin(t * 20 + i);
    ctx.fillStyle = `rgba(255, 220, 140, ${s.life * tw * 0.9})`;
    if (s.star) star(s.x, s.y, s.size * 3.2 * s.life);
    else {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * (0.5 + s.life * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = "source-over";

  drawSantaTeam(ctx, x, y, k, t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
