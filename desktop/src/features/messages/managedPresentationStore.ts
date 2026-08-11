import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as React from "react";

const PRESENTATION_PROTOCOL = "luca.managed.presentation.v1";
const PRESENTATION_EVENT = "luca://managed-presentation";
const PAINT_INTERVAL_MS = 40;
const MAX_CHUNK_BYTES = 16 * 1024;
const MAX_PUBLIC_TEXT_BYTES = 65_536;
const MAX_PRESENTATION_ROWS = 512;
const TURN_START_TIMEOUT_MS = 12_000;
const PRESENTATION_KINDS = new Set<PresentationKind>([
  "turn_started",
  "phase",
  "public_chunk",
  "completed",
  "cancelled",
  "failed",
]);

type PresentationKind =
  | "turn_started"
  | "phase"
  | "public_chunk"
  | "completed"
  | "cancelled"
  | "failed";

export type ManagedPresentationPhase =
  | "thinking"
  | "working"
  | "writing"
  | "finalizing"
  | "cancelled"
  | "failed";

export type ManagedPresentationRow = {
  anchorAt: number;
  conversationId: string;
  dispatchReceiptId: string;
  failure: "runtime" | "publication" | "unavailable" | null;
  finalMessageId: string | null;
  phase: ManagedPresentationPhase;
  publicText: string;
  residentPubkey: string;
  sequence: number;
  sessionEpoch: number;
  turnId: string;
};

type RawManagedPresentationFrame = {
  protocol: string;
  kind: PresentationKind;
  resident_pubkey: string;
  conversation_id: string;
  turn_id: string;
  dispatch_receipt_id: string;
  session_epoch: number;
  sequence: number;
  phase?: "thinking" | "working" | "writing" | "finalizing";
  public_chunk?: string;
  failure?: "runtime" | "publication" | "unavailable";
};

const rows = new Map<string, ManagedPresentationRow>();
const pendingChunks = new Map<string, string>();
const paintTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
const startTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
const completedKeys = new Set<string>();
const terminalFrameKeys = new Set<string>();
const listeners = new Set<() => void>();
const snapshots = new Map<string, readonly ManagedPresentationRow[]>();
const EMPTY_SNAPSHOT: readonly ManagedPresentationRow[] = [];
let unlisten: UnlistenFn | null = null;
let listenerPromise: Promise<void> | null = null;

function rowKey(residentPubkey: string, dispatchReceiptId: string): string {
  return `${residentPubkey.toLowerCase()}:${dispatchReceiptId}`;
}

function markTerminalFrame(key: string): void {
  terminalFrameKeys.add(key);
  if (terminalFrameKeys.size <= MAX_PRESENTATION_ROWS) return;
  const oldest = terminalFrameKeys.values().next().value;
  if (typeof oldest !== "string") return;
  terminalFrameKeys.delete(oldest);
  rows.delete(oldest);
  pendingChunks.delete(oldest);
}

function rebuildSnapshots(): void {
  snapshots.clear();
  for (const row of rows.values()) {
    const current = snapshots.get(row.conversationId) ?? [];
    snapshots.set(row.conversationId, [...current, row]);
  }
  for (const [conversationId, values] of snapshots) {
    snapshots.set(
      conversationId,
      [...values].sort(
        (left, right) =>
          left.anchorAt - right.anchorAt ||
          left.residentPubkey.localeCompare(right.residentPubkey),
      ),
    );
  }
  for (const listener of listeners) listener();
}

function validFrame(value: unknown): value is RawManagedPresentationFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<RawManagedPresentationFrame>;
  return (
    frame.protocol === PRESENTATION_PROTOCOL &&
    typeof frame.kind === "string" &&
    PRESENTATION_KINDS.has(frame.kind as PresentationKind) &&
    typeof frame.resident_pubkey === "string" &&
    /^[0-9a-f]{64}$/.test(frame.resident_pubkey) &&
    validOpaqueId(frame.conversation_id) &&
    validOpaqueId(frame.turn_id) &&
    validOpaqueId(frame.dispatch_receipt_id) &&
    Number.isSafeInteger(frame.session_epoch) &&
    Number.isSafeInteger(frame.sequence) &&
    (frame.sequence ?? 0) > 0
  );
}

function validOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function flushChunk(key: string): void {
  paintTimers.delete(key);
  const chunk = pendingChunks.get(key);
  pendingChunks.delete(key);
  const current = rows.get(key);
  if (!current || !chunk) return;
  rows.set(key, { ...current, publicText: current.publicText + chunk });
  rebuildSnapshots();
}

