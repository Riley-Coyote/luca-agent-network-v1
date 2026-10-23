/**
 * Ink in water.
 *
 * A small fluid on the GPU (Stam's stable fluids: carry, swirl, keep it
 * incompressible) moves dye through still, dark water. The dye is the app's
 * own Living Ink paint, shaded the way the living-ink lab settled it: deeper
 * and leaning toward its darker neighbour where it lies thick, lighter and
 * clearer where it is thin. On a dark surface the ink holds light; on a light
 * one it takes light away, as dye in water does. Nothing is a video or a loop:
 * every thread is the water moving.
 *
 * Coordinates are the canvas's own unit square, origin at the bottom left.
 */

export type InkColor = readonly [number, number, number];

type Target = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
};

type Pair = {
  read: Target;
  write: Target;
  width: number;
  height: number;
  swap: () => void;
};

type Program = {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
};

/** Short side of the velocity grid, in cells. */
const SIM_SHORT = 216;
/** Short side of the dye grid: finer than the water so threads stay sharp. */
const DYE_SHORT = 900;
const PRESSURE_ITERATIONS = 22;
/** How strongly the water keeps its eddies turning. */
const SWIRL = 9;
const VELOCITY_FADE = 0.26;
/** The slow current that keeps still water alive and draws ink into threads. */
const CURRENT = 1.7;
const DYE_FADE = 0.085;

const VERTEX = `#version 300 es
precision highp float;
in vec2 aPosition;
uniform vec2 uTexel;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y);
  vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 outColor;
`;

const SPLAT = `${HEAD}
uniform sampler2D uTarget;
uniform float uAspect;
uniform vec2 uPoint;
uniform float uRadius;
uniform vec4 uValue;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  outColor = texture(uTarget, vUv) + uValue * exp(-dot(p, p) / uRadius);
}`;

const ADVECT = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uVelocityTexel;
uniform float uDt;
uniform float uFade;
void main() {
  vec2 from = vUv - uDt * texture(uVelocity, vUv).xy * uVelocityTexel;
  outColor = texture(uSource, from) / (1.0 + uFade * uDt);
}`;

/**
 * Ink keeps its edges: a step forward, a step back to measure what the first
 * step blurred, half of that error given back, and the result held inside the
 * values it came from so nothing rings.
 */
const SHARPEN = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform sampler2D uForward;
uniform sampler2D uBackward;
uniform vec2 uVelocityTexel;
uniform vec2 uSourceTexel;
uniform float uDt;
uniform float uFade;
void main() {
  vec2 from = vUv - uDt * texture(uVelocity, vUv).xy * uVelocityTexel;
  vec4 corrected = texture(uForward, vUv) + 0.5 * (texture(uSource, vUv) - texture(uBackward, vUv));
  vec2 base = (floor(from / uSourceTexel - 0.5) + 0.5) * uSourceTexel;
  vec4 a = texture(uSource, base);
  vec4 b = texture(uSource, base + vec2(uSourceTexel.x, 0.0));
  vec4 c = texture(uSource, base + vec2(0.0, uSourceTexel.y));
  vec4 d = texture(uSource, base + uSourceTexel);
  vec4 lo = min(min(a, b), min(c, d));
  vec4 hi = max(max(a, b), max(c, d));
  // No walls: ink thins away near the edges, so the water reads as endless.
  float wall = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float open = mix(0.955, 1.0, smoothstep(0.0, 0.07, wall));
  outColor = clamp(corrected, lo, hi) * open / (1.0 + uFade * uDt);
}`;

const CURL = `${HEAD}
uniform sampler2D uVelocity;
void main() {
  float l = texture(uVelocity, vL).y;
  float r = texture(uVelocity, vR).y;
  float t = texture(uVelocity, vT).x;
  float b = texture(uVelocity, vB).x;
  outColor = vec4(0.5 * (r - l - t + b), 0.0, 0.0, 1.0);
}`;

