/**
 * Stage, layout and the update loop.
 *
 * One simulation, five panels. The stage advances the sim and renders the
 * selected field; the four mirrors under it render the *same* sim through the
 * other fields, so comparing readouts compares one avalanche rather than four
 * simulations that happen to look alike.
 *
 * The stage is registered first, and the engine iterates its panel set in
 * insertion order — so the sim steps exactly once per frame, before anything
 * reads it. That ordering is load-bearing.
 *
 * Every control change is coalesced into a single animation frame. Applying
 * directly from the input event meant a drag across a slider could fire fifty
 * applies before the browser painted once, and for the two controls that resize
 * the lattice each of those built an entire new sandpile.
 */

import {
  type DotPanel,
  registerPanel,
  registerScene,
  settle,
  unregisterPanel,
} from "../engine";
import { applyReadout, lutFor, type ReadoutKind, READOUTS } from "./fields";
import {
  DEFAULT_STATE,
  type LabController,
  type LabState,
  normaliseState,
} from "./controls";
import { mountPanel } from "./panel";
import { needsEvenPitch, PileSim } from "./pile-core";

const READOUT_LABEL: Record<ReadoutKind, string> = {
  odometer: "odometer",
  recency: "recency",
  flux: "flux",
  height: "height",
};

/** Mirror dot pitch in CSS px. The engine floors the pitch at 2 DEVICE pixels,
 *  so on a retina display this resolves to 1 CSS px per cell and the mirrors
 *  stay compact; at 1x it clamps to 2 and the row scrolls instead. Scaling a
 *  dot lattice to fit is not an option — a scaled lattice is a blurred one. */
const MIRROR_PITCH = 1;

/** Vertical space the mirror strip and the stage's own padding need, so the
 *  fitted dot pitch leaves room for them. */
const STAGE_CHROME = 48;
const MIRROR_CHROME = 58;

// The state object is never reassigned — only mutated — so anything holding a
// reference to it (the panel, the controller) always sees current values.
const state: LabState = { ...DEFAULT_STATE };

let sim: PileSim | null = null;
let stagePanel: DotPanel | null = null;
const mounted: HTMLCanvasElement[] = [];
let stageHost: HTMLElement | null = null;
let stageFrame: HTMLElement | null = null;
let refresh: () => void = () => {};

let simMs = 0;
let drawMs = 0;

// ---- scenes --------------------------------------------------------------
//
// Registered once, at module scope. Re-registering on every rebuild would leak
// entries into the engine's scene map.

registerScene("lab:stage", (p, t) => {
  if (!sim) return;
  const t0 = performance.now();
  sim.step(t);
  const t1 = performance.now();
  applyReadout(sim, p, state.readout, state);
  const t2 = performance.now();
  // Exponential moving average: a per-frame number is unreadable, and the point
  // of showing it is to feel when a setting has become expensive.
  simMs += (t1 - t0 - simMs) * 0.08;
  drawMs += (t2 - t1 - drawMs) * 0.08;
});

for (const kind of READOUTS) {
  registerScene(`lab:mirror:${kind}`, (p) => {
    if (!sim) return;
    applyReadout(sim, p, kind, state);
  });
}

// ---- geometry ------------------------------------------------------------

function dpr(): number {
  return Math.min(2, window.devicePixelRatio || 1);
}

/** The dot pitch the engine will actually use, in CSS px. It rounds the pitch to
 *  whole DEVICE pixels, so asking for 6 at a 1.5x ratio does not give you 6. */
function effectivePitch(cellPx: number): number {
  const d = dpr();
  return Math.max(2, Math.round(cellPx * d)) / d;
}

/**
 * Choose a dot pitch. `cellPx: 0` means "fit the window" — measured from the
 * stage's PARENT, which the flex layout has already sized, rather than from the
 * stage itself, which sizes to its content and would feed back on itself.
 */
function pitchFor(): number {
  if (state.cellPx > 0) return snapPitch(state.cellPx);
  const box = stageFrame?.getBoundingClientRect();
  if (!box || !box.height) return snapPitch(6);
  const mirrorBlock =
    state.cells * effectivePitch(MIRROR_PITCH) + MIRROR_CHROME;
  const availH = box.height - STAGE_CHROME - mirrorBlock;
  const availW = box.width - STAGE_CHROME;
  const p = Math.floor(Math.min(availH, availW) / state.cells);
  return snapPitch(Math.max(2, Math.min(20, p)));
}

