import { createBridge } from "./bridge";
import { FrameLoop } from "./loop";
import { PileRenderer } from "./snow/piles";
import { createRenderer } from "./snow/renderer";
import { MAX_FLAKES, SnowSim } from "./snow/sim";
import type { Intensity, Layout, Surfaces } from "./types";

const canvas = document.getElementById("snow") as HTMLCanvasElement;
const pileCanvas = document.getElementById("piles") as HTMLCanvasElement;
const debugEl = document.getElementById("debug") as HTMLDivElement;

const bridge = createBridge();
const sim = new SnowSim();
const renderer = createRenderer(canvas, MAX_FLAKES);
const piles = new PileRenderer(pileCanvas);

/** Piles change slowly: redraw them at most this often unless something moved. */
const PILE_REDRAW_INTERVAL = 0.05;

let layout: Layout;
let surfaces: Surfaces = { windows: [], taskbars: [] };
let debug = false;
let clock = 0;
let pileTimer = 0;

const now = () => performance.now() / 1000;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(window.innerWidth * dpr));
  const h = Math.max(1, Math.round(window.innerHeight * dpr));
  // Sim works in layout (physical) px; the canvas may differ slightly if the
  // webview's DPI doesn't match the OS rect exactly.
  const s = layout.width > 0 ? w / layout.width : 1;
  renderer.resize(w, h, s);
  piles.resize(w, h, s);
  if (debug) drawMonitorOutlines();
  loop.wake();
}

function applyLayout(l: Layout): void {
  layout = l;
  sim.setLayout(l);
  sim.ledges.setLayout(l, surfaces, now());
  resize();
}

function applySurfaces(s: Surfaces): void {
  surfaces = s;
  sim.ledges.sync(s, now());
  loop.wake();
}

function drawMonitorOutlines(): void {
  document.querySelectorAll(".mon-outline").forEach((e) => e.remove());
  const dpr = window.devicePixelRatio || 1;
  for (const m of layout.monitors) {
    const d = document.createElement("div");
    d.className = "mon-outline";
    Object.assign(d.style, {
      left: `${m.rect.x / dpr}px`,
      top: `${m.rect.y / dpr}px`,
      width: `${m.rect.w / dpr}px`,
      height: `${m.rect.h / dpr}px`,
    });
    document.body.appendChild(d);
  }
}

let fpsFrames = 0;
let fpsTime = 0;
let pileDraws = 0;

const loop = new FrameLoop((dt) => {
  clock += dt;
  sim.update(dt);
  renderer.draw(sim.pool);

  pileTimer += dt;
  if (sim.ledges.boxes.length > 0 || pileTimer >= PILE_REDRAW_INTERVAL) {
    pileTimer = 0;
    if (piles.render(sim.ledges)) pileDraws++;
  }

  if (debug) {
    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      const fps = fpsFrames / fpsTime;
      debugEl.textContent =
        `${renderer.kind}  ${fps.toFixed(0)} fps  cap ${loop.fpsCap}\n` +
        `flakes ${sim.pool.count}  ${sim.settings.intensity}  wind ${sim.windNow.toFixed(0)} px/s\n` +
        `ledges ${sim.ledges.list.length}  pile redraws ${(pileDraws / fpsTime).toFixed(0)}/s\n` +
        `monitors ${layout.monitors.length}  ${layout.width}×${layout.height}`;
      fpsFrames = 0;
      fpsTime = 0;
      pileDraws = 0;
    }
  }
  return !sim.idle;
});

async function start(): Promise<void> {
  const boot = await bridge.boot();
  debug = boot.debug;
  debugEl.style.display = debug ? "block" : "none";
  surfaces = boot.surfaces;
  applyLayout(boot.layout);
  if (debug) {
    // Console access for tuning and perf checks.
    Object.assign(window, { __frostbite: { sim, renderer, piles, loop, layout: () => layout } });
  }

  // Browser preview knobs: ?intensity=blizzard&wind=-0.5
  if (!bridge.native) {
    const q = new URLSearchParams(location.search);
    const i = q.get("intensity") as Intensity | null;
    if (i && i in { light: 1, normal: 1, blizzard: 1 }) sim.settings.intensity = i;
    const w = q.get("wind");
    if (w !== null) sim.settings.wind = Math.max(-1, Math.min(1, Number(w)));
  }

  bridge.onLayout(applyLayout);
  bridge.onSurfaces(applySurfaces);
  bridge.onCursor((c) => sim.setCursor(c));
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) loop.stop();
    else loop.wake();
  });
  loop.wake();
}

void start();
