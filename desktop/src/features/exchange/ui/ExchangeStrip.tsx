import * as React from "react";
import { toast } from "sonner";

import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import {
  applyExchangeSnapshot,
  type ExchangeEntry,
} from "@/features/exchange/exchangeStore";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { resolveExchange } from "@/shared/api/exchanges";
import { EXCHANGE_BUCKET_CEILING } from "@/shared/constants/kinds";
import { cn } from "@/shared/lib/cn";
import "./exchangeStrip.css";

const MARK_SIZE = 18;

// Flat object: a hairline, no fill, no accent. The five states live in
// exchangeStrip.css, which is the only place that can hold the house focus
// rule against the shell's global ring.
const BUTTON_CLASS = cn(
  "luca-exchange-strip__action",
  "inline-flex h-6 shrink-0 items-center rounded-sm border border-border/70 px-2",
  "text-2xs leading-none text-muted-foreground outline-none",
  "transition-colors duration-150",
);

export type ExchangeStripProps = {
  exchange: ExchangeEntry;
  profiles?: UserProfileLookup;
  residentPersonaIdLookup?: ReadonlyMap<string, string | null>;
};

/**
 * One decision line for an exchange that has paused, pinned above the composer
 * beside the permission card. Open exchanges stay in conversation details;
 * they do not interrupt the owner with a technical turn counter.
 *
 * The line hands the owner the only two decisions there are — Stop here, or let
 * them continue. Continuing is unavailable at the ceiling because no signature
 * raises it.
 */
export function ExchangeStrip({
  exchange,
  profiles,
  residentPersonaIdLookup,
}: ExchangeStripProps) {
  const [resolving, setResolving] = React.useState<"stop" | "go" | null>(null);
  const { record, phase } = exchange;
  const atCeiling = record.bucket >= EXCHANGE_BUCKET_CEILING;
  const names = record.members.map((pubkey) =>
    resolveUserLabel({ profiles, pubkey }),
  );

  async function decide(action: "stop" | "go") {
    setResolving(action);
    try {
      const snapshot = await resolveExchange(record.exchangeId, action);
      // The head that comes back is the one the relay kept, not the one this
      // desktop hoped for — reconcile from it rather than from the click.
      if (snapshot) applyExchangeSnapshot(snapshot);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "That exchange could not be resolved.",
      );
    } finally {
      setResolving(null);
    }
  }

  return (
    <section
      aria-label={`${names.join(" and ")} are waiting for your decision`}
      className="luca-exchange-strip flex min-h-9 w-full items-center gap-2.5 rounded-lg bg-plate-opaque px-3 py-1.5"
      data-exchange-phase={phase}
      data-testid="exchange-strip"
    >
      <span className="flex shrink-0 items-center gap-1">
        {record.members.map((pubkey, index) => (
          <ResidentIdentityMark
            accessibleName={names[index] ?? pubkey}
            decorative
            key={pubkey}
            personaId={residentPersonaIdLookup?.get(pubkey) ?? null}
            publicKey={pubkey}
            size={MARK_SIZE}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs leading-none text-ink-muted">
        {names.join(" · ")}
      </span>
      <span
        className={cn(
          "shrink-0 text-2xs leading-none tabular-nums",
          atCeiling ? "text-ink-muted" : "text-ink-faint",
        )}
        data-testid="exchange-strip-status"
      >
        {atCeiling ? "Conversation limit reached" : "Waiting for you"}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <button
          className={BUTTON_CLASS}
          data-testid="exchange-stop"
          disabled={resolving !== null}
          onClick={() => void decide("stop")}
          type="button"
        >
          Stop here
        </button>
        <button
          className={BUTTON_CLASS}
          data-testid="exchange-go"
          disabled={resolving !== null || atCeiling}
          onClick={() => void decide("go")}
          title={atCeiling ? "Conversation limit reached" : undefined}
          type="button"
        >
          Let them continue
        </button>
      </span>
    </section>
  );
}
