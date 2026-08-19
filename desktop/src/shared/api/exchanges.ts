import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invokeTauri } from "@/shared/api/tauri";
import type { ExchangePhase, ExchangeRecord } from "@/shared/api/types";

/**
 * The exchange record on the wire and in `ExchangeSnapshot.record`: the serde
 * shape of `luca_protocol::ExchangeRecordV1`, which is snake_case. Only the
 * snapshot wrapper is camelCase, so the record is normalised here once and the
 * rest of the app sees `ExchangeRecord`.
 */
type RawExchangeRecord = {
  protocol?: unknown;
  exchange_id?: unknown;
  owner?: unknown;
  members?: unknown;
  conversation_id?: unknown;
  root_event_id?: unknown;
  parent_exchange_id?: unknown;
  depth?: unknown;
  bucket?: unknown;
  state?: unknown;
  deadline?: unknown;
  opened_by?: unknown;
};

/** `ExchangeSnapshot` from `desktop/src-tauri/src/luca/exchange.rs`. */
type RawExchangeSnapshot = {
  record?: RawExchangeRecord;
  spent?: unknown;
  remaining?: unknown;
  phase?: unknown;
};

/** What `resolve_exchange`/`get_exchange` hand back, normalised. */
export type ExchangeSnapshot = {
  record: ExchangeRecord;
  /** Turns already spoken — counted by the relay, never by loaded history. */
  spent: number;
  phase: ExchangePhase;
};

/** Payload of the backend's `exchange-updated` event. */
export type ExchangeUpdatedEvent = {
  exchangeId?: unknown;
  record?: RawExchangeRecord;
  spent?: unknown;
  phase?: unknown;
};

const EXCHANGE_PHASES: readonly ExchangePhase[] = [
  "open",
  "paused",
  "closed",
  "expired",
];

function isHex64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

/**
 * Normalise a wire record into the camelCase mirror, or `null` when the
 * content is not a `luca.exchange.v1` record. Fails closed: a record the strip
 * cannot render is one it must not half-render.
 */
export function normalizeExchangeRecord(
  raw: RawExchangeRecord | null | undefined,
): ExchangeRecord | null {
  if (!raw) return null;
  if (raw.protocol !== "luca.exchange.v1") return null;
  if (!isHex64(raw.exchange_id) || !isHex64(raw.owner)) return null;
  if (!isHex64(raw.root_event_id) || !isHex64(raw.opened_by)) return null;
  if (!Array.isArray(raw.members) || !raw.members.every(isHex64)) return null;
  if (typeof raw.conversation_id !== "string" || !raw.conversation_id) {
    return null;
  }
  if (raw.depth !== 1 && raw.depth !== 2) return null;
  if (typeof raw.bucket !== "number" || !Number.isFinite(raw.bucket)) {
    return null;
  }
  if (raw.state !== "open" && raw.state !== "closed") return null;
  if (typeof raw.deadline !== "number" || !Number.isFinite(raw.deadline)) {
    return null;
  }

  return {
    protocol: "luca.exchange.v1",
    exchangeId: raw.exchange_id.toLowerCase(),
    owner: raw.owner.toLowerCase(),
    members: raw.members.map((member) => member.toLowerCase()),
    conversationId: raw.conversation_id,
    rootEventId: raw.root_event_id.toLowerCase(),
    parentExchangeId: isHex64(raw.parent_exchange_id)
      ? raw.parent_exchange_id.toLowerCase()
      : null,
    depth: raw.depth,
    bucket: raw.bucket,
    state: raw.state,
    deadline: raw.deadline,
    openedBy: raw.opened_by.toLowerCase(),
  };
}

/** Parse the JSON content of a kind-30178 event into a record. */
export function parseExchangeRecordContent(
  content: string,
): ExchangeRecord | null {
  try {
    return normalizeExchangeRecord(JSON.parse(content) as RawExchangeRecord);
  } catch {
    return null;
  }
}

/**
 * The lived phase, mirroring `ExchangeRecordV1::phase`. Used only where the
 * relay's own answer is not available yet (a head seen before its snapshot);
 * a snapshot's `phase` always wins over this.
 */
export function deriveExchangePhase(
  record: ExchangeRecord,
  spent: number,
  nowUnixSeconds: number,
): ExchangePhase {
  if (record.state === "closed") return "closed";
  if (nowUnixSeconds > record.deadline) return "expired";
  return spent >= record.bucket ? "paused" : "open";
}

function normalizeSnapshot(
  raw: RawExchangeSnapshot | null | undefined,
): ExchangeSnapshot | null {
  const record = normalizeExchangeRecord(raw?.record);
  if (!record) return null;
  const spent =
    typeof raw?.spent === "number" && Number.isFinite(raw.spent)
      ? raw.spent
      : 0;
  const phase = EXCHANGE_PHASES.includes(raw?.phase as ExchangePhase)
    ? (raw?.phase as ExchangePhase)
    : deriveExchangePhase(record, spent, Math.floor(Date.now() / 1000));
  return { record, spent, phase };
}

/**
 * Ask the backend for the authoritative head plus the relay's spent count.
 * `null` means "not one of ours" — the caller should drop what it holds.
 */
export async function getExchange(
  exchangeId: string,
): Promise<ExchangeSnapshot | null> {
  const raw = await invokeTauri<RawExchangeSnapshot | null>("get_exchange", {
    exchangeId,
  });
  return normalizeSnapshot(raw);
}

/** The owner's "Stop here" / "Let them go on". */
export async function resolveExchange(
  exchangeId: string,
  action: "stop" | "go",
): Promise<ExchangeSnapshot | null> {
  const raw = await invokeTauri<RawExchangeSnapshot | null>(
    "resolve_exchange",
    { exchangeId, action },
  );
  return normalizeSnapshot(raw);
}

/** Backend-emitted head changes (published after Stop and Go). */
export async function listenForExchangeUpdates(
  onUpdate: (update: {
    exchangeId: string;
    snapshot: ExchangeSnapshot | null;
  }) => void,
): Promise<UnlistenFn> {
  return listen<ExchangeUpdatedEvent>("exchange-updated", ({ payload }) => {
    const exchangeId =
      typeof payload?.exchangeId === "string" ? payload.exchangeId : null;
    if (!exchangeId) return;
    onUpdate({
      exchangeId: exchangeId.toLowerCase(),
      snapshot: normalizeSnapshot(payload),
    });
  });
}
