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
 *   - Moving between two detail surfaces — one conversation to the next —
 *     is "same": motionless. Nothing about the frame changed, only the
 *     timeline inside it.
 *   - Everything else is a plain asymmetric crossfade.
 *
 * This module only computes the relationship and stamps it on <html> as
 * data attributes; the actual animation lives in
 * `shared/styles/globals/navigation-transitions.css` against the
 * View Transitions pseudo-elements. Browsers without the API never read
 * these attributes — the outlet falls back to `NavigationTransition`.
 */

/** Sections in visual order, top to bottom, and where home ("/") sits. */
export type NavOrder = {
  readonly home: number;
  readonly sections: ReadonlyArray<readonly [prefix: string, index: number]>;
};

/** The rail's sections, top to bottom; home is the inbox seat. */
const RAIL_ORDER: NavOrder = {
  home: 2,
  sections: [
    ["/artifacts", 0],
    ["/messages/new", 1],
    ["/inbox", 2],
    ["/agents", 3],
    ["/pulse", 4],
    ["/brain", 5],
    ["/settings", 6],
  ],
};

/**
 * Under the shell's frame the places column is the geography
 * (docs/luca/rail-system/SHELL_SPEC.md, "The places column", as NAVIGATION.md
 * amended it): Search (a dialog, not a page), Chats (home, with New
 * conversation in it), Agents (with Brain in it), Activity, Library, then
 * Settings at the foot. Moving down the column moves the page the same way.
 * The Inbox, out of the column, sits with Activity, where its list goes.
 * A conversation and a project are Chats' own pages, so arriving at one from
 * another place drifts by the column as Agents, Activity and Library do
 * (SHELL_BUILD.md WP-19); within Chats they stay deeper, shallower or still.
 */
const PLACES_ORDER: NavOrder = {
  home: 1,
  sections: [
    ["/channels", 1],
    ["/projects", 1],
    ["/messages/new", 1],
    ["/agents", 2],
    ["/brain", 2],
    ["/pulse", 3],
    ["/inbox", 3],
    ["/artifacts", 4],
    ["/settings", 5],
  ],
};

/** The order the drift follows: the places' while the shell's frame is
 *  drawn (`<html data-luca-frame>`), the rail's otherwise. */
export function navOrder(framed: boolean): NavOrder {
  return framed ? PLACES_ORDER : RAIL_ORDER;
}

/** Route prefixes that read as a detail surface below their section. */
const DETAIL_PREFIXES = ["/channels/", "/projects/", "/workflows/"];

function railIndex(pathname: string, order: NavOrder): number | null {
  if (pathname === "/") return order.home;
  for (const [prefix, index] of order.sections) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return index;
  }
  return null;
}

function isDetail(pathname: string): boolean {
  return DETAIL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export type NavMotion =
  | "up"
  | "down"
  | "deeper"
  | "shallower"
  | "same"
  | "swap";

export function resolveNavMotion(
  from: string,
  to: string,
  order: NavOrder = RAIL_ORDER,
): NavMotion {
  if (from === to) return "same";
  const a = railIndex(from, order);
  const b = railIndex(to, order);
  // Two places apart: the drift follows the order, whatever page either end
  // is. Only an order that seats details in a place (the places column)
  // reaches here with a detail at one end.
  if (a !== null && b !== null && a !== b) return b > a ? "down" : "up";
  const fromDetail = isDetail(from);
  const toDetail = isDetail(to);
  if (toDetail && !fromDetail) return "deeper";
  if (fromDetail && !toDetail) return "shallower";
  // Sibling conversations stay quiet — and quiet means motionless, not a
  // softer crossfade. The frame, the header and the composer are the same
  // two objects before and after; only the timeline is different, so
  // fading the whole plane dissolves furniture that never moved. This
  // used to resolve to "swap", which is the plain crossfade.
  if (fromDetail && toDetail) return "same";
  return "swap";
}

/** The rare flourish: entering Brain dissolves in through the dot lattice. */
function wantsDissolve(from: string, to: string): boolean {
  return to.startsWith("/brain") && !from.startsWith("/brain");
}

let clearTimer: number | null = null;

function stamp(from: string, to: string) {
  const root = document.documentElement;
  root.dataset.navMotion = resolveNavMotion(
    from,
    to,
    navOrder(root.hasAttribute("data-luca-frame")),
  );
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
    // A same-path navigation (search params, a redirect) resolves to "same"
    // and goes through `stamp` like any other, so it also arms the clear
    // timer: stamping it by hand left the attribute for an earlier
    // navigation's timer to delete mid-transition, which handed the plane
    // back its animation halfway through.
    stamp(from, to);
  });
}
