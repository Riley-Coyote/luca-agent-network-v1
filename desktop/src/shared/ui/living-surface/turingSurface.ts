import type {
  LivingSurface,
  SurfaceBody,
  SurfaceBox,
  SurfaceColor,
} from "./types";

/**
 * The Turing film: Ghost's black liquid, held still across the new chat.
 *
 * Two chemicals on a grid of cells 1.3 pt across: U, fed in at rate F, and V,
 * taken away at F + k, meeting by U + 2V → 3V, with U spreading twice as fast
 * as V (Pearson's Gray–Scott in Karl Sims' form, a nine-point Laplacian). V is
 * the film. Nothing is drawn: meaning moves only the feed and the kill. The
 * film divides where the words are, settles into labyrinth across the room and
 * keeps still at its edges, and nothing is fed under a line of words.
 *
 * It is lit as Ghost's ink is lit, from above and on black: seen only along
 * the edges that face the light, a rim of 0.34 falling by e within 0.9 pt and
 * a softer band of 0.045 within 6 pt. On paper the same edges are pressed in,
 * lit above and shaded below. The edges are read off V itself, from a cubic
 * B-spline of the grid, so the light runs along curves that were never
 * polygons.
 *
 * One body of the same ink sits in the middle, the one you are about to talk
 * to; where the film comes near it, the smooth minimum draws a neck between
 * them. The composer is glass over the film, bending it at its rim. The
 * pointer is water: it parts the film along its way and clears it where it
 * presses. Each keystroke lands as a seed under the composer that pushes its
 * neighbours aside and divides. Sending drains the whole film, and the body
 * with it, into the composer.
 *
 * From Ghost's lab (prompt-ghost, lab/life/studies/04-turing/rd.js), with the
 * rulebook's light and lives (lab/life/RULES.md §6–7).
 */

/** Pearson's lives (feed F, kill k). */
const LIVES = `
const vec2 SPOTS = vec2(0.035, 0.065);
const vec2 DIVIDING = vec2(0.0367, 0.0649);
const vec2 LABYRINTH = vec2(0.029, 0.057);
const vec2 WELL = vec2(0.0, 0.12);`;

/** Where the words are, the body and the composer: shared by the reaction's maps. */
const PLACES = `
uniform vec4 uWell[12];       // centre, size (points, y down)
uniform int uWells;
uniform vec4 uBody;           // centre, radius (points), how much of it there is
uniform vec4 uGlass;          // centre, half size (points)
uniform vec2 uGlassShape;     // corner radius, 1 while it's there
uniform vec2 uSize;           // the surface (points)

float box(vec2 p, vec2 c, vec2 extent, float r) {
  vec2 q = abs(p - c) - extent + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// How far p is from the nearest thing the film keeps clear of (points).
float clearOf(vec2 p) {
  float d = 1e4;
  for (int i = 0; i < 12; i++) {
    if (i >= uWells) break;
    vec4 r = uWell[i];
    d = min(d, box(p, r.xy, r.zw * 0.5 + vec2(4.0, 3.0), 4.0));
  }
  if (uBody.w > 0.001) d = min(d, length(p - uBody.xy) - uBody.z - 2.5);
  if (uGlassShape.y > 0.5) d = min(d, box(p, uGlass.xy, uGlass.zw + 3.0, uGlassShape.x + 3.0));
  return d;
}`;

const QUAD_VERT = `#version 300 es
layout(location = 0) in vec2 aCorner;
void main() { gl_Position = vec4(aCorner, 0.0, 1.0); }`;

const SIM_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uState;
uniform ivec2 uGrid;
uniform float uCell;          // points per cell
uniform vec4 uHand[4];        // the pointer and three keystrokes: centre, radius (points), how hard
uniform vec2 uHandV;          // the pointer's travel, points a step
uniform vec4 uSeed[8];        // seeds: centre, radius (points), V
uniform int uSeeds;
${LIVES}
${PLACES}
out vec4 outState;

