import { ChevronDown } from "lucide-react";
import * as React from "react";

import type { RoomProject } from "@/features/channels/lib/roomProjects";
import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { conversationMarkSeeds } from "@/features/channels/lib/conversationMarks";
import { AgentIdentitySpecimen } from "@/shared/ui/AgentIdentitySpecimen";

/**
 * PROTOTYPE — one conversation list, the way a chat app does it.
 *
 * The single most Slack-shaped thing in this app was the sidebar TAXONOMY: a
 * `CHANNELS` section over a `DIRECT MESSAGES` section. Every consumer messenger
 * — iMessage, WhatsApp, Telegram, Signal — has exactly one list, sorted by
 * recency, with no headers and no `#`. Groups sit in the same list as one-to-one
 * chats, because a group is just "the people in it", not a different kind of
 * object.
 *
 * The one place Luca deliberately differs: a resident you have NEVER messaged
 * still appears. Your household is permanent rather than assembled out of your
 * history, so those sort to the bottom instead of being absent.
 *
 * The underlying model is untouched — channelType, visibility and roles all
 * still exist, which is what keeps the community-capable path open. This only
 * collapses what a single owner sees.
 */

export type ChatListItem = {
  channel: Channel;
  /** Display name: the resident, or the people in a group. */
  label: string;
  /** Pubkeys whose marks represent this chat. Empty for a plain room. */
  markPubkeys: string[];
};

function relativeTime(iso: string | null): string {
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

/**
 * Group rooms by project, and order the GROUPS by recency too.
 *
 * That second half is the whole difference between this and a Slack sidebar.
 * Slack's sections are a filing cabinet: fixed order, alphabetical, dead. When
 * the groups move, whatever you are actually working in floats to the top and
 * the project you have not touched in a month sinks — the rail shows your
 * current work first without being told what that is.
 *
 * Ungrouped rooms always come FIRST and carry no label. Your one-to-one chats
 * with residents have no project, so they land there — correct without needing
 * a special case, because a resident belongs to you, not to a project.
 */
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

type RowProps = {
  item: ChatListItem;
  selectedChannelId: string | null;
  unreadChannelIds: ReadonlySet<string>;
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
  onSelectChannel: (channelId: string) => void;
};

function ChatRow({
  item,
  selectedChannelId,
  unreadChannelIds,
  workingByChannelId,
  onSelectChannel,
}: RowProps) {
  const { channel, label, markPubkeys } = item;
  const isActive = channel.id === selectedChannelId;
  const isUnread = unreadChannelIds.has(channel.id);
  const working = workingByChannelId?.get(channel.id);
  const liveLabel = working
    ? working.agentCount > 1
      ? `${working.agentCount} working`
      : "working"
    : null;

  return (
    <button
      aria-label={isUnread ? `${label}, unread` : label}
      // Wearing the app's own menu-button identity rather than hand-rolling
      // active/hover colours: conversation-shell.css already owns those states.
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-md px-2 text-left outline-none",
        // Hover resolves fast enough to feel attached to the pointer without
        // flickering as the cursor crosses the list; active is instant, because
        // a press that animates feels laggy no matter how brief.
        "min-h-8 transition-colors duration-100 data-[active=true]:duration-0",
      )}
      data-active={isActive ? "true" : undefined}
      data-sidebar="menu-button"
      data-testid={`chat-row-${channel.id}`}
      onClick={() => onSelectChannel(channel.id)}
      type="button"
    >
      {/* The stack IS the multi-agent indicator — no badge, no count. Each mark
          rings in the rail's own colour so overlapping marks read as layered
          objects instead of merging into one shape. */}
      <span className="flex shrink-0 -space-x-1.5">
        {markPubkeys.map((seed) => (
          <AgentIdentitySpecimen
            accessibleName={label}
            className="ring-2 ring-sidebar"
            key={seed}
            publicKey={seed}
            size={20}
            state="present"
          />
        ))}
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          isUnread && !isActive && "font-medium text-sidebar-foreground",
        )}
        data-sidebar-row-label
      >
        {label}
      </span>

      {/* ONE trailing slot, never two, and no fixed width — a reserved column
          looks tidier in a mock and then eats the NAME on a narrow rail. */}
      <span className="flex shrink-0 justify-end">
        {isUnread && !isActive ? (
          <span
            aria-hidden
            className="size-1.5 self-center rounded-full bg-sidebar-foreground/70"
          />
        ) : liveLabel ? (
          <span className="truncate text-2xs text-sidebar-foreground/55">
            {liveLabel}…
          </span>
        ) : (
          <span className="text-2xs tabular-nums text-sidebar-foreground/35">
            {relativeTime(channel.lastMessageAt)}
          </span>
        )}
      </span>
    </button>
  );
}

