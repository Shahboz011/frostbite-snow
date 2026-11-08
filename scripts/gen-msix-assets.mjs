// Renders every MSIX visual asset from app-icon.svg into packaging/msix/Assets.
//
//   npm run msix:assets
//
// Scale-qualified names (Foo.scale-200.png, Foo.targetsize-48.png) are
// resolved at install time through resources.pri, which build-msix.ps1
// generates with makepri.
import { readFileSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "packaging", "msix", "Assets");
const icon = readFileSync(join(root, "app-icon.svg"), "utf8");
const BG = "#10223b"; // tile background, matches the icon's gradient

const inner = icon.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

/** The icon centered on a w×h canvas, occupying `frac` of the shorter side. */
function compose(w, h, frac, background) {
  const s = Math.min(w, h) * frac;
  const x = (w - s) / 2;
  const y = (h - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : ""}
  <svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="0 0 1024 1024">${inner}</svg>
</svg>`;
}

function render(name, w, h, frac, background) {
  const png = new Resvg(compose(w, h, frac, background), { fitTo: { mode: "original" } }).render().asPng();
  writeFileSync(join(out, name), png);
}

const SCALES = { 100: 1, 125: 1.25, 150: 1.5, 200: 2, 400: 4 };
const r = (n, k) => Math.round(n * k);

mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith(".png")) rmSync(join(out, f));

for (const [scale, k] of Object.entries(SCALES)) {
  // App list / taskbar icon (plated: drawn on the accent tile).
  render(`Square44x44Logo.scale-${scale}.png`, r(44, k), r(44, k), 1, null);
  // Start tiles.
  render(`Square71x71Logo.scale-${scale}.png`, r(71, k), r(71, k), 0.8, BG);
  render(`Square150x150Logo.scale-${scale}.png`, r(150, k), r(150, k), 0.66, BG);
  render(`Wide310x150Logo.scale-${scale}.png`, r(310, k), r(150, k), 0.66, BG);
  render(`Square310x310Logo.scale-${scale}.png`, r(310, k), r(310, k), 0.6, BG);
  // Package / Store logo.
  render(`StoreLogo.scale-${scale}.png`, r(50, k), r(50, k), 1, null);
  // Splash (shown briefly while a packaged app starts).
  render(`SplashScreen.scale-${scale}.png`, r(620, k), r(300, k), 0.5, null);
}

// Taskbar / Start / file explorer sizes. "altform-unplated" variants are used
// on the taskbar without a colored plate behind them.
for (const size of [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]) {
  render(`Square44x44Logo.targetsize-${size}.png`, size, size, 1, null);
  render(`Square44x44Logo.targetsize-${size}_altform-unplated.png`, size, size, 1, null);
  render(`Square44x44Logo.targetsize-${size}_altform-lightunplated.png`, size, size, 1, null);
}

console.log(`wrote ${readdirSync(out).length} assets to ${out}`);
