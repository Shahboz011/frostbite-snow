/**
 * Struct-of-arrays particle pool. Fixed capacity, swap-remove on kill, zero
 * allocations after construction.
 */
export class FlakePool {
  readonly cap: number;
  count = 0;

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** Rendered diameter in px (already includes monitor DPI scale). */
  readonly size: Float32Array;
  /** 0.25 (far, small, slow) … 1 (near, big, fast). */
  readonly depth: Float32Array;
  /** Monitor DPI scale at spawn: multiplies speeds so motion looks the same on every screen. */
  readonly k: Float32Array;
  readonly phase: Float32Array;
  readonly swayF: Float32Array;
  readonly swayA: Float32Array;
  readonly alpha: Float32Array;
  readonly rot: Float32Array;
  readonly rotV: Float32Array;
  /** Safety net: y at which the flake dies if no surface caught it. */
  readonly floor: Float32Array;
  /** Snow volume (px²) added to a pile when this flake lands. */
  readonly mass: Float32Array;
  /** 0 = flake, 1 = clump of fallen pile snow (rendered without crystal arms). */
  readonly shape: Float32Array;

  constructor(cap: number) {
    this.cap = cap;
    const f = () => new Float32Array(cap);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.size = f();
    this.depth = f();
    this.k = f();
    this.phase = f();
    this.swayF = f();
    this.swayA = f();
    this.alpha = f();
    this.rot = f();
    this.rotV = f();
    this.floor = f();
    this.mass = f();
    this.shape = f();
  }

  /** Returns the new index, or -1 when full. Caller fills every field. */
  alloc(): number {
    return this.count < this.cap ? this.count++ : -1;
  }

  kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.size[i] = this.size[last];
    this.depth[i] = this.depth[last];
    this.k[i] = this.k[last];
    this.phase[i] = this.phase[last];
    this.swayF[i] = this.swayF[last];
    this.swayA[i] = this.swayA[last];
    this.alpha[i] = this.alpha[last];
    this.rot[i] = this.rot[last];
    this.rotV[i] = this.rotV[last];
    this.floor[i] = this.floor[last];
    this.mass[i] = this.mass[last];
    this.shape[i] = this.shape[last];
  }

  clear(): void {
    this.count = 0;
  }
}
