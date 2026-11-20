/* The tissue: letters as light, like letters.js, but built for a mind that has to run live.
 *
 * letters.js takes every letter fresh from the CPU every frame, which is right for a film and too slow
 * for a million letters sixty times a second. Here the anatomy is uploaded once and stays on the GPU.
 * What changes (how lit each cell is, where the light is along each fibre) lives in a small state
 * texture, one texel per cell and one per link, and the vertex shader reads it:
 *
 *   per cell:         r glow (resting brightness, from accessibility)   g flash (light passing now)
 *                     b pulse (the one colour: a belief crossing)        a read (being read, nucleus up)
 *   per link:         r front (0..1 along the fibre, where the light is) g amount (how much)
 *                     b trail (what stays lit behind the front)          a rest (resting brightness)
 * The cells fill rows from the top, STATE_W to a row, and the links fill the rows after them (u_linkRow on), so
 * neither is capped by the width of one row.
 *
 * The lens is letters.js's lens, unchanged: every letter carries its own blur, energy conserved. One thing
 * is added so text on a path can be read: an offset from the letter's pen point to its ink centre, so a
 * line of letters sits on a baseline instead of every glyph being centred on its own ink. */

import { program } from './gl.js';

export const STRIDE = 25;
export const STATE_W = 4096;   // a row of the state texture; a mind with more cells or links than a row takes more rows
export const PARTS = { SKIN: 0, NUCLEUS: 1, DENDRITE: 2, FIBRE: 3, BOUTON: 4, SPINE: 5 };