const SWIRL_FORCE = `${HEAD}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uSwirl;
uniform float uDt;
void main() {
  float l = texture(uCurl, vL).x;
  float r = texture(uCurl, vR).x;
  float t = texture(uCurl, vT).x;
  float b = texture(uCurl, vB).x;
  float c = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
  force /= length(force) + 0.0001;
  force *= uSwirl * c;
  force.y *= -1.0;
  vec2 velocity = texture(uVelocity, vUv).xy + force * uDt;
  outColor = vec4(clamp(velocity, -900.0, 900.0), 0.0, 1.0);
}`;

/** A slow current with no source or sink (the curl of a smooth field), so the
 *  water never stands still and ink is drawn out into threads. */
const CURRENT_FORCE = `${HEAD}
uniform sampler2D uVelocity;
uniform float uTime;
uniform float uStrength;
uniform float uDt;
uniform float uAspect;
float field(vec2 p, float t) {
  return 0.6 * sin(p.x * 3.1 + t * 0.11) * cos(p.y * 2.3 - t * 0.07)
    + 0.25 * sin(p.x * 5.7 - p.y * 4.1 + t * 0.13)
    + 0.1 * cos(p.x * 9.3 + p.y * 7.7 - t * 0.17);
}
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float e = 0.003;
  float f = field(p, uTime);
  vec2 current = vec2(field(p + vec2(0.0, e), uTime) - f, -(field(p + vec2(e, 0.0), uTime) - f)) / e;
  outColor = vec4(texture(uVelocity, vUv).xy + current * uStrength * uDt, 0.0, 1.0);
}`;

const DIVERGENCE = `${HEAD}
uniform sampler2D uVelocity;
void main() {
  vec2 c = texture(uVelocity, vUv).xy;
  float l = vL.x < 0.0 ? -c.x : texture(uVelocity, vL).x;
  float r = vR.x > 1.0 ? -c.x : texture(uVelocity, vR).x;
  float t = vT.y > 1.0 ? -c.y : texture(uVelocity, vT).y;
  float b = vB.y < 0.0 ? -c.y : texture(uVelocity, vB).y;
  outColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}`;

const SCALE = `${HEAD}
uniform sampler2D uTarget;
uniform float uScale;
void main() {
  outColor = texture(uTarget, vUv) * uScale;
}`;

const PRESSURE = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float l = texture(uPressure, vL).x;
  float r = texture(uPressure, vR).x;
  float t = texture(uPressure, vT).x;
  float b = texture(uPressure, vB).x;
  float d = texture(uDivergence, vUv).x;
  outColor = vec4((l + r + t + b - d) * 0.25, 0.0, 0.0, 1.0);
}`;

const SUBTRACT = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float l = texture(uPressure, vL).x;
  float r = texture(uPressure, vR).x;
  float t = texture(uPressure, vT).x;
  float b = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy - vec2(r - l, t - b);
  outColor = vec4(velocity, 0.0, 1.0);
}`;

/**
 * The dye, painted. `rgb` holds linear paint × amount and `a` the amount, so
 * the mean paint is rgb / a. OKLab and the pigment pull are the living-ink
 * lab's, unchanged in intent.
 */
