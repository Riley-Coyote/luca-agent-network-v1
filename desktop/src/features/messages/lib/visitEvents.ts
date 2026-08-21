/**
 * Visit events: the two system notes the house speaks when a resident steps
 * into a conversation for a question and when they step back out. They ride
 * as system rows (kind 40099 today, the exchange-note kind when it lands) with
 * a JSON body — the kind does not matter here, only the payload.
 *
 *   { "type": "visit_arrived", "resident": "<hex>", "exchange_id": "<hex>" }
 *   { "type": "visit_left",    "resident": "<hex>", "exchange_id": "<hex>" }
 */
export type VisitEventType = "visit_arrived" | "visit_left";

export type VisitEvent = {
  type: VisitEventType;
  /** Lowercased hex pubkey of the visiting resident. */
  resident: string;
  exchangeId: string | null;
  /** Optional human text the relay included; the UI writes its own line. */
  text: string | null;
};

type MessageLike = {
  kind?: number;
  content?: string | null;
  body?: string | null;
};

/** Parse a timeline message into a visit event, or null if it is not one. */
export function parseVisitEvent(message: MessageLike): VisitEvent | null {
  const raw = message.body ?? message.content;
  if (raw?.[0] !== "{") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const type = record.type;
  if (type !== "visit_arrived" && type !== "visit_left") return null;
  const resident =
    typeof record.resident === "string" ? record.resident.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(resident)) return null;
  return {
    type,
    resident,
    exchangeId:
      typeof record.exchange_id === "string"
        ? record.exchange_id.toLowerCase()
        : null,
    text: typeof record.text === "string" ? record.text : null,
  };
}
