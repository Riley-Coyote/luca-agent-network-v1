/* The calm field — the front door's hero canvas.
 *
 * A fine, slow, greyscale particle cloud in the register of the signed-out
 * polyphonic.chat page: uniform points drifting on a divergence-free curl flow,
 * each held loosely to a home so the cloud never thins or wraps, the cursor
 * parting them softly and letting them back over seconds.
 *
 * The dendrite from the first mock survives only as structure. A
 * diffusion-limited-aggregation skeleton grows invisibly on a 3 px lattice over
 * about ninety seconds and never resets; particles that drift close to a grown
 * cell ease onto it and settle a little brighter. Nothing is ever drawn per
 * lattice cell, so the cloud slowly organises into a dendrite without a single
 * lit square. Greyscale only, no sparkle, no re-lights, no colour.
 */
(() => {
  const canvas = document.querySelector('.home-field');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const narrow = () => matchMedia('(max-width: 760px)').matches;

  // ── Look ──────────────────────────────────────────────────────────────────
  const AREA_PER_PARTICLE = 600;      // CSS px² per particle, wide screens
  const AREA_PER_PARTICLE_NARROW = 900;
  const ALPHA_MIN = 0.06, ALPHA_MAX = 0.30;
  const CORE_MIN = 1.0, CORE_MAX = 1.6;  // core diameter, CSS px
  const HALO_SCALE = 2.2;             // the second, larger, fainter point
  const HALO_ALPHA = 0.16;

  // ── Motion ────────────────────────────────────────────────────────────────
  const FLOW = 15;                    // curl amplitude, CSS px/s (|curl| ≤ 1.55)
  const HOME_RATE = 0.30;             // spring back to home, per second
  const K1X = 0.0036, K1Y = 0.0029, K2X = 0.0078, K2Y = 0.0066;
  const TA = 0.00022, TB = 0.00035;   // the flow itself morphs, slowly
  const REPEL_R = 150, REPEL_STRENGTH = 105, REPEL_DECAY = 1.2; // seconds

  // ── Time ──────────────────────────────────────────────────────────────────
  const ARRIVE_MS = 3000;             // dim at first paint, resting level by 3 s
  const ARRIVE_FLOOR = 0.34;
  const GROW_TAU_MS = 19000;          // ≥99 % of the bound by 90 s
  const BREATH_MS = 7000, BREATH_AMP = 0.10, BREATH_RAMP_MS = 4000;
  const CAPTURE_TAU_MS = 850;         // ~2.5 s onto the cell
  const CAPTURE_NEAR = 4;             // CSS px
  const CAPTURE_ALPHA_CAP = 0.42;
  const CAPTURE_ALPHA_MIN = 0.26;     // settled points read as structure, not dust
  const CELL = 3;                     // skeleton lattice, CSS px

  // ── Deterministic per-particle randomness ────────────────────────────────
  const hash = (i, salt) => {
    const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };

  let dpr = 1, W = 0, H = 0, PW = 0, PH = 0;
  let N = 0;
  let HX, HY, PX, PY, VX, VY, A0, SPR, CAP, CTX_, CTY_;
  let sprites = [];
  let skeleton = null;
  let t0 = 0, lastT = 0, raf = 0;
  let paused = false, hidden = false, staticDraw = false;
  let cursorX = 0, cursorY = 0, cursorOn = false;
  let maxSpeed = 0;
  const frameMs = [];

  // A point: one solid core disc plus one larger, fainter disc behind it,
  // pre-composited at device resolution so a frame is 2 000 drawImage calls
  // rather than 4 000 paths.
  function makeSprite(coreCss) {
    const halo = coreCss * HALO_SCALE;
    const size = Math.max(3, Math.ceil(halo * dpr) + 2);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const m = size / 2;
    g.fillStyle = `rgba(255,255,255,${HALO_ALPHA})`;
    g.beginPath(); g.arc(m, m, (halo * dpr) / 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(m, m, (coreCss * dpr) / 2, 0, Math.PI * 2); g.fill();
    return { c, m };
  }

  const SPRITE_STEPS = 4;
  function buildSprites() {
    sprites = [];
    for (let s = 0; s < SPRITE_STEPS; s++) {
      const core = CORE_MIN + (CORE_MAX - CORE_MIN) * (s / (SPRITE_STEPS - 1));
      sprites.push(makeSprite(core));
    }
  }

  // ── The invisible skeleton ────────────────────────────────────────────────
  function makeSkeleton() {
    const gw = Math.max(8, Math.ceil(W / CELL));
    const gh = Math.max(8, Math.ceil(H / CELL));
    const sx = narrow() ? 0.50 : 0.70, sy = narrow() ? 0.42 : 0.46;
    const cx = Math.round((gw - 1) * sx), cy = Math.round((gh - 1) * sy);
    const stuck = new Uint8Array(gw * gh);
    const list = [cy * gw + cx];
    stuck[list[0]] = 1;
    const bound = Math.max(8, Math.min(cx, gw - 1 - cx, cy, gh - 1 - cy) * 0.97);
    const walkers = [];
    const n = Math.max(24, Math.round(Math.min(gw, gh) * 0.6));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      walkers.push({ x: cx + Math.cos(a) * 3, y: cy + Math.sin(a) * 3 });
    }
    return { gw, gh, cx, cy, stuck, list, walkers, bound, radius: 1, done: false, doneAt: 0 };
  }

  function growSkeleton(t, elapsed) {
    const s = skeleton;
    if (!s || s.done) return;
    const { gw, gh, cx, cy, bound, stuck } = s;
    const target = bound * (1 - Math.exp(-elapsed / GROW_TAU_MS));
    if (s.radius >= target) return;
    const release = (w) => {
      const a = Math.random() * Math.PI * 2, r = Math.min(bound, s.radius + 2.5);
      w.x = cx + Math.cos(a) * r; w.y = cy + Math.sin(a) * r;
    };
    let budget = 2600;                        // walker steps this frame, capped
    while (s.radius < target && budget > 0) {
      for (let wi = 0; wi < s.walkers.length && budget > 0; wi++) {
        const w = s.walkers[wi];
        const d = Math.random() * 4 | 0;
        if (d === 0) w.x += 1; else if (d === 1) w.x -= 1;
        else if (d === 2) w.y += 1; else w.y -= 1;
        budget--;
        const rdx0 = w.x - cx, rdy0 = w.y - cy;
        const rr = Math.sqrt(rdx0 * rdx0 + rdy0 * rdy0);
        if (rr > bound + 4) { release(w); continue; }
        const ix = Math.round(w.x), iy = Math.round(w.y);
        if (ix < 1 || iy < 1 || ix >= gw - 1 || iy >= gh - 1) { release(w); continue; }
        const i = iy * gw + ix;
        if (stuck[i - 1] || stuck[i + 1] || stuck[i - gw] || stuck[i + gw]) {
          if (!stuck[i]) { stuck[i] = 1; s.list.push(i); }
          if (rr > s.radius) s.radius = rr;
          release(w);
        }
      }
    }
    if (s.radius >= bound - 1) { s.done = true; s.doneAt = t; }
  }

  // ── Particles ─────────────────────────────────────────────────────────────
  function seedParticles() {
    const per = W >= 761 ? AREA_PER_PARTICLE : AREA_PER_PARTICLE_NARROW;
    N = Math.max(120, Math.round((W * H) / per));
    HX = new Float32Array(N); HY = new Float32Array(N);
    PX = new Float32Array(N); PY = new Float32Array(N);
    VX = new Float32Array(N); VY = new Float32Array(N);
    A0 = new Float32Array(N); SPR = new Uint8Array(N);
    CAP = new Float32Array(N); CTX_ = new Float32Array(N); CTY_ = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      HX[i] = hash(i, 1.7); HY[i] = hash(i, 3.1);          // normalised homes
      PX[i] = HX[i] * W; PY[i] = HY[i] * H;
      const layer = hash(i, 5.9);
      A0[i] = ALPHA_MIN + layer * layer * (ALPHA_MAX - ALPHA_MIN);
      SPR[i] = Math.min(SPRITE_STEPS - 1, (hash(i, 8.3) * SPRITE_STEPS) | 0);
    }
  }

  function reproject(oldW, oldH) {
    if (!N) return;
    const kx = oldW ? W / oldW : 1, ky = oldH ? H / oldH : 1;
    for (let i = 0; i < N; i++) { PX[i] *= kx; PY[i] *= ky; CTX_[i] *= kx; CTY_[i] *= ky; }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (w === W && h === H && d === dpr) return;
    const oldW = W, oldH = H, oldN = N, oldD = dpr;
    W = w; H = h; dpr = d;
    PW = Math.round(W * dpr); PH = Math.round(H * dpr);
    canvas.width = PW; canvas.height = PH;
    if (d !== oldD || !sprites.length) buildSprites();
    const per = W >= 761 ? AREA_PER_PARTICLE : AREA_PER_PARTICLE_NARROW;
    const want = Math.max(120, Math.round((W * H) / per));
    // Keep the cloud we already have unless the count is meaningfully wrong;
    // re-seeding on every drag frame would read as a jump.
    if (!oldN || Math.abs(want - oldN) / oldN > 0.25) seedParticles();
    else reproject(oldW, oldH);
    skeleton = makeSkeleton();
    if (!isRunning()) draw(lastT || 0);
  }

  // ── Step ──────────────────────────────────────────────────────────────────
  function step(t, dt) {
    const elapsed = t - t0;
    growSkeleton(t, elapsed);
    const s = skeleton;
    const gw = s.gw, gh = s.gh, stuck = s.stuck;
    const tA = t * TA, tB = t * TB;
    const spring = 1 - Math.exp(-HOME_RATE * dt);
    const decay = Math.exp(-dt / REPEL_DECAY);
    const repel = cursorOn && !narrowPointer ? REPEL_STRENGTH : 0;
    const capEase = 1 - Math.exp(-(dt * 1000) / CAPTURE_TAU_MS);
    let peak = 0;

    for (let i = 0; i < N; i++) {
      const cap = CAP[i];
      if (cap > 0) {
        // Captured: ease onto the cell and stay there. No flow, no jitter.
        CAP[i] = cap + (1 - cap) * capEase;
        const k = CAP[i];
        PX[i] += (CTX_[i] - PX[i]) * capEase;
        PY[i] += (CTY_[i] - PY[i]) * capEase;
        if (k > 0.999) CAP[i] = 1;
        continue;
      }

      let x = PX[i], y = PY[i];
      const x0 = x, y0 = y;

      // Divergence-free curl flow — neighbours move together, like a fluid.
      const f1x = x * K1X, f1y = y * K1Y, f2x = x * K2X, f2y = y * K2Y;
      const flowX = Math.cos(f1x + tA) * Math.sin(f1y + tA * 0.7)
        + 0.55 * Math.sin(f2x + tB) * Math.cos(f2y + tB * 0.6);
      const flowY = -Math.sin(f1x + tA) * Math.cos(f1y + tA * 0.7)
        - 0.55 * Math.cos(f2x + tB) * Math.sin(f2y + tB * 0.6);
      x += flowX * FLOW * dt;
      y += flowY * FLOW * dt;

      // A long tether home: the excursion stays bounded, so the cloud keeps
      // its density and nothing ever has to wrap.
      x += (HX[i] * W - x) * spring;
      y += (HY[i] * H - y) * spring;

      // The cursor parts them; the tether walks them back over seconds.
      if (repel) {
        const rdx = x - cursorX, rdy = y - cursorY;
        const rd2 = rdx * rdx + rdy * rdy;
        if (rd2 < REPEL_R * REPEL_R && rd2 > 1) {
          const rd = Math.sqrt(rd2);
          let f = 1 - rd / REPEL_R;
          f = f * f * (3 - 2 * f);
          VX[i] += (rdx / rd) * repel * f * dt;
          VY[i] += (rdy / rd) * repel * f * dt;
        }
      }
      VX[i] *= decay; VY[i] *= decay;
      x += VX[i] * dt; y += VY[i] * dt;

      PX[i] = x; PY[i] = y;

      const sdx = x - x0, sdy = y - y0;
      const sp = Math.sqrt(sdx * sdx + sdy * sdy) / (dt || 1 / 60);
      if (sp > peak) peak = sp;

      // Capture: within a few pixels of a grown cell, ease onto it.
      const gx = (x / CELL) | 0, gy = (y / CELL) | 0;
      if (gx > 0 && gy > 0 && gx < gw - 1 && gy < gh - 1) {
        let best = -1, bd = CAPTURE_NEAR * CAPTURE_NEAR;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const gi = (gy + oy) * gw + (gx + ox);
          if (!stuck[gi]) continue;
          const cxp = ((gx + ox) + 0.5) * CELL, cyp = ((gy + oy) + 0.5) * CELL;
          const d2 = (x - cxp) * (x - cxp) + (y - cyp) * (y - cyp);
          if (d2 < bd) { bd = d2; best = gi; CTX_[i] = cxp; CTY_[i] = cyp; }
        }
        if (best >= 0) CAP[i] = 0.0001;
      }
    }
    if (peak > maxSpeed) maxSpeed = peak;
  }

  // ── Draw ──────────────────────────────────────────────────────────────────
  function draw(t) {
    const elapsed = Math.max(0, t - t0);
    // Arrival: present but dim at first paint, resting level by three seconds.
    const p = Math.min(1, elapsed / ARRIVE_MS);
    const arrive = staticDraw ? 1 : ARRIVE_FLOOR + (1 - ARRIVE_FLOOR) * (0.5 - 0.5 * Math.cos(Math.PI * p));
    // Once the skeleton has finished, the whole thing breathes, gently.
    // The breath only starts once the skeleton has settled. Its phase is
    // anchored to that moment and its amplitude eases in over four seconds, so
    // the field's brightness is continuous — nothing steps.
    let breath = 1;
    if (!staticDraw && skeleton && skeleton.done) {
      const since = t - skeleton.doneAt;
      const ramp = Math.min(1, Math.max(0, since / BREATH_RAMP_MS));
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * ramp);
      breath = 1 + Math.sin((since / BREATH_MS) * Math.PI * 2) * BREATH_AMP * eased;
    }
    const gain = arrive * breath;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, PW, PH);
    let prevA = -1;
    for (let i = 0; i < N; i++) {
      const cap = CAP[i];
      let a = A0[i];
      if (cap > 0) a = a + (Math.min(CAPTURE_ALPHA_CAP, Math.max(a + 0.12, CAPTURE_ALPHA_MIN)) - a) * cap;
      a *= gain;
      if (a < 0.012) continue;
      const s = sprites[SPR[i]];
      if (a !== prevA) { ctx.globalAlpha = a; prevA = a; }
      ctx.drawImage(s.c, PX[i] * dpr - s.m, PY[i] * dpr - s.m);
    }
    ctx.globalAlpha = 1;
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  let narrowPointer = !fine.matches;
  const isRunning = () => raf !== 0;

  function tick(t) {
    raf = requestAnimationFrame(tick);
    if (!t0) { t0 = t; lastT = t; draw(t); return; }
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    const m0 = performance.now();
    step(t, dt);
    draw(t);
    const ms = performance.now() - m0;
    frameMs.push(ms);
    if (frameMs.length > 600) frameMs.shift();
  }

  function start() {
    if (raf || paused || hidden || reduced.matches) return;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  // ── Wiring ────────────────────────────────────────────────────────────────
  resize();
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);

  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) stop(); else start();
  });

  if (fine.matches) {
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      cursorX = e.clientX - r.left; cursorY = e.clientY - r.top;
      cursorOn = true;
    }, { passive: true });
    const off = () => { cursorOn = false; };
    window.addEventListener('pointerleave', off);
    window.addEventListener('blur', off);
  }
  fine.addEventListener('change', () => { narrowPointer = !fine.matches; if (narrowPointer) cursorOn = false; });

  reduced.addEventListener('change', () => {
    if (reduced.matches) { stop(); staticDraw = true; resetToHome(); draw(performance.now()); }
    else { staticDraw = false; start(); }
  });

  function resetToHome() {
    for (let i = 0; i < N; i++) {
      PX[i] = HX[i] * W; PY[i] = HY[i] * H;
      VX[i] = 0; VY[i] = 0; CAP[i] = 0;
    }
  }

  window.__calmField = {
    setPaused(v) { paused = !!v; if (paused) stop(); else start(); },
    get paused() { return paused; },
    get running() { return isRunning(); },
    get particleCount() { return N; },
    get skeletonCells() { return skeleton ? skeleton.list.length : 0; },
    get skeletonDone() { return !!(skeleton && skeleton.done); },
    get capturedCount() { let n = 0; for (let i = 0; i < N; i++) if (CAP[i] > 0) n++; return n; },
    get maxSpeed() { return maxSpeed; },
    resetMaxSpeed() { maxSpeed = 0; },
    frameStats() {
      if (!frameMs.length) return null;
      const a = frameMs.slice().sort((x, y) => x - y);
      return { n: a.length, p50: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)], max: a[a.length - 1] };
    },
  };

  if (reduced.matches) { staticDraw = true; t0 = performance.now(); draw(t0); }
  else start();
})();