function queueChunk(key: string, chunk: string): void {
  const pending = pendingChunks.get(key) ?? "";
  const current = rows.get(key)?.publicText ?? "";
  if (
    new TextEncoder().encode(current + pending + chunk).length >
    MAX_PUBLIC_TEXT_BYTES
  ) {
    return;
  }
  pendingChunks.set(key, pending + chunk);
  if (paintTimers.has(key)) return;
  paintTimers.set(
    key,
    globalThis.setTimeout(() => flushChunk(key), PAINT_INTERVAL_MS),
  );
}

function clearStartTimer(key: string): void {
  const timer = startTimers.get(key);
  if (timer) globalThis.clearTimeout(timer);
  startTimers.delete(key);
}

function scheduleStartTimeout(key: string): void {
  clearStartTimer(key);
  startTimers.set(
    key,
    globalThis.setTimeout(() => {
      startTimers.delete(key);
      const current = rows.get(key);
      if (current?.sessionEpoch !== 0) return;
      rows.set(key, {
        ...current,
        failure: "unavailable",
        phase: "failed",
        publicText: "",
      });
      rebuildSnapshots();
    }, TURN_START_TIMEOUT_MS),
  );
}

export function ingestManagedPresentationFrame(frameValue: unknown): void {
  if (!validFrame(frameValue)) return;
  const frame = frameValue;
  const key = rowKey(frame.resident_pubkey, frame.dispatch_receipt_id);
  if (completedKeys.has(key) || terminalFrameKeys.has(key)) return;
  const current = rows.get(key);
  if (
    current &&
    current.sessionEpoch !== 0 &&
    (current.sessionEpoch !== frame.session_epoch ||
      frame.sequence !== current.sequence + 1)
  ) {
    return;
  }
  clearStartTimer(key);
  const base: ManagedPresentationRow = {
    anchorAt: current?.anchorAt ?? Date.now(),
    conversationId: frame.conversation_id,
    dispatchReceiptId: frame.dispatch_receipt_id,
    failure: current?.failure ?? null,
    finalMessageId: current?.finalMessageId ?? null,
    phase: current?.phase ?? "thinking",
    publicText: current?.publicText ?? "",
    residentPubkey: frame.resident_pubkey,
    sequence: frame.sequence,
    sessionEpoch: frame.session_epoch,
    turnId: frame.turn_id,
  };
  switch (frame.kind) {
    case "turn_started":
      rows.set(key, { ...base, failure: null, phase: "thinking" });
      break;
    case "phase":
      if (!frame.phase) return;
      rows.set(key, { ...base, phase: frame.phase });
      break;
    case "public_chunk":
      if (
        !frame.public_chunk ||
        new TextEncoder().encode(frame.public_chunk).length > MAX_CHUNK_BYTES
      ) {
        return;
      }
      rows.set(key, { ...base, phase: "writing" });
      queueChunk(key, frame.public_chunk);
      break;
    case "completed":
      rows.set(key, { ...base, phase: "finalizing" });
      markTerminalFrame(key);
      break;
    case "cancelled":
      pendingChunks.delete(key);
      rows.set(key, { ...base, phase: "cancelled", publicText: "" });
      markTerminalFrame(key);
      break;
    case "failed":
      pendingChunks.delete(key);
      rows.set(key, {
        ...base,
        failure: frame.failure ?? "runtime",
        phase: "failed",
        publicText: "",
      });
      markTerminalFrame(key);
      break;
  }
  if (frame.kind !== "public_chunk") rebuildSnapshots();
}

