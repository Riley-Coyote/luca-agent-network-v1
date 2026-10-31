/**
 * A page with unsaved changes holds history steps before they happen, so
 * the question can be asked while the address still says where you are,
 * and the step is taken only on the answer (BETA14_RELEASE.md WP-43,
 * rounds 3 and 4).
 *
 * The router's own blocker holds every other move (a link, a rail row, a
 * place icon) and the browser's own step back. It can't hold any other
 * history step cleanly: by the time it hears one the browser has already
 * stepped, and it steps a held forward step back the wrong way. So the
 * app's own steps (the title bar's arrows, ⌘[ and ⌘], a page's back link)
 * come here first, and so does the browser's step forward, heard before
 * the router hears it and stepped straight back.
 */

type Guard = (resume: () => void) => boolean;

let guard: Guard | null = null;
let indexNow: () => number | undefined = () => undefined;
/** Pops this file made itself (stepping a held step back), not to be heard. */
let unheard = 0;
/** A held step being taken: heard by the router as ever. */
let passing = false;

/**
 * The page that holds unsaved changes says so, with where in the history it
 * stands (the router's own index); null when it lets go.
 */
export function setLeaveGuard(
  next: Guard | null,
  currentIndex?: () => number | undefined,
): void {
  guard = next;
  indexNow = currentIndex ?? (() => undefined);
}

/**
 * Take a history step, or hand it to the page that holds it. Taken on that
 * page's answer, the step passes the router's own blocker (it has had its
 * say); taken at once, the router's blockers apply as ever.
 */
export function takeHistoryStep(
  step: (options: { ignoreBlocker: boolean }) => void,
): void {
  if (guard?.(() => step({ ignoreBlocker: true }))) return;
  step({ ignoreBlocker: false });
}

function historyIndex(): number | undefined {
  const state = window.history.state as { __TSR_index?: unknown } | null;
  return typeof state?.__TSR_index === "number" ? state.__TSR_index : undefined;
}

/**
 * Heard first (in the capture phase, and added before the router adds its
 * own): a browser step that isn't one back, while a page holds unsaved
 * changes, is stepped straight back unheard and held until the answer.
 */
function onPop(event: PopStateEvent) {
  if (unheard > 0) {
    unheard -= 1;
    event.stopImmediatePropagation();
    return;
  }
  if (passing) {
    passing = false;
    return;
  }
  if (!guard) return;
  const from = indexNow();
  const to = historyIndex();
  if (from === undefined || to === undefined) return;
  const delta = to - from;
  // One step back the router holds and restores rightly itself.
  if (delta === 0 || delta === -1) return;
  const held = guard(() => {
    passing = true;
    window.history.go(delta);
  });
  if (!held) return;
  event.stopImmediatePropagation();
  unheard += 1;
  window.history.go(-delta);
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", onPop, true);
}
