import * as React from "react";

import { forgetDraft } from "./drafts";
import { useWindowVisible } from "./useMnemosSession";

/**
 * Unsent corrections of shared rows (WP-49 review, item 7). A shared row's
 * words aren't the person's own, so an unsent correction of one is kept
 * only while the place is in view: it goes when the place is left or the
 * window is hidden. What the person writes to add to the shared notebook is
 * their own, and stays kept like every other draft (`drafts.ts`).
 */
const corrections = new Set<string>();

/** Marks a draft key as a correction of a shared row, and gives it back. */
export function correctionDraft(key: string): string {
  corrections.add(key);
  return key;
}

/** Drops every unsent correction of a shared row. */
export function dropCorrections() {
  for (const key of corrections) forgetDraft(key);
  corrections.clear();
}

/**
 * Drops them when the window hides and when the place is left. Called by
 * the place's own rail head, which is there exactly while the place is.
 */
export function useDropCorrectionsOnLeave() {
  const visible = useWindowVisible();
  React.useEffect(() => {
    if (!visible) dropCorrections();
  }, [visible]);
  React.useEffect(() => dropCorrections, []);
}