const COLLAPSED_KEY = "luca.collapsedProjects.v1";

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function ChatList({
  items,
  projectByChannelId,
  selectedChannelId,
  unreadChannelIds,
  workingByChannelId,
  onSelectChannel,
}: {
  items: readonly ChatListItem[];
  projectByChannelId: ReadonlyMap<string, RoomProject>;
  selectedChannelId: string | null;
  unreadChannelIds: ReadonlySet<string>;
  /** Channels with a resident mid-turn. Replaces the timestamp while running —
   *  "what is happening" beats "when it last happened". */
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
  onSelectChannel: (channelId: string) => void;
}) {
  const groups = React.useMemo(
    () => groupChats(items, projectByChannelId),
    [items, projectByChannelId],
  );
  const [collapsed, setCollapsed] = React.useState<Set<string>>(readCollapsed);

  const toggle = React.useCallback((projectId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(projectId)) next.add(projectId);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        /* a rail that forgets its collapse state is not worth throwing over */
      }
      return next;
    });
  }, []);

  const rowProps = {
    selectedChannelId,
    unreadChannelIds,
    workingByChannelId,
    onSelectChannel,
  };

  return (
    <div className="flex flex-col px-2" data-testid="chat-list">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.project?.id ?? "__rooms");
        return (
          <div
            className="flex flex-col"
            data-testid={`chat-group-${group.project?.id ?? "ungrouped"}`}
            key={group.project?.id ?? "ungrouped"}
          >
            {/* Every section is labelled, including the ungrouped one. It is
                "Rooms": chats that belong to no project are still rooms, and an
                unlabelled block above labelled ones reads as an accident rather
                than a decision. Same treatment for all of them — an affordance
                that exists on some sections and not others feels arbitrary. */}
            <button
                aria-expanded={!isCollapsed}
                // The label IS the toggle. A permanent chevron is chrome at two
                // projects and only earns its place at ten, so it appears on
                // hover; the section reads as a signpost the rest of the time.
                className={cn(
                  "group/section flex w-full items-center gap-1 px-2 pb-1 text-left outline-none",
                  // The first section sits under the pinned nav, which already
                  // supplies the separation; later ones need their own air.
                  group.project ? "mt-3" : "mt-2",
                )}
                onClick={() => toggle(group.project?.id ?? "__rooms")}
                type="button"
              >
                <span className="truncate text-2xs font-medium uppercase tracking-[0.1em] text-sidebar-foreground/35 transition-colors group-hover/section:text-sidebar-foreground/60">
                  {group.project?.label ?? "Rooms"}
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "h-3 w-3 shrink-0 text-sidebar-foreground/40 opacity-0 transition-[opacity,transform] group-hover/section:opacity-100 group-focus-visible/section:opacity-100",
                    isCollapsed && "-rotate-90 opacity-100",
                  )}
                />
            </button>

            {isCollapsed
              ? null
              : group.items.map((item) => (
                  <ChatRow item={item} key={item.channel.id} {...rowProps} />
                ))}
          </div>
        );
      })}
    </div>
  );
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
  }));
}
