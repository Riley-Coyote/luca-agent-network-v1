import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ManagedResponseSurface } from "@/features/messages/lib/managedAudience";
import {
  expireManagedPresentationActivity,
  getNearestManagedPresentationActivityExpiry,
  MANAGED_TERMINAL_ACTIVITY_MS,
  removeManagedPresentationActivity,
  resetManagedPresentationActivityStore,
  upsertManagedPresentationActivity,
} from "@/features/messages/managedPresentationActivityStore";
import {
  managedPresentationDrainQuota,
  segmentManagedPresentationText,
} from "@/features/messages/managedPresentationGraphemes";
import {
  MANAGED_PRESENTATION_EVENT,
  MANAGED_TERMINAL_DRAIN_TARGET_MS,
  MANAGED_TURN_LIVENESS_MS,
  MANAGED_TURN_START_TIMEOUT_MS,
  MAX_MANAGED_PRESENTATION_ROWS,
  validManagedPresentationChunk,
  validManagedPresentationFrame,
  withinManagedPresentationPublicTextLimit,
} from "@/features/messages/managedPresentationProtocol";
import { classifyManagedFinalReconciliation } from "@/features/messages/managedPresentationReconciliation";
import { ManagedPresentationScheduler } from "@/features/messages/managedPresentationScheduler";
import {
  managedPresentationUiKey,
  type ManagedPresentationDisplayPhase,
  type ManagedPresentationRow,
  type ManagedPresentationTurn,
  type ManagedResponseSlot,
  type RawManagedPresentationFrame,
} from "@/features/messages/managedPresentationTypes";

export type { ManagedPresentationRow } from "@/features/messages/managedPresentationTypes";

const turns = new Map<string, ManagedPresentationTurn>();
const pendingGraphemes = new Map<string, string[]>();
const terminalDrainDeadlines = new Map<string, number>();
const lookupToUiKey = new Map<string, string>();
const creationOrdinals = new Map<string, number>();
const terminalUiKeys = new Set<string>();
const completedLookupKeys = new Set<string>();
const terminalFrameLookupKeys = new Set<string>();
const nextSlotOrdinal = new Map<string, number>();
const stagedTurnUiKeys = new Set<string>();
const stagedLegacyConversationIds = new Set<string>();
const stagedTopologyConversationIds = new Set<string>();
const stagedTerminalActivityUntil = new Map<string, number>();
const turnListeners = new Map<string, Set<() => void>>();
const topologyListeners = new Map<string, Set<() => void>>();
const legacyListeners = new Map<string, Set<() => void>>();
const turnKeySnapshots = new Map<string, readonly string[]>();
const responseSlotSnapshots = new Map<string, readonly ManagedResponseSlot[]>();
const legacySnapshots = new Map<string, readonly ManagedPresentationRow[]>();
const EMPTY_KEYS: readonly string[] = [];
const EMPTY_SLOTS: readonly ManagedResponseSlot[] = [];
const EMPTY_LEGACY: readonly ManagedPresentationRow[] = [];

let unlisten: UnlistenFn | null = null;
let listenerPromise: Promise<void> | null = null;
let creationCounter = 0;
let paintCommitCount = 0;
let legacySnapshotRebuildCount = 0;
let stagedActivityExpiryAt: number | null = null;
const scheduler = new ManagedPresentationScheduler(
  flushManagedPresentationPublications,
);