const VS = `#version 300 es
precision highp float;
precision highp sampler2D;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in float a_size;
layout(location = 2) in float a_glyph;
layout(location = 3) in vec3 a_color;
layout(location = 4) in vec3 a_u;
layout(location = 5) in vec3 a_n;
layout(location = 6) in float a_angle;
layout(location = 7) in float a_squash;
layout(location = 8) in vec3 a_who;      // owner (cell or link), part, along
layout(location = 9) in vec2 a_off;      // pen point to ink centre, em
layout(location = 10) in float a_w;      // from this letter to the middle of its word, along the path
layout(location = 11) in vec3 a_face;    // a body's skin: outward from the cell (zero for everything else)
uniform mat4 u_view, u_proj;
uniform vec2 u_res, u_fade;
uniform float u_focalPx, u_focus, u_blurK, u_cocMax, u_minPx, u_near, u_gain, u_cull, u_back, u_pad;
uniform vec4 u_rest, u_lit;   // how bright each part rests and lights: membrane, nucleus, dendrite, fibre
uniform sampler2D u_state;
uniform int u_linkRow;
uniform vec3 u_fire, u_pulse;
out vec2 v_em;
out float v_r;
flat out int v_glyph;
out vec3 v_col;

vec2 onScreen(vec3 t, vec4 p, float d) { return vec2(t.x * d + p.x * t.z, t.y * d + p.y * t.z) / (d * d) * u_focalPx; }
float bump(float x, float w) { return exp(-(x / w) * (x / w)); }

void main() {
  int owner = int(a_who.x + 0.5), part = int(a_who.y + 0.5);
  float along = a_who.z;
  vec3 base = a_color;
  float gain = 0.0, lit = 0.0, pulse = 0.0;
  if (part == 3 || part == 4) {                       // a fibre or its bouton: the light travelling it
    vec4 s = texelFetch(u_state, ivec2(owner % ${STATE_W}, u_linkRow + owner / ${STATE_W}), 0);
    float wave = s.r < -0.5 ? 0.0 : bump(along - s.r, 0.07) * s.g;
    float behind = (s.r >= 0.0 && along < s.r) ? s.b : 0.0;
    lit = min(1.0, wave * 1.4 + behind);
    gain = (s.a * u_rest.w + (2.4 * wave + 0.9 * behind) * u_lit.w) * (part == 4 ? 1.6 : 1.0);
  } else {                                            // part of a cell
    vec4 s = texelFetch(u_state, ivec2(owner % ${STATE_W}, owner / ${STATE_W}), 0);
    // a dendrite thins into the tissue: bright at the body, fading toward its finest tips
    float k = part == 1 ? u_rest.y : part == 0 ? u_rest.x : u_rest.z * (1.0 - 0.75 * along);
    float thin = part == 1 ? 1.0 - 0.93 * s.a : part == 0 ? 1.0 - 0.9 * s.a : 1.0 - 0.7 * s.a;   // being read: look through it
    lit = min(1.0, s.g);
    pulse = s.b;
    // light passing through a cell fills its body, and runs out along its branches rather than to their tips
    float lightK = part == 1 ? u_lit.y : part == 0 ? u_lit.x : u_lit.z * (1.0 - 0.6 * along);
    gain = (s.r * k + s.g * lightK + s.b * 1.6) * thin;
  }
  if (gain < 1e-4) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }   // dark letters cost nothing
  vec3 col = mix(base, u_fire, 0.8 * lit);
  col = mix(col, u_pulse, clamp(pulse, 0.0, 1.0));

  vec3 pos = a_pos;
  if (a_w != 0.0 && dot(a_n, a_n) < 1e-12 && dot(a_u, a_u) > 1e-12) {
    // a path seen running right to left: swap each word end for end, so it still reads left to right
    vec4 p0 = u_view * vec4(a_pos, 1.0);
    if (onScreen(mat3(u_view) * a_u, p0, -p0.z).x < 0.0) pos += 2.0 * a_w * a_u;
  }
  vec4 vp = u_view * vec4(pos, 1.0);
  float d = -vp.z;
  if (d < u_near) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  // the far side of a body recedes, the way a membrane seen through is fainter than the face toward you:
  // light doesn't block light here, and without this both faces' words fall on each other in a jumble
  if (dot(a_face, a_face) > 0.5) gain *= mix(u_back, 1.0, smoothstep(-0.2, 0.3, dot(mat3(u_view) * a_face, normalize(-vp.xyz))));
  float emPx0 = a_size * u_focalPx / d;
  vec2 ex, ey;
  if (dot(a_n, a_n) > 1e-12) {
    ex = onScreen(mat3(u_view) * a_u, vp, d) * a_size;
    ey = onScreen(mat3(u_view) * cross(a_n, a_u), vp, d) * a_size;
  } else {
    float ang = a_angle;
    if (dot(a_u, a_u) > 1e-12) {
      vec2 sd = onScreen(mat3(u_view) * a_u, vp, d);
      if (sd.x < 0.0) sd = -sd;
      ang = atan(sd.y, sd.x);
    }
    vec2 dir = vec2(cos(ang), sin(ang));
    ex = dir * emPx0 * max(a_squash, 0.06);
    ey = vec2(-dir.y, dir.x) * emPx0;
  }
  float area = abs(ex.x * ey.y - ex.y * ey.x);
  float emPx = sqrt(max(area, 1e-10));
  gain *= u_gain * smoothstep(u_fade.x, u_fade.y, d);
  vec2 shift = ex * a_off.x + ey * a_off.y;          // set on its baseline, measured before any clamping
  if (emPx < u_minPx) { float k = u_minPx / emPx; ex *= k; ey *= k; area *= k * k; gain /= k * k; emPx = u_minPx; }
  float coc = min(u_blurK * abs(1.0 - u_focus / d), u_cocMax);
  float r = coc / emPx;
  // what a letter this soft actually adds to a pixel: its light spread over its disc. Past the point where
  // no one could see it, it costs a great deal (a big disc is a lot of pixels) and gives nothing: skip it.
  if (gain * 0.3 / (1.0 + 4.0 * r * r) < u_cull) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float h = 0.5 + r + u_pad / emPx;
  float lx = length(ex);
  vec2 dx = lx > 1e-6 ? ex / lx : vec2(1.0, 0.0);
  float hand = (ex.x * ey.y - ex.y * ey.x) < 0.0 ? -1.0 : 1.0;
  float kk = clamp(r * 1.5, 0.0, 1.0);
  vec2 ax = mix(ex, dx * emPx, kk), ay = mix(ey, vec2(-dx.y, dx.x) * emPx * hand, kk);
  gain *= area / max(abs(ax.x * ay.y - ax.y * ay.x), 1e-10);
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  vec2 em = corner * h;
  vec4 clip = u_proj * vp;
  clip.xy += (em.x * ax + em.y * ay + shift) * 2.0 / u_res * clip.w;
  gl_Position = clip;
  v_em = em;
  v_r = r;
  v_glyph = int(a_glyph + 0.5);
  v_col = col * gain;
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_atlas;
uniform float u_levels[16];
uniform int u_nLevels, u_nGlyphs;
in vec2 v_em;
in float v_r;
flat in int v_glyph;
in vec3 v_col;
out vec4 o;
float level(int k, vec2 em) {
  float h = 0.5 + u_levels[k];
  vec2 uv = vec2(em.x + h, h - em.y) / (2.0 * h);
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture(u_atlas, vec3(uv, float(k * u_nGlyphs + v_glyph))).r * inside;
}
void main() {
  float rMax = u_levels[u_nLevels - 1];
  float s = (0.5 + rMax) / (0.5 + max(v_r, rMax));
  float rc = min(v_r, rMax);
  int k = 0;
  for (int i = 1; i < 16; i++) { if (i >= u_nLevels - 1) break; if (u_levels[i] <= rc) k = i; }
  float t = clamp((rc - u_levels[k]) / (u_levels[k + 1] - u_levels[k]), 0.0, 1.0);
  vec2 em = v_em * s;
  float dens = mix(level(k, em), level(k + 1, em), t) * s * s;
  o = vec4(v_col * dens, 1.0);
}`;