vec2 at(ivec2 c) { return texelFetch(uState, clamp(c, ivec2(0), uGrid - 1), 0).xy; }
vec2 bilinear(vec2 q) {
  q -= 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = fract(q);
  return mix(mix(at(i), at(i + ivec2(1, 0)), f.x), mix(at(i + ivec2(0, 1)), at(i + ivec2(1, 1)), f.x), f.y);
}

// The feed and the kill at p: the only way meaning reaches the film.
vec2 fk(vec2 p) {
  float near = clearOf(p);
  // alive where the words are, settled across the room, still at its edges
  vec2 life = mix(LABYRINTH, DIVIDING, 1.0 - smoothstep(10.0, 70.0, near));
  vec2 q = (p - 0.5 * uSize) / (0.5 * uSize);
  life = mix(life, SPOTS, 0.9 * smoothstep(0.62, 1.02, length(q * vec2(0.86, 1.0))));
  return mix(life, WELL, 1.0 - smoothstep(0.0, 6.0, near));
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 p = gl_FragCoord.xy * uCell;            // points, y down (row 0 is the top)
  vec2 s = at(c);
  vec2 lap = 0.2 * (at(c + ivec2(1, 0)) + at(c - ivec2(1, 0)) + at(c + ivec2(0, 1)) + at(c - ivec2(0, 1)))
           + 0.05 * (at(c + ivec2(1, 1)) + at(c - ivec2(1, 1)) + at(c + ivec2(1, -1)) + at(c + ivec2(-1, 1))) - s;
  // the hand: carried along its way and pushed out from under it (read from upstream), cleared where it presses
  vec2 disp = vec2(0.0);
  float clearing = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 h = uHand[i];
    if (h.w <= 0.001) continue;
    vec2 d = p - h.xy;
    float r2 = h.z * h.z, fall = exp(-dot(d, d) / r2);
    float len = max(length(d), 0.001);
    disp += (d / len) * 0.32 * uCell * h.w * fall * smoothstep(0.0, 0.5 * h.z, len);
    if (i == 0) disp += uHandV * fall;
    clearing = max(clearing, h.w * h.w * exp(-dot(d, d) / (0.3 * r2)));
  }
  if (dot(disp, disp) > 1e-6) s = bilinear(gl_FragCoord.xy - disp / uCell);
  vec2 FK = fk(p);
  float uvv = s.x * s.y * s.y;
  float u = s.x + lap.x - uvv + FK.x * (1.0 - s.x);
  float v = s.y + 0.5 * lap.y + uvv - (FK.x + FK.y) * s.y;
  v *= 1.0 - 0.14 * clearing;
  u += (1.0 - u) * 0.14 * clearing;
  for (int i = 0; i < 8; i++) {
    if (i >= uSeeds) break;
    vec4 q = uSeed[i];
    if (length(p - q.xy) < q.z) { u = 0.5; v = max(v, q.w); }
  }
  outState = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}`;

/** The first state: bare, but for a ring of the film round the body, and a little sown where it's fed. On a new size,
 * the film already grown is carried over cell for cell, and only the new ground is sown. */
const SOW_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uOld;
uniform ivec2 uOldGrid;       // the size of the film carried over (0 when there's none)
uniform float uCell;
uniform float uDensity;
uniform float uSeed;
${PLACES}
out vec4 outState;
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (c.x < uOldGrid.x && c.y < uOldGrid.y) {
    outState = vec4(texelFetch(uOld, c, 0).xy, 0.0, 1.0);
    return;
  }
  vec2 p = gl_FragCoord.xy * uCell;
  vec2 b = floor(p / 7.0);
  float near = clearOf(p);
  float ring = uBody.w > 0.001 ? step(abs(length(p - uBody.xy) - uBody.z - 12.0), 5.0) : 0.0;
  float live = max(ring * step(0.5, hash(b + 1.7)), step(hash(b), uDensity)) * step(6.0, near);
  outState = vec4(mix(1.0, 0.5, live), live * (0.25 + 0.05 * hash(b + 3.1)), 0.0, 1.0);
}`;