function lookupKey(residentPubkey: string, receiptId: string): string {
  return `${residentPubkey.toLowerCase()}:${receiptId}`;
}
function addBoundedLookupKey(target: Set<string>, key: string): void {
  target.add(key);
  if (target.size <= MAX_MANAGED_PRESENTATION_ROWS) return;
  const oldest = target.values().next().value;
  if (typeof oldest === "string") target.delete(oldest);
}
function createTurn(
  conversationId: string,
  receiptId: string,
  residentPubkey: string,
  responseSurface: ManagedResponseSurface,
): ManagedPresentationTurn {
  const normalizedPubkey = residentPubkey.toLowerCase();
  const now = Date.now();
  return {
    anchorKey: null,
    anchorAt: 0,
    bufferedText: "",
    conversationId,
    deadlineAt: now + MANAGED_TURN_START_TIMEOUT_MS,
    dispatchReceiptId: receiptId,
    durableReceiptId: null,
    failure: null,
    finalMessageId: null,
    finalReconciliation: null,
    lastFrameAt: now,
    phase: "thinking",
    receivedText: "",
    residentPubkey: normalizedPubkey,
    responseSurface,
    sequence: 0,
    sessionEpoch: 0,
    signedText: null,
    slotOrdinal: null,
    turnId: `pending:${receiptId}:${normalizedPubkey}`,
    uiKey: managedPresentationUiKey(normalizedPubkey, receiptId),
    visibleText: "",
  };
}
function ensureCapacity(): void {
  if (turns.size < MAX_MANAGED_PRESENTATION_ROWS) return;
  const oldestTerminal = [...turns.keys()].find((key) =>
    terminalUiKeys.has(key),
  );
  const oldest = oldestTerminal ?? turns.keys().next().value;
  if (typeof oldest === "string") removeTurn(oldest);
}
function registerTurn(turn: ManagedPresentationTurn): void {
  ensureCapacity();
  turns.set(turn.uiKey, turn);
  creationOrdinals.set(turn.uiKey, creationCounter++);
  upsertManagedPresentationActivity(
    turn,
    creationOrdinals.get(turn.uiKey) ?? 0,
  );
  lookupToUiKey.set(
    lookupKey(turn.residentPubkey, turn.dispatchReceiptId),
    turn.uiKey,
  );
  rebuildConversationTopology(turn.conversationId);
  rebuildLegacySnapshot(turn.conversationId);
  notifyLegacy(turn.conversationId);
  scheduleNearestDeadline();
}
function activateResponseSlot(
  turn: ManagedPresentationTurn,
  now: number,
): ManagedPresentationTurn {
  if (turn.slotOrdinal !== null) return turn;
  const ordinal = nextSlotOrdinal.get(turn.conversationId) ?? 0;
  nextSlotOrdinal.set(turn.conversationId, ordinal + 1);
  return {
    ...turn,
    anchorAt: now,
    anchorKey: turn.durableReceiptId ?? turn.dispatchReceiptId,
    slotOrdinal: ordinal,
  };
}

function activateTerminalResponseSlot(
  turn: ManagedPresentationTurn,
  now: number,
): ManagedPresentationTurn {
  if (turn.slotOrdinal !== null || turn.visibleText.length === 0) return turn;
  return activateResponseSlot(turn, now);
}
function legacyPhase(
  phase: ManagedPresentationDisplayPhase,
): ManagedPresentationRow["phase"] {
  if (phase === "stopped" || phase === "stopping") return "cancelled";
  if (phase === "needs_attention") return "failed";
  return phase;
}
function toLegacyRow(turn: ManagedPresentationTurn): ManagedPresentationRow {
  return {
    anchorAt: turn.anchorAt || turn.lastFrameAt,
    conversationId: turn.conversationId,
    dispatchReceiptId: turn.dispatchReceiptId,
    failure: turn.failure,
    finalMessageId: turn.finalMessageId,
    phase: legacyPhase(turn.phase),
    publicText: turn.visibleText,
    residentPubkey: turn.residentPubkey,
    sequence: turn.sequence,
    sessionEpoch: turn.sessionEpoch,
    turnId: turn.turnId,
  };
}
function responseSlot(
  turn: ManagedPresentationTurn,
): ManagedResponseSlot | null {
  if (turn.slotOrdinal === null) return null;
  return {
    anchorAt: turn.anchorAt,
    anchorKey: turn.anchorKey,
    conversationId: turn.conversationId,
    finalMessageId: turn.finalMessageId,
    residentPubkey: turn.residentPubkey,
    responseSurface: turn.responseSurface,
    slotOrdinal: turn.slotOrdinal,
    uiKey: turn.uiKey,
  };
}

function turnsForConversation(
  conversationId: string,
): ManagedPresentationTurn[] {
  return [...turns.values()]
    .filter((turn) => turn.conversationId === conversationId)
    .sort(
      (left, right) =>
        (creationOrdinals.get(left.uiKey) ?? 0) -
        (creationOrdinals.get(right.uiKey) ?? 0),
    );
}

function rebuildConversationTopology(conversationId: string): void {
  const conversationTurns = turnsForConversation(conversationId);
  turnKeySnapshots.set(
    conversationId,
    conversationTurns.map((turn) => turn.uiKey),
  );
  responseSlotSnapshots.set(
    conversationId,
    conversationTurns
      .map(responseSlot)
      .filter((slot): slot is ManagedResponseSlot => slot !== null)
      .sort((left, right) => left.slotOrdinal - right.slotOrdinal),
  );
  notifyListeners(topologyListeners.get(conversationId));
}

