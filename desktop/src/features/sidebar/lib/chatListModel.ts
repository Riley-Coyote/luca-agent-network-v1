import type { RoomProject } from "@/features/channels/lib/roomProjects";
import { conversationMarkSeeds } from "@/features/channels/lib/conversationMarks";
import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * The rail's conversation model — grouping, ordering, membership — with no
 * React and no assets, so it can be unit-tested under node and reused by
 * the agent column without dragging the component tree along.
 */

export type ChatListItem = {
  channel: Channel;
  /** Display name: the resident, or the people in a group. */
  label: string;
  /** Other participants represented by this chat's marks (display seeds). */
  markPubkeys: string[];
  /** Everyone in the chat but the owner — the full membership, which is what
   *  decides whose column a chat belongs in. */
  participants: string[];
};

/** Full membership minus the owner; participants first, members as fallback. */
export function chatParticipants(
  channel: Pick<Channel, "participantPubkeys" | "memberPubkeys">,
  currentPubkey?: string | null,
): string[] {
  const me = currentPubkey ? normalizePubkey(currentPubkey) : null;
  const source = channel.participantPubkeys?.length
    ? channel.participantPubkeys
    : (channel.memberPubkeys ?? []);
  return source.filter((pubkey) => normalizePubkey(pubkey) !== me);
}

export function partitionConversationItems(items: readonly ChatListItem[]) {
  const channels: ChatListItem[] = [];
  const directMessages: ChatListItem[] = [];

  for (const item of items) {
    if (item.channel.channelType === "dm") directMessages.push(item);
    else channels.push(item);
  }

  return {
    channels,
    directMessages: sortChats(directMessages),
  };
}

/** Every chat a resident is part of — direct, group, or a project room. */
export function chatsWithAgent(
  items: readonly ChatListItem[],
  pubkey: string,
): ChatListItem[] {
  const wanted = normalizePubkey(pubkey);
  return items.filter((item) =>
    item.participants.some(
      (candidate) => normalizePubkey(candidate) === wanted,
    ),
  );
}

export type AgentActivity = {
  /** Newest message in any chat with the resident, as an ISO time. */
  newest: string | null;
  unread: boolean;
};

/**
 * Per resident: the newest thing said anywhere they are, and whether any of
 * it is unread. One pass over the chats, indexed by participant, rather than
 * a filter and a sort per resident. Keyed by the resident's lowercased
 * pubkey, as the rail looks it up.
 */
export function agentActivity(
  items: readonly ChatListItem[],
  agents: readonly { pubkey: string }[],
  unreadChannelIds: ReadonlySet<string>,
): Map<string, AgentActivity> {
  const byParticipant = new Map<string, AgentActivity>();
  const byPubkey = new Map<string, AgentActivity>();
  for (const agent of agents) {
    const activity: AgentActivity = { newest: null, unread: false };
    byParticipant.set(normalizePubkey(agent.pubkey), activity);
    byPubkey.set(agent.pubkey.toLowerCase(), activity);
  }
  if (byParticipant.size === 0) return byPubkey;
  for (const item of items) {
    const at = item.channel.lastMessageAt ?? null;
    const unread = unreadChannelIds.has(item.channel.id);
    for (const participant of item.participants) {
      const activity = byParticipant.get(normalizePubkey(participant));
      if (!activity) continue;
      if (
        at &&
        (activity.newest === null ||
          Date.parse(at) > Date.parse(activity.newest))
      ) {
        activity.newest = at;
      }
      if (unread) activity.unread = true;
    }
  }
  return byPubkey;
}

/** Keep rail semantics binary: one counterpart or a group conversation. */
export function isMultiParticipantChat(
  item: Pick<ChatListItem, "markPubkeys">,
): boolean {
  return item.markPubkeys.length > 1;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

export type ChatGroup = {
  /** null = no project. These are your own rooms — resident chats, loose work. */
  project: RoomProject | null;
  items: ChatListItem[];
  /** Newest activity anywhere in the group, which is what orders the groups. */
  mostRecent: number;
};

/** Group rooms by project for global-rail projection and project selection. */
export function groupChats(
  items: readonly ChatListItem[],
  projectByChannelId: ReadonlyMap<string, RoomProject>,
): ChatGroup[] {
  const lastActive = (item: ChatListItem) =>
    item.channel.lastMessageAt ? Date.parse(item.channel.lastMessageAt) : 0;

  const groups = new Map<string, ChatGroup>();
  for (const item of items) {
    const project = projectByChannelId.get(item.channel.id) ?? null;
    const key = project?.id ?? "";
    let group = groups.get(key);
    if (!group) {
      group = { project, items: [], mostRecent: 0 };
      groups.set(key, group);
    }
    group.items.push(item);
    group.mostRecent = Math.max(group.mostRecent, lastActive(item));
  }

  for (const group of groups.values()) group.items = sortChats(group.items);

  return [...groups.values()].sort((a, b) => {
    if (!a.project) return -1;
    if (!b.project) return 1;
    if (a.mostRecent !== b.mostRecent) return b.mostRecent - a.mostRecent;
    return a.project.label.localeCompare(b.project.label);
  });
}

/** Recency first; never-messaged residents fall to the bottom, alphabetically,
 *  so the list has a stable tail rather than an arbitrary one. */
export function sortChats(items: readonly ChatListItem[]): ChatListItem[] {
  return [...items].sort((a, b) => {
    const at = a.channel.lastMessageAt
      ? Date.parse(a.channel.lastMessageAt)
      : 0;
    const bt = b.channel.lastMessageAt
      ? Date.parse(b.channel.lastMessageAt)
      : 0;
    if (at !== bt) return bt - at;
    return a.label.localeCompare(b.label);
  });
}

/** Build list items from the raw channel set, resolving each chat's marks. */
export function buildChatListItems({
  channels,
  labels,
  currentPubkey,
}: {
  channels: readonly Channel[];
  /** Resolved display names by channel id. A plain record, matching
   *  what the DM label hook already returns. */
  labels: Readonly<Record<string, string>>;
  currentPubkey?: string | null;
}): ChatListItem[] {
  return channels.map((channel) => ({
    channel,
    label: labels[channel.id] ?? channel.name,
    markPubkeys: conversationMarkSeeds(channel, currentPubkey, 3),
    participants: chatParticipants(channel, currentPubkey),
  }));
}