/** Triangular and honeycomb draw on half-cell row offsets. At an odd device
 *  pitch that offset is half a device pixel, every dot is antialiased, and the
 *  lattice reads crooked — the exact failure `../engine.ts` opens by warning
 *  about. Force even rather than render a lie. */
function snapPitch(p: number): number {
  if (!needsEvenPitch(state.lattice)) return p;
  return Math.max(2, Math.round(p / 2) * 2);
}

/** Map a pointer event on the stage to a lattice cell. Mirrors the engine's own
 *  centring maths: integer device-pixel cell, integer origin. */
function cellAt(
  panel: DotPanel,
  canvas: HTMLCanvasElement,
  ev: PointerEvent,
  pitch: number,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const d = dpr();
  const cell = Math.max(2, Math.round(pitch * d));
  const ox = Math.floor((Math.round(rect.width * d) - panel.W * cell) / 2);
  const oy = Math.floor((Math.round(rect.height * d) - panel.H * cell) / 2);
  const x = Math.floor(((ev.clientX - rect.left) * d - ox) / cell);
  const y = Math.floor(((ev.clientY - rect.top) * d - oy) / cell);
  if (x < 0 || y < 0 || x >= panel.W || y >= panel.H) return null;
  return { x, y };
}

// ---- rebuild -------------------------------------------------------------

function rebuild(): void {
  const host = stageHost;
  if (!host) return;
  for (const c of mounted) unregisterPanel(c);
  mounted.length = 0;
  host.innerHTML = "";

  const pitch = pitchFor();
  const stageWrap = document.createElement("div");
  stageWrap.className = "stage";
  const cv = document.createElement("canvas");
  const px = Math.round(state.cells * pitch);
  cv.style.width = `${px}px`;
  cv.style.height = `${px}px`;
  cv.dataset.scene = "lab:stage";
  stageWrap.appendChild(cv);
  host.appendChild(stageWrap);

  // Register first, then size the sim from what the engine actually built. The
  // engine floors `canvasDevicePx / cellDevicePx`, so on a fractional device
  // ratio the lattice can land a cell short of what was asked for — sizing the
  // sim from the request rather than the result is how the picture ends up
  // sheared by one cell per row.
  const panel = registerPanel(cv, {
    cell: pitch,
    bloom: state.bloom,
    glow: 1,
  });
  mounted.push(cv);
  stagePanel = panel;
  sim = new PileSim(panel.W, panel.H, state);
  panel.enableMagnitude(lutFor(state.readout));

  const row = document.createElement("div");
  row.className = "mirrors";
  for (const kind of READOUTS) {
    const btn = document.createElement("button");
    btn.className = "mirror";
    btn.type = "button";
    btn.dataset.active = String(kind === state.readout);
    btn.dataset.readout = kind;
    const mc = document.createElement("canvas");
    const mpx = Math.round(panel.W * effectivePitch(MIRROR_PITCH));
    mc.style.width = `${mpx}px`;
    mc.style.height = `${mpx}px`;
    mc.dataset.scene = `lab:mirror:${kind}`;
    btn.appendChild(mc);
    const name = document.createElement("span");
    name.className = "mirror-name";
    name.textContent = READOUT_LABEL[kind];
    btn.appendChild(name);
    btn.addEventListener("click", () => {
      controller.setKey("readout", kind, false);
    });
    row.appendChild(btn);
    const mp = registerPanel(mc, { cell: MIRROR_PITCH, glow: 1 });
    mp.enableMagnitude(lutFor(kind));
    mounted.push(mc);
  }
  host.appendChild(row);

  attachPointer(cv, panel, pitch);
  settle(panel);
  syncMirrorSelection();
}

function syncMirrorSelection(): void {
  for (const b of document.querySelectorAll<HTMLElement>(".mirror")) {
    b.dataset.active = String(b.dataset.readout === state.readout);
  }
  if (stagePanel) stagePanel.enableMagnitude(lutFor(state.readout));
}

/** `setPointerCapture` throws if the id is not an active pointer — which happens
 *  with synthetic events and on some gesture cancellations. An exception thrown
 *  out of a pointerdown handler aborts the rest of it, turning a stray event
 *  into a dead drag. */
function capture(el: Element, id: number, on: boolean): void {
  try {
    if (on) el.setPointerCapture(id);
    else el.releasePointerCapture(id);
  } catch {
    /* no active pointer — nothing to capture, and nothing to fix */
  }
}

