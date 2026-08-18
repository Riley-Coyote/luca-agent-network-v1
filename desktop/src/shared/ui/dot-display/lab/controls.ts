/**
 * The control schema, the regimes, and the preset shelf.
 *
 * Declarative on purpose: `panel.ts` builds the whole interface by walking these
 * tables, so adding a knob is one entry here rather than a slider plus a
 * listener plus a label plus a formatter scattered across a DOM builder.
 *
 * Two things here are not decoration:
 *
 * - `rebuilds` marks the only two controls that genuinely have to tear down the
 *   lattice. Everything else is applied live to the running simulation. Getting
 *   this wrong is what made the panel feel broken: a rebuilding control fired on
 *   every pixel of a drag was constructing a whole new sandpile — preseed,
 *   relaxation and all — hundreds of times per gesture.
 * - `REGIMES` exists because a wall of sliders does not teach you what a system
 *   can do. Landing somewhere interesting and then reading which knobs moved
 *   does.
 */

import type {
  BoundaryKind,
  DriveMode,
  LatticeKind,
  PileConfig,
  PileSim,
} from "./pile-core";
import type { ReadoutKind } from "./fields";

/**
 * The seam between the stage and the panel.
 *
 * `state` is a live reference to one object that is mutated, never reassigned,
 * so the panel never has to ask for a fresh copy. Every write goes through
 * `setKey`, which is what lets the stage coalesce a whole drag into one frame.
 */
export interface LabController {
  readonly state: LabState;
  /** `rebuilds` tears down the lattice — pass it only for controls that
   *  genuinely resize, and only on release. */
  setKey(key: keyof LabState, value: number | string, rebuilds: boolean): void;
  applyPatch(patch: Partial<LabState>): void;
  getSim(): PileSim | null;
  reseed(): void;
  setRefresh(fn: () => void): void;
}

export interface LabState extends PileConfig {
  /** Lattice edge in cells. The sim is square. */
  cells: number;
  /** Dot pitch on the stage, CSS px. 0 means fit the viewport. */
  cellPx: number;
  readout: ReadoutKind;
  exposure: number;
  gamma: number;
  glow: number;
  slope: number;
  bloom: number;
}

export const DEFAULT_STATE: LabState = {
  threshold: 4,
  lattice: "square",
  boundary: "open",
  biasAngle: 0,
  biasStrength: 0,
  rate: 34,
  drive: "centre",
  sweepsPerFrame: 1,
  recencyDecay: 0.9,
  fluxDecay: 0.86,
  preseedPerCell: 0.46,
  cells: 96,
  cellPx: 0,
  readout: "odometer",
  exposure: 0,
  gamma: 1,
  glow: 1,
  slope: 0.35,
  bloom: 0,
};

export type ControlKind = "slider" | "select" | "angle";

export interface ControlSpec {
  kind: ControlKind;
  key: keyof LabState;
  label: string;
  /** Say what the knob MEANS, not what it does. Always visible — a hint you
   *  have to hover for is a hint nobody reads. */
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Logarithmic travel. Essential for anything spanning decades: a linear
   *  0.01–1000 slider is 99.9% useless travel. */
  log?: boolean;
  digits?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  /** Tears down the lattice. Applied on release, never mid-drag. */
  rebuilds?: boolean;
}

export interface Tab {
  id: string;
  title: string;
  blurb: string;
  controls: ControlSpec[];
}

const LATTICES: Array<{ value: LatticeKind; label: string }> = [
  { value: "square", label: "square · 4 neighbours" },
  { value: "square8", label: "square + diagonals · 8" },
  { value: "triangular", label: "triangular · 6" },
  { value: "honeycomb", label: "honeycomb · 3" },
];

const BOUNDARIES: Array<{ value: BoundaryKind; label: string }> = [
  { value: "open", label: "open — grains fall off the edge" },
  { value: "torus", label: "torus — nothing ever leaves" },
];

const DRIVES: Array<{ value: DriveMode; label: string }> = [
  { value: "centre", label: "one point, centre" },
  { value: "orbit", label: "orbiting point" },
  { value: "walk", label: "walking across" },
  { value: "two", label: "two sources" },
  { value: "pointer", label: "follow the mouse" },
  { value: "off", label: "nothing (field only)" },
];

const READOUT_OPTS: Array<{ value: ReadoutKind; label: string }> = [
  { value: "odometer", label: "odometer — every topple ever" },
  { value: "recency", label: "recency — what just moved" },
  { value: "flux", label: "flux — which way sand is moving" },
  { value: "height", label: "height — the raw 0–3 state" },
];

