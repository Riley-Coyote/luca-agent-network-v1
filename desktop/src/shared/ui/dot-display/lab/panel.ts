/**
 * The control panel.
 *
 * Tabbed rather than stacked. The previous version was one 2,644px column in a
 * 1,100px window, so reaching the second half of the controls meant scrolling
 * the animation off screen — which is fatal for an instrument whose entire
 * purpose is watching what a knob does to the picture. Five or six controls per
 * tab fits any laptop without scrolling.
 *
 * Sliders are also where discoverability lives. Every control carries an always
 * visible sentence saying what it MEANS, and the regime chips at the top drop
 * you somewhere interesting and then flash the controls they moved — which
 * teaches the parameter space far faster than poking one slider at a time.
 */

import {
  changedKeys,
  type ControlSpec,
  type LabController,
  type LabState,
  loadPresets,
  normaliseState,
  type Preset,
  REGIMES,
  savePresets,
  TABS,
} from "./controls";

const SLIDER_STEPS = 1000;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, text: string, fn: () => void): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}

// ---- slider mapping ------------------------------------------------------

function toSlider(spec: ControlSpec, value: number): number {
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  if (spec.log) {
    const lo = Math.log(Math.max(1e-6, min));
    const hi = Math.log(Math.max(1e-6, max));
    return ((Math.log(Math.max(1e-6, value)) - lo) / (hi - lo)) * SLIDER_STEPS;
  }
  return ((value - min) / (max - min || 1)) * SLIDER_STEPS;
}

function fromSlider(spec: ControlSpec, pos: number): number {
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  const f = pos / SLIDER_STEPS;
  if (spec.log) {
    const lo = Math.log(Math.max(1e-6, min));
    const hi = Math.log(Math.max(1e-6, max));
    return Math.exp(lo + (hi - lo) * f);
  }
  const raw = min + (max - min) * f;
  return spec.step ? Math.round(raw / spec.step) * spec.step : raw;
}

function fmt(spec: ControlSpec, value: number): string {
  const n =
    spec.digits !== undefined
      ? value.toFixed(spec.digits)
      : spec.step && spec.step >= 1
        ? String(Math.round(value))
        : value >= 100
          ? value.toFixed(0)
          : value.toFixed(2);
  return spec.unit ? `${n} ${spec.unit}` : n;
}

// ---- panel ---------------------------------------------------------------

