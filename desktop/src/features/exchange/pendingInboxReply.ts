type ReplyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PendingInboxOperation = "reply" | "continuation" | "new-message";
type PendingReply = {
  hash: string;
  idempotencyKey: string;
  replyEventId?: string;
  operation?: PendingInboxOperation;
  exchangeId?: string;
};
const prefix = "luca.inbox-pending-reply.v1:";

/** Only correlation metadata is stored here; the production draft owns content. */
export function pendingInboxReplyTarget(
  draftKey: string,
  storage: ReplyStorage = localStorage,
): string | undefined {
  try {
    const entry = JSON.parse(
      storage.getItem(prefix + draftKey) ?? "null",
    ) as PendingReply | null;
    return entry?.replyEventId && /^[0-9a-f]{64}$/i.test(entry.replyEventId)
      ? entry.replyEventId
      : undefined;
  } catch {
    return undefined;
  }
}

/** Persist retry identity before send; unchanged drafts survive task/window switches. */
export async function pendingInboxReplyKey(
  draftKey: string,
  fingerprint: string,
  replyEventId?: string,
  storage: ReplyStorage = localStorage,
): Promise<string> {
  return (
    await pendingInboxReplyRequest(
      draftKey,
      fingerprint,
      "reply",
      replyEventId,
      storage,
    )
  ).idempotencyKey;
}

/** Uncertain sends retain their operation even when current task phase changes. */
export async function pendingInboxReplyRequest(
  draftKey: string,
  fingerprint: string,
  operation: PendingInboxOperation,
  replyEventId?: string,
  storage: ReplyStorage = localStorage,
  exchangeId?: string,
): Promise<{
  idempotencyKey: string;
  operation: PendingInboxOperation;
  replyEventId?: string;
  exchangeId?: string;
}> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(fingerprint),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  let previous: PendingReply | null = null;
  try {
    previous = JSON.parse(
      storage.getItem(prefix + draftKey) ?? "null",
    ) as PendingReply | null;
  } catch {
    throw new Error(
      "The existing request identity could not be read. Nothing new was sent.",
    );
  }
  if (
    previous?.hash === hash &&
    typeof previous.idempotencyKey === "string" &&
    previous.idempotencyKey
  )
    return {
      idempotencyKey: previous.idempotencyKey,
      operation: previous.operation ?? "reply",
      replyEventId: previous.replyEventId,
      exchangeId: previous.exchangeId,
    };
  const next: PendingReply = {
    hash,
    idempotencyKey: crypto.randomUUID(),
    replyEventId,
    operation,
    exchangeId,
  };
  try {
    storage.setItem(prefix + draftKey, JSON.stringify(next));
  } catch {
    throw new Error(
      "The request identity could not be saved. Nothing was sent; free local storage and try again.",
    );
  }
  return {
    idempotencyKey: next.idempotencyKey,
    operation,
    replyEventId,
    exchangeId,
  };
}

/** A late acknowledgement must not erase a newer edited draft's request key. */
export function clearPendingInboxReply(
  draftKey: string,
  idempotencyKey: string,
  storage: ReplyStorage = localStorage,
): void {
  try {
    const entry = JSON.parse(
      storage.getItem(prefix + draftKey) ?? "null",
    ) as PendingReply | null;
    if (entry?.idempotencyKey === idempotencyKey)
      storage.removeItem(prefix + draftKey);
  } catch {
    throw new Error(
      "Your reply was accepted, but its local confirmation could not be saved. Retry the unchanged draft to reconcile it.",
    );
  }
}
