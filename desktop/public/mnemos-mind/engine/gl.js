/* WebGL2 plumbing for the darkroom: programs, float render targets, a
 * fullscreen pass, and the little camera math the shots need. */

/* Light is added up in 32-bit floats where the GPU can blend and filter them, and in 16-bit ones where it can't (a
 * little less headroom where it's brightest, the same picture): `gl.accum` says which. It throws only when the GPU
 * can't draw into floats at all. */
export function context(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('no webgl2');
  return prepare(gl);
}

/* what a context needs before drawing: at first, and again when a lost one is given back (its extensions and
 * everything made on it went with it) */
export function prepare(gl) {
  const has = (e) => !!gl.getExtension(e);
  const floats = has('EXT_color_buffer_float');
  if (!floats && !has('EXT_color_buffer_half_float')) throw new Error('the GPU can’t draw into float targets');
  gl.accum = floats && has('EXT_float_blend') && has('OES_texture_float_linear') ? 'RGBA32F' : 'RGBA16F';
  gl.fullscreen = gl.createVertexArray();   // an empty VAO; the pass builds its triangle from gl_VertexID
  return gl;
}

export function program(gl, vs, fs) {
  const stage = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const listing = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)}  ${l}`).join('\n');
      throw new Error(`${gl.getShaderInfoLog(s)}\n${listing}`);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, stage(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, stage(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const { name } = gl.getActiveUniform(p, i);
    u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

const FORMATS = {
  RGBA32F: ['RGBA32F', 'RGBA', 'FLOAT'],
  RGBA16F: ['RGBA16F', 'RGBA', 'HALF_FLOAT'],
};

export function target(gl, w, h, format = 'RGBA16F') {
  const [internal, fmt, type] = FORMATS[format].map((k) => gl[k]);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete (${status})`);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export const FULLSCREEN_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function pass(gl, into) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fbo : null);
  gl.viewport(0, 0, into ? into.w : gl.drawingBufferWidth, into ? into.h : gl.drawingBufferHeight);
  gl.bindVertexArray(gl.fullscreen);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/* ---------- small math ---------- */

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => scale(a, 1 / (length(a) || 1));
export const mixv = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
/* 0 → 1 as x runs a → b, eased */
export const ramp = (x, a, b, ease = smoother) => ease((x - a) / (b - a));
/* interpolate in log space: for distances and scales, so motion reads as even */
export const logmix = (a, b, t) => Math.exp(mix(Math.log(a), Math.log(b), t));

export function lookAt(eye, at, up = [0, 1, 0]) {
  const z = normalize(sub(eye, at));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
}

/* a seeded generator, so every render of a frame is the same frame */
export function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.gauss = () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.dir = () => {                       // a uniform direction on the sphere
    const z = next() * 2 - 1, a = next() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), r * Math.sin(a), z];
  };
  return next;
}
