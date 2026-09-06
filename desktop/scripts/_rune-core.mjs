// The rune generator, shared verbatim by the stress test and the lab page.
export function seeded(input) {
  const str = String(input); let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const MOVES = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
/**
 * One self-avoiding stroke on a 5x5 lattice, diagonals allowed, no hairpins.
 * opts.mirrorP: share of marks drawn as a mirrored pair.
 * opts.fixed: true = the lattice itself fills the box (translation only, and
 * the walk must span >= 3 cells both ways); false = the walk's own bounding
 * box is scaled to fill (bigger marks, but scale is erased, so a 2-cell and a
 * 4-cell diagonal collapse to one shape).
 */
export function runeWalk(seed, opts = {}) {
  const mirrorP = opts.mirrorP ?? .35, fixed = opts.fixed ?? true, M = opts.M ?? 5;
  const lenMin = opts.lenMin ?? 4, lenMax = opts.lenMax ?? 6, doubles = opts.doubles ?? false, dotP = opts.dotP ?? 0;
  const rnd = seeded("rune:" + seed); const mirror = rnd() < mirrorP;
  const minSpan = fixed ? 3 : 2;
  let walk = null;
  for (let attempt = 0; attempt < 600 && !walk; attempt++) {
    const w = [[Math.floor(rnd()*M), Math.floor(rnd()*M)]]; const used = new Set([w[0].join()]);
    const len = lenMin + Math.floor(rnd()*(lenMax - lenMin + 1)); let ok = true; let last = null;
    for (let i = 0; i < len; i++) {
      const [x, y] = w[w.length-1];
      const cands = [];
      for (const [dx, dy] of MOVES) {
        if (last && dx === -last[0] && dy === -last[1]) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= M || ny >= M || used.has(nx + "," + ny)) continue;
        cands.push([dx, dy, 1]);
        // a double-length straight move: the cell passed through must be free too
        if (doubles && (dx === 0 || dy === 0)) { const mx = x + 2*dx, my = y + 2*dy; if (mx >= 0 && my >= 0 && mx < M && my < M && !used.has(mx + "," + my)) cands.push([dx, dy, 2]); }
      }
      if (!cands.length) { ok = false; break; }
      const [dx, dy, k] = cands[Math.floor(rnd()*cands.length)]; last = [dx, dy];
      for (let s = 1; s <= k; s++) used.add((x + dx*s) + "," + (y + dy*s));
      w.push([x + dx*k, y + dy*k]);
    }
    if (!ok) continue;
    const xs = w.map(p=>p[0]), ys = w.map(p=>p[1]);
    if (Math.max(...xs)-Math.min(...xs) < minSpan-1 || Math.max(...ys)-Math.min(...ys) < minSpan-1) continue;
    walk = w;
  }
  if (!walk) walk = [[0,0],[1,1],[2,2],[3,3],[4,4]];
  // an optional detached dot, in a free cell at least one cell clear of the stroke
  let dot = null;
  if (dotP > 0 && rnd() < dotP) {
    const occupied = new Set(); for (let i = 0; i < walk.length - 1; i++) { const [x0,y0] = walk[i], [x1,y1] = walk[i+1]; const k = Math.max(Math.abs(x1-x0), Math.abs(y1-y0)); for (let s = 0; s <= k; s++) occupied.add((x0 + Math.sign(x1-x0)*s) + "," + (y0 + Math.sign(y1-y0)*s)); }
    const free = []; for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) { let clear = true; for (let dy=-1; dy<=1 && clear; dy++) for (let dx=-1; dx<=1; dx++) if (occupied.has((x+dx)+","+(y+dy))) { clear = false; break; } if (clear) free.push([x,y]); }
    if (free.length) dot = free[Math.floor(rnd()*free.length)];
  }
  const all = dot ? [...walk, dot] : walk;
  const xs = all.map(p=>p[0]), ys = all.map(p=>p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const pad = 14; let map;
  if (fixed) {
    // `fill`: a walk that spans fewer than 4 cells is scaled up so its larger
    // span fills the box — a column of residents then scans at one weight.
    const span = Math.max(maxx - minx, maxy - miny) || 1;
    const grow = opts.fill && span < M - 1 ? (M - 1) / span : 1;
    const cell = ((100 - pad*2) / (M - 1)) * grow;
    const ox = ((M - 1) / grow - (maxx - minx)) / 2 - minx, oy = ((M - 1) / grow - (maxy - miny)) / 2 - miny;
    map = ([x,y]) => [pad + (x + ox) * cell, pad + (y + oy) * cell];
  }
  else { const span = Math.max(maxx-minx, maxy-miny) || 1; const scale = (100 - pad*2) / span; const ox = (100 - (maxx-minx)*scale)/2, oy = (100 - (maxy-miny)*scale)/2; map = ([x,y]) => [ox + (x-minx)*scale, oy + (y-miny)*scale]; }
  return { P: walk.map(map), dot: dot ? map(dot) : null, mirror, walk };
}
