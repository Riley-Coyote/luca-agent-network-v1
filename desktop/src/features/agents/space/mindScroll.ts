import * as React from "react";
import { useRouter } from "@tanstack/react-router";

/**
 * Where an agent's pages sit when you arrive (BETA14_RELEASE.md WP-43,
 * round 4): a page opened by a link, a drawer row, a rail row or a button
 * starts at the top; only a step back or forward comes back to where that
 * page was. Kept per history entry, so the same page reached twice keeps
 * two places.
 */

type HistoryLike = {
  subscribe: (
    listener: (event: { action: { type: string } }) => void,
  ) => unknown;
};

const positions = new Map<string, number>();
let lastAction = "PUSH";
const heard = new WeakSet<object>();

/** Hear how each move was made (once per history). */
function hearHistoryActions(history: HistoryLike): void {
  if (heard.has(history)) return;
  heard.add(history);
  history.subscribe(({ action }) => {
    lastAction = action.type;
  });
}

/** True when the latest move was a step back or forward through history. */
export function arrivedByStep(): boolean {
  return (
    lastAction === "BACK" || lastAction === "FORWARD" || lastAction === "GO"
  );
}

/** Where to put a page on arrival at this history entry. */
function arrivalScroll(entry: string | null): number {
  if (!entry || !arrivedByStep()) return 0;
  return positions.get(entry) ?? 0;
}

/**
 * The page's scroller is placed on every arrival, once the router has put
 * its own scroll back (it keeps one place for every agent page), so this
 * rule is the last word. Arriving with nothing holding focus (a drawer's
 * row, a link from a conversation), the page's title takes it, as on every
 * move within. Returns what the scroller calls as it scrolls.
 */
export function useArrivalPlacement(
  scrollerRef: React.RefObject<HTMLElement | null>,
  titleRef: React.RefObject<HTMLElement | null>,
): (top: number) => void {
  const router = useRouter();
  const shownEntry = React.useRef<string | null>(null);
  const place = React.useEffectEvent(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Placed again when the router renders the same arrival: it may have
    // put its own scroll back in between.
    const entry = router.history.location.state.__TSR_key ?? null;
    shownEntry.current = entry;
    scroller.scrollTop = arrivalScroll(entry);
  });
  React.useLayoutEffect(() => {
    hearHistoryActions(router.history);
    place();
    return router.subscribe("onRendered", () => place());
  }, [router]);

  React.useLayoutEffect(() => {
    const started = performance.now();
    let frame = 0;
    const tick = () => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (titleRef.current) {
        titleRef.current.focus({ preventScroll: true });
        return;
      }
      if (performance.now() - started < 1500)
        frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [titleRef]);

  return React.useCallback((top: number) => {
    if (shownEntry.current) positions.set(shownEntry.current, top);
  }, []);
}
