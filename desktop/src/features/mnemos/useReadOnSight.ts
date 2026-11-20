import * as React from "react";

import { ownerTouched, showing, sightReader, touch } from "./readOnSight";

/** The mind's notes read here this app session, by mind, so a dot stays
 *  gone across sections until the notebook is read again. */
const readHere = new Map<string, Set<string>>();
/** Forget them (a community switch). */
export function resetReadHere() {
  readHere.clear();
}

const TOUCHES = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
] as const;

/**
 * Notes of the mind's own, read the notebook's way (`readOnSight.ts`): a
 * note given `watch(id)` is read once it has been mostly on screen for 1.2
 * seconds, while the window is visible and after the owner has touched the
 * page, and said through `read` a few at a time. Off (`read` null: an
 * older Mnemos), nothing is read here, as before.
 */
export function useReadOnSight(
  mind: string,
  read: ((ids: string[]) => Promise<unknown>) | null,
) {
  const [, redraw] = React.useReducer((n: number) => n + 1, 0);
  const elements = React.useRef(new Map<string, Element>());
  const observer = React.useRef<IntersectionObserver | null>(null);
  const seenHere = readHere.get(mind) ?? new Set<string>();
  if (!readHere.has(mind)) readHere.set(mind, seenHere);

  React.useEffect(() => {
    if (!read || typeof IntersectionObserver === "undefined") return;
    const looking = () =>
      ownerTouched() && document.visibilityState === "visible";
    const reader = sightReader({
      read,
      looking,
      onSeen: (id) => {
        seenHere.add(id);
        redraw();
      },
      onUnseen: (id) => {
        seenHere.delete(id);
        redraw();
      },
    });
    const watching = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.unread;
          if (!id) continue;
          reader.shown(
            id,
            showing(
              {
                intersecting: entry.isIntersecting,
                shownHeight: entry.intersectionRect.height,
                height: entry.boundingClientRect.height,
              },
              window.innerHeight,
            ),
          );
        }
      },
      { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
    );
    observer.current = watching;
    for (const el of elements.current.values()) watching.observe(el);
    // Look again at what is already on screen: once someone touches the
    // page, and when the window comes back.
    const lookAgain = () => {
      for (const el of elements.current.values()) {
        watching.unobserve(el);
        watching.observe(el);
      }
    };
    const touched = () => {
      if (ownerTouched()) return;
      touch();
      lookAgain();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") lookAgain();
      else reader.pause();
    };
    for (const kind of TOUCHES)
      document.addEventListener(kind, touched, {
        capture: true,
        passive: true,
      });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      for (const kind of TOUCHES)
        document.removeEventListener(kind, touched, { capture: true });
      document.removeEventListener("visibilitychange", visibility);
      watching.disconnect();
      reader.dispose();
      observer.current = null;
    };
  }, [read, seenHere]);

  const refs = React.useRef(new Map<string, (el: Element | null) => void>());
  const watch = React.useCallback((id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (el: Element | null) => {
        const was = elements.current.get(id);
        if (was && was !== el) {
          observer.current?.unobserve(was);
          elements.current.delete(id);
        }
        if (el) {
          elements.current.set(id, el);
          observer.current?.observe(el);
        }
      };
      refs.current.set(id, ref);
    }
    return ref;
  }, []);

  return {
    /** Whether this note was read here (its dot goes). */
    readHere: (id: string) => seenHere.has(id),
    /** Give a note of the mind's own, not yet read, to be read on sight. */
    watch,
    on: read !== null,
  };
}
