import { createBridge } from "./bridge";
import { FrameLoop } from "./loop";
import { PileRenderer } from "./snow/piles";
import { createRenderer } from "./snow/renderer";
import { MAX_FLAKES, SnowSim } from "./snow/sim";
import { DEFAULT_SETTINGS } from "./types";
import type { Layout, Power, Settings, Surfaces } from "./types";

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
let settings: Settings = { ...DEFAULT_SETTINGS };
let power: Power = { paused: false, battery: false };
let debug = false;
let pileTimer = 0;

const now = () => performance.now() / 1000;

/** Start rendering unless paused (fullscreen app / lock screen). */
function wake(): void {
  if (!power.paused) loop.wake();
}

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
  wake();
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
  wake();
}

/** 30 fps on battery and for light snow (slow flakes look the same), else 60. */
function updateFpsCap(): void {
  loop.fpsCap = power.battery || settings.intensity === "light" ? 30 : 60;
}

function applySettings(s: Settings): void {
  settings = s;
  sim.settings.enabled = s.enabled;
  sim.settings.intensity = s.intensity;
  sim.settings.wind = s.wind;
  sim.ledges.setOptions({ windows: s.snowOnWindows, ground: s.snowOnTaskbar, icicles: s.icicles }, now());
  updateFpsCap();
  wake();
}

function applyPower(p: Power): void {
  power = p;
  updateFpsCap();
  if (p.paused) loop.stop();
  else wake();
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
        `${renderer.kind}  ${fps.toFixed(0)} fps  cap ${loop.fpsCap}${power.battery ? " (battery)" : ""}\n` +
        `snow ${settings.enabled ? "on" : "off"}  flakes ${sim.pool.count}  ${settings.intensity}  wind ${sim.windNow.toFixed(0)} px/s\n` +
        `ledges ${sim.ledges.list.length}  pile redraws ${(pileDraws / fpsTime).toFixed(0)}/s\n` +
        `monitors ${layout.monitors.length}  ${layout.width}×${layout.height}` +
        (bridge.native ? "" : "\nkeys: S 1 2 3 ←→ W T I X P B");
      fpsFrames = 0;
      fpsTime = 0;
      pileDraws = 0;
    }
  }
  const more = !sim.idle;
  if (!more && debug) debugEl.textContent += "\n(idle: render loop stopped)";
  return more;
});

async function start(): Promise<void> {
  const boot = await bridge.boot();
  debug = boot.debug;
  debugEl.style.display = debug ? "block" : "none";
  surfaces = boot.surfaces;
  power = boot.power;
  applyLayout(boot.layout);
  applySettings(boot.settings);
  if (debug) {
    // Console access for tuning and perf checks.
    Object.assign(window, { __frostbite: { sim, renderer, piles, loop, layout: () => layout } });
  }

  bridge.onLayout(applyLayout);
  bridge.onSurfaces(applySurfaces);
  bridge.onSettings(applySettings);
  bridge.onPower(applyPower);
  bridge.onShake(() => {
    sim.ledges.shakeAll();
    wake();
  });
  bridge.onCursor((c) => sim.setCursor(c));
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) loop.stop();
    else wake();
  });
  applyPower(power);
}

void start();