const LIGHT_FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uState;
uniform ivec2 uGrid;
uniform float uCell;
uniform float uScale;         // device pixels per point
uniform float uLight;         // how much of the light has come on, 0 .. 1
uniform vec3 uGround;         // the surface the film lies on
uniform float uDark;          // 1 on a dark surface, 0 on paper
uniform vec4 uGlassFill;      // the composer's own colour, and how full of ink it is
uniform float uTime;
uniform vec4 uVortex;         // sending: where the film drains (points), how far it's drawn in (log), how far turned
uniform vec3 uReveal;         // where the light first comes on (points), and how far out it has reached
uniform float uDrainReach;    // sending: how far from the composer the film still reaches (points)
${PLACES}
out vec4 outColor;

const vec2 TO_LIGHT = vec2(0.0, -1.0);
const float INK_DEPTH = 0.35; // how much darker than the surface the film itself is, on the dark

float cellV(ivec2 c) { return texelFetch(uState, clamp(c, ivec2(0), uGrid - 1), 0).y; }

// V and its slope (per cell) from a cubic B-spline of the sixteen cells round q
vec3 spline(vec2 q) {
  q -= 0.5;
  vec2 i = floor(q), f = q - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 d0 = (-1.0 + 2.0 * f - f2) / 2.0;
  vec2 d1 = (-4.0 * f + 3.0 * f2) / 2.0;
  vec2 d2 = (1.0 + 2.0 * f - 3.0 * f2) / 2.0;
  vec2 d3 = f2 / 2.0;
  float wx[4] = float[4](w0.x, w1.x, w2.x, w3.x), wy[4] = float[4](w0.y, w1.y, w2.y, w3.y);
  float dx[4] = float[4](d0.x, d1.x, d2.x, d3.x), dy[4] = float[4](d0.y, d1.y, d2.y, d3.y);
  ivec2 b = ivec2(i) - 1;
  vec3 r = vec3(0.0);
  for (int y = 0; y < 4; y++) {
    vec3 row = vec3(0.0);
    for (int x = 0; x < 4; x++) {
      float v = cellV(b + ivec2(x, y));
      row += v * vec3(wx[x], dx[x], wx[x]);
    }
    r += vec3(row.x * wy[y], row.y * wy[y], row.z * dy[y]);
  }
  return r;
}

// The ink at p: its inside distance (points, positive in the ink) and outward normal. The film and the body
// are one liquid, joined by the polynomial smooth minimum: a neck wherever they come near.
vec3 ink(vec2 p) {
  vec3 s = spline(p / uCell);
  vec2 g = s.yz / uCell;
  float gm = max(length(g), 1e-4);
  float d = clamp((s.x - 0.2) / gm, -9.0, 9.0);
  vec2 n = -g / gm;
  if (uBody.w > 0.001) {
    vec2 to = p - uBody.xy;
    float len = max(length(to), 1e-3);
    float a = -d, b = len - uBody.z, k = 7.0;
    float h = max(k - abs(a - b), 0.0) / k;
    float m = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    n = normalize(mix(to / len, n, m) + 1e-5);
    d = -(min(a, b) - h * h * k * 0.25);
  }
  return vec3(d, n);
}

// Where the film seen at p comes from: sending draws it in to the composer, turning as it goes.
vec3 drawnFrom(vec2 p) {
  if (uVortex.z <= 0.0) return vec3(p, 1.0);
  vec2 d = p - uVortex.xy;
  float r = length(d);
  // drawn in unevenly, so it runs in as turning arms rather than one shrinking picture
  float squeeze = exp(uVortex.z * (1.0 + 0.32 * sin(3.0 * atan(d.y, d.x) + 1.6 * uVortex.z + r / 90.0)));
  float turn = uVortex.w * 160.0 / (r + 160.0);
  float c = cos(turn), s = sin(turn);
  vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y) * squeeze;
  // and its far edge runs in first, unevenly, the way water leaves a basin
  float edge = uDrainReach * (1.0 + 0.2 * sin(5.0 * atan(q.y, q.x) + 3.0 * uVortex.w));
  float left = 1.0 - smoothstep(edge - 60.0, edge, length(q));
  return vec3(uVortex.xy + q, squeeze / max(left, 1e-3));
}

