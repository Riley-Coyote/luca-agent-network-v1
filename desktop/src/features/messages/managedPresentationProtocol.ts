import type { RawManagedPresentationFrame } from "@/features/messages/managedPresentationTypes";

export const MANAGED_PRESENTATION_EVENT = "luca://managed-presentation";
export const MAX_MANAGED_PRESENTATION_ROWS = 512;
export const MANAGED_TURN_START_TIMEOUT_MS = 12_000;
export const MANAGED_TURN_LIVENESS_MS = 90_000;
export const MANAGED_TERMINAL_DRAIN_TARGET_MS = 300;

const PROTOCOL = "luca.managed.presentation.v1";
const MAX_CHUNK_BYTES = 16 * 1024;
const MAX_PUBLIC_TEXT_BYTES = 65_536;
const textEncoder = new TextEncoder();
const PRESENTATION_KINDS = new Set<RawManagedPresentationFrame["kind"]>([
  "turn_started",
  "phase",
  "public_chunk",
  "completed",
  "cancelled",
  "failed",
]);
const PRESENTATION_PHASES = new Set([
  "thinking",
  "working",
  "writing",
  "finalizing",
]);
const PRESENTATION_FAILURES = new Set([
  "runtime",
  "publication",
  "unavailable",
]);

function validOpaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

export function validManagedPresentationFrame(
  value: unknown,
): value is RawManagedPresentationFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Partial<RawManagedPresentationFrame>;
  const commonFieldsAreValid =
    frame.protocol === PROTOCOL &&
    typeof frame.kind === "string" &&
    PRESENTATION_KINDS.has(frame.kind as RawManagedPresentationFrame["kind"]) &&
    typeof frame.resident_pubkey === "string" &&
    /^[0-9a-f]{64}$/.test(frame.resident_pubkey) &&
    validOpaqueId(frame.conversation_id) &&
    validOpaqueId(frame.turn_id) &&
    validOpaqueId(frame.dispatch_receipt_id) &&
    Number.isSafeInteger(frame.session_epoch) &&
    Number.isSafeInteger(frame.sequence) &&
    (frame.session_epoch ?? -1) >= 0 &&
    (frame.sequence ?? 0) > 0;
  if (!commonFieldsAreValid) return false;
  if (frame.kind === "phase") {
    return (
      typeof frame.phase === "string" && PRESENTATION_PHASES.has(frame.phase)
    );
  }
  if (frame.kind === "public_chunk") {
    return typeof frame.public_chunk === "string";
  }
  if (frame.kind === "failed" && frame.failure !== undefined) {
    return PRESENTATION_FAILURES.has(frame.failure);
  }
  return true;
}

export function validManagedPresentationChunk(chunk: string): boolean {
  return (
    chunk.length > 0 && textEncoder.encode(chunk).length <= MAX_CHUNK_BYTES
  );
}

export function withinManagedPresentationPublicTextLimit(
  text: string,
): boolean {
  return textEncoder.encode(text).length <= MAX_PUBLIC_TEXT_BYTES;
}
