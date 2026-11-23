/**
 * The quiet hours, as Settings sets them (Mnemos `room.js` `settingsHours`):
 * whether they run, and when each of the three starts. Nothing is sent while
 * the person changes them; a change is first said back in one plain
 * sentence, and only their yes sends one `hours` request (`confirmOnce`).
 * Pure, so the confirm is tested without React.
 */
import { clock, hhmm, type ScheduledHour } from "./boardWords";

/** The three hours, each HH:MM. */
export type HourTimes = { mine: string; ours: string; dream: string };
export type HoursSetting = { on: boolean } & HourTimes;

/** The notebook's own defaults, where nothing is scheduled. */
export const DEFAULT_TIMES: HourTimes = {
  mine: "08:00",
  ours: "19:00",
  dream: "03:30",
};

/** What the schedule holds now: on when anything is scheduled. */
export function savedHours(plan: readonly ScheduledHour[]): HoursSetting {
  const at = (kind: keyof HourTimes) =>
    hhmm(plan.find((p) => p.kind === kind)?.at ?? null) || DEFAULT_TIMES[kind];
  return {
    on: plan.length > 0,
    mine: at("mine"),
    ours: at("ours"),
    dream: at("dream"),
  };
}

export const sameHours = (a: HoursSetting, b: HoursSetting) =>
  a.on === b.on &&
  (!a.on || (a.mine === b.mine && a.ours === b.ours && a.dream === b.dream));

const said = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return clock(new Date(2026, 0, 1, h ?? 0, m ?? 0));
};

/** The change, said back before anything is sent: what it does on this Mac,
 *  and when. */
export function changeSentence(
  name: string,
  before: HoursSetting,
  after: HoursSetting,
): { title: string; text: string; yes: string } {
  if (!after.on)
    return {
      title: "Turn off its quiet hours?",
      text: `This takes away the small job on this Mac that wakes ${name} between conversations, so it won’t wake on its own.`,
      yes: "Turn them off",
    };
  const times = `${said(after.mine)} for its own hour, ${said(after.ours)} for our hour and ${said(after.dream)} to dream`;
  return before.on
    ? {
        title: "Change its quiet hours?",
        text: `This changes the small job on this Mac that wakes ${name}: at ${times}.`,
        yes: "Change them",
      }
    : {
        title: "Turn on its quiet hours?",
        text: `This sets a small job on this Mac that wakes ${name} at ${times}.`,
        yes: "Turn them on",
      };
}

/** The one request the yes sends. */
export function hoursWrite(after: HoursSetting) {
  return after.on
    ? {
        command: "hours" as const,
        on: true,
        mine: after.mine,
        ours: after.ours,
        dream: after.dream,
      }
    : { command: "hours" as const, on: false };
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
