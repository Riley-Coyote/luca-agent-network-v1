import * as React from "react";

import type {
  ManagedConversationActivity,
  ManagedPresentationDisplayPhase,
  ManagedPresentationTurn,
  ManagedResidentActivity,
  ManagedTurnActivityStep,
} from "@/features/messages/managedPresentationTypes";

export const MANAGED_TERMINAL_ACTIVITY_MS = 4_000;

type ActivityCandidate = ManagedResidentActivity & {
  conversationId: string;
  creationOrdinal: number;
};

const candidates = new Map<string, ActivityCandidate>();
const terminalExpiresAt = new Map<string, number>();
const retiredTerminalKeys = new Set<string>();
const snapshots = new Map<string, ManagedConversationActivity>();
const listeners = new Map<string, Set<() => void>>();
const EMPTY_ACTIVITY: ManagedConversationActivity = new Map();

function isTerminalPhase(phase: ManagedPresentationDisplayPhase): boolean {
  return (
    phase === "stopped" || phase === "failed" || phase === "needs_attention"
  );
}

/**
 * Only a *stopped* turn is allowed to fade on its own.
 *
 * The owner pressed Stop, so they already know what happened, and the stopped
 * response text stays in the timeline regardless — nothing is lost when the
 * line goes. "failed" and "needs_attention" are the opposite case: the owner
 * may not have been looking, the runtime no longer re-queues a failed turn on
 * its own, and Retry renders in this shelf and nowhere else. A four-second
 * window would make a failure unrecoverable unless it was witnessed, so those
 * two stay until the owner retries or dismisses them.
 */
function isBriefTerminal(phase: ManagedPresentationDisplayPhase): boolean {
  return phase === "stopped";
}

/**
 * The single authority on how long a terminal line lingers. Producers ask for
 * an expiry; this decides whether the phase is one that may have one at all.
 */
export function managedTerminalActivityUntil(
  phase: ManagedPresentationDisplayPhase,
  now: number,
): number | undefined {
  return isBriefTerminal(phase)
    ? now + MANAGED_TERMINAL_ACTIVITY_MS
    : undefined;
}

/**
 * A run whose signed answer already landed, kept for its work summary alone.
 * Terminal outcomes are never "settled" — they are unfinished business.
 */
function isSettled(turn: ManagedPresentationTurn): boolean {
  return (
    turn.finalMessageId !== null &&
    !isTerminalPhase(turn.phase) &&
    turn.activitySteps.length > 0
  );
}

/**
 * Signed finals normally take their indicator away with them — the answer is
 * the better signal. A run that narrated real work keeps a collapsed summary
 * instead, so the history of what was done survives the arrival of the answer.
 */
function shouldOmitSignedFinal(turn: ManagedPresentationTurn): boolean {
  return (
    turn.finalMessageId !== null &&
    !isTerminalPhase(turn.phase) &&
    !isSettled(turn)
  );
}

/** Only a live turn may claim a resident's slot ahead of a finished one. */
function activeCandidate(candidate: ActivityCandidate): boolean {
  return !isTerminalPhase(candidate.phase) && !candidate.settled;
}

/** Cheap content signature: step lines change far more often than they appear. */
function stepsSignature(steps: readonly ManagedTurnActivityStep[]): string {
  return steps
    .map(
      (step) =>
        `${step.step}|${step.kind}|${step.status}|${step.count ?? ""}|${step.label}|${step.detail ?? ""}`,
    )
    .join("\u0000");
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
      activity.failure === rightActivity.failure &&
      activity.settled === rightActivity.settled &&
      activity.startedAt === rightActivity.startedAt &&
      activity.steps.length === rightActivity.steps.length &&
      stepsSignature(activity.steps) === stepsSignature(rightActivity.steps)
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
      settled: candidate.settled,
      startedAt: candidate.startedAt,
      steps: candidate.steps,
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
 * A resident's fresh turn answers whatever its last one left open. Dropping the
 * older finished candidate here is what stops a retried failure — or a settled
 * work summary — from reappearing the moment the new turn's own line leaves.
 */
function supersedeFinishedCandidates(next: ActivityCandidate): void {
  for (const [uiKey, candidate] of candidates) {
    if (
      uiKey === next.uiKey ||
      candidate.conversationId !== next.conversationId ||
      candidate.residentPubkey !== next.residentPubkey ||
      candidate.creationOrdinal >= next.creationOrdinal ||
      activeCandidate(candidate)
    ) {
      continue;
    }
    candidates.delete(uiKey);
    terminalExpiresAt.delete(uiKey);
    retiredTerminalKeys.delete(uiKey);
  }
}

/**
 * Updates only body-free activity state. Signed finals leave immediately unless
 * they carry a work summary; stopped turns linger briefly; failed and
 * needs-attention turns stay until the owner retries or dismisses them.
 */
export function upsertManagedPresentationActivity(
  turn: ManagedPresentationTurn,
  creationOrdinal: number,
  terminalUntil?: number,
): void {
  const terminal = isTerminalPhase(turn.phase);
  const settled = isSettled(turn);
  if (!terminal) {
    terminalExpiresAt.delete(turn.uiKey);
    if (!settled) retiredTerminalKeys.delete(turn.uiKey);
  } else if (terminalUntil !== undefined && isBriefTerminal(turn.phase)) {
    terminalExpiresAt.set(turn.uiKey, terminalUntil);
    retiredTerminalKeys.delete(turn.uiKey);
  } else {
    // A persistent outcome outranks any expiry a producer asked for.
    terminalExpiresAt.delete(turn.uiKey);
  }
  if (shouldOmitSignedFinal(turn)) {
    removeManagedPresentationActivity(turn.uiKey, turn.conversationId);
    return;
  }
  if ((terminal || settled) && retiredTerminalKeys.has(turn.uiKey)) {
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
    settled,
    startedAt: turn.startedAt,
    steps: turn.activitySteps,
    uiKey: turn.uiKey,
  };
  if (
    previous?.conversationId === next.conversationId &&
    previous.creationOrdinal === next.creationOrdinal &&
    previous.failure === next.failure &&
    previous.phase === next.phase &&
    previous.residentPubkey === next.residentPubkey &&
    previous.settled === next.settled &&
    previous.startedAt === next.startedAt &&
    previous.steps === next.steps
  ) {
    return;
  }
  candidates.set(turn.uiKey, next);
  if (activeCandidate(next)) supersedeFinishedCandidates(next);
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
  if (!preserveTerminalSuppression) retiredTerminalKeys.delete(uiKey);
  if (previous) rebuildConversation(previous.conversationId);
  else if (knownConversationId) rebuildConversation(knownConversationId);
}

/**
 * The owner has seen this outcome and does not want to act on it. Dismissal is
 * latched: a late republication of the same finished turn must not bring the
 * line back after the owner has closed it.
 */
export function dismissManagedPresentationActivity(
  uiKey: string,
  knownConversationId?: string,
): void {
  const candidate = candidates.get(uiKey);
  if (candidate && activeCandidate(candidate)) return;
  retiredTerminalKeys.add(uiKey);
  removeManagedPresentationActivity(uiKey, knownConversationId, true);
}

export function expireManagedPresentationActivity(now: number): void {
  const changedConversations = new Set<string>();
  for (const [uiKey, expiresAt] of terminalExpiresAt) {
    if (expiresAt > now) continue;
    terminalExpiresAt.delete(uiKey);
    retiredTerminalKeys.add(uiKey);
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
  retiredTerminalKeys.clear();
  snapshots.clear();
  for (const active of activeListeners) {
    for (const listener of active) listener();
  }
}
