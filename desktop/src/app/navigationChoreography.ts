import type { router as appRouter } from "@/app/router";

/**
 * Navigation choreography — the spatial grammar behind route transitions.
 *
 * The motion encodes the relationship between where you were and where you
 * are going, never decoration:
 *
 *   - Moving between rail sections drifts the content plane a few pixels in
 *     the direction you moved on the rail (the rail is vertical, so the
 *     geography is vertical).
 *   - Opening a detail surface (a conversation, a project, a workflow) is
 *     "deeper": the new plane rises and settles from slightly smaller.
 *   - Coming back out is "shallower": the reverse.
 *   - Everything else is a plain asymmetric crossfade.
 *
 * This module only computes the relationship and stamps it on <html> as
 * data attributes; the actual animation lives in
 * `shared/styles/globals/navigation-transitions.css` against the
 * View Transitions pseudo-elements. Browsers without the API never read
 * these attributes — the outlet falls back to `NavigationTransition`.
 */

/** Rail sections in visual order, top to bottom. */
const RAIL_ORDER: ReadonlyArray<readonly [prefix: string, index: number]> = [
  ["/artifacts", 0],
  ["/messages/new", 1],
  ["/inbox", 2],
  ["/agents", 3],
  ["/pulse", 4],
  ["/brain", 5],
];

/** Route prefixes that read as a detail surface below their section. */
const DETAIL_PREFIXES = ["/channels/", "/projects/", "/workflows/"];

function railIndex(pathname: string): number | null {
  if (pathname === "/") return 2; // home is the inbox seat
  for (const [prefix, index] of RAIL_ORDER) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return index;
  }
  return null;
}

function isDetail(pathname: string): boolean {
  return DETAIL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export type NavMotion = "up" | "down" | "deeper" | "shallower" | "swap";

export function resolveNavMotion(from: string, to: string): NavMotion {
  if (from === to) return "swap";
  const fromDetail = isDetail(from);
  const toDetail = isDetail(to);
  if (toDetail && !fromDetail) return "deeper";
  if (fromDetail && !toDetail) return "shallower";
  if (fromDetail && toDetail) return "swap"; // sibling conversations stay quiet
  const a = railIndex(from);
  const b = railIndex(to);
  if (a === null || b === null || a === b) return "swap";
  return b > a ? "down" : "up";
}

/** The rare flourish: entering Brain dissolves in through the dot lattice. */
function wantsDissolve(from: string, to: string): boolean {
  return to.startsWith("/brain") && !from.startsWith("/brain");
}

let clearTimer: number | null = null;

function stamp(from: string, to: string) {
  const root = document.documentElement;
  root.dataset.navMotion = resolveNavMotion(from, to);
  if (wantsDissolve(from, to)) {
    root.dataset.navDissolve = "1";
  } else {
    delete root.dataset.navDissolve;
  }
  // The attributes only need to survive the transition; clear them once the
  // longest animation is safely over so later non-navigation view
  // transitions (if any) don't inherit a stale direction.
  if (clearTimer !== null) window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    delete root.dataset.navMotion;
    delete root.dataset.navDissolve;
    clearTimer = null;
  }, 700);
}

/** Subscribe the choreography to the router. Call once at startup. */
export function wireNavigationChoreography(router: typeof appRouter): void {
  if (typeof document === "undefined") return;
  router.subscribe("onBeforeNavigate", (event) => {
    const from = event.fromLocation?.pathname ?? router.state.location.pathname;
    const to = event.toLocation?.pathname;
    if (!to) return;
    if (from === to) {
      // Search-param and redirect navigations still run a view transition
      // (the router wraps every navigation) — stamping them "same" keeps
      // that second transition motionless instead of replaying the last
      // direction as a visible stutter.
      document.documentElement.dataset.navMotion = "same";
      delete document.documentElement.dataset.navDissolve;
      return;
    }
    stamp(from, to);
  });
}
