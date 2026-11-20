/* The glyph atlas: every letter set once per blur level, so a letter can be
 * drawn anywhere from knife-sharp to a soft disc of light.
 *
 * Level k holds the glyph convolved with a lens disc of radius LEVELS[k] em,
 * centred on its ink, in a square cell spanning (1 + 2r) em. Values are light
 * per unit area with the ink itself at 1, and the lens kernel is normalised,
 * so every level carries the same total light: a letter going out of focus
 * spreads its light out instead of losing it. That is what makes the bokeh
 * read as optics rather than as a blur filter. */

export const LEVELS = [0, 0.03, 0.07, 0.12, 0.19, 0.28, 0.4, 0.56, 0.78, 1.08, 1.5, 2.1, 3.0];

/* a block cursor, drawn rather than set: fonts disagree about it */
export const CURSOR = '\u2588';
/* shapes of light rather than letters, drawn too: a soft round point (a membrane is many of them), and a
 * stroke, a thin bar the width of its cell with soft ends, so strokes laid end to end along a path overlap
 * into one smooth strand */
export const DOT = '\u25CF';
export const STROKE = '\u2501';
/* a line: the stroke at half its thickness for its length, so a strand of a given thickness takes half as many of
 * them, laid with the same overlap, and stays as smooth (added for the Mnemos companion, which draws whole minds) */
export const LINE = '\u2500';

import { lens } from './lens.js';

/* `type` is one alphabet in one face, { glyphs, font }, or several, { sets: [{ name, glyphs, font }] }.
 * A glyph's index is its place in that order; `index` maps 'A' (or 'serif:A' with sets) to it.
 * `metrics[i]` says how to set glyph i in a line, in em: its advance, and where its ink's centre sits
 * from the pen, cx along the line and cy above the baseline. */
export async function glyphAtlas(gl, type, { cell = 256, levels = LEVELS, keepData = false } = {}) {
  const sets = type.sets || [{ name: '', glyphs: type.glyphs, font: type.font }];
  const entries = sets.flatMap((s) => [...s.glyphs].map((ch) => ({ ch, font: s.font, key: s.name ? `${s.name}:${ch}` : ch })));
  await Promise.all(sets.map((s) => document.fonts.load(s.font(64))));
  const nG = entries.length, nL = levels.length;
  const data = new Float32Array(cell * cell * nG * nL);
  const canvas = new OffscreenCanvas(cell, cell);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const metrics = new Array(nG);
  const jobs = [];                       // every letter at every blur level wider than half a pixel

  for (let k = 0; k < nL; k++) {
    const r = levels[k];
    const pxPerEm = cell / (1 + 2 * r);
    for (let g = 0; g < nG; g++) {
      const { ch, font } = entries[g];
      ctx.clearRect(0, 0, cell, cell);
      ctx.font = font(pxPerEm);
      ctx.fillStyle = '#fff';
      let m;
      if (ch === DOT || ch === STROKE || ch === LINE) {
        drawLight(ctx, ch, cell, pxPerEm);
        // set on its centre: no pen-to-ink offset along a path, no baseline shift
        m = { width: pxPerEm, actualBoundingBoxLeft: 0, actualBoundingBoxRight: pxPerEm,
          actualBoundingBoxAscent: 0.32 * pxPerEm * 2, actualBoundingBoxDescent: 0 };
      } else if (ch === CURSOR) {
        const w = 0.56 * pxPerEm, h = 0.76 * pxPerEm;
        ctx.fillRect(cell / 2 - w / 2, cell / 2 - h / 2, w, h);
        m = { width: 0.6 * pxPerEm, actualBoundingBoxLeft: -0.02 * pxPerEm, actualBoundingBoxRight: 0.58 * pxPerEm,
          actualBoundingBoxAscent: 0.74 * pxPerEm, actualBoundingBoxDescent: -0.02 * pxPerEm };
      } else {
        m = ctx.measureText(ch);
        // put the ink's centre on the cell's centre
        const ox = cell / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
        const oy = cell / 2 - (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
        ctx.fillText(ch, ox, oy);
      }
      if (k === 0) {
        metrics[g] = { advance: m.width / pxPerEm, cx: (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 / pxPerEm,
          cy: (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 / pxPerEm };
      }
      const px = ctx.getImageData(0, 0, cell, cell).data;
      const at = (k * nG + g) * cell * cell, R = r * pxPerEm;
      for (let i = 0; i < cell * cell; i++) data[at + i] = px[i * 4 + 3] / 255;
      if (R >= 0.5) jobs.push({ at, R });
    }
  }
  await blurAll(data, jobs, cell);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R16F, cell, cell, nG * nL, 0, gl.RED, gl.FLOAT, data);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return { tex, levels, metrics, glyphs: entries.map((e) => e.key), index: Object.fromEntries(entries.map((e, i) => [e.key, i])), cell,
    ...(keepData ? { data } : {}) };
}

/* a point or a stroke of light, 1 em across, centred in its cell: soft-edged, so neighbours blend */
function drawLight(ctx, ch, cell, pxPerEm) {
  const c = cell / 2, img = ctx.getImageData(0, 0, cell, cell), px = img.data;
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const u = (x + 0.5 - c) / pxPerEm, v = (y + 0.5 - c) / pxPerEm;   // em from the centre
      let a;
      if (ch === DOT) {
        const r = Math.hypot(u, v);
        a = r >= 0.5 ? 0 : Math.exp(-((r / 0.26) ** 2)) * (1 - (r / 0.5) ** 8);
      } else {
        const thin = ch === LINE ? 0.5 : 1;   // a line's ends soften over the same length of strand, so half as far
        const along = Math.abs(u), ends = along >= 0.5 ? 0 : Math.min(1, (0.5 - along) / (0.16 * thin));
        a = ends * ends * (3 - 2 * ends) * Math.exp(-((v / (0.07 * thin)) ** 2));
      }
      px[(y * cell + x) * 4 + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/* Each letter through the lens, in place. Most of the time it takes to open a page goes here, and every
 * letter is independent of the others, so the work is shared out among workers, the widest blurs first
 * (they cost the most), and each result is written back where the letter was. Same arithmetic, same light;
 * where workers can't be made, the page does it itself. */
async function blurAll(data, jobs, N) {
  const n = Math.min(jobs.length, Math.max(1, (navigator.hardwareConcurrency || 4) - 1), 12);
  let pool = [];
  try { for (let i = 0; i < n; i++) pool.push(new Worker(new URL('./lens.worker.js', import.meta.url), { type: 'module' })); }
  catch { pool.forEach((w) => w.terminate()); pool = []; }
  if (!pool.length) { for (const j of jobs) data.set(lens(data.slice(j.at, j.at + N * N), N, j.R), j.at); return; }
  const queue = jobs.slice().sort((a, b) => b.R - a.R);
  await new Promise((resolve, reject) => {
    let next = 0, done = 0;
    const feed = (w) => {
      if (next >= queue.length) return;
      const id = next++, j = queue[id], ink = data.slice(j.at, j.at + N * N);
      w.postMessage({ id, ink, N, R: j.R }, [ink.buffer]);
    };
    for (const w of pool) {
      w.onmessage = ({ data: { id, out } }) => {
        data.set(out, queue[id].at);
        if (++done === queue.length) resolve(); else feed(w);
      };
      w.onerror = (e) => reject(e);
      feed(w);
    }
  });
  pool.forEach((w) => w.terminate());
}

