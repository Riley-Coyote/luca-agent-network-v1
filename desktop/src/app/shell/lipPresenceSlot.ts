import * as React from "react";

/**
 * THE LIP'S PRESENCE SLOT (Nov 2): the place on the conversation card's axis
 * where the agent of a conversation with one agent stands while the shell's
 * frame is drawn: their circle risen out of the card into the lip, their
 * words under it (ConversationPresence). The lip owns the element and mounts
 * it only with one pane open; the conversation portals its presence into it,
 * so it keeps its own React context. While it holds anything the lip's name
 * steps aside (conversation-presence.css).
 *
 * Only a DOM node the lip mounts, cleared when the lip unmounts: nothing
 * community-scoped is held here.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** The lip's ref callback for its presence slot. */
export function setShellLipPresenceSlot(element: HTMLElement | null) {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}

export function getShellLipPresenceSlot(): HTMLElement | null {
  return slot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverSnapshot = () => null;

/** The slot element while the lip draws it, else null. */
export function useShellLipPresenceSlot(): HTMLElement | null {
  return React.useSyncExternalStore(
    subscribe,
    getShellLipPresenceSlot,
    serverSnapshot,
  );
}