// one program for every tissue on a context: compiling it is tens of milliseconds, and a tissue is made per redraw
// (made again when a lost context is given back, which takes its programs with it)
const programs = new WeakMap();
const programFor = (gl) => {
  const p = programs.get(gl);
  if (p && gl.isProgram(p.p)) return p;
  const made = program(gl, VS, FS);
  programs.set(gl, made);
  return made;
};
const SLICE = 3 * 1024 * 1024 / 4;       // floats sent to the GPU a frame when a tissue is sent without a pause

export class Tissue {
  /* A tissue sent to the GPU a slice at a time, a step per turn of the page, so a mind that's being moved never
   * stops for it: the drawing already on screen goes on being drawn until this one has all arrived. */
  static async load(gl, atlas, data, count, opts) {
    const t = new Tissue(gl, atlas, null, count, opts);
    gl.bindBuffer(gl.ARRAY_BUFFER, t.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.STATIC_DRAW);
    for (let at = 0; at < data.length; at += SLICE) {
      if (t.count === 0) return t;                                  // let go before it arrived
      gl.bindBuffer(gl.ARRAY_BUFFER, t.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, at * 4, data, at, Math.min(SLICE, data.length - at));
      // one slice a frame: sent faster, the driver's staging fills (about 16 MB in) and the page waits for the GPU
      await new Promise((r) => (document.hidden ? setTimeout(r, 0) : requestAnimationFrame(() => r())));
    }
    return t;
  }

