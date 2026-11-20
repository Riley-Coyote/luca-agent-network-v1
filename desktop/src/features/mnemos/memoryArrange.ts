/**
 * How a newer Mnemos's memories are filtered, ordered and read, as its own
 * page does it (Mnemos `companion/page/shared/room.js` `list`, `isNew`;
 * `words.js` `visit`, `temperature`; `specimens.js` `herbariumOf`; and the
 * mind page's `warm`). Pure, so each rule is tested without React.
 */
import type { BookHour, BookMemory } from "./book";
import { modelName } from "./notebook";

/** The notebook's filters, by its own names. */
export type MemoryFilter =
  | "all"
  | "new"
  | "warm"
  | "lessons"
  | "standing"
  | "asked"
  | "quiet"
  | "colleagues";

/** The notebook's orders. */
export type MemorySort =
  | "newest"
  | "oldest"
  | "recalled"
  | "connected"
  | "easiest";

export const MEMORY_SORTS: readonly [MemorySort, string][] = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["recalled", "Most recalled"],
  ["connected", "Most connected"],
  ["easiest", "Easiest to reach"],
];

/** What the filters need beyond the memories themselves. */
export type ArrangeContext = {
  /** When the person was last here (ms), 0 on a first visit. */
  since: number;
  /** How warm each memory is from the hours lately (`heatOf`). */
  heat: ReadonlyMap<string, number>;
  /** The model that signs this mind's memories. */
  model: string;
};

/** Warm enough to say so, as the notebook's page says it. */
const WARM = 0.05;

export const sameModel = (a: string, b: string) =>
  !!a && !!b && (a === b || modelName(a) === modelName(b));

