/**
 * Dev-only preview of "the fish thief" (open /critter-preview.html):
 * a polar bear sits down with a fish, a penguin sneaks in and steals it, and
 * the bear chases it across the taskbar. `?sheet` shows every pose.
 */
import { drawAlert, drawFish, drawHeart, type BearPose, type PenguinPose } from "./snow/critterRender";
import { drawBearSprite as drawBear, drawPenguinSprite as drawPenguin } from "./snow/critterSprites";

type Ending = "escape" | "share" | "drop";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let W = 0;
let H = 0;
let dpr = 1;
let close = false;
let endingChoice: Ending | "random" = "random";

const k = () => (close ? Math.min(2.3, W / 360) : 1);
const ground = () => (close ? H * 0.72 : H - 48);

interface Pen { x: number; dir: 1 | -1; pose: PenguinPose; phase: number; speed: number; t: number; fish: boolean; scared: boolean }
interface Bear { x: number; dir: 1 | -1; pose: BearPose; phase: number; speed: number; t: number; spin: number; angry: boolean; fish: boolean; content: boolean }
interface Bit { x: number; y: number; vx: number; vy: number; r: number; life: number }
interface Heart { x: number; y: number; t: number }
/** A fish on its own: lying on the snow or flying through the air. */
interface FreeFish { x: number; y: number; vx: number; vy: number; a: number; flying: boolean; half: boolean }

let pen: Pen;
let bear: Bear;
let ending: Ending = "escape";
let stage = "";
let stageT = 0;
let slid = false;
let tripped = false;
let alertT = -1;
const fishes: FreeFish[] = [];
const bits: Bit[] = [];
const hearts: Heart[] = [];
const grooves: [number, number][] = [];
let snow = new Float32Array(0);

function setStage(s: string): void {
  stage = s;
  stageT = 0;
}

function restart(): void {
  const K = k();
  ending = endingChoice === "random" ? (["escape", "share", "drop"] as Ending[])[Math.floor(Math.random() * 3)] : endingChoice;
  bear = { x: -70 * K, dir: 1, pose: "walk", phase: 0, speed: 46 * K, t: 0, spin: 0, angry: false, fish: true, content: false };
  pen = { x: W + 40 * K, dir: -1, pose: "stand", phase: 0, speed: 0, t: 0, fish: false, scared: false };
  slid = false;
  tripped = false;
  alertT = -1;
  fishes.length = 0;
  bits.length = 0;
  hearts.length = 0;
  grooves.length = 0;
  snow = new Float32Array(Math.max(1, Math.ceil(W)));
  for (let i = 0; i < snow.length; i++) snow[i] = (9 + 3 * Math.sin(i * 0.03) + 2 * Math.sin(i * 0.13 + 1)) * (close ? 1.6 : 1);
  setStage("walkIn");
}

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  restart();
}

function puff(x: number, y: number, n: number, power: number): void {
  const K = k();
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * Math.random();
    const sp = (40 + Math.random() * 120) * K * power;
    bits.push({ x: x + (Math.random() - 0.5) * 24 * K, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: (1 + Math.random() * 2.2) * K, life: 1 });
  }
}

function trip(): void {
  if (stage !== "chase" || bear.pose !== "run" || tripped) return;
  tripped = true;
  bear.pose = "tumble";
  bear.t = 0;
  puff(bear.x + 30 * k() * bear.dir, ground(), 28, 1);
}

for (const b of document.querySelectorAll<HTMLButtonElement>("#ui button[data-end]")) {
  b.onclick = () => {
    endingChoice = b.dataset.end as Ending | "random";
    document.querySelectorAll("#ui button[data-end]").forEach((e) => e.classList.toggle("on", e === b));
    restart();
  };
}
const closeBtn = document.getElementById("close")!;
closeBtn.onclick = () => {
  close = !close;
  closeBtn.classList.toggle("on", close);
  restart();
};
canvas.addEventListener("pointerdown", (e) => {
  const K = k();
  const g = ground();
  if (Math.abs(e.clientX - bear.x) < 55 * K && e.clientY > g - 55 * K && e.clientY < g + 5) trip();
  else if (Math.abs(e.clientX - pen.x) < 16 * K && e.clientY > g - 45 * K && pen.pose === "run") {
    pen.pose = "jump";
    pen.t = 0;
  }
});
window.addEventListener("resize", resize);
resize();