const DISPLAY = `${HEAD}
uniform sampler2D uDye;
uniform vec2 uDyeTexel;
uniform vec3 uSurface;
uniform float uDark;
uniform vec4 uQuiet;
uniform float uFade;
uniform float uTime;

vec3 lin2lab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = pow(max(l, 0.0), 1.0 / 3.0);
  m = pow(max(m, 0.0), 1.0 / 3.0);
  s = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
}
vec3 lab2lin(vec3 lab) {
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}
vec3 lin2srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Where paint lies thick it goes deeper and leans toward its darker neighbour
// (warm hues toward red, cool ones toward blue); where it is thin it goes
// lighter and clearer and leans the other way. d: -1 thick, +1 thin.
const float RED = 0.506;
const float BLUE = -1.676;
float pull(float h, float target) {
  float d = target - h;
  return atan(sin(d), cos(d));
}
vec3 pigment(vec3 lab, float d) {
  float c = length(lab.yz);
  float h = atan(lab.z, lab.y);
  float warm = step(-0.35, h) * step(h, 2.62);
  float toward = clamp(pull(h, mix(BLUE, RED, warm)), -0.7, 0.7);
  float thick = clamp(-d, 0.0, 1.0);
  float thin = clamp(d, 0.0, 1.0);
  float hue = h + toward * (0.45 * thick - 0.24 * thin);
  float lightness = lab.x - 0.10 * thick + 0.08 * thin;
  float chroma = c * (1.0 + 0.08 * thick) * (1.0 - 0.3 * thin);
  return vec3(lightness, chroma * cos(hue), chroma * sin(hue));
}

void main() {
  vec4 dye = texture(uDye, vUv);
  float amount = max(dye.a, 0.0);
  vec3 mean = amount > 0.0002 ? max(dye.rgb / amount, 0.0) : vec3(0.0);
  float depth = clamp(1.0 - amount * 1.1, -1.0, 1.0);
  vec3 paint = max(lab2lin(pigment(lin2lab(mean), depth)), 0.0);

  // Where the ink's edge turns, it catches the light: thin bright rims, and
  // a little more on the edges that face up toward the one light above.
  vec2 t = uDyeTexel * 2.5;
  float aL = texture(uDye, vUv - vec2(t.x, 0.0)).a;
  float aR = texture(uDye, vUv + vec2(t.x, 0.0)).a;
  float aT = texture(uDye, vUv + vec2(0.0, t.y)).a;
  float aB = texture(uDye, vUv - vec2(0.0, t.y)).a;
  vec2 grad = vec2(aR - aL, aT - aB);
  float rim = clamp(length(grad) * 1.5, 0.0, 1.0) * smoothstep(0.06, 0.45, amount);
  float facing = clamp(-grad.y * 3.0, 0.0, 1.0);
  float body = 1.0 - exp(-amount * 2.0);

  vec3 water;
  if (uDark > 0.5) {
    // Still water, lit faintly from above.
    float sky = 1.0 - smoothstep(0.0, 1.0, length((vUv - vec2(0.5, 1.12)) * vec2(0.85, 1.35)));
    water = uSurface + vec3(0.0036, 0.004, 0.0048) * sky;
    vec3 held = paint * (body * 0.7 + rim * 0.45 + facing * 0.2);
    held += vec3(0.88, 0.92, 1.0) * facing * rim * 0.07;
    water += held;
  } else {
    vec3 absorb = (1.0 - paint) * 2.4 + 0.08;
    water = uSurface * exp(-absorb * (amount * 1.7 + rim * 0.4));
  }

  // The quiet: ink thins out around the words above the composer.
  vec2 q = (vUv - uQuiet.xy) / max(uQuiet.zw, vec2(0.0001));
  float open = smoothstep(0.55, 1.4, length(q));
  water = mix(uSurface, water, mix(0.4, 1.0, open));
  water = mix(uSurface, water, uFade);

  vec3 color = lin2srgb(water);
  // A trace of grain, so long dark gradients never band.
  float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  outColor = vec4(color + (n - 0.5) / 255.0, 1.0);
}`;

function srgbToLinear(value: number) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearColor(color: InkColor): InkColor {
  return [
    srgbToLinear(color[0]),
    srgbToLinear(color[1]),
    srgbToLinear(color[2]),
  ];
}

export class InkWaterEngine {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly quad: WebGLBuffer;
  private readonly programs: Record<string, Program>;
  private velocity!: Pair;
  private dye!: Pair;
  private pressure!: Pair;
  private divergence!: Target;
  private curl!: Target;
  private forward!: Target;
  private backward!: Target;
  private aspect = 1;
  private surface: InkColor = [0.06, 0.06, 0.06];
  private dark = true;
  private quiet: [number, number, number, number] = [0.5, 0.5, 0, 0];
  private nextFall = 0;
  private falls = 0;
  private palette: InkColor[] = [];
  private lastColor = -1;
  private elapsed = 0;

