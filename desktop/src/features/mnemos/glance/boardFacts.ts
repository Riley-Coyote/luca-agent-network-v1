/**
 * The At a glance board's numbers and newest words, from a newer Mnemos's
 * notebook (the Ghost lab's `tToday`, `tMemory`, `tBeliefs`, `tMade`,
 * `tAsks`, `tJournal`, `tCarry`). Pure, with `now` given.
 */
import type {
  BookBelief,
  BookHandoff,
  BookHour,
  BookLife,
  BookMemory,
  BookQuestions,
} from "../book";
import {
  clock,
  dayName,
  kindWords,
  pictureName,
  shortDay,
  tagsOf,
} from "../boardWords";
import {
  countPerDay,
  dayKey,
  dayLine,
  firstLine,
  modelName,
} from "../notebook";
import { ASK, ASK_ORDER, trailSentence } from "../notebookWords";

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? null : t;
};

/** One line of the newest day: a memory kept, or a quiet hour. */
export type DayRow = {
  key: string;
  at: number;
  time: string;
  tag: string | null;
  text: string;
  /** Where its row goes: the memory, or the hour. */
  room: "memories" | "hours";
  item: string;
};

/** The newest day with something kept, and what was kept. */
export type DayKept = {
  key: string;
  /** "Today", "Yesterday", "Friday, November 13". */
  name: string;
  kept: number;
  rows: DayRow[];
};

/** How many lines the newest day shows. */
export const DAY_ROWS = 9;

/** The newest day it kept a memory or had a quiet hour, newest first. */
export function newestDayKept(
  life: Pick<BookLife, "hours" | "identity">,
  memories: readonly BookMemory[],
  now: Date,
): DayKept | null {
  const days = new Map<string, { date: Date; rows: DayRow[]; kept: number }>();
  const day = (at: number) => {
    const date = new Date(at);
    const key = dayKey(date);
    let d = days.get(key);
    if (!d) {
      d = {
        date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        rows: [],
        kept: 0,
      };
      days.set(key, d);
    }
    return d;
  };
  for (const m of memories) {
    const at = time(m.born);
    if (at === null || m.state === "archived") continue;
    const d = day(at);
    d.kept += 1;
    d.rows.push({
      key: `m:${m.id}`,
      at,
      time: clock(new Date(at)),
      tag: tagsOf(m, life.identity.model)[0] ?? null,
      text: firstLine(m.content, 150),
      room: "memories",
      item: m.id,
    });
  }
  for (const h of life.hours) {
    const at = time(h.start);
    if (at === null) continue;
    day(at).rows.push({
      key: `h:${h.id}`,
      at,
      time: clock(new Date(at)),
      tag: kindWords(h.kind),
      text: trailSentence(h),
      room: "hours",
      item: h.id,
    });
  }
  const newest = [...days.entries()].sort(
    ([, a], [, b]) => b.date.getTime() - a.date.getTime(),
  )[0];
  if (!newest) return null;
  const [key, d] = newest;
  return {
    key,
    name: dayName(d.date, now),
    kept: d.kept,
    rows: [...d.rows].sort((a, b) => b.at - a.at).slice(0, DAY_ROWS),
  };
}

/** The Memory plate's numbers: how many it can reach, how many were let
 *  go, the days it kept something and since when, and its strip of days. */
export function memoryNumbers(
  life: Pick<BookLife, "memory">,
  memories: readonly BookMemory[],
  now: Date,
) {
  const { states } = life.memory;
  const counts = countPerDay(memories.filter((m) => m.state !== "archived"));
  const line = dayLine(counts, now);
  const first = line[0]?.key ?? null;
  const since = first
    ? new Date(
        Number(first.slice(0, 4)),
        Number(first.slice(5, 7)) - 1,
        Number(first.slice(8, 10)),
      )
    : null;
  return {
    reach: states.active + states.dormant,
    letGo: states.archived,
    days: [...counts.values()].filter((n) => n > 0).length,
    since: since ? shortDay(since, now) : null,
    line,
  };
}

/** Its beliefs, the most firmly held first, then the newest. */
export function beliefsHeld(beliefs: readonly BookBelief[]): BookBelief[] {
  const at = (b: BookBelief) => time(b.revised ?? b.born) ?? 0;
  return [...beliefs].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || at(b) - at(a),
  );
}

const pct = (v: number | undefined) => `${Math.round((v ?? 0) * 100)}%`;

/** "2, held at 58% to 84%" (one alone: "1, held at 84%"). */
export function beliefsRange(list: readonly BookBelief[]): string {
  if (!list.length) return "0";
  const held = list.map((b) => b.confidence ?? 0);
  const lo = pct(Math.min(...held));
  const hi = pct(Math.max(...held));
  return `${list.length}, held at ${lo === hi ? hi : `${lo} to ${hi}`}`;
}

/** "Held at 84%". */
export const heldWords = (b: BookBelief) => `Held at ${pct(b.confidence)}`;

/** What its memory asks, open, by kind in the notebook's order. */
export function asksByKind(q: BookQuestions) {
  return Object.entries(q.byKind)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (ASK_ORDER[a] ?? 9) - (ASK_ORDER[b] ?? 9))
    .map(([kind, count]) => ({
      kind,
      count,
      title: ASK[kind]?.[0] ?? kind,
    }));
}

/** The newest of a list by its `at`. */
export function newest<T extends { at?: string | null }>(
  list: readonly T[],
): T | null {
  return (
    [...list].sort((a, b) => (time(b.at) ?? 0) - (time(a.at) ?? 0))[0] ?? null
  );
}

/** Who left a note to carry forward: itself, or a colleague by name. */
export function carriedBy(h: BookHandoff, ownModel: string): string {
  return !h.model || !ownModel || modelName(h.model) === modelName(ownModel)
    ? "The note it left itself"
    : `Left by ${modelName(h.model)}, a colleague`;
}

/** One picture it made: its studio path, name, when, and the hour that made
 *  it when the notebook says. */
export type Picture = {
  path: string;
  name: string;
  at: string | null;
  hour: BookHour | null;
};

/** Every picture in its studio, newest first. */
export function picturesOf(
  life: Pick<BookLife, "studio" | "hours">,
): Picture[] {
  return life.studio
    .filter((s) => s.picture)
    .map((s) => ({
      path: s.path,
      name: pictureName(s.path),
      at: s.at,
      hour: life.hours.find((h) => h.made.includes(s.path)) ?? null,
    }))
    .sort((a, b) => (time(b.at) ?? 0) - (time(a.at) ?? 0));
}

/** The pictures one hour made, in the order it lists them. */
export function picturesMadeBy(
  life: Pick<BookLife, "studio" | "hours">,
  hour: BookHour,
): Picture[] {
  const all = picturesOf(life);
  return hour.made
    .map((path) => all.find((p) => p.path === path))
    .filter((p): p is Picture => Boolean(p));
}

/** A step through `length` things from `index`, kept inside the list. */
export const stepTo = (index: number, delta: number, length: number) =>
  Math.max(0, Math.min(length - 1, index + delta));