function update(dt: number): void {
  const K = k();
  const g = ground();
  stageT += dt;
  pen.t += dt;
  bear.t += dt;
  if (alertT >= 0) alertT += dt;

  switch (stage) {
    case "walkIn":
      // The bear strolls in with its catch.
      if (bear.x >= W * 0.28) {
        bear.pose = "sit";
        bear.speed = 0;
        bear.fish = false;
        bear.content = true;
        fishes.push({ x: bear.x + 62 * K, y: g - 2.5 * K, vx: 0, vy: 0, a: 0.05, flying: false, half: false });
        setStage("rest");
      }
      break;
    case "rest":
      // Enjoying the moment, eyes closed. The penguin sneaks in from the right.
      if (stageT > 0.8 && pen.pose === "stand") {
        pen.pose = "sneak";
        pen.speed = 42 * K;
      }
      if (fishes[0] && pen.x <= fishes[0].x + 20 * K) {
        pen.pose = "grab";
        pen.speed = 0;
        setStage("grab");
      }
      break;
    case "grab":
      if (stageT > 0.35 && !pen.fish) {
        pen.fish = true;
        fishes.length = 0;
      }
      if (stageT > 0.7) {
        // Off it goes, and the bear notices.
        pen.dir = 1;
        pen.pose = "run";
        pen.speed = 165 * K;
        pen.scared = true;
        bear.content = false;
        alertT = 0;
        setStage("notice");
      }
      break;
    case "notice":
      if (stageT > 0.25 && bear.pose === "sit") bear.pose = "roar";
      if (stageT > 0.9) {
        bear.pose = "run";
        bear.angry = true;
        bear.speed = 176 * K;
        alertT = -1;
        setStage("chase");
      }
      break;
    case "chase":
      if (!slid && pen.x > W * 0.55) {
        slid = true;
        pen.pose = "slide";
        pen.t = 0;
      }
      if (!tripped && bear.x > W * 0.52) trip();
      if (tripped && bear.pose === "run" && pen.x > W * 0.8) {
        if (ending === "share") {
          pen.pose = "stand";
          pen.speed = 0;
          pen.dir = -1;
          pen.scared = false;
          setStage("shareWait");
        } else if (ending === "drop") {
          // Startled jump: the fish flies out of its beak, back to the bear.
          pen.pose = "jump";
          pen.t = 0;
          pen.fish = false;
          fishes.push({ x: pen.x + 18 * K, y: g - 34 * K, vx: -(pen.x - bear.x) * 0.9, vy: -260 * K, a: 0, flying: true, half: false });
          setStage("dropped");
        } else {
          setStage("escape");
        }
      }
      break;
    case "escape":
      if (pen.x > W + 40 * K && bear.pose === "run") {
        bear.pose = "sit";
        bear.speed = 0;
        bear.angry = false;
      }
      if (bear.pose === "sit" && stageT > 3.2) {
        bear.dir = -1;
        bear.pose = "walk";
        bear.speed = 46 * K;
      }
      break;
    case "shareWait":
      if (bear.x > pen.x - 120 * K) {
        bear.pose = "sit";
        bear.speed = 0;
        bear.angry = false;
        setStage("share");
      }
      break;
    case "share":
      // The penguin tosses half the fish to the bear; they make friends.
      if (stageT > 0.5 && stageT - 0.016 <= 0.5 + dt) {
        fishes.push({ x: pen.x - 16 * K, y: g - 34 * K, vx: -(pen.x - (bear.x + 52 * K)) / 0.55, vy: -150 * K, a: 0, flying: true, half: true });
      }
      if (stageT > 1.1 && hearts.length < 5 && Math.random() < 0.08) hearts.push({ x: (pen.x + bear.x + 40 * K) / 2 + (Math.random() - 0.5) * 40 * K, y: g - 60 * K, t: 0 });
      if (stageT > 3.6) {
        pen.dir = 1;
        pen.pose = "run";
        pen.speed = 60 * K;
        pen.scared = false;
        bear.pose = "walk";
        bear.speed = 60 * K;
        bear.content = false;
        setStage("walkOff");
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

  // Penguin motion.
  if (pen.pose === "jump" && pen.t > 0.45 && stage !== "dropped") pen.pose = stage === "share" || stage === "shareWait" ? "stand" : "run";
  if (pen.pose === "slide") {
    pen.speed = (270 - 110 * Math.min(1, pen.t / 1.5)) * K;
    const last = grooves[grooves.length - 1];
    if (last && Math.abs(last[1] - pen.x) < 40) last[1] = pen.x;
    else grooves.push([pen.x, pen.x]);
    if (Math.random() < 0.7) bits.push({ x: pen.x - 20 * K * pen.dir, y: g - 2 * K, vx: -pen.dir * (30 + Math.random() * 70) * K, vy: (-30 - Math.random() * 60) * K, r: (0.8 + Math.random() * 1.5) * K, life: 0.8 });
    if (pen.t > 1.5) {
      pen.pose = "run";
      pen.speed = 165 * K;
    }
  }
  pen.x += pen.dir * pen.speed * dt;
  if (pen.pose === "run" || pen.pose === "sneak") pen.phase += (pen.speed * dt) / ((pen.pose === "sneak" ? 4 : 6) * K);

  // Bear motion.
  if (bear.pose === "tumble") {
    bear.spin = Math.min(1, bear.t / 0.9) * Math.PI * 2;
    bear.speed = 170 * K * Math.max(0, 1 - bear.t / 0.9);
    if (bear.t > 0.9) {
      bear.pose = "shake";
      bear.t = 0;
      bear.speed = 0;
      puff(bear.x, g - 24 * K, 18, 0.8);
    }
  } else if (bear.pose === "shake") {
    if (Math.random() < 0.8) bits.push({ x: bear.x + (Math.random() - 0.5) * 70 * K, y: g - (18 + Math.random() * 26) * K, vx: (Math.random() - 0.5) * 240 * K, vy: (-40 - Math.random() * 100) * K, r: (0.8 + Math.random() * 1.6) * K, life: 0.9 });
    if (bear.t > 0.9) {
      bear.pose = "run";
      bear.speed = 196 * K;
    }
  }
  bear.x += bear.dir * bear.speed * dt;
  if (bear.pose === "run" || bear.pose === "walk") bear.phase += (bear.speed * dt) / ((bear.pose === "walk" ? 9 : 13) * K);

  // Loose fish.
  for (let i = fishes.length - 1; i >= 0; i--) {
    const f = fishes[i];
    if (!f.flying) continue;
    f.vy += 520 * K * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.a += dt * 9;
    const mouthX = bear.x + 50 * K * bear.dir;
    if (stage === "dropped" || stage === "share") {
      // Caught by the bear.
      if (Math.abs(f.x - mouthX) < 18 * K && f.y > g - 40 * K) {
        fishes.splice(i, 1);
        bear.fish = true;
        bear.content = true;
        bear.angry = false;
        if (bear.pose === "run" || bear.pose === "tumble" || bear.pose === "shake") {
          bear.pose = "sit";
          bear.speed = 0;
        }
        continue;
      }
    }
    if (f.y > g - 2.5 * K) {
      f.y = g - 2.5 * K;
      f.flying = false;
      f.a = 0.05;
    }
  }
  if (stage === "dropped" && !bear.fish && bear.pose === "run") {
    // Run to where the fish landed and pick it up.
    const lying = fishes.find((f) => !f.flying);
    if (lying && Math.abs(bear.x + 50 * K - lying.x) < 20 * K) {
      fishes.splice(fishes.indexOf(lying), 1);
      bear.fish = true;
      bear.content = true;
      bear.angry = false;
      bear.pose = "sit";
      bear.speed = 0;
    }
  }

  const gone = (x: number, m: number) => x > W + m * K || x < -m * K;
  if (stage !== "walkIn" && stage !== "rest" && gone(pen.x, 60) && (gone(bear.x, 110) || (stage === "dropped" && bear.pose === "sit" && stageT > 4))) restart();
  if (stage === "escape" && bear.dir === -1 && bear.x < -110 * K) restart();

  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    b.life -= dt * 1.1;
    b.vy += 420 * K * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.life <= 0 || b.y > g) bits.splice(i, 1);
  }
  for (let i = hearts.length - 1; i >= 0; i--) {
    hearts[i].t += dt;
    hearts[i].y -= 22 * K * dt;
    if (hearts[i].t > 2) hearts.splice(i, 1);
  }
}

