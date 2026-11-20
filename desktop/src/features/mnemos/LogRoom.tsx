import { ItemsRoom } from "./ItemsRoom";
import { longDay } from "./MnemosParts";
import { dayKey } from "./notebook";
import type { RoomProps } from "./roomKit";

/** Log: the notebook's days, newest first. */
export function LogRoom(props: RoomProps) {
  const life = props.notebook?.life ?? null;
  const days = new Map<string, { at: string; n: number }>();
  if (life)
    for (const at of [
      ...life.hours.map((h) => h.start),
      ...life.journal.map((e) => e.at),
      ...life.notes.map((n) => n.at),
    ]) {
      if (!at) continue;
      const key = dayKey(new Date(at));
      const day = days.get(key) ?? { at, n: 0 };
      day.n += 1;
      days.set(key, day);
    }
  const items = [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, day]) => ({
      key: `#${key}`,
      title: longDay(day.at),
      note: String(day.n),
      opened: () => <article aria-label="A day">{longDay(day.at)}</article>,
    }));
  return (
    <ItemsRoom
      backLabel="Log"
      empty="Nothing has happened in its notebook yet."
      groups={life ? [{ items }] : null}
      needs="The log"
      props={props}
      testId="mnemos-log"
    />
  );
}
