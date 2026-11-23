/**
 * Time, as the notebook says it (Mnemos `companion/page/shared/words.js`:
 * `clock`, `dayName`, `shortDay`, `ago`, `temperature`, `tempWord`; the
 * Ghost lab's `soonest`, `when` and `pictureName`): how warm its last quiet
 * hour still is, when the next one wakes, the rail's one line, and the small
 * tags a memory carries. Pure: `now` is always given, so each is tested
 * without a clock.
 */
import type { BookHour, BookLife, BookMemory } from "./book";
import { modelName } from "./notebook";
import { KIND, plural } from "./notebookWords";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const en = (at: Date, options: Intl.DateTimeFormatOptions) =>
  at.toLocaleString("en-US", options);

/** A time of day, the notebook's way: "3:30 am". */
export function clock(at: Date): string {
  return en(at, { hour: "numeric", minute: "2-digit" })
    .toLowerCase()
    .replace(/[  ]/g, " ");
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "Today", "Yesterday", or "Friday, November 13". */
export function dayName(at: Date, now: Date): string {
  if (sameDay(at, now)) return "Today";
  if (sameDay(at, new Date(now.getTime() - DAY_MS))) return "Yesterday";
  return en(at, { weekday: "long", day: "numeric", month: "long" });
}

/** "Nov 13", with the year only before this one. */
export function shortDay(at: Date, now: Date): string {
  return en(at, {
    day: "numeric",
    month: "short",
    year: at.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** When something happened: "Today, 9:30 am" (the lab's `when`). */
export function when(iso: string | null | undefined, now: Date): string {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return "";
  return `${dayName(at, now)}, ${clock(at)}`;
}

/** How long ago, the notebook's way: "just now", "12 min ago", "4.3 h ago",
 *  "a day ago", "7 days ago". */
export function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = ms / HOUR_MS;
  if (h < 24)
    return `${h < 10 ? h.toFixed(1).replace(/\.0$/, "") : Math.round(h)} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "a day ago" : `${d} days ago`;
}

/** Hours for an hour's warmth to halve. */
export const HALF_LIFE_H = 6;

/** How warm an hour still is, 1 as it ends, halving every six hours. */
export function temperature(
  hour: Pick<BookHour, "end"> | null | undefined,
  now: number,
): number {
  const end = hour?.end ? Date.parse(hour.end) : Number.NaN;
  if (Number.isNaN(end)) return 0;
  return 2 ** (-(now - end) / HOUR_MS / HALF_LIFE_H);
}

/** Its warmth in a word: White-hot, Still warm, Embers, Cold. */
export function tempWord(k: number, hour: unknown): string {
  if (!hour) return "Cold";
  if (k >= 0.96) return "White-hot";
  if (k >= 0.4) return "Still warm";
  if (k >= 0.1) return "Embers";
  return "Cold";
}

/** A kind of hour, as a sentence goes on: "our hour", "a dream". */
export const kindWords = (kind: string) => (KIND[kind] ?? kind).toLowerCase();

/** One quiet hour of the schedule: its kind, the time of day it starts when
 *  the schedule names one, and whether it is loaded to run. */
export type ScheduledHour = {
  kind: string;
  at: { hour: number; minute: number } | null;
  loaded: boolean;
};

function timeOf(when: unknown): ScheduledHour["at"] {
  if (typeof when === "string") {
    const m = when.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    return hour < 24 && minute < 60 ? { hour, minute } : null;
  }
  if (typeof when !== "object" || when === null) return null;
  const w = when as Record<string, unknown>;
  const hour = typeof w.Hour === "number" ? w.Hour : null;
  const minute = typeof w.Minute === "number" ? w.Minute : 0;
  if (hour === null || hour < 0 || hour > 23 || minute < 0 || minute > 59)
    return null;
  return { hour, minute };
}

/** `life.schedule`, read forgivingly: an entry without a kind is left out. */
export function scheduleOf(
  schedule: readonly Record<string, unknown>[],
): ScheduledHour[] {
  return schedule
    .filter((s) => typeof s.kind === "string" && s.kind !== "")
    .map((s) => ({
      kind: s.kind as string,
      at: timeOf(s.when),
      loaded: s.loaded === true,
    }));
}

/** "HH:MM", as a time field holds it. */
export const hhmm = (at: ScheduledHour["at"]) =>
  at
    ? `${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")}`
    : "";

/** The next quiet hour to wake: a loaded one first, then the soonest. `at`
 *  is when it next starts, or null where the schedule names no time. */
export function soonest(
  plan: readonly ScheduledHour[],
  now: Date,
): { kind: string; at: number | null } | null {
  const next = (p: ScheduledHour) => {
    if (!p.at) return null;
    const d = new Date(now);
    d.setHours(p.at.hour, p.at.minute, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.getTime();
  };
  const order = (p: ScheduledHour) => next(p) ?? Number.POSITIVE_INFINITY;
  const first = [...plan].sort(
    (a, b) => Number(b.loaded) - Number(a.loaded) || order(a) - order(b),
  )[0];
  return first ? { kind: first.kind, at: next(first) } : null;
}

/** Under the dial: "Next, a dream at 3:30 am", or "Hours not scheduled". */
export function nextWords(next: ReturnType<typeof soonest>): string {
  if (!next) return "Hours not scheduled";
  return `Next, ${kindWords(next.kind)}${
    next.at === null ? "" : ` at ${clock(new Date(next.at))}`
  }`;
}

/** The mind's state, from its newest quiet hour: its warmth in a word, and
 *  the rest of the line ("our hour ended 7 days ago"). */
export function hourState(
  life: Pick<BookLife, "hours" | "memory">,
  now: number,
): { word: string; rest: string; hour: BookHour | null } {
  const hour = life.hours[0] ?? null;
  if (!hour)
    return {
      word: "",
      rest: `${plural(life.memory.count ?? life.memory.states.active + life.memory.states.dormant, "memory", "memories")} · no quiet hours yet`,
      hour: null,
    };
  const word = tempWord(temperature(hour, now), hour);
  const end = hour.end ? Date.parse(hour.end) : Number.NaN;
  const rest = Number.isNaN(end)
    ? kindWords(hour.kind)
    : `${kindWords(hour.kind)} ended ${ago(now - end)}`;
  return { word, rest: hour.practice ? `${rest} · practice` : rest, hour };
}

/** The rail's one line under the mind's name: "Cold · our hour ended 7 days
 *  ago" (the lab's `rail`). */
export function railStateLine(
  life: Pick<BookLife, "hours" | "memory">,
  now: number,
): string {
  const { word, rest } = hourState(life, now);
  return word ? `${word} · ${rest}` : rest;
}

/** The small words a memory carries (the lab's `tagsOf`). */
export function tagsOf(m: BookMemory, ownModel: string): string[] {
  const colleague =
    m.model && ownModel && modelName(m.model) !== modelName(ownModel)
      ? modelName(m.model)
      : null;
  return [
    m.lesson ? "a lesson" : null,
    m.standing ? "standing" : null,
    m.asked ? "asked about" : null,
    m.state === "dormant" ? "gone quiet" : null,
    colleague,
  ].filter((t): t is string => t !== null);
}

/** A picture's name, from its studio path: "night / sky" for
 *  "night/sky.png" (the lab's `pictureName`). */
export const pictureName = (path: string) =>
  path
    .replace(/\.[a-z0-9]+$/i, "")
    .split("/")
    .join(" / ");
