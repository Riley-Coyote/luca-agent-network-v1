/**
 * A page with unsaved changes holds the app's own history steps (the title
 * bar's arrows, ⌘[ and ⌘], a page's back link) before they happen, so the
 * question can be asked while the address still says where you are, and the
 * step is taken only on the answer (BETA14_RELEASE.md WP-43, round 3).
 *
 * The router's own blocker holds every other move (a link, a rail row, a
 * place icon). It can't hold a history step cleanly: by the time it hears
 * one the browser has already stepped, and a held forward step is stepped
 * back the wrong way. So these steps come here first.
 */

type Guard = (resume: () => void) => boolean;

let guard: Guard | null = null;

/** The page that holds unsaved changes says so; null when it lets go. */
export function setLeaveGuard(next: Guard | null): void {
  guard = next;
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
