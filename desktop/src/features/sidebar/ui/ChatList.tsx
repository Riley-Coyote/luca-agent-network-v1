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
  agentActivity,
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
  tag?: string | null;
  selectedChannelId: string | null;
  unreadChannelIds: ReadonlySet<string>;
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
  onSelectChannel: (channelId: string) => void;
};

/**
 * The rail's row wears the app's menu-button identity, and the Luca shell
 * owns its states: resting, hover and active colours
 * (conversation-shell.css), colour changes at the instant token with an
 * instant press (theme.css), and focus as a 1px inset outline — the row's
 * own edge brightening in place, never a second ring. The utilities here
 * give the same focus edge anywhere the shell is not.
 */
const RAIL_FOCUS_CLASS =
  "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-foreground/50";

export const RAIL_ROW_CLASS = cn(
  "group flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 text-left outline-none transition-colors",
  RAIL_FOCUS_CLASS,
);

/** The rail's small controls — the "+" buttons and the column's close. */
export const RAIL_CONTROL_CLASS = cn(
  "flex items-center justify-center rounded-md text-ink-faint outline-none transition-colors",
  "hover:bg-sidebar-accent hover:text-sidebar-foreground",
  RAIL_FOCUS_CLASS,
);

/** An unread dot arrives at the instant token (motion.css); reduced motion,
 *  at once. It wears the shell's one signal colour (conversation-shell.css):
 *  the rail is monochrome, and this is the mark that means "something new". */
export const UNREAD_DOT_CLASS =
  "motion-enter-signal luca-signal-dot size-1.5 self-center rounded-full";

/** Every section of the rail — Projects, Agents, Runtimes — starts with the
 *  same header: one label register, one inset, one height, and one trailing
 *  slot for a control (or none). Sections keep their rhythm from space, not
 *  rules: RAIL_SECTION_CLASS is the gap above each. */
export const RAIL_SECTION_CLASS = "mt-4 flex flex-col";

export function RailSectionHeader({
  action,
  title,
}: {
  action?: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex h-7 items-center justify-between px-2 text-2xs font-medium uppercase tracking-caps-wide text-ink-faint">
      <span>{title}</span>
      {action}
    </div>
  );
}

/** The actions a list's context menu can perform on the row underneath. */
export type ChatRowMenuProps = {
  onMarkChannelRead: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkChannelUnread: (channelId: string) => void;
};

