import * as React from "react";

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

export function ChatList({
  items,
  selectedChannelId,
  unreadChannelIds,
  workingByChannelId,
  onSelectChannel,
}: {
  items: readonly ChatListItem[];
  selectedChannelId: string | null;
  unreadChannelIds: ReadonlySet<string>;
  /** Channels with a resident mid-turn. Replaces the timestamp while running —
   *  "what is happening" beats "when it last happened". */
  workingByChannelId?: ReadonlyMap<string, { agentCount: number }>;
  onSelectChannel: (channelId: string) => void;
}) {
  const sorted = React.useMemo(() => sortChats(items), [items]);

  return (
    <div className="flex flex-col px-2" data-testid="chat-list">
      {/* The section's only label. Quiet enough to read as a signpost rather
          than a header — it names the content without competing with it. */}
      <p className="select-none px-2 pb-1 pt-3 text-2xs font-medium uppercase tracking-[0.1em] text-sidebar-foreground/35">
        Rooms
      </p>
      {sorted.map(({ channel, label, markPubkeys }) => {
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
            // Wearing the app's own menu-button identity rather than
            // hand-rolling active/hover colours: conversation-shell.css already
            // owns those states, and my first pass reinvented them at 10%
            // opacity, which rendered dark text on a near-dark pill.
            className={cn(
              "group flex w-full items-center gap-2.5 rounded-md px-2 text-left outline-none",
              // 32px rows on a 4px rhythm. Hover resolves fast enough to feel
              // attached to the pointer but not so fast it flickers while the
              // cursor crosses the list; the active state is instant, because
              // a press that animates feels laggy no matter how brief.
              "min-h-8 transition-colors duration-100 data-[active=true]:duration-0",
            )}
            data-active={isActive ? "true" : undefined}
            data-sidebar="menu-button"
            aria-label={isUnread ? `${label}, unread` : label}
            data-testid={`chat-row-${channel.id}`}
            key={channel.id}
            onClick={() => onSelectChannel(channel.id)}
            type="button"
          >
            {/* EVERY row carries a mark, so the list has one text baseline
                instead of two. A group with no residents in it is seeded from
                its own id — the sigil engine only needs a stable string, so a
                room gets a deterministic identity the same way a person does. */}
            <span className="flex shrink-0 -space-x-1.5">
              {(markPubkeys.length
                ? markPubkeys.slice(0, 2)
                : [channel.id]
              ).map((seed) => (
                <AgentIdentitySpecimen
                  accessibleName={label}
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

            {/* ONE trailing slot, never two. Live state displaces the
                timestamp (what is happening beats when it last happened), and
                the unread dot displaces both — an unread room does not also
                need to tell you the hour. Tabular figures so the column does
                not jitter as minutes tick over. */}
            {/* No fixed width. A reserved column looks tidier in a mock and
                then eats the NAME on a narrow rail — which is exactly how the
                hex fingerprint used to clip these same rows. The slot sizes to
                its content and disappears when there is none. */}
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
