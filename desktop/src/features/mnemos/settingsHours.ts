/**
 * The quiet hours, as Settings sets them, each by itself (Mnemos 0.7.0,
 * `room.js`: `HOUR_ROWS`, `LENGTHS`, `lengthWord`, `savedHours`,
 * `hoursChanged`, `hoursHint`, `hermesHoursPanel`): its own switch, when it
 * starts, how long it may last, and whether it may go online (never the
 * dream). Nothing is sent while the person changes them; the change is said
 * back first, and only their yes sends one `hours` request holding only what
 * changed (`confirmOnce`). Pure, so the rule is tested without React.
 */
import type { HourChange, HourKind, HoursChange } from "./api";
import type { BookHermesHour, BookHourSetting, BookQuietHours } from "./book";
import { clock } from "./boardWords";

/** The quiet hours, each its own row, in the notebook's order and words. */
export const HOUR_ROWS: readonly {
  kind: HourKind;
  label: string;
  line: string;
}[] = [
  {
    kind: "mine",
    label: "Its own hour",
    line: "An hour to itself, each morning.",
  },
  {
    kind: "ours",
    label: "Our hour",
    line: "Half an hour for the day’s work, each evening. Skipped on a day with no work.",
  },
  {
    kind: "dream",
    label: "The dream",
    line: "A short time each night, over its memory.",
  },
];

/** How long an hour may last, as the notebook offers it, in minutes. */
export const LENGTHS: readonly number[] = [10, 20, 30, 45, 60, 90, 120];

/** A length in the notebook's words. */
export const lengthWord = (n: number) =>
  n === 60
    ? "An hour"
    : n === 90
      ? "An hour and a half"
      : n === 120
        ? "Two hours"
        : `${n} minutes`;

/** The lengths the menu offers: the notebook's, and the hour's own where
 *  it is none of them, shortest first. */
export const lengthsFor = (minutes: number | null): number[] =>
  [...new Set([...LENGTHS, minutes])]
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .sort((a, b) => a - b);

/** Each hour as it is set, or as the person is setting it. */
export type HoursSetting = Record<HourKind, BookHourSetting>;

/** Each hour as it is on this Mac now (room.js `savedHours`); null where
 *  there is nothing here to set: an older Mnemos, inside Hermes, or hours
 *  that couldn't be read. */
export function savedHours(q: BookQuietHours | null): HoursSetting | null {
  if (q?.where !== "here" || !q.hours) return null;
  const one = (kind: HourKind): BookHourSetting => {
    const h = q.hours?.[kind];
    return {
      on: h?.on === true,
      at: h?.at ?? "",
      minutes: h?.minutes ?? null,
      online: kind !== "dream" && h?.online === true,
    };
  };
  return { mine: one("mine"), ours: one("ours"), dream: one("dream") };
}

/** What the person changed, hour by hour, and only that: what Save sends
 *  (room.js `hoursChanged`). Each changed hour carries `on` as it will be;
 *  one that's on, only the fields that differ; one turned off, nothing
 *  else; the dream never `online`. */
export function hoursChanged(
  now: HoursSetting,
  saved: HoursSetting,
): HoursChange {
  const changed: HoursChange = {};
  for (const { kind } of HOUR_ROWS) {
    const h = now[kind];
    const was = saved[kind];
    const c: Partial<HourChange> = {};
    if (h.on !== was.on) c.on = h.on;
    if (h.on) {
      if (h.at && h.at !== was.at) c.at = h.at;
      if (h.minutes !== was.minutes && h.minutes !== null)
        c.minutes = h.minutes;
      if (kind !== "dream" && h.online !== was.online) c.online = h.online;
    }
    if (Object.keys(c).length) changed[kind] = { on: h.on, ...c };
  }
  return changed;
}

export const isChanged = (changed: HoursChange) =>
  Object.keys(changed).length > 0;

/** The group's foot (room.js `hoursHint`): what's unsaved, what the engine
 *  last said, or how the hours stand. */
export function hoursHint(
  now: HoursSetting,
  changed: HoursChange,
  said: string | null,
): string {
  if (isChanged(changed)) return "Not saved yet.";
  if (said) return said;
  return HOUR_ROWS.some(({ kind }) => now[kind].on)
    ? "Scheduled on this Mac."
    : "All off. Nothing runs between conversations.";
}

