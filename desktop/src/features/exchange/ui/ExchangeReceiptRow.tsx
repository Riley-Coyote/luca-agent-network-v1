import { MessageCircle } from "lucide-react";

import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import type { ExchangeEntry } from "@/features/exchange/exchangeStore";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { resolveUserLabel } from "@/features/profile/lib/identity";

type ExchangeReceiptRowProps = {
  currentPubkey?: string;
  exchange: ExchangeEntry | null;
  exchangeId: string;
  onOpen: (exchangeId: string) => void;
  profiles?: UserProfileLookup;
  turnCount: number;
};

function statusLabel(exchange: ExchangeEntry | null, turnCount: number) {
  if (!exchange) return `${turnCount} ${turnCount === 1 ? "turn" : "turns"}`;
  if (exchange.phase === "paused") return "Waiting for you";
  if (exchange.phase === "open") {
    return `Now · ${exchange.spent} of ${exchange.record.bucket}`;
  }
  return `${turnCount} ${turnCount === 1 ? "turn" : "turns"}`;
}

/**
 * The ordinary room's sole projection of a resident exchange. The complete,
 * unabridged speech stays in Between agents; this quiet receipt preserves the
 * event's place in room chronology and is the way back into that record.
 */
export function ExchangeReceiptRow({
  currentPubkey,
  exchange,
  exchangeId,
  onOpen,
  profiles,
  turnCount,
}: ExchangeReceiptRowProps) {
  const members = exchange?.record.members ?? [];
  const names = members.map((pubkey) =>
    resolveUserLabel({ currentPubkey, profiles, pubkey }),
  );

  return (
    <div className="luca-measure py-1.5">
      <button
        aria-label={`Open agent conversation${names.length ? ` between ${names.join(" and ")}` : ""}`}
        className="group flex min-h-11 w-full items-center gap-3 rounded-xl bg-plate px-3 py-2 text-left transition-colors duration-150 hover:bg-plate-hover focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--ink-faint)]"
        data-exchange-id={exchangeId}
        data-testid={`exchange-receipt-${exchangeId}`}
        onClick={() => onOpen(exchangeId)}
        type="button"
      >
        {members.length ? (
          <span className="flex w-4 shrink-0 flex-col items-center gap-0.5">
            {members.slice(0, 2).map((pubkey, index) => (
              <ResidentIdentityMark
                accessibleName={names[index] ?? pubkey}
                decorative
                key={pubkey}
                publicKey={pubkey}
                size={12}
              />
            ))}
          </span>
        ) : (
          <MessageCircle
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-ink-faint"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-muted group-hover:text-foreground">
            {names.length ? names.join(" · ") : "Agents chatted"}
          </span>
          <span className="mt-0.5 block text-xs text-ink-faint">
            Between agents
          </span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">
          {statusLabel(exchange, turnCount)}
        </span>
      </button>
    </div>
  );
}
