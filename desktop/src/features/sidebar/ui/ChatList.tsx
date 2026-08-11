import * as React from "react";
import { MessageCircle, MessagesSquare, Plus } from "lucide-react";

import {
  readLastProjectRoom,
  type RoomProject,
} from "@/features/channels/lib/roomProjects";
import { ProjectTypeIcon } from "@/features/channels/ui/ConversationTypeIcon";
import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { conversationMarkSeeds } from "@/features/channels/lib/conversationMarks";

/**
 * Luca's persistent conversation rail.
 *
 * Direct messages and loose rooms remain immediately selectable under Rooms.
 * Project-bound rooms are represented by one project row and become legible in
 * the contextual room navigator after selection. The underlying channel model
 * and canonical room routes remain unchanged.
 */

export type ChatListItem = {
  channel: Channel;
  /** Display name: the resident, or the people in a group. */
  label: string;
  /** Other participants represented by this chat. */
  markPubkeys: string[];
};

/** Keep rail semantics binary: one counterpart or a group conversation. */
export function isMultiParticipantChat(
  item: Pick<ChatListItem, "markPubkeys">,
): boolean {
  return item.markPubkeys.length > 1;
}

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
  const { channel, label } = item;
  const isActive = channel.id === selectedChannelId;
  const isUnread = unreadChannelIds.has(channel.id);
  const isMultiParticipant = isMultiParticipantChat(item);
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
      data-channel-id={channel.id}
      data-testid={`channel-${channel.name}`}
      onClick={() => onSelectChannel(channel.id)}
      type="button"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-sidebar-foreground/45">
        {isMultiParticipant ? (
          <MessagesSquare aria-hidden className="size-3.5" />
        ) : (
          <MessageCircle aria-hidden className="size-3.5" />
        )}
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

type ProjectRowProps = {
  group: ChatGroup;
  isActive: boolean;
  unreadChannelIds: ReadonlySet<string>;
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
  onSelectProject: (projectId: string, preferredRoomId: string | null) => void;
};

function ProjectRow({
  group,
  isActive,
  unreadChannelIds,
  workingByChannelId,
  onSelectProject,
}: ProjectRowProps) {
  const project = group.project;
  if (!project) return null;

  const isUnread = group.items.some((item) =>
    unreadChannelIds.has(item.channel.id),
  );
  const workingCount = group.items.reduce(
    (count, item) =>
      count + (workingByChannelId?.get(item.channel.id)?.agentCount ?? 0),
    0,
  );
  const remembered = readLastProjectRoom(project.id);
  const preferredRoomId = group.items.some(
    (item) => item.channel.id === remembered,
  )
    ? remembered
    : (group.items[0]?.channel.id ?? null);

  return (
    <button
      aria-label={isUnread ? `${project.label}, unread` : project.label}
      className={cn(
        "group flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 text-left outline-none",
        "transition-colors duration-100 data-[active=true]:duration-0",
      )}
      data-active={isActive ? "true" : undefined}
      data-sidebar="menu-button"
      data-testid={`project-row-${project.id}`}
      onClick={() => onSelectProject(project.id, preferredRoomId)}
      type="button"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-sidebar-foreground/45">
        <ProjectTypeIcon className="size-3.5" />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          isUnread && !isActive && "font-medium text-sidebar-foreground",
        )}
      >
        {project.label}
      </span>
      <span className="flex shrink-0 justify-end">
        {isUnread && !isActive ? (
          <span
            aria-hidden
            className="size-1.5 self-center rounded-full bg-sidebar-foreground/70"
          />
        ) : workingCount > 0 ? (
          <span className="truncate text-2xs text-sidebar-foreground/55">
            {workingCount > 1 ? `${workingCount} working` : "working"}…
          </span>
        ) : (
          <span className="text-2xs tabular-nums text-sidebar-foreground/35">
            {relativeTime(
              group.items.find((item) => item.channel.lastMessageAt)?.channel
                .lastMessageAt ?? null,
            )}
          </span>
        )}
      </span>
    </button>
  );
}