export async function ensureManagedPresentationListener(): Promise<void> {
  if (unlisten || listenerPromise) return listenerPromise ?? Promise.resolve();
  listenerPromise = listen<RawManagedPresentationFrame>(
    PRESENTATION_EVENT,
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
): void {
  void ensureManagedPresentationListener();
  const anchorAt = Date.now();
  for (const pubkey of residentPubkeys) {
    const residentPubkey = pubkey.toLowerCase();
    const key = rowKey(residentPubkey, dispatchReceiptId);
    if (rows.has(key) || completedKeys.has(key)) continue;
    if (rows.size >= MAX_PRESENTATION_ROWS) continue;
    rows.set(key, {
      anchorAt,
      conversationId,
      dispatchReceiptId,
      failure: null,
      finalMessageId: null,
      phase: "thinking",
      publicText: "",
      residentPubkey,
      sequence: 0,
      sessionEpoch: 0,
      turnId: `pending:${dispatchReceiptId}:${residentPubkey}`,
    });
    scheduleStartTimeout(key);
  }
  rebuildSnapshots();
}

export function replaceManagedPresentationReceipt(
  previousReceiptId: string,
  receiptId: string,
): void {
  for (const [key, row] of [...rows]) {
    if (row.dispatchReceiptId !== previousReceiptId) continue;
    rows.delete(key);
    clearStartTimer(key);
    const next = { ...row, dispatchReceiptId: receiptId };
    const nextKey = rowKey(row.residentPubkey, receiptId);
    if (!completedKeys.has(nextKey)) {
      const streamed = rows.get(nextKey);
      if (streamed) {
        // The native stream can beat the relay send result. Preserve the
        // authenticated row and only carry over the optimistic placement so
        // receipt reconciliation never erases already-visible public chunks.
        rows.set(nextKey, { ...streamed, anchorAt: row.anchorAt });
      } else {
        rows.set(nextKey, next);
        if (next.sessionEpoch === 0) scheduleStartTimeout(nextKey);
      }
    }
  }
  rebuildSnapshots();
}

export function completeManagedPresentation(
  residentPubkey: string | null | undefined,
  dispatchReceiptId: string | null | undefined,
  finalMessageId?: string | null,
): boolean {
  if (!residentPubkey || !dispatchReceiptId) return false;
  const key = rowKey(residentPubkey, dispatchReceiptId);
  const removed = rows.has(key);
  completedKeys.add(key);
  markTerminalFrame(key);
  if (completedKeys.size > 512) {
    const oldest = completedKeys.values().next().value;
    if (typeof oldest === "string") completedKeys.delete(oldest);
  }
  const timer = paintTimers.get(key);
  if (timer) globalThis.clearTimeout(timer);
  paintTimers.delete(key);
  clearStartTimer(key);
  pendingChunks.delete(key);
  const current = rows.get(key);
  if (current && finalMessageId) {
    rows.set(key, {
      ...current,
      finalMessageId,
      phase: "finalizing",
    });
    rebuildSnapshots();
  } else if (rows.delete(key)) {
    rebuildSnapshots();
  }
  return removed;
}

/**
 * Reconciles a signed final with its provisional row. The causal event id is
 * authoritative, while the single-row fallback covers the narrow race where
 * the live stream is accepted before the optimistic send receipt is replaced.
 * We never guess when more than one turn from the resident is active.
 */
export function completeManagedPresentationForConversation(
  residentPubkey: string | null | undefined,
  dispatchReceiptId: string | null | undefined,
  conversationId: string | null | undefined,
  finalMessageId?: string | null,
): void {
  if (!residentPubkey || !dispatchReceiptId) return;
  if (
    completeManagedPresentation(
      residentPubkey,
      dispatchReceiptId,
      finalMessageId,
    )
  ) {
    return;
  }
  if (!conversationId) return;

  const normalizedPubkey = residentPubkey.toLowerCase();
  const candidates = [...rows.values()].filter(
    (row) =>
      row.conversationId === conversationId &&
      row.residentPubkey === normalizedPubkey,
  );
  if (candidates.length !== 1) return;
  completeManagedPresentation(
    candidates[0].residentPubkey,
    candidates[0].dispatchReceiptId,
    finalMessageId,
  );
}

/** Release live rows only after their signed finals have joined the rendered timeline. */
export function releaseManagedPresentationFinals(
  messageIds: readonly string[],
): void {
  if (messageIds.length === 0) return;
  const rendered = new Set(messageIds);
  let changed = false;
  for (const [key, row] of rows) {
    if (!row.finalMessageId || !rendered.has(row.finalMessageId)) continue;
    rows.delete(key);
    changed = true;
  }
  if (changed) rebuildSnapshots();
}

export function removeManagedPresentationsByReceipt(receiptId: string): void {
  let changed = false;
  for (const [key, row] of [...rows]) {
    if (row.dispatchReceiptId !== receiptId) continue;
    clearStartTimer(key);
    rows.delete(key);
    changed = true;
  }
  if (changed) rebuildSnapshots();
}

export function resetManagedPresentationStore(): void {
  for (const timer of paintTimers.values()) globalThis.clearTimeout(timer);
  for (const timer of startTimers.values()) globalThis.clearTimeout(timer);
  rows.clear();
  pendingChunks.clear();
  paintTimers.clear();
  startTimers.clear();
  completedKeys.clear();
  terminalFrameKeys.clear();
  snapshots.clear();
  for (const listener of listeners) listener();
}

export function getManagedPresentationSnapshot(
  conversationId: string,
): readonly ManagedPresentationRow[] {
  return snapshots.get(conversationId) ?? EMPTY_SNAPSHOT;
}

export function useManagedPresentations(
  conversationId: string | null,
): readonly ManagedPresentationRow[] {
  React.useEffect(() => {
    void ensureManagedPresentationListener();
  }, []);
  const subscribe = React.useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const getSnapshot = React.useCallback(
    () =>
      conversationId
        ? getManagedPresentationSnapshot(conversationId)
        : EMPTY_SNAPSHOT,
    [conversationId],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
