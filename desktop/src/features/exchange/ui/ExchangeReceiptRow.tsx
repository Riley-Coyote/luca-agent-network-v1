import { MessageCircle } from "lucide-react";

import type { ExchangeEntry } from "@/features/exchange/exchangeStore";
import {
  exchangeStatusLabel,
  exchangeTaskSubject,
} from "@/features/exchange/sideConversations";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { ExchangeIdentityMark } from "./ExchangeIdentityMark";

type ExchangeReceiptRowProps = {
  currentPubkey?: string;
  exchange: ExchangeEntry | null;
  exchangeId: string;
  onOpen: (exchangeId: string) => void;
  profiles?: UserProfileLookup;
  turnCount: number;
  /** Actual originating brief, when the caller has loaded it. */
  subject?: string;
  onOpenTaskWindow?: (exchangeId: string) => void;
};

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
  subject,
  onOpenTaskWindow,
}: ExchangeReceiptRowProps) {
  const members = exchange?.record.members ?? [];
  const names = members.map((pubkey) =>
    resolveUserLabel({ currentPubkey, profiles, pubkey }),
  );
  const recipient =
    members.find((pubkey) => pubkey !== exchange?.record.openedBy) ??
    members[0];
  const recipientName = recipient
    ? resolveUserLabel({ currentPubkey, profiles, pubkey: recipient })
    : "agent";
  const title = exchangeTaskSubject(subject, recipientName);

  return (
    <div className="luca-measure py-1.5">
      <button
        aria-label={`Preview ${title}`}
        className="group flex min-h-11 w-full items-center gap-3 rounded-xl bg-plate px-3 py-2 text-left transition-colors duration-150 hover:bg-plate-hover focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--ink-faint)]"
        data-exchange-id={exchangeId}
        data-testid={`exchange-receipt-${exchangeId}`}
        onClick={() => onOpen(exchangeId)}
        type="button"
      >
        {recipient ? (
          <ExchangeIdentityMark
            name={recipientName}
            pubkey={recipient}
            avatarUrl={profiles?.[normalizePubkey(recipient)]?.avatarUrl}
          />
        ) : (
          <MessageCircle
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-ink-faint"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-muted group-hover:text-foreground">
            {title}
          </span>
          <span className="mt-0.5 block text-xs text-ink-faint">
            {members.length > 2 ? names.join(" & ") : recipientName} ·{" "}
            {exchangeStatusLabel(exchange?.phase)}
          </span>
        </span>
      </button>
      {onOpenTaskWindow && members.length === 2 ? (
        <button
          className="mt-1 text-xs text-primary hover:underline focus-visible:underline"
          onClick={() => onOpenTaskWindow(exchangeId)}
          type="button"
        >
          Open task in new window
        </button>
      ) : null}
    </div>
  );
}
