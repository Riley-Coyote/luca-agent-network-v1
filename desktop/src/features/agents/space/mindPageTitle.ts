import * as React from "react";

/**
 * The title of the page that slid in over a mind's page (BETA14_RELEASE.md
 * WP-43; Riley's call on the title bar, 2026-10-30): the lip says "{name}"
 * on their page and "{name} · {that page's title}" on every page pushed from
 * it ("Luca · Settings", "Luca · Soul"). The frame writes it from the title
 * it draws; the lip reads it. Community-scoped: reset with the community's
 * other state (resetCommunityState).
 */

type MindPageTitle = { pubkey: string; title: string } | null;

let current: MindPageTitle = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setMindPageTitle(next: MindPageTitle): void {
  const same =
    (current === null && next === null) ||
    (current !== null &&
      next !== null &&
      current.pubkey === next.pubkey.toLowerCase() &&
      current.title === next.title);
  if (same) return;
  current = next
    ? { pubkey: next.pubkey.toLowerCase(), title: next.title }
    : null;
  emit();
}

export function mindPageTitle(): MindPageTitle {
  return current;
}

export function subscribeMindPageTitle(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The pushed page's title for this mind, or null on their own page. */
export function useMindPageTitle(pubkey: string | null): string | null {
  const value = React.useSyncExternalStore(
    subscribeMindPageTitle,
    mindPageTitle,
    () => null,
  );
  if (!value || !pubkey || value.pubkey !== pubkey.toLowerCase()) return null;
  return value.title;
}

/** Community-switch reset (see resetCommunityState in useCommunityInit). */
export function resetMindPageTitle(): void {
  current = null;
  emit();
}
