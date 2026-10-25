/**
 * The runtime sessions card's placement under the frame
 * (docs/luca/rail-system/SHELL_SPEC.md, "The rail" and "Smallest window";
 * Decided 12). Pure, so the unit tests can hold it.
 */

/** The window's right edge beside the conversation's card (SHELL_SPEC.md,
 *  "The conversation's card"; shell-frame.css's --luca-frame-edge). */
const WINDOW_EDGE = 6;

/** The narrowest the conversation's card is left beside the runtime sessions
 *  card, in rem: it holds text, so it follows ⌘+ and ⌘− as the card does
 *  (SHELL_SPEC.md, "Smallest window"). */
export const CONVERSATION_MIN_REM = 24;

/**
 * Whether the rail's card steps aside while the runtime sessions card is
 * open: where, beside the open rail, the conversation's card would be left
 * under `CONVERSATION_MIN_REM`. `conversationLeft` is where the
 * conversation's card would rest beside the runtime card with the rail open
 * (ShellLip's `shellFrameCardLeft`), `rem` the root's font size.
 */
export function railStepsAside({
  conversationLeft,
  rem,
  viewportWidth,
}: {
  conversationLeft: number;
  rem: number;
  viewportWidth: number;
}): boolean {
  const room = viewportWidth - WINDOW_EDGE - conversationLeft;
  return room < CONVERSATION_MIN_REM * rem;
}

/** A frame at 60 Hz is 16.7 ms; one this close to the last means the page
 *  is drawing steadily again. */
export const QUIET_FRAME_MS = 24;
/** The longest the card waits for that before it opens anyway. */
export const OPEN_WAIT_MAX_MS = 300;

type FrameClock = {
  request: (step: (now: number) => void) => number;
  cancel: (id: number) => void;
  now: () => number;
};

const browserClock: FrameClock = {
  request: (step) => window.requestAnimationFrame(step),
  cancel: (id) => window.cancelAnimationFrame(id),
  now: () => performance.now(),
};

/**
 * Calls `callback` once the page is drawing frames steadily: after at least
 * two frames, on the first that follows the one before it within
 * `QUIET_FRAME_MS`, or after `OPEN_WAIT_MAX_MS` at the latest. The card opens
 * from the Agents page, and that click also mounts New conversation; a slide
 * started under that work would lose its first frames to it. Returns the way
 * to stop waiting.
 */
export function whenFramesFlow(
  callback: () => void,
  clock: FrameClock = browserClock,
): () => void {
  const start = clock.now();
  let last = Number.NaN;
  let frames = 0;
  let id = 0;
  const step = (now: number) => {
    frames += 1;
    const steady = frames >= 2 && now - last < QUIET_FRAME_MS;
    if (steady || now - start >= OPEN_WAIT_MAX_MS) {
      id = 0;
      callback();
      return;
    }
    last = now;
    id = clock.request(step);
  };
  id = clock.request(step);
  return () => {
    if (id) clock.cancel(id);
  };
}