export function ChatList({
  items,
  projectByChannelId,
  selectedChannelId,
  unreadChannelIds,
  workingByChannelId,
  onSelectChannel,
  onSelectProject,
  onCreateProject,
  onCreateRoom,
  projects,
  selectedProjectId,
}: {
  items: readonly ChatListItem[];
  projectByChannelId: ReadonlyMap<string, RoomProject>;
  projects: readonly RoomProject[];
  selectedChannelId: string | null;
  selectedProjectId?: string | null;
  unreadChannelIds: ReadonlySet<string>;
  /** Channels with a resident mid-turn. Replaces the timestamp while running —
   *  "what is happening" beats "when it last happened". */
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
  onSelectChannel: (channelId: string) => void;
  onSelectProject: (projectId: string, preferredRoomId: string | null) => void;
  onCreateProject: () => void;
  onCreateRoom: () => void;
}) {
  const groups = React.useMemo(
    () => groupChats(items, projectByChannelId),
    [items, projectByChannelId],
  );
  const rowProps = {
    selectedChannelId,
    unreadChannelIds,
    workingByChannelId,
    onSelectChannel,
  };
  const looseRooms = groups.find((group) => group.project === null);
  const groupsByProjectId = new Map(
    groups.flatMap((group) =>
      group.project ? [[group.project.id, group] as const] : [],
    ),
  );
  const orderedProjects = [...projects].sort((a, b) => {
    const aRecent = groupsByProjectId.get(a.id)?.mostRecent ?? 0;
    const bRecent = groupsByProjectId.get(b.id)?.mostRecent ?? 0;
    return bRecent !== aRecent
      ? bRecent - aRecent
      : a.label.localeCompare(b.label);
  });
  const effectiveProjectId =
    selectedProjectId ??
    (selectedChannelId
      ? (projectByChannelId.get(selectedChannelId)?.id ?? null)
      : null);

  return (
    <div className="flex flex-col px-2" data-testid="chat-list">
      <div className="mt-2 flex flex-col" data-testid="chat-projects">
        <div className="flex items-center justify-between px-2 pb-1 text-2xs font-medium uppercase tracking-[0.1em] text-sidebar-foreground/35">
          <span>Projects</span>
          <button
            aria-label="New project"
            className="-mr-1 flex size-6 items-center justify-center rounded-md text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            data-testid="create-room-project"
            onClick={onCreateProject}
            title="New project"
            type="button"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        {orderedProjects.map((project) => {
          const group =
            groupsByProjectId.get(project.id) ??
            ({ project, items: [], mostRecent: 0 } satisfies ChatGroup);
          return (
            <ProjectRow
              group={group}
              isActive={effectiveProjectId === project.id}
              key={project.id}
              onSelectProject={onSelectProject}
              unreadChannelIds={unreadChannelIds}
              workingByChannelId={workingByChannelId}
            />
          );
        })}
        {orderedProjects.length === 0 ? (
          <button
            className="flex min-h-8 items-center gap-2.5 rounded-md px-2 text-left text-sm text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={onCreateProject}
            type="button"
          >
            <span className="flex size-5 items-center justify-center">
              <Plus className="size-3.5" />
            </span>
            New project
          </button>
        ) : null}
      </div>

      <div
        className={cn("flex flex-col", "mt-3")}
        data-testid="chat-group-ungrouped"
      >
        <div className="flex items-center justify-between px-2 pb-1 text-2xs font-medium uppercase tracking-[0.1em] text-sidebar-foreground/35">
          <span>Rooms</span>
          <button
            aria-label="New room"
            className="-mr-1 flex size-6 items-center justify-center rounded-md text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            data-testid="create-room"
            onClick={onCreateRoom}
            title="New room"
            type="button"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        {looseRooms?.items.map((item) => (
          <ChatRow item={item} key={item.channel.id} {...rowProps} />
        ))}
      </div>
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