const born = (m: BookMemory) => {
  const t = m.born ? Date.parse(m.born) : Number.NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Formed since the person was last here. */
export const isNew = (m: BookMemory, since: number) =>
  since > 0 && born(m) > since;

export const isWarm = (m: BookMemory, heat: ReadonlyMap<string, number>) =>
  (heat.get(m.id) ?? 0) > WARM;

export const byColleague = (m: BookMemory, model: string) =>
  !!m.model && !sameModel(m.model, model);

function passes(m: BookMemory, filter: MemoryFilter, ctx: ArrangeContext) {
  switch (filter) {
    case "new":
      return isNew(m, ctx.since);
    case "warm":
      return isWarm(m, ctx.heat);
    case "lessons":
      return m.lesson === true;
    case "standing":
      return m.standing === true;
    case "asked":
      return m.asked === true;
    case "quiet":
      return m.state === "dormant";
    case "colleagues":
      return byColleague(m, ctx.model);
    default:
      return true;
  }
}

/** The memories it can reach, through one filter, in one order. */
export function arrange(
  memories: readonly BookMemory[],
  filter: MemoryFilter,
  sort: MemorySort,
  ctx: ArrangeContext,
): BookMemory[] {
  const out = memories.filter(
    (m) => m.state !== "archived" && passes(m, filter, ctx),
  );
  const order: Record<MemorySort, (a: BookMemory, b: BookMemory) => number> = {
    newest: (a, b) => born(b) - born(a),
    oldest: (a, b) => born(a) - born(b),
    recalled: (a, b) =>
      (b.recalls ?? 0) - (a.recalls ?? 0) || born(b) - born(a),
    connected: (a, b) => (b.ties?.length ?? 0) - (a.ties?.length ?? 0),
    easiest: (a, b) => b.acc - a.acc,
  };
  return out.sort(order[sort]);
}

/** The filters to offer, with how many each holds: New only when something
 *  is, Warm only when an hour lately warmed one, By colleagues only when a
 *  colleague signed one. */
export function filtersFor(
  memories: readonly BookMemory[],
  ctx: ArrangeContext,
): { id: MemoryFilter; label: string; n?: number }[] {
  const reach = memories.filter((m) => m.state !== "archived");
  const fresh = reach.filter((m) => isNew(m, ctx.since)).length;
  const warm = reach.some((m) => isWarm(m, ctx.heat));
  const colleagues = reach.some((m) => byColleague(m, ctx.model));
  return [
    { id: "all", label: "All" },
    ...(fresh ? [{ id: "new" as const, label: "New", n: fresh }] : []),
    ...(warm ? [{ id: "warm" as const, label: "Warm" }] : []),
    { id: "lessons", label: "Lessons" },
    { id: "standing", label: "Standing" },
    { id: "asked", label: "Asked about" },
    { id: "quiet", label: "Gone quiet" },
    ...(colleagues
      ? [{ id: "colleagues" as const, label: "By colleagues" }]
      : []),
  ];
}

/** An hour's warmth: its light, cooling since it ended (half-life six
 *  hours). */
export const HALF_LIFE_H = 6;
export const temperature = (hour: Pick<BookHour, "end">, now: number) => {
  const end = hour.end ? Date.parse(hour.end) : Number.NaN;
  return Number.isNaN(end) ? 0 : 2 ** (-(now - end) / 36e5 / HALF_LIFE_H);
};

/** How warm each memory is from the hours lately. Light adds the way light
 *  does: two hours on one memory make it warmer, never more than white. A
 *  memory reached for is lit fully; one found waiting, a little over half;
 *  one it woke with in hand, less. */
export function heatOf(
  hours: readonly BookHour[],
  now: number,
): Map<string, number> {
  const heat = new Map<string, number>();
  for (const hour of hours) {
    const k = temperature(hour, now);
    if (k < 0.01) continue;
    const touch = (id: string, level: number) =>
      heat.set(id, 1 - (1 - (heat.get(id) ?? 0)) * (1 - level * k));
    for (const id of hour.trail.woke) touch(id, 0.42);
    for (const id of hour.trail.waiting) touch(id, 0.55);
    for (const id of hour.trail.reached) touch(id, 1);
  }
  return heat;
}

/** Back after this long, it is a new visit. */
export const AWAY_MS = 30 * 60_000;

/** Somewhere a visit can be kept: the timestamps only, never words. */
export type VisitStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

/**
 * When the person was last here, by the notebook's rule (`words.js`
 * `visit`): a visit begins after half an hour away, and "since" is when the
 * last one ended. Kept per mind as two times; 0 on the first visit.
 */
export function visitSince(
  mind: string,
  now: number,
  store: VisitStore | null,
): number {
  const key = `luca.mnemos.visit.${mind}`;
  let was: { since?: unknown; seen?: unknown } | null = null;
  try {
    was = JSON.parse(store?.get(key) ?? "null");
  } catch {
    was = null;
  }
  const seen = typeof was?.seen === "number" ? was.seen : 0;
  const kept = typeof was?.since === "number" ? was.since : 0;
  const since = !seen || now - seen > AWAY_MS ? seen : kept;
  try {
    store?.set(key, JSON.stringify({ since, seen: now }));
  } catch {
    // A store that won't keep it: the next visit is a first one.
  }
  return since;
}

/** A memory's five readings, as the notebook's page shows them. */
export type Readings = {
  strength: number;
  stability: number;
  reach: number;
  links: number;
  recalled: number;
};

/** A memory's readings: how strongly it is kept, how settled, how easy to
 *  reach, its links to memories in view (each tie is listed once at each
 *  end), and the times it came back. */
export function readingsOf(
  memory: BookMemory,
  inView: ReadonlySet<string>,
): Readings {
  return {
    strength: memory.strength ?? 0.5,
    stability: memory.stability ?? 0.5,
    reach: memory.acc,
    links: (memory.ties ?? []).filter((t) => inView.has(t[0])).length,
    recalled: memory.recalls ?? 0,
  };
}

/** Each mind's visit, worked out once per app session. */
const visits = new Map<string, number>();
export function visitOf(
  mind: string,
  now: number,
  store: VisitStore | null,
): number {
  const known = visits.get(mind);
  if (known !== undefined) return known;
  const since = visitSince(mind, now, store);
  visits.set(mind, since);
  return since;
}
/** Forget the visits worked out (a community switch). */
export function resetVisits() {
  visits.clear();
}
