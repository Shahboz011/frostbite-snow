import { createBridge } from "./bridge";
import { FrameLoop } from "./loop";
import { PileRenderer } from "./snow/piles";
import { createRenderer } from "./snow/renderer";
import { MAX_FLAKES, SnowSim } from "./snow/sim";
import { Yard } from "./snow/yard";
import { YardRenderer } from "./snow/yardRender";
import { DEFAULT_SETTINGS } from "./types";
import type { Layout, Power, Settings, Surfaces } from "./types";

const canvas = document.getElementById("snow") as HTMLCanvasElement;
const pileCanvas = document.getElementById("piles") as HTMLCanvasElement;
const objectCanvas = document.getElementById("objects") as HTMLCanvasElement;
const debugEl = document.getElementById("debug") as HTMLDivElement;

const bridge = createBridge();
const sim = new SnowSim();
const renderer = createRenderer(canvas, MAX_FLAKES);
const piles = new PileRenderer(pileCanvas);
const yard = new Yard(sim.ledges, (x, y, vx, vy, m, k) => sim.emitClump(x, y, vx, vy, m, k));
const yardRenderer = new YardRenderer(objectCanvas);
let hitKey = "";

/** Piles change slowly: redraw them at most this often unless something moved. */
const PILE_REDRAW_INTERVAL = 0.05;

let layout: Layout;
let surfaces: Surfaces = { windows: [], taskbars: [], icons: [] };
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
  yardRenderer.resize(w, h, s);
  yard.dirty = true;
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
  sim.ledges.setOptions(
    { windows: s.snowOnWindows, ground: s.snowOnTaskbar, icons: s.snowOnIcons, icicles: s.icicles },
    now(),
  );
  yard.enabled = s.snowman && s.enabled && s.snowOnTaskbar;
  yard.throwing = s.snowballs;
  updateFpsCap();
  wake();
}

function applyPower(p: Power): void {
  power = p;
  updateFpsCap();
  if (p.paused) loop.stop();
  else wake();
}

/** Tell Rust where the overlay should take the mouse; set the cursor shape. */
function syncInteraction(): void {
  const regions = yard.hitRegions();
  const capture = yard.capturing;
  const key = JSON.stringify(regions) + capture;
  if (key !== hitKey) {
    hitKey = key;
    bridge.setHitRegions(regions, capture);
  }
  const cur = yard.cursorStyle;
  if (document.body.style.cursor !== cur) document.body.style.cursor = cur;
}

/** DOM event → layout (physical) px. */
function toLayout(e: PointerEvent): [number, number] {
  const f = layout.width / Math.max(1, window.innerWidth);
  return [e.clientX * f, e.clientY * f];
}

function installPointer(): void {
  // Capture phase, so in the browser preview we win over the fake windows.
  window.addEventListener(
    "pointerdown",
    (e) => {
      const [x, y] = toLayout(e);
      if (e.button === 2) {
        // Right-click a snowman: new outfit.
        yard.setCursor(x, y);
        if (yard.enabled && yard.restyle(x, y)) {
          e.preventDefault();
          e.stopPropagation();
          wake();
        }
        return;
      }
      if (e.button !== 0) return;
      yard.setCursor(x, y);
      if (!yard.wants(x, y) || !yard.pointerDown(x, y)) return;
      e.preventDefault();
      e.stopPropagation();
      syncInteraction();
      wake();
    },
    { capture: true },
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!yard.capturing) return;
      const [x, y] = toLayout(e);
      yard.pointerMove(x, y);
      e.stopPropagation();
      wake();
    },
    { capture: true },
  );
  const up = (e: PointerEvent) => {
    if (!yard.capturing) return;
    const [x] = toLayout(e);
    yard.pointerUp(x);
    e.stopPropagation();
    syncInteraction();
    wake();
  };
  window.addEventListener("pointerup", up, { capture: true });
  // No browser context menu over the overlay (right-click restyles snowmen).
  window.addEventListener("contextmenu", (e) => {
    const [x, y] = toLayout(e as PointerEvent);
    if (yard.stackAt(x, y)) e.preventDefault();
  });
  window.addEventListener("pointercancel", up, { capture: true });
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

  yard.update(dt);
  if (yard.dirty) {
    yard.dirty = false;
    yardRenderer.render(yard);
    syncInteraction();
  }

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
        (bridge.native ? "" : "\nkeys: S 1 2 3 ←→ W T O I N F X P B");
      fpsFrames = 0;
      fpsTime = 0;
      pileDraws = 0;
    }
  }
  const more = !sim.idle || yard.busy;
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
    Object.assign(window, { __frostbite: { sim, renderer, piles, yard, yardRenderer, loop, layout: () => layout } });
  }

  bridge.onLayout(applyLayout);
  bridge.onSurfaces(applySurfaces);
  bridge.onSettings(applySettings);
  bridge.onPower(applyPower);
  bridge.onShake(() => {
    sim.ledges.shakeAll();
    yard.clear();
    wake();
  });
  bridge.onCursor((c) => {
    sim.setCursor(c);
    yard.setCursor(c.x, c.y);
    if (yard.enabled) wake();
  });
  installPointer();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) loop.stop();
    else wake();
  });
  applyPower(power);
}

void start();
