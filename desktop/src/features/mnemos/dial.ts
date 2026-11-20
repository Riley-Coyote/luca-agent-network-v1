/**
 * The dial's geometry (the Ghost lab's `tHours`): the day as a 24-hour face,
 * noon at the top and midnight at the foot, read clockwise. An arc where
 * each scheduled hour falls, as long as that hour runs (an hour to itself,
 * half an hour for the day's work, a short time to dream), and a mark for
 * now. Pure: the drawing is `HoursDial.tsx`.
 */
import {
  clock,
  hourState,
  kindWords,
  nextWords,
  type ScheduledHour,
  type soonest,
} from "./boardWords";

/** The face's own units: a 200 square, the ring's centre and radius. */
export const DIAL = { size: 200, centre: 100, radius: 66 } as const;

/** How long each kind of hour runs, in hours (the lab's `LONG`). */
export const LONG: Record<string, number> = { mine: 1, ours: 0.5, dream: 0.25 };

/** A time of day (hours, 0 to 24) as an angle in radians from the top,
 *  clockwise: noon is 0, 6 pm a quarter turn, midnight a half. */
export const angleOf = (t: number) => ((t - 12) / 24) * 2 * Math.PI;

const round = (v: number) => Math.round(v * 100) / 100;

/** Where a time of day falls on a circle of radius `r`. */
export function pointAt(t: number, r: number = DIAL.radius): [number, number] {
  const a = angleOf(t);
  return [
    round(DIAL.centre + r * Math.sin(a)),
    round(DIAL.centre - r * Math.cos(a)),
  ];
}

/** An arc from `start` for `length` hours, clockwise; across midnight it
 *  simply goes on (24.5 is half past midnight). */
export function arcPath(
  start: number,
  length: number,
  r: number = DIAL.radius,
): string {
  const [x1, y1] = pointAt(start, r);
  const [x2, y2] = pointAt(start + length, r);
  const large = length > 12 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/** A moment's time of day in hours: 15:30 is 15.5. */
export const hourOfDay = (at: Date) => at.getHours() + at.getMinutes() / 60;

/** One arc on the face. */
export type DialArc = {
  kind: string;
  start: number;
  length: number;
  path: string;
  /** The kind of its newest hour: drawn in the full ink. */
  last: boolean;
};

/** The arcs of every scheduled hour that names a time. */
export function arcsOf(
  plan: readonly ScheduledHour[],
  lastKind: string | null,
): DialArc[] {
  return plan
    .filter(
      (p): p is ScheduledHour & { at: NonNullable<ScheduledHour["at"]> } =>
        Boolean(p.at),
    )
    .map((p) => {
      const start = p.at.hour + p.at.minute / 60;
      const length = LONG[p.kind] ?? 0.25;
      return {
        kind: p.kind,
        start,
        length,
        path: arcPath(start, length),
        last: p.kind === lastKind,
      };
    });
}

/** The ticks every three hours, each a short line inside the ring. */
export function ticks(): { x1: number; y1: number; x2: number; y2: number }[] {
  return [0, 3, 6, 9, 12, 15, 18, 21].map((t) => {
    const [x1, y1] = pointAt(t, DIAL.radius - 7);
    const [x2, y2] = pointAt(t, DIAL.radius - 4);
    return { x1, y1, x2, y2 };
  });
}

const atClock = (start: number) => {
  const at = new Date(
    2026,
    0,
    1,
    Math.floor(start),
    Math.round((start % 1) * 60),
  );
  return clock(at);
};

const andList = (items: string[]) =>
  items.length < 2
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** What the dial shows, in one sentence: its state, where its hours fall,
 *  now, and the next one. */
export function dialSentence({
  arcs,
  life,
  next,
  now,
}: {
  arcs: readonly DialArc[];
  life: Parameters<typeof hourState>[0];
  next: ReturnType<typeof soonest>;
  now: Date;
}): string {
  const { word, rest } = hourState(life, now.getTime());
  const parts = [
    word ? `${word}: ${rest}` : "No quiet hours yet",
    arcs.length
      ? `its hours fall at ${andList(arcs.map((a) => `${atClock(a.start)} for ${kindWords(a.kind)}`))}`
      : "no hours are set on the dial",
    `it is now ${clock(now)}`,
    nextWords(next)
      .replace(/^Next/, "next")
      .replace(/^Hours/, "hours"),
  ];
  return `${parts.join("; ")}.`;
}
