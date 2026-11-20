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
/** A `read` that failed is tried again while the note is still on sight:
 *  once after the first wait, once more after the second, then not until
 *  the next sight. */
export const RETRY_AFTER_MS = [30_000, 120_000] as const;

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
 * failed is unread again, and is tried again while it is still on sight,
 * twice (`RETRY_AFTER_MS`: after 30 seconds, then after 2 minutes), and
 * then only the next time it is on sight (it leaves the screen and comes
 * back, or the window hides and shows again): never a loop.
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
  /** How many times each failed note has been tried again on this sight,
   *  and the wait before its next try. */
  const retried = new Map<string, number>();
  const retrying = new Map<string, Timer>();
  const stopRetry = (id: string) => {
    const t = retrying.get(id);
    if (t !== undefined) clearTimer(t);
    retrying.delete(id);
    retried.delete(id);
  };
  const failedNow = (id: string) => {
    failed.add(id);
    const n = retried.get(id) ?? 0;
    const wait = RETRY_AFTER_MS[n];
    if (wait === undefined) return;
    retrying.set(
      id,
      setTimer(() => {
        retrying.delete(id);
        if (!failed.has(id) || !options.looking()) return;
        retried.set(id, n + 1);
        failed.delete(id);
        seen(id);
      }, wait),
    );
  };
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
      options.read(ids).then(
        () => {
          for (const each of ids) retried.delete(each);
        },
        () => {
          for (const each of ids) {
            said.delete(each);
            failedNow(each);
            options.onUnseen?.(each);
          }
        },
      );
    }, SAY_AFTER_MS);
  };

  return {
    /** A note came into view enough to read (`yes`), or left it. */
    shown(id: string, yes: boolean) {
      if (said.has(id)) return;
      // A failed note waits for its next try, or until it has left the
      // screen: then its next sight starts afresh.
      if (failed.has(id)) {
        if (!yes) {
          failed.delete(id);
          stopRetry(id);
        }
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
      for (const id of [...retrying.keys()]) stopRetry(id);
      retried.clear();
    },
    /** Whether this note was read here. */
    said: (id: string) => said.has(id),
    dispose() {
      for (const t of waiting.values()) clearTimer(t);
      waiting.clear();
      for (const id of [...retrying.keys()]) stopRetry(id);
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
