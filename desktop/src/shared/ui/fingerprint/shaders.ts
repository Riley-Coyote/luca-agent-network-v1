/**
 * The study's shaders (design-lab/agent-marks/fingerprint/template.html),
 * ported as they are. GROW is the study's simulation without its runtime
 * drift and pull: here it only ever grows a print once, from its stripes;
 * nothing regrows a print while its agent works (WP-39, Decided 5).
 */

export const VERT = `#version 300 es
in vec2 aPos; uniform float uSpan; out vec2 vP;
void main() { vP = aPos * uSpan; gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** Gray–Scott, diffusion faster along the ridge than across it, edges held. */
export const GROW = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uS; uniform sampler2D uT;
uniform int uN; uniform float uF, uK, uA, uB, uIso, uDt;
vec2 at(ivec2 c) { c = clamp(c, ivec2(0), ivec2(uN - 1)); return texelFetch(uS, c, 0).rg; }
vec2 bil(vec2 pos) { vec2 q = clamp(pos - 0.5, vec2(0.0), vec2(float(uN - 1))); vec2 f = fract(q); ivec2 i = ivec2(floor(q));
  return mix(mix(at(i), at(i + ivec2(1, 0)), f.x), mix(at(i + ivec2(0, 1)), at(i + ivec2(1, 1)), f.x), f.y); }
void main() {
  ivec2 ic = ivec2(gl_FragCoord.xy); vec2 pos = vec2(ic) + 0.5; vec2 s = at(ic);
  float ang = texelFetch(uT, ic, 0).r; vec2 t = vec2(cos(ang), sin(ang)); vec2 n = vec2(-t.y, t.x);
  vec2 lap = uA * (bil(pos + t) + bil(pos - t) - 2.0 * s) + uB * (bil(pos + n) + bil(pos - n) - 2.0 * s);
  vec2 l9 = (-s + 0.2 * (at(ic + ivec2(1, 0)) + at(ic - ivec2(1, 0)) + at(ic + ivec2(0, 1)) + at(ic - ivec2(0, 1)))
    + 0.05 * (at(ic + ivec2(1, 1)) + at(ic + ivec2(-1, 1)) + at(ic + ivec2(1, -1)) + at(ic + ivec2(-1, -1)))) * 4.0;
  lap += uIso * l9;
  float uvv = s.x * s.y * s.y;
  vec2 nx = s + uDt * vec2(0.2 * lap.x - uvv + uF * (1.0 - s.x), 0.1 * lap.y + uvv - (uF + uK) * s.y);
  o = vec4(clamp(nx, 0.0, 1.0), 0.0, 1.0);
}`;

/**
 * The print, drawn. Large: black lacquer lit from above, plus a soft ring of
 * light so a ridge reads whichever way it runs, and a hairline rim brightest
 * on top. Rail (uPaper): the print pressed in ink, its ridges in the face's
 * own colour, wet enough to catch a little light.
 */
export const PRINT = `#version 300 es
precision highp float;
in vec2 vP; out vec4 o;
uniform sampler2D uS; uniform int uN; uniform float uPx, uLevel, uRipR, uRipA, uOval, uPaper, uBreath;
uniform vec2 uCore; uniform vec3 uWave;   // amplitude (texels), wavenumber, phase
uniform vec2 uLight; uniform vec3 uHi, uBody, uInk;
float h(vec2 pos) {
  vec2 q = clamp(pos - 0.5, vec2(0.0), vec2(float(uN) - 1.001)); vec2 f = fract(q); ivec2 i = ivec2(floor(q)); ivec2 m = ivec2(uN - 1);
  float a = texelFetch(uS, min(i, m), 0).g, b = texelFetch(uS, min(i + ivec2(1, 0), m), 0).g;
  float c = texelFetch(uS, min(i + ivec2(0, 1), m), 0).g, d = texelFetch(uS, min(i + ivec2(1, 1), m), 0).g;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float hd(vec2 pos) { vec2 away = pos - uCore; float l = length(away) + 1e-3; return h(pos - away / l * uWave.x * sin(uWave.y * l - uWave.z)); }
void main() {
  vec2 p = vP; float r = length(vec2(p.x / uOval, p.y)); float edge = 1.0 / uPx;
  if (r > 1.0 + 2.0 * edge) { o = vec4(0.0); return; }
  vec3 L = normalize(vec3(uLight * 0.8, 0.6)); vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float stp = max(1.0, float(uN) / (2.0 * uPx));
  float lit = 0.0, ink = 0.0, shine = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 q = p + (vec2(float(i), float(j)) - 0.5) * 0.5 * edge;
    vec2 pos = (q * 0.5 + 0.5) * float(uN);
    float hv = hd(pos);
    float hx = hd(pos + vec2(stp, 0.0)) - hd(pos - vec2(stp, 0.0));
    float hy = hd(pos + vec2(0.0, stp)) - hd(pos - vec2(0.0, stp));
    float relief = 6.0 * (1.0 + 0.1 * uBreath);
    vec3 nn = normalize(vec3(-hx * relief / stp, -hy * relief / stp, 1.0));
    float key = pow(max(dot(nn, H), 0.0), 26.0);
    float ring = pow(clamp(1.0 - nn.z, 0.0, 1.0), 1.15);
    float rip = exp(-pow((length(vec2(q.x / uOval, q.y)) - uRipR) / 0.07, 2.0));
    lit += key * 0.85 * (1.0 + 1.8 * uRipA * rip) + ring * 0.5 + 0.04 * hv;
    ink += smoothstep(0.13 + 0.022 * uBreath, 0.27 + 0.022 * uBreath, hv); shine += key;
  }
  lit *= 0.25; ink *= 0.25; shine *= 0.25;
  float fade = 1.0 - smoothstep(0.78, 1.0, r);   // a pressed print fades at its edge
  float disc = 1.0 - smoothstep(1.0 - edge, 1.0 + 0.5 * edge, r);
  vec2 dir = normalize(vec2(p.x / uOval, p.y) + 1e-5); float face = dot(dir, uLight);
  float rimD = abs(r - (1.0 - 0.7 * edge)) * uPx;
  float rim = (1.0 - smoothstep(0.35, 1.3, rimD)) * (0.08 + 0.55 * pow(max(face, 0.0), 1.8));
  if (uPaper > 0.5) {
    float a = clamp(ink * mix(0.55, 1.0, fade) * uLevel, 0.0, 1.0) * disc;
    vec3 c = clamp(uInk * (0.78 + 0.5 * shine), 0.0, 1.0);
    o = vec4(c * a, a); return;
  }
  vec3 body = uBody + vec3(0.022) * smoothstep(-1.0, 1.0, p.y);
  float I = clamp(lit * mix(0.35, 1.0, fade) * uLevel + rim, 0.0, 1.0);
  float a = max(disc, rim);
  o = vec4(mix(body, uHi, I) * a, a);
}`;
