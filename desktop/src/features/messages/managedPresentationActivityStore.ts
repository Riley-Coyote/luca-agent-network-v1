import * as React from "react";

import type {
  ManagedConversationActivity,
  ManagedPresentationTurn,
  ManagedResidentActivity,
} from "@/features/messages/managedPresentationTypes";

export const MANAGED_TERMINAL_ACTIVITY_MS = 4_000;

type ActivityCandidate = ManagedResidentActivity & {
  conversationId: string;
  creationOrdinal: number;
};

const candidates = new Map<string, ActivityCandidate>();
const terminalExpiresAt = new Map<string, number>();
const expiredTerminalKeys = new Set<string>();
const snapshots = new Map<string, ManagedConversationActivity>();
const listeners = new Map<string, Set<() => void>>();
const EMPTY_ACTIVITY: ManagedConversationActivity = new Map();

function isBriefTerminal(turn: ManagedPresentationTurn): boolean {
  return (
    turn.phase === "stopped" ||
    turn.phase === "failed" ||
    turn.phase === "needs_attention"
  );
}

function shouldOmitSignedFinal(turn: ManagedPresentationTurn): boolean {
  return turn.finalMessageId !== null && !isBriefTerminal(turn);
}

function activeCandidate(candidate: ActivityCandidate): boolean {
  return !["stopped", "failed", "needs_attention"].includes(candidate.phase);
}

function sameActivity(
  left: ManagedConversationActivity,
  right: ManagedConversationActivity,
): boolean {
  if (left.size !== right.size) return false;
  const leftEntries = [...left];
  const rightEntries = [...right];
  return leftEntries.every(([pubkey, activity], index) => {
    const [rightPubkey, rightActivity] = rightEntries[index] ?? [];
    if (!rightActivity) return false;
    return (
      pubkey === rightPubkey &&
      activity.uiKey === rightActivity.uiKey &&
      activity.phase === rightActivity.phase &&
      activity.failure === rightActivity.failure
    );
  });
}

function rebuildConversation(conversationId: string): void {
  const byResident = new Map<string, ActivityCandidate[]>();
  for (const candidate of candidates.values()) {
    if (candidate.conversationId !== conversationId) continue;
    const residentCandidates = byResident.get(candidate.residentPubkey) ?? [];
    residentCandidates.push(candidate);
    byResident.set(candidate.residentPubkey, residentCandidates);
  }
  const selected = [...byResident.values()]
    .map((residentCandidates) => {
      const newestFirst = [...residentCandidates].sort(
        (left, right) => right.creationOrdinal - left.creationOrdinal,
      );
      return newestFirst.find(activeCandidate) ?? newestFirst[0];
    })
    .filter((candidate): candidate is ActivityCandidate => Boolean(candidate))
    .sort((left, right) => left.creationOrdinal - right.creationOrdinal);
  const next = new Map<string, ManagedResidentActivity>();
  for (const candidate of selected) {
    next.set(candidate.residentPubkey, {
      failure: candidate.failure,
      phase: candidate.phase,
      residentPubkey: candidate.residentPubkey,
      uiKey: candidate.uiKey,
    });
  }
  const previous = snapshots.get(conversationId) ?? EMPTY_ACTIVITY;
  if (sameActivity(previous, next)) return;
  snapshots.set(conversationId, next);
  const activeListeners = listeners.get(conversationId);
  if (!activeListeners) return;
  for (const listener of activeListeners) listener();
}

/**
 * Updates only body-free activity state. Signed finals leave immediately;
 * stopped, failed, and needs-attention turns remain for a short acknowledgement
 * window while their retained presentation turns stay available to the timeline.
 */