/** The quiet line under "Can go online", always there. */
export const onlineLine = (online: boolean) =>
  online
    ? "It can search and read the web in this hour. Every page it reads is listed in Hours."
    : "It can’t search or read the web in this hour.";

/** HH:MM in the app's clock words: "08:00" is "8:00 am". */
export function clockWords(at: string): string {
  const m = /^(\d\d):(\d\d)$/.exec(at);
  if (!m) return at;
  return clock(new Date(2026, 0, 1, Number(m[1]), Number(m[2])));
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** One hour as it will be, in the shape of the engine's own answer: "Its
 *  own hour: on, daily at 8:00 am, up to an hour, online." */
export function hourLine(kind: HourKind, h: BookHourSetting): string {
  const label = HOUR_ROWS.find((r) => r.kind === kind)?.label ?? kind;
  if (!h.on) return `${label}: off.`;
  const parts = [
    "on",
    h.at ? `daily at ${clockWords(h.at)}` : null,
    h.minutes !== null ? `up to ${lower(lengthWord(h.minutes))}` : null,
    kind === "dream" ? "never online" : h.online ? "online" : "offline",
  ].filter(Boolean);
  return `${label}: ${parts.join(", ")}.`;
}

/** The ask before a save: one line for each hour that changes, then each
 *  standing sentence only where it is true. */
export function hoursAsk(
  name: string,
  changed: HoursChange,
  now: HoursSetting,
  saved: HoursSetting,
): { title: string; lines: string[]; sentences: string[] } {
  const kinds = HOUR_ROWS.map((r) => r.kind).filter((k) => changed[k]);
  const sentences: string[] = [];
  if (kinds.some((k) => changed[k]?.on && !saved[k].on))
    sentences.push(
      `Turning an hour on sets a small job on this Mac that wakes ${name} at that time.`,
    );
  if (kinds.some((k) => changed[k]?.on === false))
    sentences.push("Turning one off takes its job away.");
  if (kinds.some((k) => changed[k]?.online === true))
    sentences.push(
      "Online, it can search and read the web in that hour. Every page it reads is listed in Hours.",
    );
  return {
    title: "Save these quiet hours?",
    lines: kinds.map((k) => hourLine(k, now[k])),
    sentences,
  };
}

/** The one request the yes sends: only what changed. */
export const hoursWrite = (changed: HoursChange) => ({
  command: "hours" as const,
  hours: changed,
});

/** One hour inside Hermes, only to read (room.js `hermesHoursPanel`). */
export function hermesHour(
  kind: HourKind,
  hours: Record<HourKind, BookHermesHour | null> | null,
): {
  state: string;
  starts: { label: string; value: string } | null;
  online: { label: string; line: string | null } | null;
  notLimited: boolean;
} {
  const job = hours ? hours[kind] : null;
  const on = job?.on === true;
  const state = !hours ? "Can’t tell" : on ? "On" : "Off";
  if (!job || !on)
    return { state, starts: null, online: null, notLimited: false };
  const when = /^\d\d:\d\d$/.test(job.at) ? clockWords(job.at) : null;
  return {
    state,
    starts: {
      label: when ? "Starts at" : "Runs on Hermes’s schedule",
      value: when ?? job.at,
    },
    online:
      job.limited && !job.online && kind === "dream"
        ? { label: "Never online.", line: null }
        : job.online
          ? {
              label: "Can go online",
              line: "It can search and read the web in this hour.",
            }
          : { label: "Offline", line: null },
    notLimited: !job.limited,
  };
}

/**
 * One write, asked first: `ask` holds it and sends nothing; `yes` sends it
 * once (a second yes while it is out, or after, sends nothing); `no` lets it
 * go unsent.
 */
export function confirmOnce<W, R>(send: (write: W) => Promise<R>) {
  let asked: W | null = null;
  let out = false;
  return {
    ask(write: W) {
      if (!out) asked = write;
    },
    asking: () => asked,
    no() {
      if (!out) asked = null;
    },
    async yes(): Promise<{ sent: true; said: R } | { sent: false }> {
      if (asked === null || out) return { sent: false };
      const write = asked;
      out = true;
      try {
        return { sent: true, said: await send(write) };
      } finally {
        out = false;
        asked = null;
      }
    },
  };
}