// Memoised: a column toggle, or a new message somewhere else, must not
// re-render every row in the rail. Each prop is a primitive, a collection the
// shell keeps stable, or a stable callback, so the bail-out holds.
export const ChatRow = React.memo(function ChatRow({
  item,
  testId,
  tag,
  selectedChannelId,
  unreadChannelIds,
  workingByChannelId,
  onSelectChannel,
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

  return (
    <button
      aria-label={isUnread ? `${label}, unread` : label}
      className={RAIL_ROW_CLASS}
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
            isUnread && !isActive && "text-sidebar-foreground",
          )}
          data-sidebar-row-label
        >
          {label}
        </span>
        {tag ? (
          <span
            className="truncate text-3xs uppercase tracking-caps text-ink-faint"
            data-testid="agent-column-project-tag"
          >
            {tag}
          </span>
        ) : null}
      </span>

      {/* ONE trailing slot, never two, and no fixed width — a reserved column
          looks tidier in a mock and then eats the NAME on a narrow rail. */}
      <span className="flex shrink-0 justify-end">
        {isUnread && !isActive ? (
          <span
            aria-hidden
            className={UNREAD_DOT_CLASS}
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
});

/**
 * One context menu for a whole list of rows, not one Radix root per row. The
 * list's container is the trigger; a right-click, or the keyboard's menu key
 * on a focused row, names the row underneath and the menu renders that
 * channel's actions. A right-click that lands on no row opens nothing.
 */
export function ChatRowContextMenu({
  children,
  items,
  unreadChannelIds,
  onMarkChannelRead,
  onMarkChannelUnread,
}: ChatRowMenuProps & {
  children: React.ReactElement;
  items: readonly ChatListItem[];
  unreadChannelIds: ReadonlySet<string>;
}) {
  const [channelId, setChannelId] = React.useState<string | null>(null);
  const item = channelId
    ? (items.find((candidate) => candidate.channel.id === channelId) ?? null)
    : null;
  const rowUnder = (event: React.SyntheticEvent) =>
    event.target instanceof Element
      ? (event.target
          .closest("[data-channel-id]")
          ?.getAttribute("data-channel-id") ?? null)
      : null;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenuCapture={(event) => {
          const id = rowUnder(event);
          if (!id) {
            // Not a row: nothing to offer, so the trigger below must not open.
            event.stopPropagation();
            return;
          }
          setChannelId(id);
        }}
        // A touch long-press opens without a contextmenu event; name the row
        // at the press instead.
        onPointerDownCapture={(event) => setChannelId(rowUnder(event))}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {item ? (
          <ChannelContextMenuItems
            channel={item.channel}
            hasUnread={unreadChannelIds.has(item.channel.id)}
            onMarkChannelRead={onMarkChannelRead}
            onMarkChannelUnread={onMarkChannelUnread}
          />
        ) : null}
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

const ProjectRow = React.memo(function ProjectRow({
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
      className={RAIL_ROW_CLASS}
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
          isUnread && !isActive && "text-sidebar-foreground",
        )}
      >
        {project.label}
      </span>
      <span className="flex shrink-0 justify-end">
        {isUnread && !isActive ? (
          <span aria-hidden className={UNREAD_DOT_CLASS} />
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
});

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
  showProjects = true,
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
  /** Local mode has no git backend, so the whole PROJECTS section — header,
   *  rows and the "New project" entry — is withheld. Loose rooms still show. */
  showProjects?: boolean;
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
  };
  const looseRooms = groups.find((group) => group.project === null);
  // Per resident: the newest thing said anywhere they are, and whether any of
  // it is unread. The rail row wears that instead of a per-chat clock.
  const activityByPubkey = React.useMemo(() => {
    const map = new Map<string, AgentRailActivity>();
    for (const [pubkey, activity] of agentActivity(
      items,
      agents,
      unreadChannelIds,
    )) {
      map.set(pubkey, {
        recent: relativeTime(activity.newest),
        unread: activity.unread,
      });
    }
    return map;
  }, [agents, items, unreadChannelIds]);
  // A chat with any managed resident in it belongs in that resident's column,
  // judged on the whole membership — not the few marks the row can wear.
  const unaffiliatedDirectMessages = React.useMemo(() => {
    const knownAgents = new Set(
      agents.map((agent) => agent.pubkey.toLowerCase()),
    );
    return directMessages.filter(
      (item) =>
        !item.participants.some((pubkey) =>
          knownAgents.has(pubkey.toLowerCase()),
        ),
    );
  }, [agents, directMessages]);
  const groupsByProjectId = React.useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.project ? [[group.project.id, group] as const] : [],
        ),
      ),
    [groups],
  );
  const orderedProjects = React.useMemo(
    () =>
      [...projects].sort((a, b) => {
        const aRecent = groupsByProjectId.get(a.id)?.mostRecent ?? 0;
        const bRecent = groupsByProjectId.get(b.id)?.mostRecent ?? 0;
        return bRecent !== aRecent
          ? bRecent - aRecent
          : a.label.localeCompare(b.label);
      }),
    [groupsByProjectId, projects],
  );
  const effectiveProjectId =
    selectedProjectId ??
    (selectedChannelId
      ? (projectByChannelId.get(selectedChannelId)?.id ?? null)
      : null);

  return (
    <ChatRowContextMenu
      items={items}
      onMarkChannelRead={onMarkChannelRead}
      onMarkChannelUnread={onMarkChannelUnread}
      unreadChannelIds={unreadChannelIds}
    >
      <div className="flex flex-col px-2" data-testid="chat-list">
        <div className="mt-2 flex flex-col" data-testid="chat-channels">
          {showProjects ? (
            <>
              <RailSectionHeader
                action={
                  <button
                    aria-label="New project"
                    className={cn(RAIL_CONTROL_CLASS, "-mr-1 size-6")}
                    data-testid="create-channel"
                    onClick={onCreateProject}
                    title="New project"
                    type="button"
                  >
                    <Plus className="size-3.5" />
                  </button>
                }
                title="Projects"
              />
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
                  className={cn(
                    RAIL_CONTROL_CLASS,
                    "min-h-8 justify-start gap-2.5 px-2 text-left text-sm",
                  )}
                  onClick={onCreateProject}
                  type="button"
                >
                  <span className="flex size-5 items-center justify-center">
                    <Plus className="size-3.5" />
                  </span>
                  New project
                </button>
              ) : null}
            </>
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
    </ChatRowContextMenu>
  );
}
