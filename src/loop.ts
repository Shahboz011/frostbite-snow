/**
 * requestAnimationFrame loop with an FPS cap that stops completely when the
 * scene is idle (no rAF callbacks at all = ~0% CPU).
 */
export class FrameLoop {
  /** Frames per second ceiling (60 normally, 30 on battery). */
  fpsCap = 60;
  private raf = 0;
  private last = 0;
  private running = false;

  /** Return false to stop the loop until `wake()` is called. */
  constructor(private frame: (dt: number) => boolean) {}

  wake(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const minGap = 1000 / this.fpsCap - 1.5; // tolerance for vsync jitter
    const gap = now - this.last;
    if (gap < minGap) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    this.last = now;
    // Clamp dt so a stall (sleep, debugger) doesn't teleport flakes.
    const dt = Math.min(gap, 100) / 1000;
    if (this.frame(dt)) {
      this.raf = requestAnimationFrame(this.tick);
    } else {
      this.running = false;
    }
  };
}
