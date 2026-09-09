import * as React from "react";
import { MessageCircle, MessagesSquare, Plus } from "lucide-react";

import {
  readLastProjectRoom,
  type RoomProject,
} from "@/features/channels/lib/roomProjects";
import { ProjectTypeIcon } from "@/features/channels/ui/ConversationTypeIcon";
import {
  AgentRail,
  type AgentRailActivity,
  type AgentRailAgent,
} from "@/features/sidebar/ui/AgentRail";
import { ChannelContextMenuItems } from "@/features/sidebar/ui/ChannelContextMenu";
import { cn } from "@/shared/lib/cn";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";

import {
  buildChatListItems,
  type ChatGroup,
  type ChatListItem,
  chatsWithAgent,
  groupChats,
  isMultiParticipantChat,
  partitionConversationItems,
  relativeTime,
  sortChats,
} from "@/features/sidebar/lib/chatListModel";

export {
  buildChatListItems,
  type ChatGroup,
  type ChatListItem,
  chatsWithAgent,
  groupChats,
  isMultiParticipantChat,
  partitionConversationItems,
  relativeTime,
  sortChats,
};

/**
 * Luca's persistent conversation rail.
 *
 * Direct messages and loose rooms remain immediately selectable under Rooms.
 * Project-bound rooms are represented by one project row and become legible in
 * the contextual room navigator after selection. The underlying channel model
 * and canonical room routes remain unchanged.
 */

export type ChatRowProps = {
  item: ChatListItem;
  /** Where the row lives, for tests; defaults to the rail's channel-<name>. */
  testId?: string;
  /** A quiet second line under the label — the agent column's project tag. */
  detail?: React.ReactNode;
  selectedChannelId: string | null;
  unreadChannelIds: ReadonlySet<string>;
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
  onSelectChannel: (channelId: string) => void;
  onMarkChannelRead: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkChannelUnread: (channelId: string) => void;
};

export function ChatRow({
  item,
  testId,
  detail,
  selectedChannelId,
  unreadChannelIds,
  workingByChannelId,
  onSelectChannel,
  onMarkChannelRead,
  onMarkChannelUnread,
}: ChatRowProps) {
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

  const row = (
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
      data-testid={testId ?? `channel-${channel.name}`}
      onClick={() => onSelectChannel(channel.id)}
      type="button"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-ink-faint">
        {isMultiParticipant ? (
          <MessagesSquare aria-hidden className="size-3.5" />
        ) : (
          <MessageCircle aria-hidden className="size-3.5" />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate text-sm",
            isUnread && !isActive && "font-medium text-sidebar-foreground",
          )}
          data-sidebar-row-label
        >
          {label}
        </span>
        {detail}
      </span>

      {/* ONE trailing slot, never two, and no fixed width — a reserved column
          looks tidier in a mock and then eats the NAME on a narrow rail. */}
      <span className="flex shrink-0 justify-end">
        {isUnread && !isActive ? (
          <span
            aria-hidden
            className="size-1.5 self-center rounded-full bg-sidebar-foreground/70"
            data-testid={`channel-unread-${channel.name}`}
          />
        ) : liveLabel ? (
          <span className="truncate text-2xs text-ink-faint">{liveLabel}…</span>
        ) : (
          <span className="text-2xs tabular-nums text-ink-faint">
            {relativeTime(channel.lastMessageAt)}
          </span>
        )}
      </span>
    </button>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ChannelContextMenuItems
          channel={channel}
          hasUnread={isUnread}
          onMarkChannelRead={onMarkChannelRead}
          onMarkChannelUnread={onMarkChannelUnread}
        />
      </ContextMenuContent>
    </ContextMenu>
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
      <span className="flex size-5 shrink-0 items-center justify-center text-ink-faint">
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
          <span className="truncate text-2xs text-ink-faint">
            {workingCount > 1 ? `${workingCount} working` : "working"}…
          </span>
        ) : (
          <span className="text-2xs tabular-nums text-ink-faint">
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
  onMarkChannelRead,
  onMarkChannelUnread,
  onSelectProject,
  onCreateProject,
  onCreateAgent,
  projects,
  selectedProjectId,
  agents,
  selectedAgentPubkey,
  onSelectAgent,
}: {
  /** The residents the rail lists, in display order. */
  agents: readonly AgentRailAgent[];
  selectedAgentPubkey: string | null;
  onSelectAgent: (pubkey: string) => void;
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
  onMarkChannelRead: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkChannelUnread: (channelId: string) => void;
  onSelectProject: (projectId: string, preferredRoomId: string | null) => void;
  onCreateProject: () => void;
  onCreateAgent: () => void;
}) {
  const { channels, directMessages } = React.useMemo(
    () => partitionConversationItems(items),
    [items],
  );
  const groups = React.useMemo(
    () => groupChats(channels, projectByChannelId),
    [channels, projectByChannelId],
  );
  const rowProps = {
    selectedChannelId,
    unreadChannelIds,
    workingByChannelId,
    onSelectChannel,
    onMarkChannelRead,
    onMarkChannelUnread,
  };
  const looseRooms = groups.find((group) => group.project === null);
  // Per resident: the newest thing said anywhere they are, and whether any of
  // it is unread. The rail row wears that instead of a per-chat clock.
  const activityByPubkey = React.useMemo(() => {
    const map = new Map<string, AgentRailActivity>();
    for (const agent of agents) {
      const mine = chatsWithAgent(items, agent.pubkey);
      const newest = sortChats(mine)[0]?.channel.lastMessageAt ?? null;
      map.set(agent.pubkey.toLowerCase(), {
        recent: relativeTime(newest),
        unread: mine.some((item) => unreadChannelIds.has(item.channel.id)),
      });
    }
    return map;
  }, [agents, items, unreadChannelIds]);
  const knownAgents = new Set(
    agents.map((agent) => agent.pubkey.toLowerCase()),
  );
  // A chat with any managed resident in it belongs in that resident's column,
  // judged on the whole membership — not the few marks the row can wear.
  const unaffiliatedDirectMessages = directMessages.filter(
    (item) =>
      !item.participants.some((pubkey) =>
        knownAgents.has(pubkey.toLowerCase()),
      ),
  );
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
      <div className="mt-2 flex flex-col" data-testid="chat-channels">
        <div className="flex items-center justify-between px-2 pb-1 text-2xs font-medium uppercase tracking-caps-wide text-ink-faint">
          <span>Projects</span>
          <button
            aria-label="New project"
            className="-mr-1 flex size-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            data-testid="create-channel"
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
            className="flex min-h-8 items-center gap-2.5 rounded-md px-2 text-left text-sm text-ink-faint transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={onCreateProject}
            type="button"
          >
            <span className="flex size-5 items-center justify-center">
              <Plus className="size-3.5" />
            </span>
            New project
          </button>
        ) : null}
        {looseRooms?.items.map((item) => (
          <ChatRow item={item} key={item.channel.id} {...rowProps} />
        ))}
      </div>

      <AgentRail
        activityByPubkey={activityByPubkey}
        agents={agents}
        onCreateAgent={onCreateAgent}
        onSelectAgent={onSelectAgent}
        selectedAgentPubkey={selectedAgentPubkey}
      />
      {unaffiliatedDirectMessages.map((item) => (
        <ChatRow item={item} key={item.channel.id} {...rowProps} />
      ))}
    </div>
  );
}