function rebuildLegacySnapshot(conversationId: string): void {
  legacySnapshotRebuildCount += 1;
  legacySnapshots.set(
    conversationId,
    turnsForConversation(conversationId).map(toLegacyRow),
  );
}

function notifyListeners(active: Set<() => void> | undefined): void {
  if (!active) return;
  for (const listener of active) listener();
}

function notifyTurn(uiKey: string): void {
  notifyListeners(turnListeners.get(uiKey));
}

function notifyLegacy(conversationId: string): void {
  notifyListeners(legacyListeners.get(conversationId));
}

function publishTurn(
  turn: ManagedPresentationTurn,
  topologyChanged = false,
  terminalActivityUntil?: number,
): void {
  turns.set(turn.uiKey, turn);
  upsertManagedPresentationActivity(
    turn,
    creationOrdinals.get(turn.uiKey) ?? 0,
    terminalActivityUntil,
  );
  notifyTurn(turn.uiKey);
  rebuildLegacySnapshot(turn.conversationId);
  notifyLegacy(turn.conversationId);
  if (topologyChanged) rebuildConversationTopology(turn.conversationId);
}

function stageTurnPublication(
  turn: ManagedPresentationTurn,
  topologyChanged = false,
  terminalActivityUntil?: number,
): void {
  turns.set(turn.uiKey, turn);
  stagedTurnUiKeys.add(turn.uiKey);
  stagedLegacyConversationIds.add(turn.conversationId);
  if (topologyChanged) stagedTopologyConversationIds.add(turn.conversationId);
  if (terminalActivityUntil !== undefined) {
    stagedTerminalActivityUntil.set(turn.uiKey, terminalActivityUntil);
  }
  scheduler.requestPaint();
}

function hasStagedPublications(): boolean {
  return (
    stagedTurnUiKeys.size > 0 ||
    stagedLegacyConversationIds.size > 0 ||
    stagedTopologyConversationIds.size > 0 ||
    stagedActivityExpiryAt !== null
  );
}

function terminalDrainQuota(
  uiKey: string,
  backlog: number,
  now: number,
): number {
  const base = managedPresentationDrainQuota(backlog);
  const deadline = terminalDrainDeadlines.get(uiKey);
  if (deadline === undefined) return base;
  const remainingTicks = Math.max(1, Math.ceil((deadline - now) / 40));
  return Math.max(base, Math.ceil(backlog / remainingTicks));
}

function flushManagedPresentationPublications(now: number): boolean {
  if (pendingGraphemes.size === 0 && !hasStagedPublications()) return false;
  paintCommitCount += 1;
  for (const [uiKey, backlog] of pendingGraphemes) {
    const current = turns.get(uiKey);
    if (!current || backlog.length === 0) {
      pendingGraphemes.delete(uiKey);
      terminalDrainDeadlines.delete(uiKey);
      continue;
    }
    const quota = terminalDrainQuota(uiKey, backlog.length, now);
    const reveal = backlog.splice(0, quota).join("");
    let next: ManagedPresentationTurn = {
      ...current,
      bufferedText: backlog.join(""),
      visibleText: current.visibleText + reveal,
    };
    if (reveal && next.slotOrdinal === null) {
      next = activateResponseSlot(next, Date.now());
      stagedTopologyConversationIds.add(next.conversationId);
    }
    turns.set(uiKey, next);
    stagedTurnUiKeys.add(uiKey);
    stagedLegacyConversationIds.add(next.conversationId);
    if (backlog.length === 0) {
      pendingGraphemes.delete(uiKey);
      terminalDrainDeadlines.delete(uiKey);
    }
  }

  const turnUiKeys = [...stagedTurnUiKeys];
  const legacyConversationIds = [...stagedLegacyConversationIds];
  const topologyConversationIds = [...stagedTopologyConversationIds];
  const terminalActivityUntil = new Map(stagedTerminalActivityUntil);
  const activityExpiryAt = stagedActivityExpiryAt;
  stagedTurnUiKeys.clear();
  stagedLegacyConversationIds.clear();
  stagedTopologyConversationIds.clear();
  stagedTerminalActivityUntil.clear();
  stagedActivityExpiryAt = null;

  for (const uiKey of turnUiKeys) {
    const turn = turns.get(uiKey);
    if (!turn) continue;
    upsertManagedPresentationActivity(
      turn,
      creationOrdinals.get(uiKey) ?? 0,
      terminalActivityUntil.get(uiKey),
    );
  }
  if (activityExpiryAt !== null) {
    expireManagedPresentationActivity(activityExpiryAt);
  }
  for (const uiKey of turnUiKeys) notifyTurn(uiKey);
  for (const conversationId of legacyConversationIds) {
    rebuildLegacySnapshot(conversationId);
    notifyLegacy(conversationId);
  }
  for (const conversationId of topologyConversationIds) {
    rebuildConversationTopology(conversationId);
  }
  scheduleNearestDeadline();
  return pendingGraphemes.size > 0 || hasStagedPublications();
}

