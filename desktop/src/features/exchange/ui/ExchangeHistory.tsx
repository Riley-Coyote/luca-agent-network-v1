import * as React from "react";

import { useRoomExchangeHistory } from "@/features/exchange/exchangeStore";
import { exchangeIdFromTags } from "@/features/exchange/exchangeTags";
import {
  exchangeStatusLabel,
  exchangeTaskSubject,
} from "@/features/exchange/sideConversations";
import { parseImetaTags } from "@/features/messages/lib/parseImeta";
import type { TimelineMessage } from "@/features/messages/types";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Markdown } from "@/shared/ui/markdown";
import { ExchangeIdentityMark } from "./ExchangeIdentityMark";

type ExchangeHistoryProps = {
  channelId: string;
  currentPubkey?: string;
  messages: TimelineMessage[];
  profiles?: UserProfileLookup;
  requestedExchangeId?: string | null;
  onOpenTaskWindow?: (exchangeId: string) => void;
};

function createdAtSeconds(message: TimelineMessage): number {
  return message.createdAt > 1e12
    ? Math.floor(message.createdAt / 1000)
    : message.createdAt;
}

/** "Now" while live; otherwise the day, in plain words. */
function whenLabel(firstTurn: TimelineMessage | null, live: boolean): string {
  if (live) return "Now";
  if (!firstTurn) return "Earlier";
  const at = new Date(createdAtSeconds(firstTurn) * 1000);
  const today = new Date();
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(at)) / 86_400_000);
  if (days <= 0) {
    return at.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return at.toLocaleDateString(undefined, { weekday: "long" });
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * "Between agents": every exchange that happened in this room, newest first —
 * the permanent record of what the residents said to each other here. Live
 * ones open with their turns; older ones collapse to their task subject.
 */
export function ExchangeHistory({
  channelId,
  currentPubkey,
  messages,
  profiles,
  requestedExchangeId = null,
  onOpenTaskWindow,
}: ExchangeHistoryProps) {
  const entries = useRoomExchangeHistory(channelId);
  const [toggled, setToggled] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!requestedExchangeId) return;
    setToggled((previous) => ({
      ...previous,
      [requestedExchangeId]: true,
    }));
    const frame = requestAnimationFrame(() => {
      document
        .querySelector(
          `[data-exchange-history-id="${CSS.escape(requestedExchangeId)}"]`,
        )
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [requestedExchangeId]);

  const turnsByExchange = React.useMemo(() => {
    const turns = new Map<string, TimelineMessage[]>();
    for (const message of messages) {
      const exchangeId = exchangeIdFromTags(message.tags);
      if (exchangeId) {
        const list = turns.get(exchangeId) ?? [];
        list.push(message);
        turns.set(exchangeId, list);
      }
    }
    for (const list of turns.values()) {
      list.sort((a, b) => createdAtSeconds(a) - createdAtSeconds(b));
    }
    return turns;
  }, [messages]);

  if (entries.length === 0) return null;

  return (
    <div
      className="overflow-hidden rounded-2xl bg-plate"
      data-testid="exchange-history"
    >
      {entries.map((entry) => {
        const { record, phase } = entry;
        const live = phase === "open" || phase === "paused";
        const turns = turnsByExchange.get(record.exchangeId) ?? [];
        const expanded = toggled[record.exchangeId] ?? live;
        const names = record.members.map((member) =>
          resolveUserLabel({ currentPubkey, profiles, pubkey: member }),
        );
        const first = turns[0] ?? null;
        const root = messages.find(
          (message) => message.id === record.rootEventId,
        );
        const taskMessages = root
          ? [root, ...turns.filter((turn) => turn.id !== root.id)]
          : turns;
        const subject = exchangeTaskSubject(root?.body, names.join(" and "));
        const markPubkey =
          record.members.find((member) => member !== record.openedBy) ??
          record.members[0];
        const meta = [
          whenLabel(first, phase === "open"),
          names.join(" & "),
          exchangeStatusLabel(phase),
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <div
            className="px-3 py-2.5"
            data-exchange-history-id={record.exchangeId}
            data-exchange-phase={phase}
            data-testid={`exchange-history-${record.exchangeId}`}
            key={record.exchangeId}
          >
            <div className="flex items-center gap-3">
              <button
                aria-expanded={expanded}
                className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-hidden"
                onClick={() =>
                  setToggled((prev) => ({
                    ...prev,
                    [record.exchangeId]: !expanded,
                  }))
                }
                type="button"
              >
                {markPubkey ? (
                  <ExchangeIdentityMark
                    name={resolveUserLabel({
                      currentPubkey,
                      profiles,
                      pubkey: markPubkey,
                    })}
                    pubkey={markPubkey}
                    avatarUrl={
                      profiles?.[normalizePubkey(markPubkey)]?.avatarUrl
                    }
                  />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {subject}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {meta}
                  </span>
                </span>
              </button>
            </div>
            {onOpenTaskWindow && record.members.length === 2 ? (
              <button
                className="mt-1 pl-8 text-xs text-primary hover:underline focus-visible:underline"
                onClick={() => onOpenTaskWindow(record.exchangeId)}
                type="button"
              >
                Open task in new window
              </button>
            ) : null}
            {expanded && taskMessages.length > 0 ? (
              <div className="mt-3 flex flex-col gap-2.5 pl-7">
                {taskMessages.map((turn) => (
                  <div className="flex items-start gap-2" key={turn.id}>
                    {turn.pubkey ? (
                      <ExchangeIdentityMark
                        name={resolveUserLabel({
                          currentPubkey,
                          profiles,
                          pubkey: turn.pubkey,
                        })}
                        pubkey={turn.pubkey}
                        avatarUrl={
                          turn.avatarUrl ??
                          profiles?.[normalizePubkey(turn.pubkey)]?.avatarUrl
                        }
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <span className="block text-xs font-medium leading-4 text-foreground">
                        {turn.pubkey
                          ? resolveUserLabel({
                              currentPubkey,
                              profiles,
                              pubkey: turn.pubkey,
                            })
                          : turn.author}
                      </span>
                      <Markdown
                        className="conversation-prose type-body mt-0.5 max-w-full break-words text-foreground"
                        content={turn.body}
                        imetaByUrl={
                          turn.tags ? parseImetaTags(turn.tags) : undefined
                        }
                        progressive={Boolean(turn.managedPresentation)}
                        streaming={turn.managedPresentation?.streaming ?? false}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {expanded && taskMessages.length === 0 ? (
              <p className="mt-3 pl-8 text-xs text-muted-foreground">
                No messages loaded for this task.
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