// What the surface shows of the film at p, seen squeezed by squeeze: the ink lit from above on the dark,
// pressed into paper in the light. Squeezed past seeing, it has gone into the composer.
vec3 shade(vec2 p, float squeeze, float light) {
  vec3 e = ink(p);
  float inSurface = step(0.0, p.x) * step(0.0, p.y) * step(p.x, uSize.x) * step(p.y, uSize.y);
  float drawn = (1.0 - smoothstep(1.6, 7.0, squeeze)) * inSurface * light;
  float cover = clamp(0.5 + e.x * uScale / squeeze, 0.0, 1.0) * drawn;
  float inside = max(e.x, 0.0);
  float face = dot(e.yz, TO_LIGHT);
  float up = smoothstep(0.08, 0.95, face);
  if (uDark > 0.5) {
    float rim = exp(-inside / 0.9) * up * 0.34;
    float sky = exp(-inside / 6.0) * up * 0.045;
    // wet: where the meniscus's shoulder turns 15 degrees to the light, a fine crescent mirrors it
    float slope = 0.5625 * exp(-inside / 1.6);
    float shoulder = (slope - 0.26) / 0.05;
    float wet = exp(-shoulder * shoulder) * smoothstep(0.7, 0.98, face) * 0.3;
    // the body is Ghost's own black; the film is a shade of it, and the neck between them runs from one to the other
    float body = uBody.w > 0.001 ? 1.0 - smoothstep(-2.0, 5.0, length(p - uBody.xy) - uBody.z) : 0.0;
    return mix(uGround, vec3(0.0), cover * mix(INK_DEPTH, 0.94, body)) + (rim + sky + wet) * cover;
  }
  float down = smoothstep(0.08, 0.95, -face);
  float lit = exp(-inside / 0.9) * up * 0.55 * cover;
  float pressed = (exp(-inside / 1.6) * down * 0.11 + 0.02) * cover;
  // the body is ink on paper, not a pressing
  float body = uBody.w > 0.001 ? 1.0 - smoothstep(-0.5, 0.5, length(p - uBody.xy) - uBody.z) : 0.0;
  vec3 paper = uGround * (1.0 - pressed) + (1.0 - uGround) * lit;
  return mix(paper, vec3(0.03) + lit * 0.5, body * cover);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uScale - gl_FragCoord.y) / uScale;   // points, y down
  // the light comes on out from the body, and finds the film already there
  float light = uLight * (1.0 - smoothstep(uReveal.z - 160.0, uReveal.z, length(p - uReveal.xy)));
  vec3 from = drawnFrom(p);
  vec3 color = shade(from.xy, from.z, light);
  // the composer: glass over the film, bending it at its rim, and filling with ink as the film drains in
  if (uGlassShape.y > 0.5) {
    float g = box(p, uGlass.xy, uGlass.zw, uGlassShape.x);
    if (g < 1.5) {
      vec2 ex = vec2(0.5, 0.0), ey = vec2(0.0, 0.5);
      vec2 n = normalize(vec2(
        box(p + ex, uGlass.xy, uGlass.zw, uGlassShape.x) - box(p - ex, uGlass.xy, uGlass.zw, uGlassShape.x),
        box(p + ey, uGlass.xy, uGlass.zw, uGlassShape.x) - box(p - ey, uGlass.xy, uGlass.zw, uGlassShape.x)) + 1e-5);
      float depth = max(-g, 0.0);
      float bend = 1.0 - smoothstep(0.0, 16.0, depth);
      vec3 lens = drawnFrom(p + n * 9.0 * bend * bend);
      vec3 behind = shade(lens.xy, lens.z, light);
      vec3 glass = uDark > 0.5 ? 0.30 * behind + 20.0 / 255.0 : 0.955 * behind + 0.04 * (1.0 - behind);
      // drinking the film in, it holds the ink a moment before it settles to its own colour
      float drinking = uGlassFill.a * (1.0 - uGlassFill.a) * 4.0;
      glass = mix(glass, vec3(0.0), 0.8 * drinking * uDark);
      glass = mix(glass, uGlassFill.rgb, smoothstep(0.5, 1.0, uGlassFill.a));
      float up = smoothstep(0.08, 0.95, dot(n, TO_LIGHT));
      float rim = exp(-depth / 0.9) * (0.34 * up + 0.05 * (1.0 - up));
      glass += (uDark > 0.5 ? rim : rim * 0.6) * (1.0 - 0.6 * uGlassFill.a + 1.2 * drinking);
      color = mix(color, glass, clamp(0.5 - g * uScale, 0.0, 1.0));
    }
  }
  float noise = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  outColor = vec4(color + (noise - 0.5) / 255.0, 1.0);
}`;

type Program = {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
};

/** Points per cell of the reaction. */
const CELL = 1.3;
/** The reaction's clock: steps a second, at rest and while it first grows. */
const STEPS_PER_SECOND = 480;
const OPENING_STEPS_PER_SECOND = 5400;
const OPENING_SECONDS = 1.4;
const MAX_STEPS_PER_FRAME = 96;
/** Opening: the film grows unseen for a moment, then the light comes on out from the body and finds it. */
const UNSEEN_SECONDS = 0.4;
const REVEAL_SECONDS = 1.1;
/** The pointer as water: how wide, and how fast it settles once it stops. */
const HAND_RADIUS = 26;
/** Sending: how long the film takes to drain into the composer. */
export const TURING_DRAIN_SECONDS = 0.75;
/** How much of the surface is sown with the film's first drops. */
const SOW_DENSITY = 0.12;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class TuringSurface implements LivingSurface {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly sim: Program;
  private readonly sowing: Program;
  private readonly light: Program;
  private readonly quad: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private targets: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[] =
    [];
  private current = 0;
  private gridW = 0;
  private gridH = 0;
  private width = 1;
  private height = 1;
  private ground: SurfaceColor = [0.063, 0.063, 0.063];
  private dark = true;
  private sown = false;
  private sinceSown = 0;
  private stepsSinceSown = 0;
  private owed = 0;
  private time = 0;
  private readonly wells = new Float32Array(48);
  private wellCount = 0;
  private body: { x: number; y: number; r: number } | null = null;
  private glass: {
    x: number;
    y: number;
    hw: number;
    hh: number;
    r: number;
  } | null = null;
  private glassFill: SurfaceColor = [0.086, 0.086, 0.086];
  private readonly hands = new Float32Array(16);
  private pointer = {
    x: -1e4,
    y: -1e4,
    strength: 0,
    pressed: false,
    travelX: 0,
    travelY: 0,
  };
  private readonly arrivals: { x: number; y: number; age: number }[] = [];
  private readonly seeds: { x: number; y: number }[] = [];
  private handTravel: [number, number] = [0, 0];
  private drain: { age: number } | null = null;

  static create(canvas: HTMLCanvasElement): TuringSurface | null {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "low-power",
      stencil: false,
    });
    if (!gl?.getExtension("EXT_color_buffer_float")) return null;
    try {
      return new TuringSurface(canvas, gl);
    } catch (error) {
      console.warn("turing", error);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    this.sim = this.program(SIM_FRAG);
    this.sowing = this.program(SOW_FRAG);
    this.light = this.program(LIGHT_FRAG);
    const quad = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!quad || !vao) throw new Error("turing: no buffers");
    this.quad = quad;
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.resize();
  }

  configure(surface: SurfaceColor) {
    this.ground = surface;
    this.dark =
      0.2126 * surface[0] + 0.7152 * surface[1] + 0.0722 * surface[2] < 0.5;
  }

  setWells(boxes: readonly SurfaceBox[]) {
    this.wells.fill(0);
    const list = boxes.slice(0, 12);
    list.forEach((b, i) => {
      this.wells.set(
        [
          b.x * this.width,
          (1 - b.y) * this.height,
          b.halfWidth * 2 * this.width,
          b.halfHeight * 2 * this.height,
        ],
        i * 4,
      );
    });
    this.wellCount = list.length;
  }

  setBody(body: SurfaceBody | null) {
    if (this.drain) return;
    this.body = body
      ? {
          x: body.x * this.width,
          y: (1 - body.y) * this.height,
          r: body.radius * this.width,
        }
      : null;
  }

  setGlass(box: SurfaceBox | null, fill: SurfaceColor) {
    this.glassFill = fill;
    this.glass = box
      ? {
          x: box.x * this.width,
          y: (1 - box.y) * this.height,
          hw: box.halfWidth * this.width,
          hh: box.halfHeight * this.height,
          r: (box.radius ?? 0) * this.width,
        }
      : null;
  }

  pulse(x: number, y: number) {
    if (this.drain) return;
    const at = { x: x * this.width, y: (1 - y) * this.height };
    this.seeds.push(at);
    if (this.seeds.length > 8) this.seeds.shift();
    this.arrivals.push({ ...at, age: 0 });
    if (this.arrivals.length > 3) this.arrivals.shift();
  }

  stir(x: number, y: number, dx: number, dy: number) {
    const px = x * this.width;
    const py = (1 - y) * this.height;
    const travel = Math.hypot(dx * this.width, dy * this.height);
    this.pointer.x = px;
    this.pointer.y = py;
    this.pointer.travelX += dx * this.width;
    this.pointer.travelY -= dy * this.height;
    // Passing over it, the pointer only stirs; how much, from how fast it goes.
    this.pointer.strength = Math.max(
      this.pointer.strength,
      Math.min(0.42, travel / 22),
    );
  }

  press(x: number, y: number, down: boolean) {
    this.pointer.x = x * this.width;
    this.pointer.y = (1 - y) * this.height;
    this.pointer.pressed = down;
  }

  release(x: number, y: number, _width: number) {
    if (this.drain) return;
    this.drain = { age: 0 };
    if (!this.glass) {
      this.glass = {
        x: x * this.width,
        y: (1 - y) * this.height,
        hw: 1,
        hh: 1,
        r: 0,
      };
    }
  }

  /** Grow the film unseen until it has had `seconds` of life; asked again, it only makes up the difference. */
  warm(seconds: number) {
    if (!this.sow()) return;
    let steps = Math.round(seconds * STEPS_PER_SECOND) - this.stepsSinceSown;
    this.sinceSown = Math.max(OPENING_SECONDS, UNSEEN_SECONDS + REVEAL_SECONDS);
    while (steps > 0) {
      const n = Math.min(400, steps);
      this.step(n);
      steps -= n;
    }
  }

  frame(dt: number, fade: number) {
    this.time += dt;
    if (!this.sown && !this.sow()) {
      this.draw(fade);
      return;
    }
    if (this.drain) {
      // Draining, the film holds its shape while it's drawn in.
      this.advance(dt, 0);
      this.draw(fade);
      return;
    }
    this.sinceSown += dt;
    const rate =
      this.sinceSown < OPENING_SECONDS
        ? OPENING_STEPS_PER_SECOND
        : this.sinceSown < OPENING_SECONDS + 0.8
          ? STEPS_PER_SECOND +
            (OPENING_STEPS_PER_SECOND - STEPS_PER_SECOND) *
              (1 -
                smoothstep(
                  OPENING_SECONDS,
                  OPENING_SECONDS + 0.8,
                  this.sinceSown,
                ))
          : STEPS_PER_SECOND;
    this.owed = Math.min(MAX_STEPS_PER_FRAME, this.owed + dt * rate);
    const steps = Math.floor(this.owed);
    this.owed -= steps;
    this.advance(dt, steps);
    if (steps > 0) this.step(steps);
    this.draw(fade);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(1, this.canvas.clientWidth);
    const cssH = Math.max(1, this.canvas.clientHeight);
    const pixelW = Math.round(cssW * dpr);
    const pixelH = Math.round(cssH * dpr);
    if (this.canvas.width === pixelW && this.canvas.height === pixelH) return;
    // Lengths held in points stay where they were on the page.
    this.canvas.width = pixelW;
    this.canvas.height = pixelH;
    this.width = cssW;
    this.height = cssH;
    const gridW = Math.ceil(cssW / CELL);
    const gridH = Math.ceil(cssH / CELL);
    if (gridW === this.gridW && gridH === this.gridH) return;
    // A new size keeps the film it has grown: carried over, with only new ground sown.
    const previous = this.targets;
    const grown = this.sown ? previous[this.current] : undefined;
    const from = { w: this.gridW, h: this.gridH };
    this.gridW = gridW;
    this.gridH = gridH;
    this.allocate();
    if (grown) this.lay(grown.texture, from.w, from.h);
    else this.sown = false;
    const gl = this.gl;
    for (const t of previous) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteTexture(t.texture);
      gl.deleteFramebuffer(t.framebuffer);
    }
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
    for (const p of [this.sim, this.sowing, this.light])
      gl.deleteProgram(p.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /** The springs and timers between steps: the pointer, the keystrokes, the drain. */
  private advance(dt: number, steps: number) {
    const p = this.pointer;
    p.strength = p.pressed
      ? Math.min(1, p.strength + dt / 0.3)
      : p.strength * Math.exp(-dt * 3.2);
    const per = Math.max(1, steps);
    this.hands.set([p.x, p.y, HAND_RADIUS, p.strength], 0);
    this.handTravel = [p.travelX / per, p.travelY / per];
    p.travelX = 0;
    p.travelY = 0;
    for (const a of this.arrivals) a.age += dt;
    while (this.arrivals.length && (this.arrivals[0]?.age ?? 0) > 0.9)
      this.arrivals.shift();
    for (let i = 0; i < 3; i += 1) {
      const a = this.arrivals[i];
      this.hands.set(
        a ? [a.x, a.y, 9, (1 - a.age / 0.9) * 0.7] : [0, 0, 1, 0],
        (i + 1) * 4,
      );
    }
    if (this.drain) this.drain.age += dt;
  }

  /** Sow the first state, once the surface knows its size and where its body is. */
  private sow() {
    if (this.sown) return true;
    if (!this.gridW || !this.targets.length) return false;
    if (!this.lay(null, 0, 0)) return false;
    this.sown = true;
    this.sinceSown = 0;
    this.stepsSinceSown = 0;
    return true;
  }

  /** Lay the state into the first target: what grew before (a `from` of that size), and sown ground elsewhere. */
  private lay(from: WebGLTexture | null, fromW: number, fromH: number) {
    const gl = this.gl;
    const target = this.targets[0];
    if (!target) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, this.gridW, this.gridH);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
    gl.useProgram(this.sowing.program);
    const u = this.sowing.uniform;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from);
    gl.uniform1i(u("uOld"), 0);
    gl.uniform2i(u("uOldGrid"), from ? fromW : 0, from ? fromH : 0);
    gl.uniform1f(u("uCell"), CELL);
    gl.uniform1f(u("uDensity"), SOW_DENSITY);
    gl.uniform1f(u("uSeed"), 1.7);
    this.places(this.sowing);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.current = 0;
    return true;
  }

  private step(n: number) {
    const gl = this.gl;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
    gl.useProgram(this.sim.program);
    const u = this.sim.uniform;
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.gridW, this.gridH);
    gl.uniform2i(u("uGrid"), this.gridW, this.gridH);
    gl.uniform1f(u("uCell"), CELL);
    gl.uniform4fv(u("uHand"), this.hands);
    gl.uniform2f(u("uHandV"), this.handTravel[0], this.handTravel[1]);
    const seeds = new Float32Array(32);
    this.seeds.slice(0, 8).forEach((s, i) => {
      seeds.set([s.x, s.y, 3.4, 0.3], i * 4);
    });
    gl.uniform4fv(u("uSeed"), seeds);
    this.places(this.sim);
    gl.uniform1i(u("uState"), 0);
    gl.activeTexture(gl.TEXTURE0);
    for (let i = 0; i < n; i += 1) {
      gl.uniform1i(u("uSeeds"), i === 0 ? Math.min(8, this.seeds.length) : 0);
      const from = this.targets[this.current];
      const to = this.targets[1 - this.current];
      if (!from || !to) break;
      gl.bindTexture(gl.TEXTURE_2D, from.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.current = 1 - this.current;
    }
    this.seeds.length = 0;
    this.stepsSinceSown += n;
    gl.bindVertexArray(null);
  }

  private draw(fade: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
    gl.useProgram(this.light.program);
    const u = this.light.uniform;
    const state = this.targets[this.current];
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state?.texture ?? null);
    gl.uniform1i(u("uState"), 0);
    gl.uniform2i(u("uGrid"), Math.max(1, this.gridW), Math.max(1, this.gridH));
    gl.uniform1f(u("uCell"), CELL);
    gl.uniform1f(u("uScale"), this.canvas.width / this.width);
    gl.uniform1f(u("uLight"), this.sown ? fade : 0);
    const from = this.body ??
      this.glass ?? { x: this.width / 2, y: this.height / 2 };
    const farthest = Math.hypot(
      Math.max(from.x, this.width - from.x),
      Math.max(from.y, this.height - from.y),
    );
    const shown = smoothstep(
      UNSEEN_SECONDS,
      UNSEEN_SECONDS + REVEAL_SECONDS,
      this.sinceSown,
    );
    const reach =
      this.sinceSown <= UNSEEN_SECONDS
        ? 0
        : (farthest + 200) * (1 - (1 - shown) ** 2.2);
    gl.uniform3f(u("uReveal"), from.x, from.y, reach);
    gl.uniform3f(u("uGround"), this.ground[0], this.ground[1], this.ground[2]);
    gl.uniform1f(u("uDark"), this.dark ? 1 : 0);
    const drawn = this.drain
      ? smoothstep(0, TURING_DRAIN_SECONDS, this.drain.age)
      : 0;
    const fill = smoothstep(0.15, 1, drawn);
    gl.uniform4f(
      u("uGlassFill"),
      this.glassFill[0],
      this.glassFill[1],
      this.glassFill[2],
      fill,
    );
    const glass = this.glass;
    gl.uniform4f(
      u("uVortex"),
      glass?.x ?? 0,
      glass?.y ?? 0,
      4.6 * drawn ** 1.8,
      2.4 * drawn ** 1.4,
    );
    gl.uniform1f(
      u("uDrainReach"),
      this.drain
        ? Math.hypot(this.width, this.height) * (1 - drawn) ** 0.7 + 1
        : 1e5,
    );
    gl.uniform1f(u("uTime"), this.time);
    this.places(this.light);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** The words, the body and the composer, for whichever program is about to run. */
  private places(program: Program) {
    const gl = this.gl;
    const u = program.uniform;
    gl.uniform4fv(u("uWell"), this.wells);
    gl.uniform1i(u("uWells"), this.wellCount);
    const body = this.body;
    gl.uniform4f(
      u("uBody"),
      body?.x ?? 0,
      body?.y ?? 0,
      body?.r ?? 0,
      body && body.r > 0.5 ? 1 : 0,
    );
    const glass = this.glass;
    gl.uniform4f(
      u("uGlass"),
      glass?.x ?? 0,
      glass?.y ?? 0,
      glass?.hw ?? 0,
      glass?.hh ?? 0,
    );
    gl.uniform2f(u("uGlassShape"), glass?.r ?? 0, glass ? 1 : 0);
    gl.uniform2f(u("uSize"), this.width, this.height);
  }

  /** Two state targets at the grid's size; whoever held the old ones lets them go. */
  private allocate() {
    const gl = this.gl;
    this.targets = [0, 1].map(() => {
      const texture = gl.createTexture();
      const framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) throw new Error("turing: no state target");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RG32F,
        this.gridW,
        this.gridH,
        0,
        gl.RG,
        gl.FLOAT,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );
      if (
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
      ) {
        throw new Error("turing: float state unavailable");
      }
      return { texture, framebuffer };
    });
    this.current = 0;
  }

  private program(fragment: string): Program {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("turing: no shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`turing: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram();
    if (!program) throw new Error("turing: no program");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, QUAD_VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`turing: ${gl.getProgramInfoLog(program)}`);
    }
    const cache = new Map<string, WebGLUniformLocation | null>();
    return {
      program,
      uniform: (name) => {
        if (!cache.has(name))
          cache.set(name, gl.getUniformLocation(program, name));
        return cache.get(name) ?? null;
      },
    };
  }
}