function scheduleNearestDeadline(): void {
  let nearest = getNearestManagedPresentationActivityExpiry();
  for (const turn of turns.values()) {
    if (turn.deadlineAt === null) continue;
    if (nearest === null || turn.deadlineAt < nearest)
      nearest = turn.deadlineAt;
  }
  scheduler.setNearestDeadline(
    nearest,
    nearest === null ? null : processDeadlines,
  );
}

function processDeadlines(now = Date.now()): void {
  stagedActivityExpiryAt = Math.max(stagedActivityExpiryAt ?? now, now);
  for (const current of turns.values()) {
    if (current.deadlineAt === null || current.deadlineAt > now) continue;
    const next = activateTerminalResponseSlot(
      {
        ...current,
        deadlineAt: null,
        failure: current.sessionEpoch === 0 ? "unavailable" : current.failure,
        phase: "needs_attention",
      },
      now,
    );
    stageTurnPublication(
      next,
      current.slotOrdinal === null && next.slotOrdinal !== null,
      now + MANAGED_TERMINAL_ACTIVITY_MS,
    );
  }
  scheduler.requestPaint();
}

function clearPending(uiKey: string): void {
  pendingGraphemes.delete(uiKey);
  terminalDrainDeadlines.delete(uiKey);
}

function markTerminalFrame(key: string, uiKey: string): void {
  addBoundedLookupKey(terminalFrameLookupKeys, key);
  terminalUiKeys.add(uiKey);
}

function removeTurn(uiKey: string): void {
  const current = turns.get(uiKey);
  if (!current) return;
  turns.delete(uiKey);
  clearPending(uiKey);
  creationOrdinals.delete(uiKey);
  terminalUiKeys.delete(uiKey);
  removeManagedPresentationActivity(uiKey, current.conversationId);
  for (const [key, value] of lookupToUiKey) {
    if (value === uiKey) lookupToUiKey.delete(key);
  }
  notifyTurn(uiKey);
  rebuildConversationTopology(current.conversationId);
  rebuildLegacySnapshot(current.conversationId);
  notifyLegacy(current.conversationId);
  scheduleNearestDeadline();
}

function ingestPublicChunk(
  turn: ManagedPresentationTurn,
  chunk: string,
): ManagedPresentationTurn | null {
  if (!validManagedPresentationChunk(chunk)) return null;
  const receivedText = turn.receivedText + chunk;
  if (!withinManagedPresentationPublicTextLimit(receivedText)) return null;
  const graphemes = pendingGraphemes.get(turn.uiKey) ?? [];
  graphemes.push(...segmentManagedPresentationText(chunk));
  pendingGraphemes.set(turn.uiKey, graphemes);
  scheduler.requestPaint();
  return {
    ...turn,
    bufferedText: turn.bufferedText + chunk,
    phase: "writing",
    receivedText,
  };
}

function frameBase(
  current: ManagedPresentationTurn,
  frame: RawManagedPresentationFrame,
): ManagedPresentationTurn {
  const now = Date.now();
  return {
    ...current,
    conversationId: frame.conversation_id,
    deadlineAt: now + MANAGED_TURN_LIVENESS_MS,
    dispatchReceiptId: frame.dispatch_receipt_id,
    durableReceiptId: frame.dispatch_receipt_id,
    lastFrameAt: now,
    residentPubkey: frame.resident_pubkey,
    sequence: frame.sequence,
    sessionEpoch: frame.session_epoch,
    turnId: frame.turn_id,
  };
}

