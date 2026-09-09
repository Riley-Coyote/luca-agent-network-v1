import * as React from "react";
import { ArrowLeft, Plus, X } from "lucide-react";

import type { RoomProject } from "@/features/channels/lib/roomProjects";
import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import type { AgentRailAgent } from "@/features/sidebar/ui/AgentRail";
import {
  ChatRow,
  ChatRowContextMenu,
  type ChatRowMenuProps,
  type ChatRowProps,
  RAIL_CONTROL_CLASS,
} from "@/features/sidebar/ui/ChatList";
import {
  type ChatListItem,
  sortChats,
} from "@/features/sidebar/lib/chatListModel";
import { usePanelPresence } from "@/shared/layout/PanelPresence";
import { cn } from "@/shared/lib/cn";

const NO_ITEMS: readonly ChatListItem[] = [];

/**
 * The agent column: everything you and one resident have talked about, in
 * one place, beside the rail. A chat that lives in a project wears the
 * project's name as a tag — the room's home, said quietly, so the column
 * reads as a person's history rather than a list of channels.
 *
 * On the desktop it lives in three layers inside the sidebar's container:
 * a stage that clips to the container (so a closing column is swallowed by
 * the pane's returning edge instead of overhanging the conversation), a
 * mover that slides by transform when the rail is put away or peeked, and
 * the column itself, which arrives and leaves by opacity and a short drift
 * under `PanelPresence`.
 */
export const AgentChatsColumn = React.memo(function AgentChatsColumn({
  agent,
  items,
  mobile = false,
  railHidden = false,
  onClose,
  onMarkChannelRead,
  onMarkChannelUnread,
  onNewChat,
  projectByChannelId,
  ...rowProps
}: ChatRowMenuProps &
  Omit<ChatRowProps, "item" | "testId" | "tag"> & {
    agent: AgentRailAgent;
    items: readonly ChatListItem[];
    /** In the mobile sheet the column takes the rail's place rather than
     *  sitting beside it, and the close control reads as "back". */
    mobile?: boolean;
    /** The rail is collapsed: the column sits at the left edge as the pane. */
    railHidden?: boolean;
    onClose: () => void;
    onNewChat: () => void;
    projectByChannelId: ReadonlyMap<string, RoomProject>;
  }) {
  // null outside PanelPresence (the phone sheet): always open, no motion.
  const presence = usePanelPresence();
  const open = presence ?? true;
  // The frame paints first — the header and the offer of a thread — and the
  // rows land in a deferred render, so the frame that starts the column's
  // entrance has nothing else to do.
  const deferredItems = React.useDeferredValue(items, NO_ITEMS);
  const ordered = React.useMemo(
    () => sortChats(deferredItems),
    [deferredItems],
  );
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

  // Opened from the keyboard — the resident's row was activated while it
  // showed its focus state — the column takes focus at its first row once
  // the rows have landed. A pointer open leaves focus where it was.
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const keyboardOpenRef = React.useRef(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.matches(":focus-visible"),
  );
  const rowsLanded = ordered.length > 0 || !hasDirectChat;
  React.useEffect(() => {
    // Not before the column is open: while it arrives it is inert, and an
    // inert control refuses focus.
    if (!keyboardOpenRef.current || !rowsLanded || !open) return;
    keyboardOpenRef.current = false;
    listRef.current
      ?.querySelector<HTMLElement>("button")
      ?.focus({ preventScroll: true });
  }, [open, rowsLanded]);

  const column = (
    <aside
      aria-label={`Chats with ${agent.name}`}
      className={cn(
        "flex flex-col bg-sidebar",
        mobile
          ? "min-h-0 w-full flex-1"
          : cn(
              "pointer-events-auto h-full w-full",
              // Arrival: opacity and an 8px drift at fast · arrival. Leaving:
              // the reverse at instant · standard. Reduced motion: at once.
              "transition-[opacity,translate] motion-reduce:transition-none",
              "data-[panel-open=true]:[transition-duration:var(--motion-duration-fast)] data-[panel-open=true]:[transition-timing-function:var(--motion-ease-arrival)]",
              "data-[panel-open=false]:-translate-x-2 data-[panel-open=false]:opacity-0 data-[panel-open=false]:[transition-duration:var(--motion-duration-instant)] data-[panel-open=false]:[transition-timing-function:var(--motion-ease-standard)]",
              railHidden
                ? "group-data-[peek=companion]:border-l group-data-[peek=companion]:border-border/50"
                : "border-l border-border/50",
            ),
      )}
      data-panel-open={open}
      data-testid="agent-chats-column"
      inert={open ? undefined : true}
    >
      {mobile ? null : (
        // The column's header sits at the height of the rail's first row,
        // always: the strip above — where the macOS window controls and the
        // floating chrome live — stays clear and draggable, exactly as it
        // does over the rail, so putting the rail away never slides the
        // header under the lights. conversation-shell.css sizes the band
        // from the same two values as the rail's pinned header; the utility
        // is the fallback outside the Luca shell.
        <div
          className="h-(--buzz-top-chrome-height,32px) shrink-0"
          data-tauri-drag-region
          data-testid="agent-column-chrome-band"
        />
      )}
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
          className={cn(RAIL_CONTROL_CLASS, "size-6")}
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

      <ChatRowContextMenu
        items={deferredItems}
        onMarkChannelRead={onMarkChannelRead}
        onMarkChannelUnread={onMarkChannelUnread}
        unreadChannelIds={rowProps.unreadChannelIds}
      >
        <div
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2"
          ref={listRef}
        >
          {hasDirectChat ? null : (
            <button
              className={cn(
                RAIL_CONTROL_CLASS,
                "min-h-8 justify-start gap-2.5 px-2 text-left text-sm",
              )}
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

          {/* The same row as the rail — context menu, unread dot, working
              label, channel id — so nothing a chat could do out there is lost
              in here. Only its address and its project tag are the column's. */}
          {ordered.map((item) => (
            <ChatRow
              item={item}
              key={item.channel.id}
              tag={projectByChannelId.get(item.channel.id)?.label ?? null}
              testId={`agent-column-chat-${item.channel.name}`}
              {...rowProps}
            />
          ))}
        </div>
      </ChatRowContextMenu>
    </aside>
  );

  if (mobile) return column;

  return (
    // The stage: the container's box, clipping. The pane's edge is what
    // reveals and swallows the column; nothing of it ever paints over the
    // conversation.
    <div
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      data-testid="agent-column-stage"
    >
      {/* The mover: beside the rail, or at the edge when the rail is put
          away — by transform, on the rail's own duration and curve, so the
          two read as one plane; a companion peek slides it back beside the
          rail. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 left-(--sidebar-rail-width) w-(--agent-column-width)",
          "transition-transform [transition-duration:var(--motion-duration-standard)] [transition-timing-function:var(--motion-ease-standard)] motion-reduce:transition-none",
          railHidden
            ? "-translate-x-(--sidebar-rail-width) group-data-[peek=companion]:translate-x-0"
            : "translate-x-0",
        )}
        data-testid="agent-column-mover"
      >
        {column}
      </div>
    </div>
  );
});