  /** Null when this device cannot run the water (no WebGL2 or float targets). */
  static create(canvas: HTMLCanvasElement): InkWaterEngine | null {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
      stencil: false,
    });
    if (!gl?.getExtension("EXT_color_buffer_float")) return null;
    try {
      return new InkWaterEngine(canvas, gl);
    } catch (error) {
      console.warn("ink-water", error);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const quad = gl.createBuffer();
    if (!quad) throw new Error("ink: no buffer");
    this.quad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.disable(gl.BLEND);
    this.programs = {
      advect: this.program(ADVECT),
      current: this.program(CURRENT_FORCE),
      curl: this.program(CURL),
      display: this.program(DISPLAY),
      divergence: this.program(DIVERGENCE),
      pressure: this.program(PRESSURE),
      scale: this.program(SCALE),
      sharpen: this.program(SHARPEN),
      splat: this.program(SPLAT),
      subtract: this.program(SUBTRACT),
      swirl: this.program(SWIRL_FORCE),
    };
    this.resize(true);
  }

  /** The surface the water sits on (sRGB 0..1), and the paints it pours. */
  configure(surface: InkColor, palette: readonly InkColor[]) {
    this.surface = linearColor(surface);
    this.dark =
      0.2126 * surface[0] + 0.7152 * surface[1] + 0.0722 * surface[2] < 0.5;
    const first = this.palette.length === 0;
    this.palette = palette.map(linearColor);
    if (first && this.palette.length > 0) {
      // The water was not empty before you arrived: two drops still falling,
      // and a bloom from an earlier one resting low.
      this.fall(0.2 + Math.random() * 0.1, 0.8);
      this.fall(0.72 + Math.random() * 0.1, 0.92);
      this.well(0.16 + Math.random() * 0.12, 0.12);
      this.well(0.7 + Math.random() * 0.14, 0.16);
      this.nextFall = this.elapsed + 3.4;
    }
  }

  /** Where the words sit: the ink keeps its distance (unit square). */
  setQuiet(x: number, y: number, radiusX: number, radiusY: number) {
    this.quiet = [x, y, radiusX, radiusY];
  }

  /** Match the drawing buffer to the canvas's size; rebuild the water only
   *  when its shape has changed enough to matter. */
  resize(force = false) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const aspect = width / height;
    if (!force && Math.abs(aspect - this.aspect) / this.aspect < 0.12) return;
    this.aspect = aspect;
    this.allocate();
  }

  /** A bead of ink let go at a point: it sinks and opens into a bloom. */
  drop(x: number, y: number, color: InkColor, strength = 1) {
    const paint = linearColor(color);
    const amount = 0.7 * strength;
    this.splat(
      this.dye,
      x,
      y,
      [paint[0] * amount, paint[1] * amount, paint[2] * amount, amount],
      0.00009,
    );
    this.splat(this.velocity, x, y, [0, -45 * strength, 0, 0], 0.00022);
  }

  /** The pointer moving through the water. */
  stir(x: number, y: number, dx: number, dy: number) {
    this.splat(this.velocity, x, y, [dx * 900, dy * 900, 0, 0], 0.0014);
  }

  /** The first message going in: the composer sinks to its place, and what
   *  was written opens behind it. */
  release(x: number, y: number, width: number) {
    const count = 7;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const color = this.palette[
        (this.lastColor + i + 1) % Math.max(1, this.palette.length)
      ] ?? [0.6, 0.6, 0.6];
      const px = x + (t - 0.5) * width;
      const amount = 0.7 + 0.3 * Math.sin(t * Math.PI);
      this.splat(
        this.dye,
        px,
        y,
        [color[0] * amount, color[1] * amount, color[2] * amount, amount],
        0.00016,
      );
    }
    this.splat(this.velocity, x, y, [0, -260, 0, 0], 0.012);
  }

  /** Advance the water by dt seconds and draw it. */
  frame(dt: number, fade: number) {
    this.elapsed += dt;
    this.pourAmbient(dt);
    this.step(dt);
    this.render(fade);
  }

  /** Run the water forward without drawing, so it opens already alive. */
  warm(seconds: number) {
    const dt = 1 / 60;
    for (let t = 0; t < seconds; t += dt) {
      this.elapsed += dt;
      this.pourAmbient(dt);
      this.step(dt);
    }
  }

  dispose() {
    const gl = this.gl;
    this.releaseTargets();
    for (const program of Object.values(this.programs))
      gl.deleteProgram(program.program);
    gl.deleteBuffer(this.quad);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  // ── the water ──────────────────────────────────────────────────────────

  /**
   * The water's own life: now and then a drop falls in from above, sinks and
   * opens; between drops, a slow bloom wells up low in the water, so the
   * bottom of the view is never bare.
   */
  private pourAmbient(_dt: number) {
    if (this.palette.length === 0 || this.elapsed < this.nextFall) return;
    // Away from the middle, where the words are.
    const x =
      Math.random() < 0.5
        ? 0.08 + Math.random() * 0.26
        : 0.66 + Math.random() * 0.26;
    if (this.falls % 2 === 0) {
      this.fall(x, 0.93);
      if (Math.random() < 0.3)
        this.fall(x + (Math.random() - 0.5) * 0.08, 0.92);
    } else {
      this.well(x, 0.1 + Math.random() * 0.12);
    }
    this.falls += 1;
    this.nextFall = this.elapsed + 3.6 + Math.random() * 3;
  }

  /** A slow upwelling: ink rising a little from low in the water. */
  private well(x: number, y: number) {
    const c = this.nextColor();
    const amount = 0.9 + Math.random() * 0.5;
    this.splat(
      this.dye,
      x,
      y,
      [c[0] * amount, c[1] * amount, c[2] * amount, amount],
      0.0004,
    );
    this.splat(
      this.velocity,
      x,
      y,
      [(Math.random() - 0.5) * 16, 26 + Math.random() * 14, 0, 0],
      0.0012,
    );
  }

  private nextColor(): InkColor {
    let pick = Math.floor(Math.random() * this.palette.length);
    if (pick === this.lastColor) pick = (pick + 1) % this.palette.length;
    this.lastColor = pick;
    return this.palette[pick] ?? [0.6, 0.6, 0.6];
  }

  private fall(x: number, y: number) {
    const c = this.nextColor();
    const amount = 1.0 + Math.random() * 0.6;
    this.splat(
      this.dye,
      x,
      y,
      [c[0] * amount, c[1] * amount, c[2] * amount, amount],
      0.00026,
    );
    this.splat(
      this.velocity,
      x,
      y,
      [(Math.random() - 0.5) * 10, -(70 + Math.random() * 30), 0, 0],
      0.0009,
    );
  }

  private step(dt: number) {
    const gl = this.gl;
    const p = this.programs;
    const v = this.velocity;
    const texel: [number, number] = [1 / v.width, 1 / v.height];

    this.activate(p.current, texel);
    this.bindTexture(p.current, "uVelocity", v.read, 0);
    gl.uniform1f(p.current.uniforms.uTime, this.elapsed);
    gl.uniform1f(p.current.uniforms.uStrength, CURRENT);
    gl.uniform1f(p.current.uniforms.uDt, dt);
    gl.uniform1f(p.current.uniforms.uAspect, this.aspect);
    this.draw(v.write);
    v.swap();

    this.activate(p.curl, texel);
    this.bindTexture(p.curl, "uVelocity", v.read, 0);
    this.draw(this.curl);

    this.activate(p.swirl, texel);
    this.bindTexture(p.swirl, "uVelocity", v.read, 0);
    this.bindTexture(p.swirl, "uCurl", this.curl, 1);
    gl.uniform1f(p.swirl.uniforms.uSwirl, SWIRL);
    gl.uniform1f(p.swirl.uniforms.uDt, dt);
    this.draw(v.write);
    v.swap();

    this.activate(p.divergence, texel);
    this.bindTexture(p.divergence, "uVelocity", v.read, 0);
    this.draw(this.divergence);

    this.activate(p.scale, texel);
    this.bindTexture(p.scale, "uTarget", this.pressure.read, 0);
    gl.uniform1f(p.scale.uniforms.uScale, 0.8);
    this.draw(this.pressure.write);
    this.pressure.swap();

    this.activate(p.pressure, texel);
    this.bindTexture(p.pressure, "uDivergence", this.divergence, 1);
    for (let i = 0; i < PRESSURE_ITERATIONS; i += 1) {
      this.bindTexture(p.pressure, "uPressure", this.pressure.read, 0);
      this.draw(this.pressure.write);
      this.pressure.swap();
    }

    this.activate(p.subtract, texel);
    this.bindTexture(p.subtract, "uPressure", this.pressure.read, 0);
    this.bindTexture(p.subtract, "uVelocity", v.read, 1);
    this.draw(v.write);
    v.swap();

    this.activate(p.advect, texel);
    gl.uniform2f(p.advect.uniforms.uVelocityTexel, texel[0], texel[1]);
    gl.uniform1f(p.advect.uniforms.uDt, dt);
    this.bindTexture(p.advect, "uVelocity", v.read, 0);
    this.bindTexture(p.advect, "uSource", v.read, 1);
    gl.uniform1f(p.advect.uniforms.uFade, VELOCITY_FADE);
    this.draw(v.write);
    v.swap();

    // The ink: forward, back, and corrected, so its edges stay sharp.
    const dyeTexel: [number, number] = [
      1 / this.dye.width,
      1 / this.dye.height,
    ];
    this.activate(p.advect, dyeTexel);
    gl.uniform2f(p.advect.uniforms.uVelocityTexel, texel[0], texel[1]);
    gl.uniform1f(p.advect.uniforms.uFade, 0);
    this.bindTexture(p.advect, "uVelocity", v.read, 0);
    gl.uniform1f(p.advect.uniforms.uDt, dt);
    this.bindTexture(p.advect, "uSource", this.dye.read, 1);
    this.draw(this.forward);
    gl.uniform1f(p.advect.uniforms.uDt, -dt);
    this.bindTexture(p.advect, "uSource", this.forward, 1);
    this.draw(this.backward);

    this.activate(p.sharpen, dyeTexel);
    gl.uniform2f(p.sharpen.uniforms.uVelocityTexel, texel[0], texel[1]);
    gl.uniform2f(p.sharpen.uniforms.uSourceTexel, dyeTexel[0], dyeTexel[1]);
    gl.uniform1f(p.sharpen.uniforms.uDt, dt);
    gl.uniform1f(p.sharpen.uniforms.uFade, DYE_FADE);
    this.bindTexture(p.sharpen, "uVelocity", v.read, 0);
    this.bindTexture(p.sharpen, "uSource", this.dye.read, 1);
    this.bindTexture(p.sharpen, "uForward", this.forward, 2);
    this.bindTexture(p.sharpen, "uBackward", this.backward, 3);
    this.draw(this.dye.write);
    this.dye.swap();
  }

  private render(fade: number) {
    const gl = this.gl;
    const p = this.programs.display;
    this.activate(p, [1 / this.dye.width, 1 / this.dye.height]);
    this.bindTexture(p, "uDye", this.dye.read, 0);
    gl.uniform2f(p.uniforms.uDyeTexel, 1 / this.dye.width, 1 / this.dye.height);
    gl.uniform3f(
      p.uniforms.uSurface,
      this.surface[0],
      this.surface[1],
      this.surface[2],
    );
    gl.uniform1f(p.uniforms.uDark, this.dark ? 1 : 0);
    gl.uniform4f(
      p.uniforms.uQuiet,
      this.quiet[0],
      this.quiet[1],
      this.quiet[2],
      this.quiet[3],
    );
    gl.uniform1f(p.uniforms.uFade, fade);
    gl.uniform1f(p.uniforms.uTime, this.elapsed);
    this.draw(null);
  }

  private splat(
    target: Pair,
    x: number,
    y: number,
    value: readonly [number, number, number, number],
    radius: number,
  ) {
    const gl = this.gl;
    const p = this.programs.splat;
    this.activate(p, [1 / target.width, 1 / target.height]);
    this.bindTexture(p, "uTarget", target.read, 0);
    gl.uniform1f(p.uniforms.uAspect, this.aspect);
    gl.uniform2f(p.uniforms.uPoint, x, y);
    gl.uniform1f(p.uniforms.uRadius, radius);
    gl.uniform4f(p.uniforms.uValue, value[0], value[1], value[2], value[3]);
    this.draw(target.write);
    target.swap();
  }

  // ── plumbing ───────────────────────────────────────────────────────────

  private allocate() {
    const gl = this.gl;
    const sim = this.gridSize(SIM_SHORT);
    const dye = this.gridSize(DYE_SHORT);
    if (this.velocity) this.releaseTargets();
    this.velocity = this.pair(sim[0], sim[1], gl.RG16F, gl.RG);
    this.dye = this.pair(dye[0], dye[1], gl.RGBA16F, gl.RGBA);
    this.pressure = this.pair(sim[0], sim[1], gl.R16F, gl.RED);
    this.divergence = this.target(sim[0], sim[1], gl.R16F, gl.RED);
    this.curl = this.target(sim[0], sim[1], gl.R16F, gl.RED);
    this.forward = this.target(dye[0], dye[1], gl.RGBA16F, gl.RGBA);
    this.backward = this.target(dye[0], dye[1], gl.RGBA16F, gl.RGBA);
  }

  private releaseTargets() {
    const gl = this.gl;
    for (const target of [
      this.velocity.read,
      this.velocity.write,
      this.dye.read,
      this.dye.write,
      this.pressure.read,
      this.pressure.write,
      this.divergence,
      this.curl,
      this.forward,
      this.backward,
    ]) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
  }

  private gridSize(short: number): [number, number] {
    return this.aspect >= 1
      ? [Math.round(short * this.aspect), short]
      : [short, Math.round(short / this.aspect)];
  }

  private target(
    width: number,
    height: number,
    internal: number,
    format: number,
  ): Target {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error("ink: no target");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internal,
      width,
      height,
      0,
      format,
      gl.HALF_FLOAT,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("ink: float targets unavailable");
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, framebuffer, width, height };
  }

  private pair(
    width: number,
    height: number,
    internal: number,
    format: number,
  ): Pair {
    const pair: Pair = {
      read: this.target(width, height, internal, format),
      write: this.target(width, height, internal, format),
      width,
      height,
      swap: () => {
        const read = pair.read;
        pair.read = pair.write;
        pair.write = read;
      },
    };
    return pair;
  }

  private program(fragment: string): Program {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("ink: no shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`ink: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram();
    if (!program) throw new Error("ink: no program");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`ink: ${gl.getProgramInfoLog(program)}`);
    }
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(program, i);
      if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  }

  private activate(program: Program, texel: [number, number]) {
    const gl = this.gl;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
    gl.useProgram(program.program);
    gl.uniform2f(program.uniforms.uTexel, texel[0], texel[1]);
  }

  private bindTexture(
    program: Program,
    name: string,
    target: Target,
    unit: number,
  ) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.uniform1i(program.uniforms[name], unit);
  }

  private draw(target: Target | null) {
    const gl = this.gl;
    if (target) {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    } else {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
