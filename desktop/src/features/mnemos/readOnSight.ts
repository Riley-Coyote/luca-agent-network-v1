/**
 * A note of the mind's own counts as read the notebook's way (Mnemos
 * `companion/page/shared/room.js` `watchReading`, `markSeen`): once most of
 * it (or most of the screen) has shown it for a moment, in a window on
 * screen, in front of someone who has touched the page. Nothing short of
 * that counts: a note marked read unseen is a note lost. Each is said once,
 * a few at a time. Pure apart from the clock it is given.
 */

/** How long a note stays on screen before it is read. */
export const SEEN_AFTER_MS = 1200;
/** Notes read close together are said together. */
export const SAY_AFTER_MS = 300;
/** How much of the note, or of the screen, must show it. */
export const SHOWING_SHARE = 0.6;

/** Whether a note is showing enough to be read: most of it, or most of the
 *  screen when it is taller than the screen. */
export function showing(
  seen: { intersecting: boolean; shownHeight: number; height: number },
  view: number,
): boolean {
  return (
    seen.intersecting &&
    seen.shownHeight >= Math.min(seen.height, view) * SHOWING_SHARE
  );
}

type Timer = unknown;

/** What the reader is given: how to say notes read, whether a person is
 *  there to read them now, and a clock. */
export type SightOptions = {
  read: (ids: string[]) => Promise<unknown>;
  /** The window is on screen and the owner has touched the page. */
  looking: () => boolean;
  /** Said once read, so the page can let the dot go. */
  onSeen?: (id: string) => void;
  /** And if saying it failed, so the dot comes back. */
  onUnseen?: (id: string) => void;
  setTimer?: (run: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

/**
 * Follows the notes on screen: `shown(id, yes)` as each comes into view or
 * leaves it. A note shown for `SEEN_AFTER_MS` while someone is looking is
 * read, and the notes read within `SAY_AFTER_MS` of each other are said in
 * one `read`. A note already said is never said again; one whose saying
 * failed is unread again, and is tried again only the next time it is on
 * sight (it leaves the screen and comes back, or the window hides and
 * shows again): never again and again while it sits there.
 */
export function sightReader(options: SightOptions) {
  const setTimer =
    options.setTimer ??
    ((run: () => void, ms: number): Timer => setTimeout(run, ms));
  const clearTimer =
    options.clearTimer ??
    ((t: Timer) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const waiting = new Map<string, Timer>();
  const said = new Set<string>();
  /** Notes whose saying failed, still on screen since. */
  const failed = new Set<string>();
  const toSay = new Set<string>();
  let saying: Timer | null = null;

  const seen = (id: string) => {
    waiting.delete(id);
    if (said.has(id) || !options.looking()) return;
    said.add(id);
    toSay.add(id);
    options.onSeen?.(id);
    if (saying !== null) clearTimer(saying);
    saying = setTimer(() => {
      saying = null;
      const ids = [...toSay];
      toSay.clear();
      options.read(ids).catch(() => {
        for (const each of ids) {
          said.delete(each);
          failed.add(each);
          options.onUnseen?.(each);
        }
      });
    }, SAY_AFTER_MS);
  };

  return {
    /** A note came into view enough to read (`yes`), or left it. */
    shown(id: string, yes: boolean) {
      if (said.has(id)) return;
      // A failed note waits until it has left the screen.
      if (failed.has(id)) {
        if (!yes) failed.delete(id);
        return;
      }
      if (yes && options.looking() && !waiting.has(id))
        waiting.set(
          id,
          setTimer(() => seen(id), SEEN_AFTER_MS),
        );
      if (!yes && waiting.has(id)) {
        clearTimer(waiting.get(id));
        waiting.delete(id);
      }
    },
    /** Nobody is looking any more (the window hid): nothing waiting
     *  counts. */
    pause() {
      for (const t of waiting.values()) clearTimer(t);
      waiting.clear();
      // Shown again, every note on screen is a new sight.
      failed.clear();
    },
    /** Whether this note was read here. */
    said: (id: string) => said.has(id),
    dispose() {
      for (const t of waiting.values()) clearTimer(t);
      waiting.clear();
    },
  };
}

/** The owner has touched the page this app session: moved, scrolled,
 *  pressed a key. Until then nothing is read on sight. */
let touched = false;
export const ownerTouched = () => touched;
export function touch() {
  touched = true;
}
/** Forget it (a community switch). */
export function resetOwnerTouch() {
  touched = false;
}
