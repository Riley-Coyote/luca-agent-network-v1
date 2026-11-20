/**
 * The Log: a mind's days, as the notebook's page gathers them (Mnemos
 * `companion/page/shared/room.js` `logItems`). Its hours; journal entries
 * and notes not written in an hour (those are the hour's); the notes it
 * left itself; questions answered; each change in how firmly a belief is
 * held; and the memories formed, gathered by day. Newest first. Pure.
 */
import type {
  BookAnswered,
  BookBelief,
  BookEntry,
  BookHandoff,
  BookHour,
  BookLife,
  BookMemory,
  BookNote,
} from "./book";
import { dayKey, threads } from "./notebook";

/** Where each thing the notebook gives no id opens, by its place in the
 *  notebook's own list. The sections use the same keys. */
export const leftKey = (index: number) => `#left-${index}`;
export const beliefKey = (index: number) => `#belief-${index}`;
export const answeredKey = (index: number) => `#answered-${index}`;
export const dayItemKey = (day: string) => `#${day}`;

export type LogEvent =
  | {
      type: "hour";
      at: string;
      hour: BookHour;
      /** What it wrote in the hour: its journal, and its notes (each with
       *  the thread it opens). */
      journal: BookEntry[];
      notes: { note: BookNote; thread: string }[];
    }
  | { type: "journal"; at: string; entry: BookEntry }
  | { type: "note"; at: string; note: BookNote; thread: string }
  | { type: "left"; at: string; left: BookHandoff; key: string }
  | { type: "answer"; at: string; answered: BookAnswered; key: string }
  | {
      type: "belief";
      at: string;
      belief: BookBelief;
      from: number | null;
      to: number | null;
      key: string;
    }
  | { type: "formed"; at: string; memories: BookMemory[] };

/** One day: its local date (`YYYY-MM-DD`), and what happened, newest
 *  first. */
export type LogDay = { day: string; at: string; events: LogEvent[] };

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? null : t;
};

export function logEvents(
  life: BookLife,
  memories: readonly BookMemory[],
): LogEvent[] {
  const events: LogEvent[] = [];
  const threadOf = new Map<string, string>();
  for (const t of threads(life.notes))
    for (const n of t.notes) threadOf.set(n.id, t.id);
  const hourIds = new Set(life.hours.map((h) => h.id));
  for (const hour of life.hours) {
    const at = hour.end ?? hour.start;
    if (!at) continue;
    const journal = life.journal.filter((e) => e.hour === hour.id);
    const notes = life.notes
      .filter((n) => n.hour === hour.id)
      .map((note) => ({ note, thread: threadOf.get(note.id) ?? note.id }));
    events.push({ type: "hour", at, hour, journal, notes });
  }
  // An entry or note written in an hour is the hour's (an hour not in the
  // notebook's list leaves it standing on its own).
  const inHour = (hour: string | undefined) => !!hour && hourIds.has(hour);
  for (const entry of life.journal)
    if (!inHour(entry.hour) && entry.at)
      events.push({ type: "journal", at: entry.at, entry });
  for (const note of life.notes)
    if (!inHour(note.hour) && note.at)
      events.push({
        type: "note",
        at: note.at,
        note,
        thread: threadOf.get(note.id) ?? note.id,
      });
  life.handoffs.forEach((left, i) => {
    if (left.at)
      events.push({ type: "left", at: left.at, left, key: leftKey(i) });
  });
  life.questions.answered.forEach((answered, i) => {
    if (answered.at)
      events.push({
        type: "answer",
        at: answered.at,
        answered,
        key: answeredKey(i),
      });
  });
  life.beliefs.forEach((belief, i) => {
    for (const change of belief.history ?? [])
      if (change.at)
        events.push({
          type: "belief",
          at: change.at,
          belief,
          from: change.from,
          to: change.to,
          key: beliefKey(i),
        });
  });
  const formed = new Map<string, BookMemory[]>();
  for (const m of memories) {
    const t = time(m.born);
    if (t === null || m.state === "archived") continue;
    const key = dayKey(new Date(t));
    formed.set(key, [...(formed.get(key) ?? []), m]);
  }
  for (const list of formed.values()) {
    const sorted = [...list].sort(
      (a, b) => (time(b.born) ?? 0) - (time(a.born) ?? 0),
    );
    events.push({
      type: "formed",
      at: sorted[0]?.born as string,
      memories: sorted,
    });
  }
  return events
    .filter((e) => time(e.at) !== null)
    .sort((a, b) => (time(b.at) ?? 0) - (time(a.at) ?? 0));
}

/** The events gathered into their days, newest day first. */
export function logDays(
  life: BookLife,
  memories: readonly BookMemory[],
): LogDay[] {
  const days: LogDay[] = [];
  for (const event of logEvents(life, memories)) {
    const day = dayKey(new Date(event.at));
    const last = days[days.length - 1];
    if (last && last.day === day) last.events.push(event);
    else days.push({ day, at: event.at, events: [event] });
  }
  return days;
}

/** A day as the Log names it: Today, Yesterday, or the day itself. */
export function dayName(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (dayKey(at) === dayKey(now)) return "Today";
  if (dayKey(at) === dayKey(new Date(now.getTime() - 864e5)))
    return "Yesterday";
  return at.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: at.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** What a day holds, in a few words: "3 memories · 1 quiet hour". */
export function dayWords(day: LogDay): string {
  const count = (type: LogEvent["type"]) =>
    day.events.filter((e) => e.type === type).length;
  const formed = day.events
    .filter(
      (e): e is Extract<LogEvent, { type: "formed" }> => e.type === "formed",
    )
    .reduce((n, e) => n + e.memories.length, 0);
  const inHours = (n: (e: Extract<LogEvent, { type: "hour" }>) => number) =>
    day.events
      .filter(
        (e): e is Extract<LogEvent, { type: "hour" }> => e.type === "hour",
      )
      .reduce((sum, e) => sum + n(e), 0);
  const said = (n: number, one: string, many: string) =>
    n ? `${n.toLocaleString("en-US")} ${n === 1 ? one : many}` : null;
  return [
    said(formed, "memory", "memories"),
    said(count("hour"), "quiet hour", "quiet hours"),
    said(
      count("journal") + inHours((e) => e.journal.length),
      "journal entry",
      "journal entries",
    ),
    said(count("note") + inHours((e) => e.notes.length), "note", "notes"),
    said(count("left"), "note to itself", "notes to itself"),
    said(count("answer"), "answer", "answers"),
    said(count("belief"), "belief change", "belief changes"),
  ]
    .filter(Boolean)
    .join(" · ");
}