  constructor(gl, atlas, data, count, { cells = STATE_W, links = STATE_W, blocks = null } = {}) {
    this.gl = gl;
    this.atlas = atlas;
    this.count = count;
    this.prog = programFor(gl);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    // one way in to the points for the whole, and one for where each block of space begins (see pack)
    const layout = [[0, 3, 0], [1, 1, 3], [2, 1, 4], [3, 3, 5], [4, 3, 8], [5, 3, 11], [6, 1, 14], [7, 1, 15], [8, 3, 16], [9, 2, 19], [10, 1, 21], [11, 3, 22]];
    const vaoFrom = (first) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      for (const [loc, size, offset] of layout) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, (first * STRIDE + offset) * 4);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
      return vao;
    };
    this.vao = vaoFrom(0);
    this.blocks = blocks && blocks.length ? blocks : null;
    // a way in where each block begins (VAOs are cheap; rebinding a dozen pointers for every draw isn't)
    this.vaos = this.blocks ? Array.from({ length: this.blocks.length / BLOCK }, (_, b) => (this.blocks[b * BLOCK] === 0 ? this.vao : vaoFrom(this.blocks[b * BLOCK]))) : null;
    this.drawn = count;
    this.levels = new Float32Array(16);
    this.levels.set(atlas.levels);
    this.linkRow = Math.max(1, Math.ceil(cells / STATE_W));
    this.rows = this.linkRow + Math.max(1, Math.ceil(links / STATE_W));
    this.state = new Float32Array(STATE_W * this.rows * 4);
    this.stateTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, STATE_W, this.rows, 0, gl.RGBA, gl.FLOAT, this.state);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  /* let the GPU have its memory back: a mind that grows builds a new tissue, and the old one must not linger */
  dispose() {
    const { gl } = this;
    gl.deleteBuffer(this.buf); gl.deleteTexture(this.stateTex);   // the program is shared
    for (const v of new Set([this.vao, ...(this.vaos || [])])) gl.deleteVertexArray(v);
    this.count = 0;
  }

  // written in place: thousands of calls a frame, so no small arrays for the collector to sweep up
  cell(i, glow, flash, pulse, read) { const s = this.state, k = i * 4; s[k] = glow; s[k + 1] = flash; s[k + 2] = pulse; s[k + 3] = read; }
  link(i, front, amount, trail, rest) { const s = this.state, k = (this.linkRow * STATE_W + i) * 4; s[k] = front; s[k + 1] = amount; s[k + 2] = trail; s[k + 3] = rest; }

  /* add one exposure of the tissue into `into`, as Letters.draw does */
  draw(into, { view, proj, focalPx, focus, blurK, cocMax = 300, minPx = 1.25, near = 0.05, fade = [0.06, 0.38], gain = 1, cull = 0, margin = 0.4, pad = 1.5,
    fire = [0.92, 0.95, 1.0], pulse = [0.45, 1.0, 0.92], rest = [1, 1, 0.6, 1], light = [2.2, 2.8, 1.3, 1], back = 0.1 }) {
    const { gl, prog: { p, u } } = this;
    // the whole state, a few hundred kilobytes, once a frame: every texel in it is a cell or a link
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STATE_W, this.rows, gl.RGBA, gl.FLOAT, this.state);
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fbo);
    gl.viewport(0, 0, into.w, into.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(p);
    gl.uniformMatrix4fv(u.u_view, false, view);
    gl.uniformMatrix4fv(u.u_proj, false, proj);
    gl.uniform2f(u.u_res, into.w, into.h);
    gl.uniform1f(u.u_focalPx, focalPx);
    gl.uniform1f(u.u_focus, focus);
    gl.uniform1f(u.u_blurK, blurK);
    gl.uniform1f(u.u_cocMax, cocMax);
    gl.uniform1f(u.u_minPx, minPx);
    gl.uniform1f(u.u_near, near);
    gl.uniform1f(u.u_gain, gain);
    gl.uniform1f(u.u_cull, cull);
    gl.uniform1f(u.u_back, back);
    gl.uniform1f(u.u_pad, pad);
    gl.uniform4fv(u.u_rest, rest);
    gl.uniform4fv(u.u_lit, light);
    gl.uniform2f(u.u_fade, fade[0], fade[1]);
    gl.uniform3fv(u.u_fire, fire);
    gl.uniform3fv(u.u_pulse, pulse);
    gl.uniform1fv(u.u_levels, this.levels);
    gl.uniform1i(u.u_nLevels, this.atlas.levels.length);
    gl.uniform1i(u.u_nGlyphs, this.atlas.glyphs.length);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.tex);
    gl.uniform1i(u.u_atlas, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
    gl.uniform1i(u.u_state, 1);
    gl.uniform1i(u.u_linkRow, this.linkRow);
    gl.activeTexture(gl.TEXTURE0);
    if (!this.blocks) {
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    } else {
      // only the blocks of space the camera can see (a little wider than the frame, so a soft point just outside
      // still bleeds in): up close, most of the mind is beside or behind you and costs nothing. Neighbouring blocks
      // that are both seen are drawn as one.
      const P = frustum(proj, view, 1.15), B = this.blocks, n = B.length / BLOCK;
      let runAt = -1, runCount = 0, runVao = null;
      this.drawn = 0;
      const flush = () => { if (runCount) { gl.bindVertexArray(runVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, runCount); this.drawn += runCount; } runCount = 0; runAt = -1; };
      for (let b = 0; b < n; b++) {
        const k = b * BLOCK, first = B[k], cnt = B[k + 1];
        if (!seen(P, B[k + 2], B[k + 3], B[k + 4], B[k + 5], B[k + 6], B[k + 7], margin)) { flush(); continue; }
        if (runCount && runAt + runCount === first) runCount += cnt;
        else { flush(); runAt = first; runCount = cnt; runVao = this.vaos[b]; }
      }
      flush();
    }
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}

/* the planes of what the camera sees (Gribb and Hartmann, from projection × view), its sides opened by `wide` */
function frustum(proj, view, wide) {
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += proj[k * 4 + r] * view[c * 4 + k];
    m[c * 4 + r] = v;
  }
  const row = (r) => [m[r], m[4 + r], m[8 + r], m[12 + r]], [x, y, z, w] = [row(0), row(1), row(2), row(3)];
  const plane = (a, s, f) => { const p = [w[0] * f + s * a[0], w[1] * f + s * a[1], w[2] * f + s * a[2], w[3] * f + s * a[3]]; const l = Math.hypot(p[0], p[1], p[2]) || 1; return p.map((v) => v / l); };
  return [plane(x, 1, wide), plane(x, -1, wide), plane(y, 1, wide), plane(y, -1, wide), plane(z, 1, 1)];
}
/* whether a box can be seen: no plane has it wholly behind (with `margin` to spare) */
function seen(P, x0, y0, z0, x1, y1, z1, margin) {
  for (const [a, b, c, d] of P) if (a * (a > 0 ? x1 : x0) + b * (b > 0 ? y1 : y0) + c * (c > 0 ? z1 : z0) + d < -margin) return false;
  return true;
}

