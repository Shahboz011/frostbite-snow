/**
 * Settings window. Every change goes to Rust (`update_settings`), which saves
 * it, updates the tray and tells the overlay; we re-render from the
 * `frostbite://settings` broadcast so tray changes show up here too.
 *
 * In a plain browser (vite dev) it runs against an in-memory mock.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_SETTINGS, type Intensity, type Settings } from "../types";

interface SettingsView {
  settings: Settings;
  autostartSupported: boolean;
  version: string;
}

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

interface Toggle {
  key: BoolKey;
  section: "settle" | "fun" | "desktop";
  name: string;
  desc?: string;
  /** Extra control at the end of the row. */
  action?: { id: string; label: string };
}

const TOGGLES: Toggle[] = [
  { key: "snowOnWindows", section: "settle", name: "Windows", desc: "Snow piles up on top of open windows" },
  { key: "snowOnTaskbar", section: "settle", name: "Taskbar", desc: "Snow builds up along the bottom of the screen" },
  { key: "snowOnIcons", section: "settle", name: "Desktop icons" },
  { key: "icicles", section: "settle", name: "Icicles", desc: "Hang from snowy ledges" },
  { key: "snowman", section: "fun", name: "Snowman", desc: "Hold the mouse on taskbar snow and drag to roll a snowball" },
  { key: "snowballs", section: "fun", name: "Snowball fights", desc: "Snowmen throw snowballs at each other" },
  {
    key: "santa",
    section: "fun",
    name: "Santa",
    desc: "Flies by every 10 minutes and drops gifts. Click a gift to open it.",
    action: { id: "santaNow", label: "Send now" },
  },
  {
    key: "polarChase",
    section: "fun",
    name: "Fish thief",
    desc: "Every 12 minutes a penguin steals a polar bear's fish and the chase is on. Click the bear to trip it.",
    action: { id: "polarNow", label: "Play now" },
  },
  { key: "winterWallpaper", section: "desktop", name: "Winter wallpaper", desc: "Turn off to get your own wallpaper back" },
  { key: "launchAtStartup", section: "desktop", name: "Launch at startup", desc: "Start Frostbite when you sign in" },
];

const WIND_LABELS: Record<string, string> = {
  "-3": "Strong, to the left",
  "-2": "Moderate, to the left",
  "-1": "Light, to the left",
  "0": "Calm",
  "1": "Light, to the right",
  "2": "Moderate, to the right",
  "3": "Strong, to the right",
};

const native = "__TAURI_INTERNALS__" in window;
let settings: Settings = { ...DEFAULT_SETTINGS };

const api = {
  async load(): Promise<SettingsView> {
    if (native) return invoke<SettingsView>("get_settings");
    return { settings: { ...DEFAULT_SETTINGS }, autostartSupported: true, version: "dev" };
  },
  save(s: Settings): void {
    if (native) void invoke("update_settings", { settings: s });
  },
  call(cmd: "send_santa" | "send_polar" | "shake_snow" | "quit_app"): void {
    if (native) void invoke(cmd);
    else console.log(`[mock] ${cmd}`);
  },
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function buildRows(autostartSupported: boolean): void {
  for (const t of TOGGLES) {
    if (t.key === "launchAtStartup" && !autostartSupported) continue;
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("div");
    label.className = "label";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = t.name;
    label.append(name);
    if (t.desc) {
      const d = document.createElement("div");
      d.className = "desc";
      d.textContent = t.desc;
      label.append(d);
    }
    row.append(label);
    if (t.action) {
      const b = document.createElement("button");
      b.className = "btn";
      b.id = t.action.id;
      b.textContent = t.action.label;
      row.append(b);
    }
    const sw = document.createElement("label");
    sw.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `t-${t.key}`;
    input.setAttribute("aria-label", t.name);
    input.addEventListener("change", () => change({ [t.key]: input.checked }));
    sw.append(input, document.createElement("span"));
    row.append(sw);
    $(t.section).append(row);
  }
}

function change(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  render();
  api.save(settings);
}

function render(): void {
  const s = settings;
  $<HTMLInputElement>("enabled").checked = s.enabled;
  $("status").textContent = s.enabled ? "Snow is falling on your desktop" : "Snow is paused";
  for (const b of $("intensity").querySelectorAll<HTMLButtonElement>("button")) {
    const on = b.dataset.v === s.intensity;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", String(on));
  }
  const step = Math.round(s.wind * 3);
  $<HTMLInputElement>("wind").value = String(step);
  $("windValue").textContent = WIND_LABELS[String(step)] ?? "Calm";
  for (const t of TOGGLES) {
    const el = document.getElementById(`t-${t.key}`) as HTMLInputElement | null;
    if (el) el.checked = s[t.key];
  }
  // Snow-dependent sections look inactive while snow is off.
  for (const id of ["snowfall", "settle", "fun"]) $(id).classList.toggle("dim", !s.enabled);
  const santaNow = document.getElementById("santaNow") as HTMLButtonElement | null;
  if (santaNow) santaNow.disabled = !(s.santa && s.enabled);
  const polarNow = document.getElementById("polarNow") as HTMLButtonElement | null;
  if (polarNow) polarNow.disabled = !(s.polarChase && s.enabled);
}

/** A few slow flakes drifting across the header. */
function heroFlakes(): void {
  const c = $<HTMLCanvasElement>("flakes");
  const ctx = c.getContext("2d")!;
  const flakes = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.6, v: 0.02 + Math.random() * 0.04, p: Math.random() * 6 }));
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    for (const f of flakes) {
      if (settings.enabled) {
        f.y += f.v * dt * 3;
        f.p += dt;
      }
      if (f.y > 1.05) {
        f.y = -0.05;
        f.x = Math.random();
      }
      ctx.beginPath();
      ctx.arc((f.x + Math.sin(f.p) * 0.01) * w, f.y * h, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function start(): Promise<void> {
  const view = await api.load();
  settings = view.settings;
  buildRows(view.autostartSupported);
  $("version").textContent = `Frostbite ${view.version}`;

  $<HTMLInputElement>("enabled").addEventListener("change", (e) => change({ enabled: (e.target as HTMLInputElement).checked }));
  for (const b of $("intensity").querySelectorAll<HTMLButtonElement>("button")) {
    b.addEventListener("click", () => change({ intensity: b.dataset.v as Intensity }));
  }
  $<HTMLInputElement>("wind").addEventListener("input", (e) => change({ wind: Number((e.target as HTMLInputElement).value) / 3 }));
  $("santaNow")?.addEventListener("click", () => api.call("send_santa"));
  $("polarNow")?.addEventListener("click", () => api.call("send_polar"));
  $("shake").addEventListener("click", () => api.call("shake_snow"));
  $("quit").addEventListener("click", () => api.call("quit_app"));

  if (native) {
    void listen<Settings>("frostbite://settings", (e) => {
      settings = e.payload;
      render();
    });
  }
  render();
  heroFlakes();
}

void start();
