/* The lens kernel for the glyph atlas: a flat disc with a brighter rim, the "soap bubble" edge real cinema
 * glass gives out-of-focus lights, built as a sum of two discs so it can be convolved row by row, cheaply,
 * with anti-aliased edges. Pure arithmetic on arrays, so it runs the same on the page or in a worker. */

const RIM = 0.45, RIM_INNER = 0.8;

/* src convolved with the lens of radius R px: (1+RIM)·disc(R) − RIM·disc(RIM_INNER·R), normalised */
export function lens(src, N, R) {
  const a = disc(src, N, R), b = disc(src, N, RIM_INNER * R);
  const wa = discWeight(R), wb = discWeight(RIM_INNER * R);
  const norm = 1 / ((1 + RIM) * wa - RIM * wb);
  const out = new Float32Array(N * N);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, ((1 + RIM) * a[i] - RIM * b[i]) * norm);
  return out;
}

function discRows(R) {
  const rows = [];
  const Ri = Math.ceil(R);
  for (let dy = -Ri; dy <= Ri; dy++) {
    const wv = Math.min(1, Math.max(0, R + 0.5 - Math.abs(dy)));   // partial coverage of the outermost rows
    if (wv <= 0) continue;
    rows.push(dy, wv, Math.max(0.5, Math.sqrt(Math.max(0, R * R - dy * dy))));
  }
  return rows;
}

function discWeight(R) {
  const rows = discRows(R);
  let w = 0;
  for (let j = 0; j < rows.length; j += 3) w += rows[j + 1] * 2 * rows[j + 2];
  return w;
}

/* Unnormalised disc convolution: each output pixel sums a chord of every row
 * within R, read from that row's running sum with fractional ends. Rows with
 * no ink are skipped, which is most of them once the blur is wide. */
function disc(src, N, R) {
  const W = N + 1;
  const P = new Float64Array(W * N);
  const inked = new Uint8Array(N);
  for (let y = 0; y < N; y++) {
    let s = 0;
    for (let x = 0; x < N; x++) { const v = src[y * N + x]; s += v; P[y * W + x + 1] = s; }
    inked[y] = s > 0 ? 1 : 0;
  }
  const rows = discRows(R);
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let j = 0; j < rows.length; j += 3) {
      const yy = y + rows[j];
      if (yy < 0 || yy >= N || !inked[yy]) continue;
      const wv = rows[j + 1], hw = rows[j + 2];
      const base = yy * W, sbase = yy * N;
      for (let x = 0; x < N; x++) {
        // integral of row yy over [x + .5 - hw, x + .5 + hw]
        let u1 = x + 0.5 + hw, u0 = x + 0.5 - hw, f1, f0;
        if (u1 >= N) f1 = P[base + N]; else if (u1 <= 0) f1 = 0; else { const i = u1 | 0; f1 = P[base + i] + (u1 - i) * src[sbase + i]; }
        if (u0 >= N) f0 = P[base + N]; else if (u0 <= 0) f0 = 0; else { const i = u0 | 0; f0 = P[base + i] + (u0 - i) * src[sbase + i]; }
        out[y * N + x] += wv * (f1 - f0);
      }
    }
  }
  return out;
}
