/* The lab: what happens to the light after the letters have been exposed.
 * A wide, soft scatter (bloom) the way light scatters in glass and water, a
 * touch of lens colour fringing toward the edges, a vignette, a filmic
 * shoulder so bright cores roll off to white instead of clipping, and grain.
 * The picture sits on the house black, #060608, never on pure black. */

import { program, target, pass, FULLSCREEN_VS } from './gl.js';

const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_texel;
in vec2 v_uv;
out vec4 o;
vec3 at(vec2 d) { return texture(u_src, v_uv + d * u_texel).rgb; }
void main() {   // the 13-tap downsample: soft, and stable under motion
  vec3 e = at(vec2(0.0));
  vec3 abcd = at(vec2(-2.0, 2.0)) + at(vec2(2.0, 2.0)) + at(vec2(-2.0, -2.0)) + at(vec2(2.0, -2.0));
  vec3 cross = at(vec2(0.0, 2.0)) + at(vec2(-2.0, 0.0)) + at(vec2(2.0, 0.0)) + at(vec2(0.0, -2.0));
  vec3 inner = at(vec2(-1.0, 1.0)) + at(vec2(1.0, 1.0)) + at(vec2(-1.0, -1.0)) + at(vec2(1.0, -1.0));
  o = vec4(e * 0.125 + abcd * 0.03125 + cross * 0.0625 + inner * 0.125, 1.0);
}`;

const UP_FS = `#version 300 es
precision highp float;
uniform sampler2D u_cur, u_small;
uniform vec2 u_smallTexel;
uniform float u_w, u_smallOn;
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 s = vec3(0.0);
  if (u_smallOn > 0.5) {
    vec2 d = u_smallTexel;
    s += texture(u_small, v_uv + vec2(-d.x, d.y)).rgb + texture(u_small, v_uv + vec2(d.x, d.y)).rgb;
    s += texture(u_small, v_uv + vec2(-d.x, -d.y)).rgb + texture(u_small, v_uv + vec2(d.x, -d.y)).rgb;
    s += 2.0 * (texture(u_small, v_uv + vec2(0.0, d.y)).rgb + texture(u_small, v_uv + vec2(0.0, -d.y)).rgb);
    s += 2.0 * (texture(u_small, v_uv + vec2(-d.x, 0.0)).rgb + texture(u_small, v_uv + vec2(d.x, 0.0)).rgb);
    s += 4.0 * texture(u_small, v_uv).rgb;
    s /= 16.0;
  }
  o = vec4(texture(u_cur, v_uv).rgb * u_w + s, 1.0);
}`;

const FINAL_FS = `#version 300 es
precision highp float;
uniform sampler2D u_scene, u_bloom;
uniform vec2 u_res;
uniform float u_bloomMix, u_bloomNorm, u_exposure, u_grain, u_vignette, u_ca;
uniform uint u_seed;
uniform vec3 u_floor, u_grade;
in vec2 v_uv;
out vec4 o;
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float rand(uvec3 p) { return float(pcg(p.x + pcg(p.y + pcg(p.z)))) * (1.0 / 4294967295.0); }
vec3 filmic(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  float aspect = u_res.x / u_res.y;
  vec2 c = v_uv - 0.5;
  vec2 ca = c * u_ca * dot(c * vec2(aspect, 1.0), c * vec2(aspect, 1.0));
  vec3 sc = vec3(texture(u_scene, v_uv - ca).r, texture(u_scene, v_uv).g, texture(u_scene, v_uv + ca).b);
  vec3 bl = vec3(texture(u_bloom, v_uv - ca).r, texture(u_bloom, v_uv).g, texture(u_bloom, v_uv + ca).b) * u_bloomNorm;
  vec3 col = mix(sc, bl, u_bloomMix) * u_exposure * u_grade;
  float v = length(c * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);
  col *= 1.0 - u_vignette * smoothstep(0.25, 1.05, v);
  col = srgb(filmic(col));
  col = u_floor + (1.0 - u_floor) * col;
  uvec3 p = uvec3(uvec2(gl_FragCoord.xy), u_seed);
  float g = rand(p) + rand(p + uvec3(0u, 0u, 7919u)) - 1.0;         // triangular, -1..1
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += g * u_grain * (0.55 + 0.45 * smoothstep(0.02, 0.3, lum)) * (1.0 - smoothstep(0.7, 1.0, lum));
  o = vec4(col, 1.0);
}`;

export class Post {
  constructor(gl, W, H, levels = 7, { accum = 'RGBA32F' } = {}) {
    this.gl = gl;
    this.W = W; this.H = H;
    this.accum = target(gl, W, H, accum);
    this.down = [];
    let w = W, h = H;
    for (let i = 0; i < levels; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.down.push(target(gl, w, h));
    }
    this.up = this.down.map((t) => target(gl, t.w, t.h));
    this.downP = program(gl, FULLSCREEN_VS, DOWN_FS);
    this.upP = program(gl, FULLSCREEN_VS, UP_FS);
    this.finalP = program(gl, FULLSCREEN_VS, FINAL_FS);
  }

  /* give the GPU back its targets, when the frame changes size */
  dispose() {
    const { gl } = this;
    for (const t of [this.accum, ...this.down, ...this.up]) { gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex); }
    for (const p of [this.downP, this.upP, this.finalP]) gl.deleteProgram(p.p);   // a window resized many times made many
  }

  clear() {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accum.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  finish({ exposure = 1, bloom = 0.12, bloomShape = null, grain = 0.03, vignette = 0.35, ca = 0.006,
    floor = [6 / 255, 6 / 255, 8 / 255], grade = [1, 1, 1] }, seed = 0) {
    const { gl } = this;
    const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };

    gl.useProgram(this.downP.p);
    let src = this.accum;
    for (const t of this.down) {
      bind(0, src.tex);
      gl.uniform1i(this.downP.u.u_src, 0);
      gl.uniform2f(this.downP.u.u_texel, 1 / src.w, 1 / src.h);
      pass(gl, t);
      src = t;
    }

    const n = this.down.length;
    const weights = bloomShape || new Array(n).fill(1);
    gl.useProgram(this.upP.p);
    for (let i = n - 1; i >= 0; i--) {
      bind(0, this.down[i].tex);
      gl.uniform1i(this.upP.u.u_cur, 0);
      const small = i < n - 1 ? this.up[i + 1] : null;
      bind(1, small ? small.tex : this.down[i].tex);
      gl.uniform1i(this.upP.u.u_small, 1);
      gl.uniform2f(this.upP.u.u_smallTexel, small ? 1 / small.w : 0, small ? 1 / small.h : 0);
      gl.uniform1f(this.upP.u.u_smallOn, small ? 1 : 0);
      gl.uniform1f(this.upP.u.u_w, weights[i]);
      pass(gl, this.up[i]);
    }

    const f = this.finalP;
    gl.useProgram(f.p);
    bind(0, this.accum.tex); gl.uniform1i(f.u.u_scene, 0);
    bind(1, this.up[0].tex); gl.uniform1i(f.u.u_bloom, 1);
    gl.uniform2f(f.u.u_res, this.W, this.H);
    gl.uniform1f(f.u.u_bloomMix, bloom);
    gl.uniform1f(f.u.u_bloomNorm, 1 / weights.reduce((a, b) => a + b, 0));
    gl.uniform1f(f.u.u_exposure, exposure);
    gl.uniform1f(f.u.u_grain, grain);
    gl.uniform1f(f.u.u_vignette, vignette);
    gl.uniform1f(f.u.u_ca, ca);
    gl.uniform1ui(f.u.u_seed, seed >>> 0);
    gl.uniform3fv(f.u.u_floor, floor);
    gl.uniform3fv(f.u.u_grade, grade);
    pass(gl, null);
  }
}
