import * as React from "react";

/**
 * THE LIP'S RIGHT-HAND SLOT (docs/luca/rail-system/SHELL_SPEC.md, "The
 * conversation's card"; SHELL_BUILD.md, WP-04): the place at the lip's right
 * end, over the conversation's card, where the open conversation's actions
 * stand while the shell's frame is drawn. The lip owns the element; the
 * conversation portals its actions into it, so they keep their own React
 * context (the workspace's layout controls, the right cards).
 *
 * Only a DOM node the lip mounts, cleared when the lip unmounts: nothing
 * community-scoped is held here.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** The lip's ref callback for its right-hand slot. */
export function setShellLipActionsSlot(element: HTMLElement | null) {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}

export function getShellLipActionsSlot(): HTMLElement | null {
  return slot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverSnapshot = () => null;

/** The slot element while the lip is drawn, else null. */
export function useShellLipActionsSlot(): HTMLElement | null {
  return React.useSyncExternalStore(
    subscribe,
    getShellLipActionsSlot,
    serverSnapshot,
  );
}
