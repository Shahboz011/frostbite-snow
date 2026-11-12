/**
 * Polar bear and emperor penguin drawn from painted sprite sheets
 * (src/assets/critters/*.png: transparent strips of equal frames, every frame
 * facing right with the feet on `baseline`). Same call shape as the vector
 * versions in critterRender.ts.
 *
 * Sheets:
 *   bear-run    6-frame gallop
 *   bear-poses  0 walk with fish, 1 sit content, 2 roar, 3 on its back, 4 sit with fish
 *   pen-run     6-frame run with a fish in the beak
 *   pen-poses   0 stand, 1 sneak, 2 grab (beak down), 3 belly slide with fish, 4 jump, 5 stand with fish
 */
import type { BearOpts, BearPose, PenguinOpts, PenguinPose } from "./critterRender";
import bearRunMeta from "../assets/critters/bear-run.json";
import bearPosesMeta from "../assets/critters/bear-poses.json";
import penRunMeta from "../assets/critters/pen-run.json";
import penPosesMeta from "../assets/critters/pen-poses.json";
import bearRunUrl from "../assets/critters/bear-run.png";
import bearPosesUrl from "../assets/critters/bear-poses.png";
import penRunUrl from "../assets/critters/pen-run.png";
import penPosesUrl from "../assets/critters/pen-poses.png";

type G = CanvasRenderingContext2D;

interface Meta {
  frames: number;
  frameW: number;
  frameH: number;
  baseline: number;
}

interface Sheet extends Meta {
  img: HTMLImageElement;
  ready: boolean;
}

function sheet(url: string, meta: Meta): Sheet {
  const img = new Image();
  const s: Sheet = { ...meta, img, ready: false };
  img.onload = () => (s.ready = true);
  img.src = url;
  return s;
}

const SHEETS = {
  bearRun: sheet(bearRunUrl, bearRunMeta),
  bearPoses: sheet(bearPosesUrl, bearPosesMeta),
  penRun: sheet(penRunUrl, penRunMeta),
  penPoses: sheet(penPosesUrl, penPosesMeta),
};

/** Layout px per sheet px at k = 1: the bear ~105 long, the penguin ~44 tall. */
const BEAR_SCALE = 0.42;
const PEN_SCALE = 0.235;
/** The gallop sheet came out ~12% smaller than the pose sheet. */
const RUN_MATCH = 1.12;

export function spritesReady(): boolean {
  return Object.values(SHEETS).every((s) => s.ready);
}

/** Draw frame `i` of `s` standing on (0, 0) in the current transform. */
function frame(g: G, s: Sheet, i: number): void {
  if (!s.ready) return;
  const f = ((i % s.frames) + s.frames) % s.frames;
  g.drawImage(s.img, f * s.frameW, 0, s.frameW, s.frameH, -s.frameW / 2, -s.baseline, s.frameW, s.frameH);
}

function shadow(g: G, w: number, a = 0.28): void {
  g.save();
  g.scale(1, 0.12);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, w);
  gr.addColorStop(0, `rgba(10, 25, 50, ${a})`);
  gr.addColorStop(1, "rgba(10, 25, 50, 0)");
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, w, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

const cycle = (phase: number, n: number) => Math.floor((phase / (Math.PI * 2)) * n);

export function drawBearSprite(ctx: G, x: number, groundY: number, k: number, t: number, pose: BearPose, phase: number, dir: 1 | -1 = 1, opts: BearOpts = {}): void {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(k * dir, k);
  shadow(ctx, 52);
  ctx.scale(BEAR_SCALE, BEAR_SCALE);
  const P = SHEETS.bearPoses;
  switch (pose) {
    case "run": {
      // A little lift on the gathered frames sells the gallop.
      const f = cycle(phase, 6);
      ctx.translate(0, -Math.abs(Math.sin(phase)) * 6);
      ctx.scale(RUN_MATCH, RUN_MATCH); // the gallop sheet was painted a bit smaller
      frame(ctx, SHEETS.bearRun, f);
      break;
    }
    case "walk":
      if (opts.fish) {
        ctx.translate(0, -Math.abs(Math.sin(phase)) * 3);
        ctx.rotate(Math.sin(phase) * 0.015);
        frame(ctx, P, 0);
      } else {
        // Plodding off: the gallop frames at a slow pace read as a trot.
        frame(ctx, SHEETS.bearRun, cycle(phase, 6));
      }
      break;
    case "sit":
      // Breathing.
      ctx.scale(1, 1 + Math.sin(t * 2.4) * 0.008);
      frame(ctx, P, opts.fish ? 4 : 1);
      break;
    case "roar":
      ctx.translate(Math.sin(t * 50) * 1.2, 0);
      frame(ctx, P, 2);
      break;
    case "tumble":
      ctx.translate(0, -70);
      ctx.rotate(opts.spin ?? 0);
      ctx.translate(0, 70);
      frame(ctx, P, 3);
      break;
    case "shake":
      ctx.translate(0, -60);
      ctx.rotate(Math.sin(t * 42) * 0.06);
      ctx.translate(Math.sin(t * 42 + 1) * 3, 60);
      frame(ctx, SHEETS.bearRun, 1);
      break;
  }
  ctx.restore();
}

export function drawPenguinSprite(ctx: G, x: number, groundY: number, k: number, t: number, pose: PenguinPose, phase: number, dir: 1 | -1 = 1, opts: PenguinOpts = {}): void {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(k * dir, k);
  shadow(ctx, pose === "slide" ? 24 : 15);
  ctx.scale(PEN_SCALE, PEN_SCALE);
  const P = SHEETS.penPoses;
  const s = Math.sin(phase);
  switch (pose) {
    case "run":
      if (opts.fish) {
        ctx.translate(0, -Math.abs(s) * 8);
        frame(ctx, SHEETS.penRun, cycle(phase, 6));
      } else {
        // Hurrying away empty-beaked: a quick waddle on the sneak frame.
        ctx.translate(0, -Math.abs(s) * 7);
        ctx.rotate(s * 0.08);
        frame(ctx, P, 1);
      }
      break;
    case "sneak":
      ctx.translate(0, -Math.abs(s) * 3);
      ctx.rotate(s * 0.05);
      frame(ctx, P, 1);
      break;
    case "grab":
      frame(ctx, P, 2);
      break;
    case "slide":
      ctx.translate(Math.sin(t * 30) * 1.2, 0);
      frame(ctx, P, 3);
      break;
    case "jump":
      ctx.translate(0, -Math.sin(Math.min(1, (opts.poseT ?? 0) / 0.45) * Math.PI) * 55);
      frame(ctx, P, 4);
      break;
    case "stand":
      ctx.rotate(Math.sin(t * 2) * 0.02);
      frame(ctx, P, opts.fish ? 5 : 0);
      break;
  }
  ctx.restore();
}