function attachPointer(
  cv: HTMLCanvasElement,
  panel: DotPanel,
  pitch: number,
): void {
  let pouring = false;
  const update = (ev: PointerEvent) => {
    if (!sim) return;
    const c = cellAt(panel, cv, ev, pitch);
    sim.pointer = c;
    // Pouring on drag works regardless of the configured drive mode — direct
    // manipulation should always work, not only when a select says so.
    if (pouring && c) sim.drop(c.x, c.y, ev.shiftKey ? 24 : 4);
  };
  cv.addEventListener("pointerdown", (ev) => {
    pouring = true;
    capture(cv, ev.pointerId, true);
    update(ev);
  });
  cv.addEventListener("pointermove", update);
  cv.addEventListener("pointerup", (ev) => {
    pouring = false;
    capture(cv, ev.pointerId, false);
  });
  cv.addEventListener("pointerleave", () => {
    if (sim) sim.pointer = null;
  });
}

// ---- coalesced updates ---------------------------------------------------

let wantRebuild = false;
let wantConfigure = false;
let scheduled = 0;

function schedule(): void {
  if (scheduled) return;
  scheduled = requestAnimationFrame(() => {
    scheduled = 0;
    if (wantRebuild) {
      wantRebuild = false;
      wantConfigure = false;
      rebuild();
    } else if (wantConfigure) {
      wantConfigure = false;
      sim?.configure(state);
    }
    refresh();
  });
}

const controller: LabController = {
  state,
  setKey(key, value, rebuilds) {
    (state as unknown as Record<string, unknown>)[key] = value;
    if (rebuilds) wantRebuild = true;
    else wantConfigure = true;
    if (key === "readout") syncMirrorSelection();
    if (key === "bloom" && stagePanel) stagePanel.opt.bloom = state.bloom;
    schedule();
  },
  applyPatch(patch) {
    Object.assign(state, normaliseState({ ...state, ...patch }));
    wantRebuild = true;
    schedule();
  },
  getSim: () => sim,
  reseed() {
    sim?.reset();
  },
  setRefresh(fn) {
    refresh = fn;
  },
};

// ---- status --------------------------------------------------------------

function startStatus(): void {
  const el = (id: string) => document.getElementById(id);
  const out = {
    fps: el("s-fps"),
    sim: el("s-sim"),
    aval: el("s-aval"),
    max: el("s-max"),
    total: el("s-total"),
    live: el("s-live"),
  };
  let frames = 0;
  let last = performance.now();
  const tick = () => {
    frames++;
    const now = performance.now();
    if (now - last >= 400 && sim) {
      const st = sim.stats();
      if (out.fps) {
        out.fps.textContent = String(
          Math.round((frames * 1000) / (now - last)),
        );
      }
      if (out.sim) {
        out.sim.textContent = `${(simMs + drawMs).toFixed(1)}ms`;
      }
      if (out.aval) {
        out.aval.textContent = (
          sim.inAvalanche ? st.avalanche : st.lastAvalanche
        ).toLocaleString();
      }
      if (out.max) out.max.textContent = st.maxAvalanche.toLocaleString();
      if (out.total) out.total.textContent = st.totalTopples.toLocaleString();
      if (out.live) out.live.dataset.running = String(sim.inAvalanche);
      frames = 0;
      last = now;
    }
    requestAnimationFrame(tick);
  };
  tick();
}

// ---- mount ---------------------------------------------------------------

export function mountLab(root: HTMLElement): void {
  stageHost = root.querySelector<HTMLElement>("#stage-host");
  stageFrame = root.querySelector<HTMLElement>("#stage-frame");
  const panelHost = root.querySelector<HTMLElement>("#panel-host");
  if (!stageHost || !stageFrame || !panelHost) {
    throw new Error("dot-lab: template is missing a mount point");
  }

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.body.dataset.reduced = "true";
  }

  rebuild();
  mountPanel(panelHost, controller);
  refresh();
  startStatus();

  // Only a fitted stage cares about the window size, and only after the resize
  // settles — rebuilding per resize event would restart the simulation dozens of
  // times while the user drags a window edge.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    if (state.cellPx > 0) return;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      wantRebuild = true;
      schedule();
    }, 180);
  });
}

/** Test/debug surface, and what the headless verification reads. */
export function labProbe(): Record<string, unknown> {
  return {
    hasSim: !!sim,
    W: sim?.W ?? 0,
    H: sim?.H ?? 0,
    stageW: stagePanel?.W ?? 0,
    stageH: stagePanel?.H ?? 0,
    panels: mounted.length,
    readout: state.readout,
    cells: state.cells,
    unstable: sim?.unstable ?? 0,
    simMs: +simMs.toFixed(3),
    drawMs: +drawMs.toFixed(3),
    stats: sim?.stats() ?? null,
  };
}