export function ingestManagedPresentationFrame(frameValue: unknown): void {
  if (!validManagedPresentationFrame(frameValue)) return;
  const frame = frameValue;
  const frameLookupKey = lookupKey(
    frame.resident_pubkey,
    frame.dispatch_receipt_id,
  );
  if (
    completedLookupKeys.has(frameLookupKey) ||
    terminalFrameLookupKeys.has(frameLookupKey)
  ) {
    return;
  }
  const uiKey = lookupToUiKey.get(frameLookupKey);
  const current = uiKey ? turns.get(uiKey) : undefined;
  if (!current) return;
  if (
    current.sessionEpoch === 0
      ? frame.sequence !== 1
      : current.sessionEpoch !== frame.session_epoch ||
        frame.sequence !== current.sequence + 1 ||
        current.turnId !== frame.turn_id ||
        current.conversationId !== frame.conversation_id
  ) {
    return;
  }

  let next = frameBase(current, frame);
  let topologyChanged = false;
  switch (frame.kind) {
    case "turn_started":
      next = { ...next, failure: null, phase: "thinking" };
      break;
    case "phase":
      if (!frame.phase) return;
      next = { ...next, failure: null, phase: frame.phase };
      break;
    case "public_chunk": {
      const withChunk = ingestPublicChunk(next, frame.public_chunk ?? "");
      if (!withChunk) return;
      next = withChunk;
      break;
    }
    case "completed":
      next = { ...next, deadlineAt: null, phase: "finalizing" };
      terminalDrainDeadlines.set(
        next.uiKey,
        Date.now() + MANAGED_TERMINAL_DRAIN_TARGET_MS,
      );
      if (pendingGraphemes.has(next.uiKey)) scheduler.requestPaint();
      markTerminalFrame(frameLookupKey, next.uiKey);
      break;
    case "cancelled":
      clearPending(next.uiKey);
      next = activateTerminalResponseSlot(
        {
          ...next,
          bufferedText: "",
          deadlineAt: null,
          phase: "stopped",
          receivedText: next.visibleText,
        },
        Date.now(),
      );
      topologyChanged =
        current.slotOrdinal === null && next.slotOrdinal !== null;
      markTerminalFrame(frameLookupKey, next.uiKey);
      break;
    case "failed":
      clearPending(next.uiKey);
      next = activateTerminalResponseSlot(
        {
          ...next,
          bufferedText: "",
          deadlineAt: null,
          failure: frame.failure ?? "runtime",
          phase: "failed",
          receivedText: next.visibleText,
        },
        Date.now(),
      );
      topologyChanged =
        current.slotOrdinal === null && next.slotOrdinal !== null;
      markTerminalFrame(frameLookupKey, next.uiKey);
      break;
  }
  stageTurnPublication(
    next,
    topologyChanged,
    ["stopped", "failed"].includes(next.phase)
      ? Date.now() + MANAGED_TERMINAL_ACTIVITY_MS
      : undefined,
  );
  scheduleNearestDeadline();
}

export async function ensureManagedPresentationListener(): Promise<void> {
  if (unlisten || listenerPromise) return listenerPromise ?? Promise.resolve();
  listenerPromise = listen<RawManagedPresentationFrame>(
    MANAGED_PRESENTATION_EVENT,
    (event) => ingestManagedPresentationFrame(event.payload),
  )
    .then((dispose) => {
      unlisten = dispose;
    })
    .catch(() => {
      listenerPromise = null;
    });
  return listenerPromise;
}

export function seedManagedPresentations(
  conversationId: string,
  dispatchReceiptId: string,
  residentPubkeys: readonly string[],
  responseSurface: ManagedResponseSurface = "timeline",
): void {
  void ensureManagedPresentationListener();
  for (const pubkey of residentPubkeys) {
    const residentPubkey = pubkey.toLowerCase();
    const key = lookupKey(residentPubkey, dispatchReceiptId);
    if (lookupToUiKey.has(key) || completedLookupKeys.has(key)) continue;
    registerTurn(
      createTurn(
        conversationId,
        dispatchReceiptId,
        residentPubkey,
        responseSurface,
      ),
    );
  }
}

