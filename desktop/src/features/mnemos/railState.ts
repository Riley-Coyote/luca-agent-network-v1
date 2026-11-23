import * as React from "react";

import type { BookLife } from "./book";
import { railStateLine } from "./boardWords";

/**
 * The mind's state for the rail's one line (WP-49, Decided 2): its newest
 * quiet hour, as the card last read it. Held only while the card shows the
 * mind's notebook; it goes when the card does, so nothing outlives it.
 */
type Held = Pick<BookLife, "hours" | "memory">;

const held = new Map<string, Held>();
const listeners = new Set<() => void>();
const tell = () => {
  for (const listener of listeners) listener();
};

/** The card's side: keeps the newest reading of `life` for `mind`, and lets
 *  it go when the card goes or the notebook does. */
export function useRailStateSource(mind: string, life: BookLife | null) {
  React.useEffect(() => {
    if (!life) return;
    held.set(mind, { hours: life.hours, memory: life.memory });
    tell();
    return () => {
      held.delete(mind);
      tell();
    };
  }, [mind, life]);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The rail's side: "Cold · our hour ended 7 days ago", read again each
 *  minute; null while the card holds no notebook for this mind. */
export function useRailState(mind: string | null): string | null {
  const life = React.useSyncExternalStore(subscribe, () =>
    mind ? (held.get(mind) ?? null) : null,
  );
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!life) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [life]);
  return life ? railStateLine(life, now) : null;
}
