import type { FlakePool } from "./pool";

/** Floats per flake in the instance stream: x, y, size, alpha, rot, shape. */
const STRIDE = 6;

export interface Renderer {
  readonly kind: "webgl2" | "canvas2d";
  resize(pxWidth: number, pxHeight: number, layoutToCanvas: number): void;
  draw(pool: FlakePool): void;
}

const VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in float a_size;
layout(location=2) in float a_alpha;
layout(location=3) in float a_rot;
layout(location=4) in float a_shape;
uniform vec2 u_res;
uniform float u_scale;
out float v_alpha;
out float v_rot;
out float v_crystal;
out float v_clump;
void main() {
  vec2 p = a_pos * u_scale;
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float s = a_size * u_scale;
  gl_PointSize = s;
  v_alpha = a_alpha;
  v_rot = a_rot;
  // Only big, near flakes show crystal arms; small ones are soft dots.
  v_crystal = smoothstep(7.0, 11.0, s) * (1.0 - a_shape);
  v_clump = a_shape;
}`;

const FS = `#version 300 es
precision mediump float;
in float v_alpha;
in float v_rot;
in float v_crystal;
in float v_clump;
out vec4 o;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float disc = smoothstep(1.0, 0.45, r);
  float a = atan(p.y, p.x) + v_rot;
  float arms = pow(abs(cos(a * 3.0)), 24.0) * smoothstep(1.0, 0.15, r);
  float star = max(arms, smoothstep(0.32, 0.12, r));
  float shape = mix(disc, max(star, disc * 0.18), v_crystal);
  // Clumps: denser, lumpy edge.
  float lump = 0.82 + 0.12 * sin(a * 5.0 + v_rot * 7.0);
  shape = mix(shape, smoothstep(lump, lump - 0.25, r), v_clump);
  // Cool grey-blue rim so flakes stay visible over white windows.
  vec3 col = mix(vec3(1.0), vec3(0.70, 0.78, 0.88), smoothstep(0.25, 0.95, r));
  float alpha = shape * v_alpha;
  o = vec4(col * alpha, alpha); // premultiplied
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error("shader: " + gl.getShaderInfoLog(s));
  }
  return s;
}

export class WebGLRenderer implements Renderer {
  readonly kind = "webgl2" as const;
  private gl: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private buf!: WebGLBuffer;
  private uRes!: WebGLUniformLocation;
  private uScale!: WebGLUniformLocation;
  private data: Float32Array;
  private w = 1;
  private h = 1;
  private scale = 1;
  private lost = false;

  constructor(private canvas: HTMLCanvasElement, private cap: number) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.data = new Float32Array(cap * STRIDE);
    this.setup();
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.setup();
      this.lost = false;
      this.resize(this.w, this.h, this.scale);
    });
  }

  private setup(): void {
    const gl = this.gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.uRes = gl.getUniformLocation(prog, "u_res")!;
    this.uScale = gl.getUniformLocation(prog, "u_scale")!;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const B = STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, B, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, B, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, B, 12);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, B, 16);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, B, 20);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  resize(pxWidth: number, pxHeight: number, layoutToCanvas: number): void {
    this.w = pxWidth;
    this.h = pxHeight;
    this.scale = layoutToCanvas;
    this.canvas.width = pxWidth;
    this.canvas.height = pxHeight;
    if (this.lost) return;
    this.gl.viewport(0, 0, pxWidth, pxHeight);
  }

  draw(pool: FlakePool): void {
    if (this.lost) return;
    const gl = this.gl;
    const n = Math.min(pool.count, this.cap);
    const d = this.data;
    for (let i = 0, o = 0; i < n; i++, o += STRIDE) {
      d[o] = pool.x[i];
      d[o + 1] = pool.y[i];
      d[o + 2] = pool.size[i];
      d[o + 3] = pool.alpha[i];
      d[o + 4] = pool.rot[i];
      d[o + 5] = pool.shape[i];
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (n === 0) return;
    gl.useProgram(this.prog);
    gl.uniform2f(this.uRes, this.w, this.h);
    gl.uniform1f(this.uScale, this.scale);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * STRIDE);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.bindVertexArray(null);
  }
}

/** Fallback for machines without WebGL2 (rare: remote desktop, broken drivers). */
export class Canvas2DRenderer implements Renderer {
  readonly kind = "canvas2d" as const;
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: true })!;
  }
  resize(w: number, h: number, s: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.scale = s;
  }
  draw(pool: FlakePool): void {
    const c = this.ctx;
    const s = this.scale;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.fillStyle = "#fff";
    for (let i = 0; i < pool.count; i++) {
      const r = pool.size[i] * s * 0.5;
      c.globalAlpha = pool.alpha[i];
      c.fillRect(pool.x[i] * s - r, pool.y[i] * s - r, r * 2, r * 2);
    }
    c.globalAlpha = 1;
  }
}

export function createRenderer(canvas: HTMLCanvasElement, cap: number): Renderer {
  try {
    return new WebGLRenderer(canvas, cap);
  } catch (e) {
    console.warn("Falling back to Canvas2D:", e);
    return new Canvas2DRenderer(canvas);
  }
}