function mergeReceiptRace(
  optimisticUiKey: string,
  authenticatedUiKey: string,
  receiptId: string,
): void {
  const optimistic = turns.get(optimisticUiKey);
  const authenticated = turns.get(authenticatedUiKey);
  if (!optimistic || !authenticated) return;
  const merged: ManagedPresentationTurn = {
    ...authenticated,
    anchorAt:
      authenticated.slotOrdinal !== null
        ? authenticated.anchorAt
        : optimistic.anchorAt,
    anchorKey:
      authenticated.slotOrdinal !== null
        ? authenticated.anchorKey
        : optimistic.anchorKey,
    dispatchReceiptId: receiptId,
    durableReceiptId: receiptId,
    responseSurface: optimistic.responseSurface,
    slotOrdinal: authenticated.slotOrdinal ?? optimistic.slotOrdinal,
    uiKey: optimisticUiKey,
  };
  const authenticatedPending = pendingGraphemes.get(authenticatedUiKey);
  const authenticatedDrainDeadline =
    terminalDrainDeadlines.get(authenticatedUiKey);
  turns.delete(authenticatedUiKey);
  turns.set(optimisticUiKey, merged);
  if (authenticatedPending) {
    pendingGraphemes.set(optimisticUiKey, authenticatedPending);
  }
  clearPending(authenticatedUiKey);
  if (authenticatedDrainDeadline !== undefined) {
    terminalDrainDeadlines.set(optimisticUiKey, authenticatedDrainDeadline);
  }
  creationOrdinals.delete(authenticatedUiKey);
  removeManagedPresentationActivity(
    authenticatedUiKey,
    authenticated.conversationId,
  );
  if (terminalUiKeys.delete(authenticatedUiKey)) {
    terminalUiKeys.add(optimisticUiKey);
  }
  for (const [key, value] of lookupToUiKey) {
    if (value === authenticatedUiKey) lookupToUiKey.set(key, optimisticUiKey);
  }
  lookupToUiKey.set(
    lookupKey(merged.residentPubkey, receiptId),
    optimisticUiKey,
  );
  notifyTurn(authenticatedUiKey);
  notifyTurn(optimisticUiKey);
  upsertManagedPresentationActivity(
    merged,
    creationOrdinals.get(optimisticUiKey) ?? 0,
    ["stopped", "failed", "needs_attention"].includes(merged.phase)
      ? Date.now() + MANAGED_TERMINAL_ACTIVITY_MS
      : undefined,
  );
  rebuildConversationTopology(merged.conversationId);
  rebuildLegacySnapshot(merged.conversationId);
  notifyLegacy(merged.conversationId);
}

export function replaceManagedPresentationReceipt(
  previousReceiptId: string,
  receiptId: string,
): void {
  const candidates = [...turns.values()].filter(
    (turn) => turn.dispatchReceiptId === previousReceiptId,
  );
  for (const current of candidates) {
    const previousKey = lookupKey(current.residentPubkey, previousReceiptId);
    const nextKey = lookupKey(current.residentPubkey, receiptId);
    const authenticatedUiKey = lookupToUiKey.get(nextKey);
    if (authenticatedUiKey && authenticatedUiKey !== current.uiKey) {
      mergeReceiptRace(current.uiKey, authenticatedUiKey, receiptId);
      continue;
    }
    const next = {
      ...current,
      anchorKey: current.slotOrdinal === null ? null : receiptId,
      dispatchReceiptId: receiptId,
      durableReceiptId: receiptId,
    };
    turns.set(current.uiKey, next);
    lookupToUiKey.set(previousKey, current.uiKey);
    lookupToUiKey.set(nextKey, current.uiKey);
    publishTurn(next, current.slotOrdinal !== null);
  }
  scheduleNearestDeadline();
}

function findTurnForFinal(
  residentPubkey: string,
  dispatchReceiptId: string,
  conversationId?: string | null,
): ManagedPresentationTurn | null {
  const normalizedPubkey = residentPubkey.toLowerCase();
  const directUiKey = lookupToUiKey.get(
    lookupKey(normalizedPubkey, dispatchReceiptId),
  );
  if (!directUiKey) return null;
  const turn = turns.get(directUiKey) ?? null;
  if (conversationId && turn?.conversationId !== conversationId) return null;
  return turn;
}