export function mountPanel(host: HTMLElement, ctl: LabController): void {
  const refreshers: Array<() => void> = [];
  const nodesByKey = new Map<keyof LabState, HTMLElement>();
  let presets = loadPresets();
  let activeTab = TABS[0].id;

  host.innerHTML = "";

  // --- regimes: the discovery mechanism ---
  const regimeBar = el("div", "regimes");
  const regimeBlurb = el(
    "p",
    "regime-blurb",
    "Start somewhere — each of these is a different corner of the same physics. The controls it changes will flash.",
  );
  for (const r of REGIMES) {
    regimeBar.appendChild(
      button("regime", r.name, () => {
        const moved = changedKeys(ctl.state, r.state);
        ctl.applyPatch(r.state);
        regimeBlurb.textContent = r.blurb;
        for (const b of regimeBar.querySelectorAll<HTMLElement>(".regime")) {
          b.dataset.active = String(b.textContent === r.name);
        }
        flash(moved);
      }),
    );
  }
  host.appendChild(regimeBar);
  host.appendChild(regimeBlurb);

  function flash(keys: Set<keyof LabState>): void {
    // Jump to the tab holding the most changed controls, so the highlight is
    // somewhere the user can actually see.
    let best = activeTab;
    let bestCount = -1;
    for (const tab of TABS) {
      const n = tab.controls.filter((c) => keys.has(c.key)).length;
      if (n > bestCount) {
        bestCount = n;
        best = tab.id;
      }
    }
    selectTab(best);
    for (const key of keys) {
      const node = nodesByKey.get(key);
      if (!node) continue;
      node.dataset.flash = "true";
      setTimeout(() => {
        node.dataset.flash = "false";
      }, 1400);
    }
  }

  // --- tabs ---
  const tabBar = el("div", "tabs");
  const tabBodies = new Map<string, HTMLElement>();

  function selectTab(id: string): void {
    activeTab = id;
    for (const b of tabBar.querySelectorAll<HTMLElement>(".tab")) {
      b.dataset.active = String(b.dataset.tab === id);
    }
    for (const [key, node] of tabBodies) {
      node.hidden = key !== id;
    }
  }

  for (const tab of TABS) {
    const b = button("tab", tab.title, () => selectTab(tab.id));
    b.dataset.tab = tab.id;
    tabBar.appendChild(b);
  }
  const algebraBtn = button("tab", "Algebra", () => selectTab("algebra"));
  algebraBtn.dataset.tab = "algebra";
  tabBar.appendChild(algebraBtn);
  host.appendChild(tabBar);

  const bodies = el("div", "tab-bodies");
  host.appendChild(bodies);

  for (const tab of TABS) {
    const body = el("div", "tab-body");
    body.appendChild(el("p", "tab-blurb", tab.blurb));
    for (const spec of tab.controls) {
      const node = buildControl(spec, ctl, refreshers);
      nodesByKey.set(spec.key, node);
      body.appendChild(node);
    }
    if (tab.id === "drive") body.appendChild(buildReseed(ctl));
    tabBodies.set(tab.id, body);
    bodies.appendChild(body);
  }

  const algebra = buildAlgebra(ctl);
  tabBodies.set("algebra", algebra);
  bodies.appendChild(algebra);

  selectTab(TABS[0].id);

  // --- shelf: always visible, so a good accident is never more than one click
  // from being kept ---
  const foot = el("div", "panel-foot");
  const nameInput = el("input", "seed-input");
  nameInput.type = "text";
  nameInput.placeholder = "name this state…";
  const shelf = el("div", "shelf");

  const renderShelf = () => {
    shelf.innerHTML = "";
    for (const p of presets) {
      const chip = el("span", "chip");
      chip.appendChild(
        button("chip-load", p.name, () => {
          ctl.applyPatch(normaliseState(p.state));
        }),
      );
      chip.appendChild(
        button("chip-del", "×", () => {
          presets = presets.filter((q) => q !== p);
          savePresets(presets);
          renderShelf();
        }),
      );
      shelf.appendChild(chip);
    }
  };

  // Name and save share a row with the field actions: the footer is always on
  // screen, so every pixel it takes is a pixel the controls above it lose.
  const saveRow = el("div", "foot-row");
  saveRow.appendChild(nameInput);
  saveRow.appendChild(
    button("act", "save", () => {
      const name = nameInput.value.trim() || `state ${presets.length + 1}`;
      presets = [...presets, { name, state: { ...ctl.state } } as Preset];
      savePresets(presets);
      nameInput.value = "";
      renderShelf();
    }),
  );
  saveRow.appendChild(
    button("act", "copy", () => {
      void navigator.clipboard?.writeText(JSON.stringify(ctl.state, null, 2));
    }),
  );
  saveRow.appendChild(button("act", "reset", () => ctl.reseed()));
  saveRow.appendChild(
    button("act", "clear", () => ctl.getSim()?.clearHistory()),
  );

  foot.appendChild(saveRow);
  foot.appendChild(shelf);
  host.appendChild(foot);
  renderShelf();

  ctl.setRefresh(() => {
    for (const r of refreshers) r();
  });
}

// ---- one control ---------------------------------------------------------

function buildControl(
  spec: ControlSpec,
  ctl: LabController,
  refreshers: Array<() => void>,
): HTMLElement {
  const wrap = el("div", "ctl");
  wrap.dataset.flash = "false";
  const head = el("div", "ctl-head");
  head.appendChild(el("span", "ctl-label", spec.label));
  const val = el("span", "ctl-val");
  head.appendChild(val);
  wrap.appendChild(head);

  if (spec.kind === "select") {
    const sel = el("select");
    for (const o of spec.options ?? []) {
      const opt = el("option");
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      ctl.setKey(spec.key, sel.value, !!spec.rebuilds);
    });
    wrap.appendChild(sel);
    refreshers.push(() => {
      sel.value = String(ctl.state[spec.key]);
    });
  } else if (spec.kind === "angle") {
    const input = el("input");
    input.type = "range";
    input.min = "0";
    input.max = "360";
    input.step = "1";
    input.addEventListener("input", () => {
      ctl.setKey(spec.key, (Number(input.value) * Math.PI) / 180, false);
    });
    wrap.appendChild(input);
    refreshers.push(() => {
      const deg = Math.round(((ctl.state[spec.key] as number) * 180) / Math.PI);
      val.textContent = `${deg}°`;
      if (document.activeElement !== input) input.value = String(deg);
    });
  } else {
    const input = el("input");
    input.type = "range";
    input.min = "0";
    input.max = String(SLIDER_STEPS);
    input.step = "1";

    // A rebuilding control shows its value live but only commits on release.
    // Committing on `input` meant every pixel of a drag constructed a whole new
    // sandpile — preseed, relaxation and all.
    const commitOnRelease = !!spec.rebuilds;
    input.addEventListener("input", () => {
      const v = fromSlider(spec, Number(input.value));
      if (commitOnRelease) val.textContent = fmt(spec, v);
      else ctl.setKey(spec.key, v, false);
    });
    if (commitOnRelease) {
      input.addEventListener("change", () => {
        ctl.setKey(spec.key, fromSlider(spec, Number(input.value)), true);
      });
    }
    wrap.appendChild(input);
    refreshers.push(() => {
      const v = ctl.state[spec.key] as number;
      val.textContent = fmt(spec, v);
      if (document.activeElement !== input) {
        input.value = String(toSlider(spec, v));
      }
    });
  }

  if (spec.hint) wrap.appendChild(el("p", "ctl-hint", spec.hint));
  return wrap;
}

