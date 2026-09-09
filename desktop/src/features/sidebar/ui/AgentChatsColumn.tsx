import {
  ArrowLeft,
  MessageCircle,
  MessagesSquare,
  Plus,
  X,
} from "lucide-react";

import type { RoomProject } from "@/features/channels/lib/roomProjects";
import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import type { AgentRailAgent } from "@/features/sidebar/ui/AgentRail";
import {
  type ChatListItem,
  isMultiParticipantChat,
  relativeTime,
  sortChats,
} from "@/features/sidebar/lib/chatListModel";
import { cn } from "@/shared/lib/cn";

/**
 * The agent column: everything you and one resident have talked about, in
 * one place, beside the rail. A chat that lives in a project wears the
 * project's name as a tag — the room's home, said quietly, so the column
 * reads as a person's history rather than a list of channels.
 */
export function AgentChatsColumn({
  agent,
  items,
  mobile = false,
  onClose,
  onNewChat,
  onSelectChannel,
  projectByChannelId,
  selectedChannelId,
  unreadChannelIds,
}: {
  agent: AgentRailAgent;
  items: readonly ChatListItem[];
  /** In the mobile sheet the column takes the rail's place rather than
   *  sitting beside it, and the close control reads as "back". */
  mobile?: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onSelectChannel: (channelId: string) => void;
  projectByChannelId: ReadonlyMap<string, RoomProject>;
  selectedChannelId: string | null;
  unreadChannelIds: ReadonlySet<string>;
}) {
  const ordered = sortChats(items);
  const wanted = agent.pubkey.toLowerCase();
  // The direct thread with this resident is a single durable conversation.
  // Once it exists the column lists it like any other chat; until then the
  // column offers to start it — and says so, rather than promising a "new"
  // chat that would resolve to the same thread.
  const hasDirectChat = items.some(
    (item) =>
      item.channel.channelType === "dm" &&
      item.participants.length === 1 &&
      item.participants[0].toLowerCase() === wanted,
  );
  return (
    <aside
      aria-label={`Chats with ${agent.name}`}
      className={cn(
        "flex flex-col bg-sidebar",
        mobile
          ? "min-h-0 w-full flex-1"
          : "absolute inset-y-0 left-(--sidebar-rail-width) z-20 w-(--agent-column-width) border-l border-border/50",
      )}
      data-testid="agent-chats-column"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <ResidentIdentityMark
          accessibleName={agent.name}
          className="luca-identity-breath text-foreground"
          decorative
          personaId={agent.personaId}
          presentation="glyph"
          publicKey={agent.pubkey}
          size={15}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate text-sm text-foreground">{agent.name}</span>
        </span>
        <button
          aria-label={
            mobile ? "Back to agents" : `Close chats with ${agent.name}`
          }
          className="flex size-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          onClick={onClose}
          type="button"
        >
          {mobile ? (
            <ArrowLeft className="size-3.5" />
          ) : (
            <X className="size-3.5" />
          )}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {hasDirectChat ? null : (
          <button
            className="flex min-h-8 items-center gap-2.5 rounded-md px-2 text-left text-sm text-ink-faint transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            data-testid="agent-column-new-chat"
            onClick={onNewChat}
            type="button"
          >
            <span className="flex size-5 items-center justify-center">
              <Plus className="size-3.5" />
            </span>
            Chat with {agent.name}
          </button>
        )}

        {ordered.map((item) => {
          const { channel, label } = item;
          const isActive = channel.id === selectedChannelId;
          const isUnread = unreadChannelIds.has(channel.id) && !isActive;
          const project = projectByChannelId.get(channel.id) ?? null;
          const group = isMultiParticipantChat(item);
          // The direct thread wears the resident's own name, like every
          // other row: a person's chats, not a list of channel types.
          const title = label;
          return (
            <button
              aria-label={isUnread ? `${title}, unread` : title}
              className={cn(
                "group flex min-h-8 w-full items-center gap-2.5 rounded-md px-2 text-left outline-none",
                "transition-colors duration-100 data-[active=true]:duration-0",
              )}
              data-active={isActive ? "true" : undefined}
              data-sidebar="menu-button"
              data-testid={`agent-column-chat-${channel.name}`}
              key={channel.id}
              onClick={() => onSelectChannel(channel.id)}
              type="button"
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-ink-faint">
                {group ? (
                  <MessagesSquare aria-hidden className="size-3.5" />
                ) : (
                  <MessageCircle aria-hidden className="size-3.5" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span
                  className={cn(
                    "truncate text-sm",
                    isUnread && "font-medium text-sidebar-foreground",
                  )}
                >
                  {title}
                </span>
                {project ? (
                  <span
                    className="truncate text-3xs uppercase tracking-caps text-ink-faint"
                    data-testid="agent-column-project-tag"
                  >
                    {project.label}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 justify-end">
                {isUnread ? (
                  <span
                    aria-hidden
                    className="size-1.5 self-center rounded-full bg-sidebar-foreground/70"
                  />
                ) : (
                  <span className="text-2xs tabular-nums text-ink-faint">
                    {relativeTime(channel.lastMessageAt)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