export function reconcileManagedPresentationFinal(
  residentPubkey: string | null | undefined,
  dispatchReceiptId: string | null | undefined,
  conversationId: string | null | undefined,
  finalMessageId: string | null | undefined,
  signedText?: string | null,
): ManagedPresentationTurn | null {
  if (!residentPubkey || !dispatchReceiptId) return null;
  const finalLookupKey = lookupKey(residentPubkey, dispatchReceiptId);
  addBoundedLookupKey(completedLookupKeys, finalLookupKey);
  const current = findTurnForFinal(
    residentPubkey,
    dispatchReceiptId,
    conversationId,
  );
  if (!current) return null;
  lookupToUiKey.set(finalLookupKey, current.uiKey);
  let next: ManagedPresentationTurn = {
    ...current,
    deadlineAt: null,
    dispatchReceiptId,
    durableReceiptId: dispatchReceiptId,
    finalMessageId: finalMessageId ?? current.finalMessageId,
    phase: "finalizing",
  };
  if (
    signedText !== undefined &&
    signedText !== null &&
    withinManagedPresentationPublicTextLimit(signedText)
  ) {
    const reconciliation = classifyManagedFinalReconciliation(
      current.receivedText,
      signedText,
    );
    next = {
      ...next,
      finalReconciliation: reconciliation,
      signedText,
    };
    if (reconciliation === "signed_extends_stream") {
      const suffix = signedText.slice(current.receivedText.length);
      const backlog = pendingGraphemes.get(current.uiKey) ?? [];
      backlog.push(...segmentManagedPresentationText(suffix));
      pendingGraphemes.set(current.uiKey, backlog);
      next = {
        ...next,
        bufferedText: next.bufferedText + suffix,
        receivedText: signedText,
      };
    } else if (
      reconciliation === "stream_extends_signed" ||
      reconciliation === "divergent"
    ) {
      clearPending(current.uiKey);
      next = {
        ...next,
        bufferedText: "",
        receivedText: signedText,
        visibleText: signedText,
      };
    }
  }
  if (
    next.slotOrdinal === null &&
    (next.finalMessageId !== null || next.signedText !== null)
  ) {
    clearPending(next.uiKey);
    next = activateResponseSlot(
      {
        ...next,
        bufferedText: "",
        receivedText: next.signedText ?? next.receivedText,
        visibleText: next.signedText ?? "",
      },
      Date.now(),
    );
  }
  terminalUiKeys.add(next.uiKey);
  terminalDrainDeadlines.set(
    next.uiKey,
    Date.now() + MANAGED_TERMINAL_DRAIN_TARGET_MS,
  );
  if (pendingGraphemes.has(next.uiKey)) scheduler.requestPaint();
  publishTurn(
    next,
    (current.slotOrdinal === null && next.slotOrdinal !== null) ||
      current.finalMessageId !== next.finalMessageId,
  );
  scheduleNearestDeadline();
  return next;
}

export function completeManagedPresentation(
  residentPubkey: string | null | undefined,
  dispatchReceiptId: string | null | undefined,
  finalMessageId?: string | null,
  signedText?: string | null,
): boolean {
  if (!residentPubkey || !dispatchReceiptId) return false;
  return (
    reconcileManagedPresentationFinal(
      residentPubkey,
      dispatchReceiptId,
      null,
      finalMessageId,
      signedText,
    ) !== null
  );
}

export function completeManagedPresentationForConversation(
  residentPubkey: string | null | undefined,
  dispatchReceiptId: string | null | undefined,
  conversationId: string | null | undefined,
  finalMessageId?: string | null,
  signedText?: string | null,
): void {
  reconcileManagedPresentationFinal(
    residentPubkey,
    dispatchReceiptId,
    conversationId,
    finalMessageId,
    signedText,
  );
}

/** Finalized turns stay bounded in memory so the mounted row keeps one uiKey. */
export function releaseManagedPresentationFinals(
  _messageIds: readonly string[],
): void {}

export function removeManagedPresentationsByReceipt(receiptId: string): void {
  const uiKeys = new Set<string>();
  for (const [key, uiKey] of lookupToUiKey) {
    if (key.endsWith(`:${receiptId}`)) uiKeys.add(uiKey);
  }
  for (const turn of turns.values()) {
    if (turn.dispatchReceiptId === receiptId) uiKeys.add(turn.uiKey);
  }
  for (const uiKey of uiKeys) removeTurn(uiKey);
}

/** Removes a retained response slot when its durable signed event is deleted. */
export function removeManagedPresentationByFinalMessageId(
  finalMessageId: string,
): void {
  const normalizedId = finalMessageId.toLowerCase();
  const uiKeys = [...turns.values()]
    .filter((turn) => turn.finalMessageId?.toLowerCase() === normalizedId)
    .map((turn) => turn.uiKey);
  for (const uiKey of uiKeys) removeTurn(uiKey);
}