/* pack anatomy letters into the static buffer: base colour and resting size baked in, owner/part/along
 * for the state lookup, and the pen-to-ink offset from the atlas metrics for letters set along a path.
 *
 * With `blocks`, the letters are laid in by where they are: space is cut into about that many cubes and each cube's
 * letters lie together, so a renderer can leave out the cubes the camera can't see. Each block is
 * [first, count, minX, minY, minZ, maxX, maxY, maxZ]; within a block the letters keep their order. */
export const BLOCK = 8;
export function pack(letters, glyphIndex, metrics, inkOf, { blocks = 0 } = {}) {
  const out = new Float32Array(letters.length * STRIDE);
  let n = 0, order = letters, B = null;
  if (blocks > 1 && letters.length) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const { p } of letters) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2]; }
    const side = Math.cbrt(((x1 - x0) * (y1 - y0) * (z1 - z0) || 1) / blocks) || 1;
    const gx = Math.max(1, Math.ceil((x1 - x0) / side)), gy = Math.max(1, Math.ceil((y1 - y0) / side)), gz = Math.max(1, Math.ceil((z1 - z0) / side));
    const G = gx * gy * gz, cell = (v, lo, g) => Math.min(g - 1, Math.max(0, Math.floor((v - lo) / side)));
    const key = new Uint32Array(letters.length), counts = new Uint32Array(G + 1);
    letters.forEach(({ p }, i) => { const k = cell(p[0], x0, gx) + gx * (cell(p[1], y0, gy) + gy * cell(p[2], z0, gz)); key[i] = k; counts[k + 1]++; });
    for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
    const at = counts.slice(0, -1), idx = new Uint32Array(letters.length);
    for (let i = 0; i < letters.length; i++) idx[at[key[i]]++] = i;
    order = { *[Symbol.iterator]() { for (let i = 0; i < idx.length; i++) yield letters[idx[i]]; } };
    B = Array.from({ length: G }, () => [0, 0, Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    B.key = key; B.idx = idx;
  }
  let j = 0;
  for (const l of order) {
    const slot = B ? B.key[B.idx[j++]] : -1;
    const g = glyphIndex(l.ch);
    if (g === undefined) continue;
    const k = n++ * STRIDE, ink = inkOf(l), u = l.u || [0, 0, 0], nn = l.n || [0, 0, 0];
    out[k] = l.p[0]; out[k + 1] = l.p[1]; out[k + 2] = l.p[2]; out[k + 3] = l.size; out[k + 4] = g;
    out[k + 5] = ink[0]; out[k + 6] = ink[1]; out[k + 7] = ink[2];
    out[k + 8] = u[0]; out[k + 9] = u[1]; out[k + 10] = u[2];
    out[k + 11] = nn[0]; out[k + 12] = nn[1]; out[k + 13] = nn[2];
    out[k + 14] = l.ang || 0; out[k + 15] = 1;
    out[k + 16] = l.link !== undefined && (l.part === 3 || l.part === 4) ? l.link : l.cell;
    out[k + 17] = l.part; out[k + 18] = l.along || 0;
    // along a path, a letter's anchor is its pen point: move the glyph so its ink sits where it belongs
    const m = metrics[g];
    if (l.u && m) { out[k + 19] = m.cx - m.advance / 2; out[k + 20] = m.cy - 0.32; } else { out[k + 19] = 0; out[k + 20] = 0; }
    out[k + 21] = l.w || 0;
    const f = l.face || [0, 0, 0];
    out[k + 22] = f[0]; out[k + 23] = f[1]; out[k + 24] = f[2];
    if (B) {
      const b = B[slot];
      if (!b[1]) b[0] = n - 1;
      b[1]++;
      const [px, py, pz] = l.p;
      if (px < b[2]) b[2] = px; if (py < b[3]) b[3] = py; if (pz < b[4]) b[4] = pz;
      if (px > b[5]) b[5] = px; if (py > b[6]) b[6] = py; if (pz > b[7]) b[7] = pz;
    }
  }
  return { data: out.subarray(0, n * STRIDE), count: n, blocks: B ? Float32Array.from(B.filter((x) => x[1] > 0).flat()) : null };
}