function drawScene(t: number): void {
  const K = k();
  const g = ground();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#0b1b30");
  sky.addColorStop(1, "#2d5a86");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  if (!close) {
    ctx.fillStyle = "rgba(240, 244, 250, 0.92)";
    ctx.fillRect(W * 0.15, H * 0.2, W * 0.45, H * 0.4);
    ctx.fillStyle = "rgba(200, 210, 225, 0.95)";
    ctx.fillRect(W * 0.15, H * 0.2, W * 0.45, 28);
  }
  ctx.fillStyle = "rgba(20, 24, 32, 0.95)";
  ctx.fillRect(0, g, W, H - g);
  ctx.beginPath();
  ctx.moveTo(0, g);
  for (let x = 0; x < snow.length; x += 2) {
    let h = snow[x];
    for (const [a, b] of grooves) if (x >= Math.min(a, b) && x <= Math.max(a, b)) h *= 0.45;
    ctx.lineTo(x, g - h);
  }
  ctx.lineTo(W, g);
  ctx.closePath();
  const sg = ctx.createLinearGradient(0, g - 16 * K, 0, g);
  sg.addColorStop(0, "#ffffff");
  sg.addColorStop(1, "#cfdcec");
  ctx.fillStyle = sg;
  ctx.fill();

  const sink = 3 * K;
  for (const f of fishes) drawFish(ctx, f.x, f.y - sink, K * (f.half ? 0.7 : 1), f.a, t, f.flying ? 1 : 0.15);
  drawBear(ctx, bear.x, g - sink, K, t, bear.pose, bear.phase, bear.dir, { spin: bear.spin, angry: bear.angry, fish: bear.fish, content: bear.content });
  drawPenguin(ctx, pen.x, g - sink, K, t, pen.pose, pen.phase, pen.dir, { scared: pen.scared && stage === "chase", fish: pen.fish, poseT: pen.t });
  if (alertT >= 0) drawAlert(ctx, bear.x + 34 * K * bear.dir, g - 66 * K, K, alertT);

  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (const b of bits) {
    ctx.globalAlpha = Math.min(1, b.life * 1.4);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const h of hearts) drawHeart(ctx, h.x, h.y, 9 * K * (0.6 + Math.min(1, h.t * 3) * 0.4), Math.max(0, 1 - h.t / 2));
}