function buildReseed(ctl: LabController): HTMLElement {
  const row = el("div", "btn-row");
  row.appendChild(
    button("act", "reseed at this density", () => {
      ctl.reseed();
    }),
  );
  return row;
}

// ---- algebra -------------------------------------------------------------

/**
 * The sandpile group, exposed as buttons.
 *
 * These are not effects. Toppling is abelian, so the recurrent configurations
 * form a finite abelian group under add-then-relax — which is what lets an
 * identity mark be DERIVED rather than drawn, and lets a room's mark be the sum
 * of whoever is in it, with arrival order provably irrelevant.
 */
function buildAlgebra(ctl: LabController): HTMLElement {
  const body = el("div", "tab-body");
  body.appendChild(
    el(
      "p",
      "tab-blurb",
      "Toppling is order-independent, so the stable configurations form a finite abelian group. These are its operations.",
    ),
  );

  let slotA: Int16Array | null = null;
  let slotB: Int16Array | null = null;
  const status = el("p", "algebra-status", "—");

  const busy = async (label: string, fn: () => void) => {
    status.textContent = `${label}…`;
    // Yield once so the label paints before the main thread blocks. Identity on
    // a large lattice is a real relaxation, not an instant lookup.
    await new Promise((r) => setTimeout(r, 16));
    const t0 = performance.now();
    fn();
    status.textContent = `${label} — ${Math.round(performance.now() - t0)}ms`;
  };

  const seedInput = el("input", "seed-input");
  seedInput.type = "text";
  seedInput.placeholder = "public key, or any string";
  seedInput.value = "luca";

  const rows = el("div", "btn-row");
  rows.appendChild(
    button("act", "identity element", () => {
      void busy("identity", () => {
        const sim = ctl.getSim();
        if (sim) sim.load(sim.identity());
      });
    }),
  );
  rows.appendChild(
    button("act", "element from seed", () => {
      void busy("element", () => {
        const sim = ctl.getSim();
        if (sim) sim.load(sim.elementFromSeed(seedInput.value || "luca"));
      });
    }),
  );

  const abRow = el("div", "btn-row");
  abRow.appendChild(
    button("act", "store A", () => {
      const sim = ctl.getSim();
      if (sim) slotA = Int16Array.from(sim.height);
      status.textContent = "stored A";
    }),
  );
  abRow.appendChild(
    button("act", "store B", () => {
      const sim = ctl.getSim();
      if (sim) slotB = Int16Array.from(sim.height);
      status.textContent = "stored B";
    }),
  );
  abRow.appendChild(
    button("act", "load A + B", () => {
      void busy("A + B", () => {
        const sim = ctl.getSim();
        if (!sim || !slotA || !slotB) {
          status.textContent = "store A and B first";
          return;
        }
        sim.load(sim.add(slotA, slotB));
      });
    }),
  );

  const growWrap = el("div", "ctl");
  const growHead = el("div", "ctl-head");
  growHead.appendChild(el("span", "ctl-label", "growth"));
  const growVal = el("span", "ctl-val", "1,000 grains");
  growHead.appendChild(growVal);
  const grow = el("input");
  grow.type = "range";
  grow.min = "0";
  grow.max = "1000";
  grow.step = "1";
  grow.value = "500";
  const growN = () =>
    Math.round(Math.exp(Math.log(10 ** 6) * (Number(grow.value) / 1000)));
  grow.addEventListener("input", () => {
    growVal.textContent = `${growN().toLocaleString()} grains`;
  });
  grow.addEventListener("change", () => {
    void busy(`growth ${growN().toLocaleString()}`, () => {
      const sim = ctl.getSim();
      if (sim) sim.load(sim.growth(growN()));
    });
  });
  growWrap.appendChild(growHead);
  growWrap.appendChild(grow);
  growWrap.appendChild(
    el(
      "p",
      "ctl-hint",
      "Drop n grains on one cell of an empty field and relax. The picture refines self-similarly at every power of ten. Above ~100k this takes a moment — it is a real relaxation.",
    ),
  );

  body.appendChild(el("p", "ctl-label", "seed"));
  body.appendChild(seedInput);
  body.appendChild(rows);
  body.appendChild(abRow);
  body.appendChild(growWrap);
  body.appendChild(status);
  return body;
}
