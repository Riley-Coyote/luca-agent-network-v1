import * as React from "react";

/**
 * Which resident's column is open beside the rail, if any.
 *
 * Module state rather than sidebar-local state because two trees care: the
 * rail (which opens it) and the conversation card (which must not stack the
 * project room panel beside it). The second column is whichever the owner
 * chose — an agent or a project — never both.
 */
let selectedAgentPubkey: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getSelectedAgentPubkey(): string | null {
  return selectedAgentPubkey;
}

export function setSelectedAgentPubkey(pubkey: string | null): void {
  const next = pubkey ? pubkey.toLowerCase() : null;
  if (next === selectedAgentPubkey) return;
  selectedAgentPubkey = next;
  emit();
}

/** Choosing the open agent again closes the column. */
export function toggleSelectedAgentPubkey(pubkey: string): void {
  const next = pubkey.toLowerCase();
  setSelectedAgentPubkey(next === selectedAgentPubkey ? null : next);
}

/** Community switch: the column belongs to the home it was opened in. */
export function resetAgentColumnStore(): void {
  setSelectedAgentPubkey(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelectedAgentPubkey(): string | null {
  return React.useSyncExternalStore(
    subscribe,
    getSelectedAgentPubkey,
    () => null,
  );
}

/**
 * Whether a resident's column is open — watched only while it can matter to
 * the caller. With `enabled` false the snapshot is a constant, so a surface
 * that has nothing to step aside for never re-renders on a toggle.
 */
export function useAgentColumnOpen(enabled: boolean): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => enabled && selectedAgentPubkey !== null,
    () => false,
  );
}