/** ?sheet: every pose side by side, for checking the drawings. */
function drawSheet(t: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#1d3a5e";
  ctx.fillRect(0, 0, W, H);
  const K = Math.min(2.4, W / 330);
  const row1 = H * 0.34;
  const row2 = H * 0.8;
  for (const y of [row1, row2]) {
    ctx.fillStyle = "#e9f0f8";
    ctx.fillRect(0, y - 2 * K, W, 3 * K);
  }
  const pens: [PenguinPose, number, boolean][] = [["stand", 0, false], ["sneak", 0.8, false], ["grab", 0, false], ["run", 0.6, true], ["slide", 0, true], ["jump", 0, false]];
  pens.forEach(([p, ph, fish], i) => drawPenguin(ctx, (W / 6.4) * (i + 0.7), row1 - 2 * K, K * 0.9, t, p, ph, 1, { fish, scared: p === "run", poseT: 0.22 }));
  const K2 = K * 0.62;
  const bears: [BearPose, number, { fish?: boolean; angry?: boolean; content?: boolean; spin?: number }][] = [
    ["walk", 0.8, { fish: true }],
    ["sit", 0, { content: true }],
    ["roar", 0, { angry: true }],
    ["run", 0.4, { angry: true }],
    ["tumble", 0, { spin: 2.4 }],
  ];
  bears.forEach(([p, ph, o], i) => drawBear(ctx, (W / 5) * (i + 0.5) - 6 * K2, row2 - 2 * K, K2, t, p, ph, 1, o));
}

let last = performance.now() / 1000;
const t0 = last;
function frame(): void {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  if (location.search.includes("sheet")) drawSheet(now - t0);
  else {
    update(dt);
    drawScene(now - t0);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