export function getManagedPresentationTurn(
  uiKey: string,
): ManagedPresentationTurn | null {
  return turns.get(uiKey) ?? null;
}

export function acknowledgeManagedPresentationReconciliation(
  uiKey: string,
  finalMessageId: string,
): boolean {
  const current = turns.get(uiKey);
  if (
    !current ||
    current.finalMessageId !== finalMessageId ||
    current.finalReconciliation === null
  ) {
    return false;
  }
  turns.set(uiKey, { ...current, finalReconciliation: null });
  notifyTurn(uiKey);
  return true;
}

export function getManagedPresentationTurnKeysSnapshot(
  conversationId: string,
): readonly string[] {
  return turnKeySnapshots.get(conversationId) ?? EMPTY_KEYS;
}

export function getManagedResponseSlotsSnapshot(
  conversationId: string,
): readonly ManagedResponseSlot[] {
  return responseSlotSnapshots.get(conversationId) ?? EMPTY_SLOTS;
}

export function subscribeManagedPresentationTurn(
  uiKey: string,
  listener: () => void,
): () => void {
  const active = turnListeners.get(uiKey) ?? new Set<() => void>();
  active.add(listener);
  turnListeners.set(uiKey, active);
  return () => {
    active.delete(listener);
    if (active.size === 0) turnListeners.delete(uiKey);
  };
}

export function subscribeManagedPresentationTopology(
  conversationId: string,
  listener: () => void,
): () => void {
  const active = topologyListeners.get(conversationId) ?? new Set<() => void>();
  active.add(listener);
  topologyListeners.set(conversationId, active);
  return () => {
    active.delete(listener);
    if (active.size === 0) topologyListeners.delete(conversationId);
  };
}

export function subscribeManagedPresentationLegacy(
  conversationId: string,
  listener: () => void,
): () => void {
  const active = legacyListeners.get(conversationId) ?? new Set<() => void>();
  active.add(listener);
  legacyListeners.set(conversationId, active);
  return () => {
    active.delete(listener);
    if (active.size === 0) legacyListeners.delete(conversationId);
  };
}

export {
  getManagedPresentationActivitySnapshot,
  subscribeManagedPresentationActivity,
} from "@/features/messages/managedPresentationActivityStore";

export function getManagedPresentationSnapshot(
  conversationId: string,
): readonly ManagedPresentationRow[] {
  return legacySnapshots.get(conversationId) ?? EMPTY_LEGACY;
}

export function flushManagedPresentationSchedulerForTests(
  now?: number,
): boolean {
  return scheduler.flushForTests(now);
}

export function expireManagedPresentationDeadlinesForTests(now?: number): void {
  processDeadlines(now);
}

export function getManagedPresentationSchedulerStatsForTests(): {
  legacySnapshotRebuilds: number;
  paintCommits: number;
} {
  return {
    legacySnapshotRebuilds: legacySnapshotRebuildCount,
    paintCommits: paintCommitCount,
  };
}

export function resetManagedPresentationStore(): void {
  scheduler.reset();
  const activeTurnListeners = [...turnListeners.values()];
  const activeTopologyListeners = [...topologyListeners.values()];
  const activeLegacyListeners = [...legacyListeners.values()];
  turns.clear();
  pendingGraphemes.clear();
  terminalDrainDeadlines.clear();
  lookupToUiKey.clear();
  creationOrdinals.clear();
  terminalUiKeys.clear();
  completedLookupKeys.clear();
  terminalFrameLookupKeys.clear();
  nextSlotOrdinal.clear();
  stagedTurnUiKeys.clear();
  stagedLegacyConversationIds.clear();
  stagedTopologyConversationIds.clear();
  stagedTerminalActivityUntil.clear();
  stagedActivityExpiryAt = null;
  resetManagedPresentationActivityStore();
  turnKeySnapshots.clear();
  responseSlotSnapshots.clear();
  legacySnapshots.clear();
  creationCounter = 0;
  paintCommitCount = 0;
  legacySnapshotRebuildCount = 0;
  for (const active of activeTurnListeners) notifyListeners(active);
  for (const active of activeTopologyListeners) notifyListeners(active);
  for (const active of activeLegacyListeners) notifyListeners(active);
}
