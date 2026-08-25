import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ManagedResponseSurface } from "@/features/messages/lib/managedAudience";
import * as timelinePlacement from "@/features/messages/lib/managedTimelineProjection";
import {
  expireManagedPresentationActivity,
  getNearestManagedPresentationActivityExpiry,
  MANAGED_TERMINAL_ACTIVITY_MS,
  managedTerminalActivityUntil,
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
  MANAGED_TURN_WAKE_TIMEOUT_MS,
  MAX_MANAGED_PRESENTATION_ROWS,
  validManagedPresentationChunk,
  validManagedPresentationFrame,
  withinManagedPresentationPublicTextLimit,
} from "@/features/messages/managedPresentationProtocol";
import { classifyManagedFinalReconciliation } from "@/features/messages/managedPresentationReconciliation";
import {
  dedupeManagedOperationalStatuses,
  mergeManagedActivityStep,
  parseManagedActivityStep,
  settleManagedActivitySteps,
} from "@/features/messages/lib/managedOperationalStatus";
import type { ManagedConversationOperationalStatus } from "@/shared/api/types";
import { ManagedPresentationScheduler } from "@/features/messages/managedPresentationScheduler";
import {
  managedPresentationUiKey,
  type ManagedPresentationDisplayPhase,
  type ManagedPresentationRow,
  type ManagedPresentationTurn,
  type ManagedResponseSlot,
  type ManagedTurnActivityStep,
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
const durableInterruptedUiKeys = new Set<string>();
const nextSlotOrdinal = new Map<string, number>();
const stagedTurnUiKeys = new Set<string>();
const stagedLegacyConversationIds = new Set<string>();
const stagedTopologyConversationIds = new Set<string>();
const stagedTerminalActivityUntil = new Map<string, number>();
const turnListeners = new Map<string, Set<() => void>>();
const topologyListeners = new Map<string, Set<() => void>>();
const legacyListeners = new Map<string, Set<() => void>>();
const operationalStatusListeners = new Map<string, Set<() => void>>();
const turnKeySnapshots = new Map<string, readonly string[]>();
const responseSlotSnapshots = new Map<string, readonly ManagedResponseSlot[]>();
const legacySnapshots = new Map<string, readonly ManagedPresentationRow[]>();
const operationalReceiptSnapshots = new Map<string, ReadonlySet<string>>();
const EMPTY_KEYS: readonly string[] = [];
const EMPTY_SLOTS: readonly ManagedResponseSlot[] = [];
const EMPTY_LEGACY: readonly ManagedPresentationRow[] = [];
const EMPTY_OPERATIONAL_RECEIPTS: ReadonlySet<string> = new Set();
/** Shared so an un-narrated turn keeps one identity across republications. */
const NO_ACTIVITY_STEPS: readonly ManagedTurnActivityStep[] = [];

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
  waking = false,
): ManagedPresentationTurn {
  const normalizedPubkey = residentPubkey.toLowerCase();
  const now = Date.now();
  return {
    activitySteps: NO_ACTIVITY_STEPS,
    anchorKey: null,
    anchorAt: 0,
    bufferedText: "",
    conversationId,
    deadlineAt:
      now +
      (waking ? MANAGED_TURN_WAKE_TIMEOUT_MS : MANAGED_TURN_START_TIMEOUT_MS),
    dispatchReceiptId: receiptId,
    durableReceiptId: null,
    failure: null,
    finalMessageId: null,
    finalReconciliation: null,
    lastFrameAt: now,
    phase: waking ? "waking" : "thinking",
    receivedText: "",
    residentPubkey: normalizedPubkey,
    responseSurface,
    sequence: 0,
    sessionEpoch: 0,
    signedText: null,
    slotOrdinal: null,
    startedAt: now,
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

/**
 * A turn is ending with text still in the paint queue.
 *
 * THE UNPAINTED TAIL IS NOT UNFINISHED TEXT. It arrived, it passed validation,
 * it is already counted in `receivedText` — it simply had not reached the
 * screen yet, because the reveal scheduler paints graphemes on a 40ms cadence
 * and Stop lands whenever the owner presses it. Stop is *designed* to be
 * pressed mid-stream, so this is the common case, not the edge one.
 *
 * These branches used to write `receivedText: visibleText` and drop the
 * buffer, throwing away everything between the last painted grapheme and the
 * terminal frame — measured at 28 of 68 characters, cut mid-word, when the
 * frame arrived 150ms after a chunk. The row then printed "Stopped · Response
 * may be incomplete" over a response the UI itself had truncated, which blames
 * the runtime for the desktop's own loss.
 *
 * So the tail is painted in one step instead of discarded. That also gives a
 * turn that died before its first paint tick a row at all: `visibleText` was
 * empty there, and `activateTerminalResponseSlot` above refuses a slot to a
 * turn with no visible text.
 */
function flushUnpaintedTail(
  turn: ManagedPresentationTurn,
): ManagedPresentationTurn {
  const complete = turn.visibleText + turn.bufferedText;
  return {
    ...turn,
    bufferedText: "",
    // Restated rather than left alone: the three fields describe one string,
    // and this is the moment the turn stops changing.
    receivedText: complete,
    visibleText: complete,
  };
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
      managedTerminalActivityUntil(next.phase, now),
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
  timelinePlacement.releaseManagedTimelineProjectionSlot(uiKey);
  clearPending(uiKey);
  creationOrdinals.delete(uiKey);
  terminalUiKeys.delete(uiKey);
  durableInterruptedUiKeys.delete(uiKey);
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

function consumeSupersededInterruptedActivity(
  conversationId: string,
  residentPubkey: string,
): void {
  for (const uiKey of durableInterruptedUiKeys) {
    const interrupted = turns.get(uiKey);
    if (
      interrupted?.conversationId !== conversationId ||
      interrupted.residentPubkey !== residentPubkey
    ) {
      continue;
    }
    durableInterruptedUiKeys.delete(uiKey);
    removeManagedPresentationActivity(uiKey, conversationId);
  }
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

function phaseWord(phase: ManagedPresentationDisplayPhase): string {
  return `${phase.charAt(0).toUpperCase()}${phase.slice(1)}`.replace(/_/g, " ");
}

/**
 * Fold this frame's optional activity object into the turn's narration.
 *
 * Every field is untrusted and the whole object is optional, so a frame that
 * carries nothing — or carries nonsense — returns the turn unchanged and the
 * surface falls back to the phase word it has always shown.
 */
function withFrameActivity(
  turn: ManagedPresentationTurn,
  frame: RawManagedPresentationFrame,
): ManagedPresentationTurn {
  const parsed = parseManagedActivityStep(
    frame.activity,
    turn.activitySteps.length + 1,
    phaseWord(frame.phase ?? turn.phase),
  );
  if (!parsed) return turn;
  const activitySteps = mergeManagedActivityStep(turn.activitySteps, parsed);
  return activitySteps === turn.activitySteps
    ? turn
    : { ...turn, activitySteps };
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

  let next = withFrameActivity(frameBase(current, frame), frame);
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
      next = {
        ...next,
        activitySteps: settleManagedActivitySteps(next.activitySteps),
        deadlineAt: null,
        phase: "finalizing",
      };
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
        flushUnpaintedTail({
          ...next,
          deadlineAt: null,
          phase: "stopped",
        }),
        Date.now(),
      );
      topologyChanged =
        current.slotOrdinal === null && next.slotOrdinal !== null;
      markTerminalFrame(frameLookupKey, next.uiKey);
      break;
    case "failed":
      clearPending(next.uiKey);
      next = activateTerminalResponseSlot(
        flushUnpaintedTail({
          ...next,
          deadlineAt: null,
          failure: frame.failure ?? "runtime",
          phase: "failed",
        }),
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
    managedTerminalActivityUntil(next.phase, Date.now()),
  );
  scheduleNearestDeadline();
}

/**
 * Settle one exact presentation after desktop has durably cancelled and
 * replaced the resident runtime.
 *
 * The native cancellation command is authoritative but does not guarantee a
 * final observer `cancelled` frame: its five-second watchdog may have to kill
 * the old process. Without this local terminal transition, already-buffered
 * graphemes keep animating and late frames can make a successfully stopped
 * resident look active again. Canonical signed-final reconciliation remains
 * available for the explicitly reported `publication_ambiguous` case.
 */
export function cancelManagedPresentation(
  residentPubkey: string,
  dispatchReceiptId: string,
  conversationId?: string | null,
): ManagedPresentationTurn | null {
  const frameLookupKey = lookupKey(residentPubkey, dispatchReceiptId);
  const current = findTurnForFinal(
    residentPubkey,
    dispatchReceiptId,
    conversationId,
  );
  if (!current) return null;

  clearPending(current.uiKey);
  const next = activateTerminalResponseSlot(
    {
      ...current,
      bufferedText: "",
      deadlineAt: null,
      failure: null,
      phase: "stopped",
      receivedText: current.visibleText,
    },
    Date.now(),
  );
  const topologyChanged =
    current.slotOrdinal === null && next.slotOrdinal !== null;
  markTerminalFrame(frameLookupKey, next.uiKey);
  publishTurn(next, topologyChanged, Date.now() + MANAGED_TERMINAL_ACTIVITY_MS);
  scheduleNearestDeadline();
  return next;
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
  options: {
    /** Residents whose process was not running at send time. The desktop is
     *  starting them; their row says so, and they get the longer deadline. */
    wakingResidentPubkeys?: ReadonlySet<string>;
  } = {},
): void {
  void ensureManagedPresentationListener();
  for (const pubkey of residentPubkeys) {
    const residentPubkey = pubkey.toLowerCase();
    const key = lookupKey(residentPubkey, dispatchReceiptId);
    if (lookupToUiKey.has(key) || completedLookupKeys.has(key)) continue;
    consumeSupersededInterruptedActivity(conversationId, residentPubkey);
    registerTurn(
      createTurn(
        conversationId,
        dispatchReceiptId,
        residentPubkey,
        responseSurface,
        options.wakingResidentPubkeys?.has(residentPubkey) ?? false,
      ),
    );
  }
}

/**
 * The desktop tried to start a sleeping resident for this send and could not.
 * There is nothing to wait for, so the seeded turn goes straight to the
 * unavailable outcome instead of holding "waking" for the full deadline.
 */
export function failManagedPresentationWake(
  conversationId: string,
  dispatchReceiptId: string,
  residentPubkey: string,
): void {
  const uiKey = lookupToUiKey.get(
    lookupKey(residentPubkey.toLowerCase(), dispatchReceiptId),
  );
  const current = uiKey ? turns.get(uiKey) : undefined;
  if (
    !current ||
    current.conversationId !== conversationId ||
    current.phase !== "waking"
  ) {
    return;
  }
  const now = Date.now();
  const next = activateTerminalResponseSlot(
    {
      ...current,
      deadlineAt: null,
      failure: "unavailable",
      phase: "needs_attention",
    },
    now,
  );
  stageTurnPublication(
    next,
    current.slotOrdinal === null && next.slotOrdinal !== null,
    managedTerminalActivityUntil(next.phase, now),
  );
  scheduler.requestPaint();
}

/**
 * Rehydrate durable, body-free restart outcomes into already seeded optimistic
 * turns. The UX-203A response deliberately has no resident identity, so an
 * exact receipt may update every sibling seeded by the same owner send while
 * preserving any visible partial text and completed sibling result.
 */
export function hydrateManagedOperationalStatuses(
  conversationId: string,
  statuses: readonly ManagedConversationOperationalStatus[],
): void {
  const deduped = dedupeManagedOperationalStatuses(statuses);
  operationalReceiptSnapshots.set(
    conversationId,
    new Set(deduped.map((status) => status.dispatchReceiptId)),
  );
  notifyListeners(operationalStatusListeners.get(conversationId));
  for (const status of deduped) {
    for (const current of turns.values()) {
      if (
        current.conversationId !== conversationId ||
        current.dispatchReceiptId !== status.dispatchReceiptId ||
        current.finalMessageId !== null ||
        (current.phase === "needs_attention" && current.failure === "runtime")
      ) {
        continue;
      }
      clearPending(current.uiKey);
      const next = activateTerminalResponseSlot(
        flushUnpaintedTail({
          ...current,
          deadlineAt: null,
          failure: "runtime",
          phase: "needs_attention",
        }),
        Date.now(),
      );
      terminalUiKeys.add(next.uiKey);
      removeManagedPresentationActivity(next.uiKey, conversationId);
      durableInterruptedUiKeys.add(next.uiKey);
      publishTurn(
        next,
        current.slotOrdinal === null && next.slotOrdinal !== null,
      );
    }
  }
  scheduleNearestDeadline();
}

export function getManagedOperationalReceiptSnapshot(
  conversationId: string,
): ReadonlySet<string> {
  return (
    operationalReceiptSnapshots.get(conversationId) ??
    EMPTY_OPERATIONAL_RECEIPTS
  );
}

export function subscribeManagedOperationalReceipts(
  conversationId: string,
  listener: () => void,
): () => void {
  const active = operationalStatusListeners.get(conversationId) ?? new Set();
  active.add(listener);
  operationalStatusListeners.set(conversationId, active);
  return () => {
    active.delete(listener);
    if (active.size === 0) operationalStatusListeners.delete(conversationId);
  };
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
    // The owner started waiting when the optimistic turn was seeded, and the
    // narration may have begun on either half of the race.
    activitySteps: authenticated.activitySteps.reduce(
      mergeManagedActivityStep,
      optimistic.activitySteps,
    ),
    startedAt: Math.min(optimistic.startedAt, authenticated.startedAt),
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
    managedTerminalActivityUntil(merged.phase, Date.now()),
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
    activitySteps: settleManagedActivitySteps(current.activitySteps),
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
  dismissManagedPresentationActivity,
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
  timelinePlacement.resetManagedTimelineProjectionState();
  const activeTurnListeners = [...turnListeners.values()];
  const activeTopologyListeners = [...topologyListeners.values()];
  const activeLegacyListeners = [...legacyListeners.values()];
  const activeOperationalListeners = [...operationalStatusListeners.values()];
  turns.clear();
  pendingGraphemes.clear();
  terminalDrainDeadlines.clear();
  lookupToUiKey.clear();
  creationOrdinals.clear();
  terminalUiKeys.clear();
  completedLookupKeys.clear();
  terminalFrameLookupKeys.clear();
  durableInterruptedUiKeys.clear();
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
  operationalReceiptSnapshots.clear();
  creationCounter = 0;
  paintCommitCount = 0;
  legacySnapshotRebuildCount = 0;
  for (const active of activeTurnListeners) notifyListeners(active);
  for (const active of activeTopologyListeners) notifyListeners(active);
  for (const active of activeLegacyListeners) notifyListeners(active);
  for (const active of activeOperationalListeners) notifyListeners(active);
}