export const TABS: Tab[] = [
  {
    id: "drive",
    title: "Drive",
    blurb:
      "How fast grains arrive, and how fast the field is allowed to relax.",
    controls: [
      {
        kind: "slider",
        key: "sweepsPerFrame",
        label: "time dilation",
        unit: "sweeps/frame",
        min: 0.01,
        max: 1000,
        log: true,
        digits: 2,
        hint: "Production runs at 1, where a big cascade is over in four frames. Below 0.1 you watch the wavefront cross and reflect.",
      },
      {
        kind: "slider",
        key: "rate",
        label: "pour rate",
        unit: "grains/sec",
        min: 0,
        max: 400,
        step: 1,
        hint: "Added only while the field is at rest. That separation is what drives the pile critical on its own.",
      },
      {
        kind: "select",
        key: "drive",
        label: "where grains land",
        options: DRIVES,
        hint: "The ONLY difference between the shipping think / work / listen / net scenes. Same physics, different pour point.",
      },
      {
        kind: "slider",
        key: "preseedPerCell",
        label: "reseed density",
        unit: "grains/cell",
        min: 0,
        max: 3,
        step: 0.01,
        digits: 2,
        hint: "How much sand the field starts with. Production hardcodes 90 grains at any size — 0.46/cell on the rail, 0.056 at 40×40.",
      },
    ],
  },
  {
    id: "rule",
    title: "Rule",
    blurb: "The physics itself — what kind of object you are looking at.",
    controls: [
      {
        kind: "slider",
        key: "threshold",
        label: "toppling threshold",
        unit: "grains",
        min: 2,
        max: 9,
        step: 1,
        hint: "How full a cell gets before it spills. Below the neighbour count it never settles; above it, a frozen crust.",
      },
      {
        kind: "select",
        key: "lattice",
        label: "neighbours",
        options: LATTICES,
        rebuilds: true,
        hint: "Who a cell spills into. Triangular and honeycomb force an even dot pitch.",
      },
      {
        kind: "select",
        key: "boundary",
        label: "edges",
        options: BOUNDARIES,
        hint: "Open edges lose grains — the only thing keeping it critical. A torus keeps everything and chokes.",
      },
      {
        kind: "angle",
        key: "biasAngle",
        label: "drift direction",
        hint: "Which way a topple favours.",
      },
      {
        kind: "slider",
        key: "biasStrength",
        label: "drift strength",
        min: 0,
        max: 1,
        step: 0.01,
        digits: 2,
        hint: "Skews the spill. Weights stay whole numbers summing to the threshold, so no grain is lost — it just leans.",
      },
    ],
  },
  {
    id: "colour",
    title: "Colour",
    blurb: "One simulation. These change only how it becomes light.",
    controls: [
      {
        kind: "select",
        key: "readout",
        label: "field on the stage",
        options: READOUT_OPTS,
        hint: "Click any of the four panels under the stage to promote it here.",
      },
      {
        kind: "slider",
        key: "exposure",
        label: "exposure",
        min: 0,
        max: 4000,
        step: 1,
        hint: "Odometer only. 0 auto-exposes to the busiest cell; any other value locks it so the image stops rescaling.",
      },
      {
        kind: "slider",
        key: "gamma",
        label: "gamma",
        min: 0.25,
        max: 3,
        step: 0.01,
        digits: 2,
        hint: "Below 1 lifts the faint outer structure. Above 1 leaves only the hot core.",
      },
      {
        kind: "slider",
        key: "glow",
        label: "brightness",
        min: 0.2,
        max: 2,
        step: 0.01,
        digits: 2,
      },
      {
        kind: "slider",
        key: "slope",
        label: "resting slope",
        min: 0,
        max: 1,
        step: 0.01,
        digits: 2,
        hint: "Stored tension between avalanches. The slope is the paper; the cascade is the writing.",
      },
    ],
  },
  {
    id: "frame",
    title: "Frame",
    blurb: "Size, dot pitch, and how long a mark lingers after it is made.",
    controls: [
      {
        kind: "slider",
        key: "cells",
        label: "lattice size",
        unit: "cells across",
        min: 12,
        max: 220,
        step: 1,
        rebuilds: true,
        hint: "14 is the avatar rail, where everything shipping was tuned. Small is the real legibility test.",
      },
      {
        kind: "slider",
        key: "cellPx",
        label: "dot pitch",
        unit: "px (0 = fit)",
        min: 0,
        max: 20,
        step: 1,
        rebuilds: true,
        hint: "0 sizes the stage to your window. Anything else is a fixed dot size.",
      },
      {
        kind: "slider",
        key: "recencyDecay",
        label: "recency fade",
        min: 0.5,
        max: 0.995,
        step: 0.005,
        digits: 3,
        hint: "How long a cell stays lit after it topples. This is the phosphor.",
      },
      {
        kind: "slider",
        key: "fluxDecay",
        label: "flux fade",
        min: 0.5,
        max: 0.995,
        step: 0.005,
        digits: 3,
        hint: "The same, for the flow field. Higher values leave longer currents.",
      },
      {
        kind: "slider",
        key: "bloom",
        label: "bloom",
        min: 0,
        max: 2,
        step: 0.05,
        digits: 2,
        hint: "Neighbour bleed. The expensive pass — watch the frame time.",
      },
    ],
  },
];

/**
 * Curated corners of the parameter space.
 *
 * The fastest way to learn what a system does is to be dropped somewhere
 * interesting and then look at what changed — so applying a regime highlights
 * every control it moved.
 */
