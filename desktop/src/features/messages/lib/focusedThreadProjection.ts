import { projectManagedTimelineMessages } from "@/features/messages/lib/managedTimelineProjection";
import {
  buildFocusedThreadEntries,
  buildMainTimelineEntries,
  type MainTimelineEntry,
} from "@/features/messages/lib/threadPanel";
import type { ManagedResponseSlot } from "@/features/messages/managedPresentationTypes";
import type { TimelineMessage } from "@/features/messages/types";
import type { UserProfileLookup } from "@/features/profile/lib/identity";

export type FocusedThreadProjection = {
  entries: MainTimelineEntry[];
  head: TimelineMessage | null;
  messages: TimelineMessage[];
};

type FocusedThreadProjectionInput = {
  focusedHeadId: string | null;
  managedResponseSlots: readonly ManagedResponseSlot[];
  profiles?: UserProfileLookup;
  residentPersonaIdLookup?: ReadonlyMap<string, string | null>;
  roomMessages: readonly TimelineMessage[];
  threadHeadMessage: TimelineMessage | null;
  threadMessages: readonly MainTimelineEntry[];
};

function uniqueMessages(
  messages: readonly (TimelineMessage | null)[],
): TimelineMessage[] {
  const seen = new Set<string>();
  return messages.filter((message): message is TimelineMessage => {
    if (!message || seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

/**
 * Compose the focused thread from its authoritative independent query and the
 * process-memory response slots for that thread surface. Room projection data
 * is used only as a fallback for the selected head, never as reply history.
 */
export function projectFocusedThreadTimeline(
  input: FocusedThreadProjectionInput,
): FocusedThreadProjection {
  if (!input.focusedHeadId) {
    return { entries: [], head: null, messages: [] };
  }

  const head =
    input.threadHeadMessage ??
    input.roomMessages.find((message) => message.id === input.focusedHeadId) ??
    null;
  if (!head) return { entries: [], head: null, messages: [] };

  const authoritativeEntryById = new Map(
    input.threadMessages.map((entry) => [entry.message.id, entry]),
  );
  const authoritativeMessages = uniqueMessages([
    head,
    ...input.threadMessages.map((entry) => entry.message),
  ]);
  const projectedMessages = projectManagedTimelineMessages(
    authoritativeMessages,
    input.managedResponseSlots,
    input.profiles,
    input.residentPersonaIdLookup,
    "thread",
  ).messages;
  const entries = buildFocusedThreadEntries(
    buildMainTimelineEntries(
      projectedMessages,
      new Set(),
      new Map(),
      input.profiles,
      true,
    ),
    input.focusedHeadId,
  ).map((entry) => {
    const authoritative = authoritativeEntryById.get(entry.message.id);
    return authoritative ? { ...entry, summary: authoritative.summary } : entry;
  });

  return { entries, head, messages: projectedMessages };
}
