import { formatTimelineMessages } from "@/features/messages/lib/formatTimelineMessages";
import type { ManagedPresentationRow } from "@/features/messages/managedPresentationTypes";
import type { Channel, RelayEvent } from "@/shared/api/types";
import {
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";
import type { QuickChatMessage } from "./types";

/** Use the main timeline's trusted authorship/edit/delete projection before merging public streams. */
export function projectQuickChatMessages(
  events: RelayEvent[],
  streams: readonly ManagedPresentationRow[],
  channel: Channel | null,
  owner: string,
  resident: string | null,
  relaySelfPubkey?: string | null,
): QuickChatMessage[] {
  const normalizedOwner = owner.toLowerCase();
  const normalizedResident = resident?.toLowerCase();
  const rows = formatTimelineMessages(
    events,
    channel,
    owner,
    null,
    undefined,
    undefined,
    undefined,
    undefined,
    relaySelfPubkey,
  )
    .filter(
      (row) =>
        (row.kind === KIND_STREAM_MESSAGE ||
          row.kind === KIND_STREAM_MESSAGE_V2) &&
        (row.pubkey === normalizedOwner || row.pubkey === normalizedResident),
    )
    .map((row) => ({
      id: row.id,
      role:
        row.pubkey === normalizedOwner
          ? ("owner" as const)
          : ("assistant" as const),
      text: row.body,
      pending: row.pending,
      at: row.createdAt * 1000,
    }));
  const signedIds = new Set(events.map((event) => event.id));
  for (const stream of streams) {
    if (
      !stream.publicText ||
      stream.residentPubkey.toLowerCase() !== normalizedResident ||
      (stream.finalMessageId && signedIds.has(stream.finalMessageId))
    )
      continue;
    rows.push({
      id: `${stream.dispatchReceiptId}:${stream.sessionEpoch}`,
      role: "assistant",
      text: stream.publicText,
      pending: stream.phase !== "failed" && stream.phase !== "cancelled",
      at: stream.anchorAt,
    });
  }
  return rows
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .map(({ at: _at, ...row }) => row);
}
