import * as React from "react";

import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import { useRoomExchangeHistory } from "@/features/exchange/exchangeStore";
import { exchangeIdFromTags } from "@/features/exchange/exchangeTags";
import { parseVisitEvent } from "@/features/messages/lib/visitEvents";
import type { TimelineMessage } from "@/features/messages/types";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { cn } from "@/shared/lib/cn";

type ExchangeHistoryProps = {
  channelId: string;
  currentPubkey?: string;
  messages: TimelineMessage[];
  profiles?: UserProfileLookup;
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

function revealMessage(messageId: string) {
  const row = document.querySelector(
    `[data-timeline-item-key="${CSS.escape(messageId)}"]`,
  );
  row?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/**
 * "Between agents": every exchange that happened in this room, newest first —
 * the permanent record of what the residents said to each other here. Live
 * ones open with their turns; older ones collapse to a gist line. A member who
 * stepped in for the exchange wears `visiting`.
 */
export function ExchangeHistory({
  channelId,
  currentPubkey,
  messages,
  profiles,
}: ExchangeHistoryProps) {
  const entries = useRoomExchangeHistory(channelId);
  const [toggled, setToggled] = React.useState<Record<string, boolean>>({});

  // Turns by exchange id, in order; visitors by exchange id.
  const { turnsByExchange, visitorsByExchange } = React.useMemo(() => {
    const turns = new Map<string, TimelineMessage[]>();
    const visitors = new Map<string, Set<string>>();
    for (const message of messages) {
      const exchangeId = exchangeIdFromTags(message.tags);
      if (exchangeId) {
        const list = turns.get(exchangeId) ?? [];
        list.push(message);
        turns.set(exchangeId, list);
      }
      const visit = parseVisitEvent(message);
      if (visit?.type === "visit_arrived" && visit.exchangeId) {
        const set = visitors.get(visit.exchangeId) ?? new Set<string>();
        set.add(visit.resident);
        visitors.set(visit.exchangeId, set);
      }
    }
    for (const list of turns.values()) {
      list.sort((a, b) => createdAtSeconds(a) - createdAtSeconds(b));
    }
    return { turnsByExchange: turns, visitorsByExchange: visitors };
  }, [messages]);

  if (entries.length === 0) return null;

  return (
    <div
      className="overflow-hidden rounded-2xl bg-plate"
      data-testid="exchange-history"
    >
      {entries.map((entry) => {
        const { record, spent, phase } = entry;
        const live = phase === "open" || phase === "paused";
        const turns = turnsByExchange.get(record.exchangeId) ?? [];
        const visitors = visitorsByExchange.get(record.exchangeId);
        const visiting =
          !!visitors &&
          record.members.some((member) =>
            visitors.has(normalizePubkey(member)),
          );
        const expanded = toggled[record.exchangeId] ?? live;
        const names = record.members.map((member) =>
          resolveUserLabel({ currentPubkey, profiles, pubkey: member }),
        );
        const first = turns[0] ?? null;
        const meta = [
          whenLabel(first, live),
          live
            ? `${spent} of ${record.bucket}`
            : `${turns.length || spent} turns`,
          visiting ? "visiting" : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <div
            className="px-3 py-2.5"
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
                {/* Stacked, not side by side: the pair is one column the
                    width of a single mark, so the names and the turns keep
                    the measure in a 360px drawer. */}
                <span className="flex w-4 shrink-0 flex-col items-center gap-1">
                  {record.members.map((member, index) => (
                    <ResidentIdentityMark
                      accessibleName={names[index] ?? member}
                      className={cn(live && visiting && "luca-identity-breath")}
                      decorative
                      key={member}
                      publicKey={member}
                      size={14}
                    />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {names.join(" · ")}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {meta}
                  </span>
                  {!expanded && first ? (
                    <span className="mt-1 block truncate text-xs text-ink-faint">
                      {first.body}
                    </span>
                  ) : null}
                </span>
              </button>
              {first ? (
                <button
                  className="shrink-0 text-xs text-ink-faint transition-colors hover:text-foreground focus-visible:outline-hidden"
                  onClick={() => revealMessage(first.id)}
                  title="Show in conversation"
                  type="button"
                >
                  Show
                </button>
              ) : null}
            </div>
            {expanded && turns.length > 0 ? (
              <div className="mt-3 flex flex-col gap-2.5 pl-7">
                {turns.map((turn) => (
                  <div className="flex items-start gap-2" key={turn.id}>
                    {turn.pubkey ? (
                      <ResidentIdentityMark
                        accessibleName={turn.author}
                        className="mt-0.5"
                        decorative
                        publicKey={turn.pubkey}
                        size={12}
                      />
                    ) : null}
                    <div className="min-w-0">
                      <span className="block text-xs font-medium leading-4 text-foreground">
                        {turn.author}
                      </span>
                      <span className="mt-0.5 line-clamp-3 block text-xs leading-[1.45] text-ink-muted">
                        {turn.body}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
