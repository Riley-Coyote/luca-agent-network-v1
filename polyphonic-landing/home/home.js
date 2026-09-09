/* Front-door motion: the app's own dot physics (LucaDots), tuned for a full-bleed field. */
(() => {
  const D = window.LucaDots;
  if (!D) return;

  // Diffusion-limited aggregation, as in the desktop onboarding card and the lab,
  // with three changes for a hero: an off-centre seed so the type has room, a
  // clock-driven pace (something within a second, the whole field in about half
  // a minute, on any framerate), and no reset — once grown it holds, and memories
  // along the dendrite re-light instead of a new run starting.
  const GROW_TAU_MS = 11000;

  function makeField(p, sx, sy) {
    const W = p.W, H = p.H;
    const seedX = Math.round((W - 1) * sx), seedY = Math.round((H - 1) * sy);
    const stuck = new Uint8Array(W * H), age = new Float32Array(W * H);
    const list = [seedY * W + seedX];
    stuck[list[0]] = 1; age[list[0]] = 1;
    const walkers = [];
    const n = Math.max(24, Math.round(Math.min(W, H) * .6));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      walkers.push({ x: seedX + Math.cos(a) * 3, y: seedY + Math.sin(a) * 3 });
    }
    const bound = Math.max(8, Math.min(seedX, W - 1 - seedX, seedY, H - 1 - seedY) * .97);
    return { stuck, age, list, walkers, radius: 1, count: 1, cx: seedX, cy: seedY, bound, done: false, t0: undefined };
  }

  const narrow = () => matchMedia('(max-width: 760px)').matches;

  const homeDla = (p, t) => {
    const key = `home-dla:${p.W}x${p.H}`;
    const st = p.useSim(key, () => makeField(p, narrow() ? .5 : .7, narrow() ? .42 : .46));
    p.fade(.9);
    const { cx, cy, bound } = st;
    const W = p.W, H = p.H;
    if (st.t0 === undefined) st.t0 = t;
    const neighbourStuck = (x, y) =>
      (x > 0 && st.stuck[y * W + x - 1]) || (x < W - 1 && st.stuck[y * W + x + 1]) ||
      (y > 0 && st.stuck[(y - 1) * W + x]) || (y < H - 1 && st.stuck[(y + 1) * W + x]);
    const release = (w) => {
      const a = Math.random() * Math.PI * 2, r = Math.min(bound, st.radius + 2.5);
      w.x = cx + Math.cos(a) * r; w.y = cy + Math.sin(a) * r;
    };
    // One sweep: `active` walkers take `steps` random steps; dust is written on the
    // last step, and only near the growth front, so the sparkle hugs the dendrite.
    const sweep = (active, steps, dust) => {
      for (let step = 0; step < steps; step++) for (let wi = 0; wi < active; wi++) {
        const w = st.walkers[wi];
        const d = Math.random() * 4 | 0;
        if (d === 0) w.x += 1; else if (d === 1) w.x -= 1; else if (d === 2) w.y += 1; else w.y -= 1;
        const rr = Math.hypot(w.x - cx, w.y - cy);
        if (rr > bound + 4) { release(w); continue; }
        const ix = Math.round(w.x), iy = Math.round(w.y);
        if (ix < 0 || iy < 0 || ix >= W || iy >= H) { release(w); continue; }
        if (dust && step === steps - 1 && rr < st.radius + 7) p.add(ix, iy, .12);
        if (neighbourStuck(ix, iy)) {
          const i = iy * W + ix;
          if (!st.stuck[i]) { st.stuck[i] = 1; st.age[i] = 1; st.list.push(i); st.count++; }
          st.radius = Math.max(st.radius, rr);
          release(w);
        }
      }
    };
    if (!st.done) {
      const target = bound * (1 - Math.exp(-(t - st.t0) / GROW_TAU_MS));
      sweep(Math.min(8, st.walkers.length), 2, true);          // ambient: walkers always searching
      let catchUp = 0;
      while (st.radius < target && catchUp++ < 6) sweep(st.walkers.length, 3, catchUp === 1);
      if (st.radius >= bound - 1) st.done = true;
    } else {
      // Settled: a few memories along the dendrite re-light each second.
      for (let k = 0; k < 2; k++) if (Math.random() < .35) {
        const i = st.list[Math.random() * st.list.length | 0];
        st.age[i] = Math.max(st.age[i], .4);
      }
    }
    for (let k = 0; k < st.list.length; k++) {
      const i = st.list[k], a = st.age[i];
      const v = .28 + .7 * a;
      if (v > p.buf[i]) p.buf[i] = v;
      if (p.magnitude) p.magnitude[i] = .2 + .7 * a;
      if (a > .001) st.age[i] = a * .986;
    }
  };
  D.registerScene('home-dla', homeDla);

  const field = document.querySelector('.home-field');
  if (field) {
    const panel = D.registerPanel(field, { seed: 'polyphonic-home', cell: 7 });
    panel.enableMagnitude(D.MAGNITUDE_LUT_INKFLOOR);
    // registerPanel settles 26 frames at once, which skips the part worth watching.
    // Start again from the seed so the first thing a visitor sees is growth.
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { panel.sim = null; panel.buf.fill(0); if (panel.magnitude) panel.magnitude.fill(0); }
    else D.settle(panel);
    window.__homePanel = panel;
  }
  document.querySelectorAll('.door-mark canvas').forEach((c) => {
    D.registerPanel(c, { seed: c.dataset.seed || 'luca', cell: 2, breath: true });
  });

  const toggle = document.getElementById('motion-toggle');
  if (toggle && D.setMotionPaused) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let paused = false;
    const apply = () => {
      const off = paused || reduced.matches;
      toggle.setAttribute('aria-pressed', String(off));
      toggle.setAttribute('aria-label', off ? 'Resume page animation' : 'Pause page animation');
      toggle.querySelector('path').setAttribute('d', off ? 'M9 5l10 7-10 7z' : 'M8 6v12M16 6v12');
      toggle.disabled = reduced.matches;
      D.setMotionPaused(off);
    };
    toggle.addEventListener('click', () => { paused = !paused; apply(); });
    reduced.addEventListener('change', apply);
    apply();
  }
})();