export function upsertManagedPresentationActivity(
  turn: ManagedPresentationTurn,
  creationOrdinal: number,
  terminalUntil?: number,
): void {
  const terminal = isBriefTerminal(turn);
  if (!terminal) {
    terminalExpiresAt.delete(turn.uiKey);
    expiredTerminalKeys.delete(turn.uiKey);
  } else if (terminalUntil !== undefined) {
    terminalExpiresAt.set(turn.uiKey, terminalUntil);
    expiredTerminalKeys.delete(turn.uiKey);
  }
  if (shouldOmitSignedFinal(turn)) {
    removeManagedPresentationActivity(turn.uiKey, turn.conversationId);
    return;
  }
  if (terminal && expiredTerminalKeys.has(turn.uiKey)) {
    removeManagedPresentationActivity(turn.uiKey, turn.conversationId, true);
    return;
  }
  const previous = candidates.get(turn.uiKey);
  const next: ActivityCandidate = {
    conversationId: turn.conversationId,
    creationOrdinal,
    failure: turn.failure,
    phase: turn.phase,
    residentPubkey: turn.residentPubkey,
    uiKey: turn.uiKey,
  };
  if (
    previous?.conversationId === next.conversationId &&
    previous.creationOrdinal === next.creationOrdinal &&
    previous.failure === next.failure &&
    previous.phase === next.phase &&
    previous.residentPubkey === next.residentPubkey
  ) {
    return;
  }
  candidates.set(turn.uiKey, next);
  if (previous && previous.conversationId !== turn.conversationId) {
    rebuildConversation(previous.conversationId);
  }
  rebuildConversation(turn.conversationId);
}

export function removeManagedPresentationActivity(
  uiKey: string,
  knownConversationId?: string,
  preserveTerminalSuppression = false,
): void {
  const previous = candidates.get(uiKey);
  candidates.delete(uiKey);
  terminalExpiresAt.delete(uiKey);
  if (!preserveTerminalSuppression) expiredTerminalKeys.delete(uiKey);
  if (previous) rebuildConversation(previous.conversationId);
  else if (knownConversationId) rebuildConversation(knownConversationId);
}

export function expireManagedPresentationActivity(now: number): void {
  const changedConversations = new Set<string>();
  for (const [uiKey, expiresAt] of terminalExpiresAt) {
    if (expiresAt > now) continue;
    terminalExpiresAt.delete(uiKey);
    expiredTerminalKeys.add(uiKey);
    const previous = candidates.get(uiKey);
    if (!previous) continue;
    candidates.delete(uiKey);
    changedConversations.add(previous.conversationId);
  }
  for (const conversationId of changedConversations) {
    rebuildConversation(conversationId);
  }
}

export function getNearestManagedPresentationActivityExpiry(): number | null {
  let nearest: number | null = null;
  for (const expiresAt of terminalExpiresAt.values()) {
    if (nearest === null || expiresAt < nearest) nearest = expiresAt;
  }
  return nearest;
}

export function getManagedPresentationActivitySnapshot(
  conversationId: string,
): ManagedConversationActivity {
  return snapshots.get(conversationId) ?? EMPTY_ACTIVITY;
}

export function subscribeManagedPresentationActivity(
  conversationId: string,
  listener: () => void,
): () => void {
  const active = listeners.get(conversationId) ?? new Set<() => void>();
  active.add(listener);
  listeners.set(conversationId, active);
  return () => {
    active.delete(listener);
    if (active.size === 0) listeners.delete(conversationId);
  };
}

export function useManagedPresentationActivitySnapshot(
  conversationId: string | null,
): ManagedConversationActivity {
  const subscribe = React.useCallback(
    (listener: () => void) =>
      conversationId
        ? subscribeManagedPresentationActivity(conversationId, listener)
        : () => undefined,
    [conversationId],
  );
  const getSnapshot = React.useCallback(
    () =>
      conversationId
        ? getManagedPresentationActivitySnapshot(conversationId)
        : EMPTY_ACTIVITY,
    [conversationId],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function resetManagedPresentationActivityStore(): void {
  const activeListeners = [...listeners.values()];
  candidates.clear();
  terminalExpiresAt.clear();
  expiredTerminalKeys.clear();
  snapshots.clear();
  for (const active of activeListeners) {
    for (const listener of active) listener();
  }
}