export interface Regime {
  name: string;
  blurb: string;
  state: Partial<LabState>;
}

export const REGIMES: Regime[] = [
  {
    name: "the rail",
    blurb:
      "What actually ships, magnified. A 14-cell lattice barely fed, so the field rests just below critical and the occasional micro-topple is the twinkle.",
    state: {
      cells: 14,
      cellPx: 20,
      rate: 4,
      sweepsPerFrame: 1,
      threshold: 4,
      lattice: "square",
      boundary: "open",
      readout: "recency",
      biasStrength: 0,
      slope: 0.35,
      gamma: 1,
    },
  },
  {
    name: "one cascade",
    blurb:
      "Time slowed to 1/25th. Pour hard, then watch a single avalanche cross the field and reflect off the open boundary — the thing nobody has ever actually seen.",
    state: {
      cells: 96,
      cellPx: 0,
      rate: 340,
      sweepsPerFrame: 0.04,
      readout: "recency",
      recencyDecay: 0.97,
      threshold: 4,
      slope: 0.2,
    },
  },
  {
    name: "deep record",
    blurb:
      "Run hot and let the odometer accumulate. Gamma below 1 lifts the faint outer structure. This picture only gets richer the longer you leave it.",
    state: {
      cells: 96,
      cellPx: 0,
      rate: 120,
      sweepsPerFrame: 6,
      readout: "odometer",
      gamma: 0.55,
      exposure: 0,
      glow: 1.1,
      threshold: 4,
    },
  },
  {
    name: "the current",
    blurb:
      "Colour by which way sand is moving. A cell surrounded on all sides nets to zero, so only the one-sided avalanche front lights up.",
    state: {
      cells: 96,
      cellPx: 0,
      rate: 260,
      sweepsPerFrame: 0.5,
      readout: "flux",
      fluxDecay: 0.95,
      slope: 0.18,
      glow: 1.2,
    },
  },
  {
    name: "drift",
    blurb:
      "Topples favour one direction, so the whole pile leans and shears. Grains are still conserved exactly — the spill weights stay whole numbers summing to the threshold.",
    state: {
      cells: 96,
      cellPx: 0,
      biasStrength: 0.8,
      biasAngle: 0.9,
      rate: 200,
      sweepsPerFrame: 1,
      readout: "flux",
      fluxDecay: 0.93,
    },
  },
  {
    name: "living terrain",
    blurb:
      "Threshold 3 on a 4-neighbour lattice: every cell spills more than it can hold, so the field can never fully settle. It just keeps moving.",
    state: {
      cells: 96,
      cellPx: 0,
      threshold: 3,
      rate: 40,
      sweepsPerFrame: 0.4,
      readout: "recency",
      recencyDecay: 0.93,
      slope: 0.3,
    },
  },
  {
    name: "frozen crust",
    blurb:
      "Threshold 7 — far above the neighbour count. Grains stack up and the field goes rigid, releasing rarely and enormously.",
    state: {
      cells: 96,
      cellPx: 0,
      threshold: 7,
      rate: 400,
      sweepsPerFrame: 1,
      readout: "height",
      slope: 0.5,
    },
  },
  {
    name: "honeycomb",
    blurb:
      "Three neighbours instead of four. A genuinely different organism, not a skin — the cascades are stringy where the square lattice's are round.",
    state: {
      cells: 96,
      cellPx: 0,
      lattice: "honeycomb",
      threshold: 3,
      rate: 160,
      sweepsPerFrame: 0.6,
      readout: "odometer",
      gamma: 0.7,
    },
  },
  {
    name: "torus",
    blurb:
      "Closed edges. Nothing ever leaves, so the field fills and chokes — which is the clearest demonstration of why an open, dissipative boundary is what keeps a sandpile critical.",
    state: {
      cells: 96,
      cellPx: 0,
      boundary: "torus",
      rate: 300,
      sweepsPerFrame: 2,
      readout: "odometer",
      gamma: 0.8,
    },
  },
];

// ---- presets -------------------------------------------------------------

export interface Preset {
  name: string;
  state: LabState;
}

const STORAGE_KEY = "luca.dot-lab.presets.v2";

export function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Preset =>
        !!p && typeof (p as Preset).name === "string" && !!(p as Preset).state,
    );
  } catch {
    // A corrupt shelf must never take the instrument down with it.
    return [];
  }
}

export function savePresets(presets: Preset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* quota or private mode — the shelf is a convenience, not a contract */
  }
}

/** Merge a stored state over the defaults, so a preset saved before a new knob
 *  existed still restores cleanly instead of yielding undefined. */
export function normaliseState(raw: Partial<LabState> | null): LabState {
  return { ...DEFAULT_STATE, ...(raw ?? {}) };
}

/** Which keys differ — used to highlight what a regime moved. */
export function changedKeys(
  a: LabState,
  b: Partial<LabState>,
): Set<keyof LabState> {
  const out = new Set<keyof LabState>();
  for (const k of Object.keys(b) as Array<keyof LabState>) {
    if (a[k] !== b[k]) out.add(k);
  }
  return out;
}
