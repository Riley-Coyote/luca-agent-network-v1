import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { ResidentIdentityMark } from "@/features/channels/ui/ResidentIdentityMark";
import type { VisitEvent } from "@/features/messages/lib/visitEvents";
import type { TimelineMessage } from "@/features/messages/types";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { cn } from "@/shared/lib/cn";

type VisitNoteRowProps = {
  currentPubkey?: string;
  message: TimelineMessage;
  /** Arrival rows: the visit is still under way (mark breathing). */
  open?: boolean;
  profiles?: UserProfileLookup;
  visit: VisitEvent;
};

/**
 * The door at each end of a visit.
 *
 * A guest arriving is an event, so it is drawn as a threshold: a rule all the
 * way across the reading plane with the moment centred on it — the same
 * grammar the day divider uses, a break in presence rather than in time. The
 * way out is bare and its rule fades toward the ends instead of running to
 * them, so the door reads as swinging one way.
 */
export function VisitNoteRow({
  currentPubkey,
  message,
  open = false,
  profiles,
  visit,
}: VisitNoteRowProps) {
  const agentsQuery = useManagedAgentsQuery();
  const name = React.useMemo(() => {
    const resident = normalizePubkey(visit.resident);
    const agent = (agentsQuery.data ?? []).find(
      (candidate) => normalizePubkey(candidate.pubkey) === resident,
    );
    return (
      agent?.name ??
      resolveUserLabel({ currentPubkey, profiles, pubkey: visit.resident })
    );
  }, [agentsQuery.data, currentPubkey, profiles, visit.resident]);
  const arrived = visit.type === "visit_arrived";

  return (
    <div
      className={cn(
        "luca-visit-threshold flex items-center gap-3.5 px-2",
        arrived ? "pb-2.5 pt-3.5" : "py-3",
      )}
      data-message-id={message.id}
      data-testid={arrived ? "visit-arrived-row" : "visit-left-row"}
      data-visit-guest={arrived ? visit.resident : undefined}
    >
      <span aria-hidden className="luca-visit-threshold__rule" />
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 whitespace-nowrap text-2xs leading-4",
          arrived ? "text-muted-foreground" : "text-muted-foreground/70",
        )}
      >
        {arrived ? (
          <ResidentIdentityMark
            accessibleName={name}
            className={cn("text-foreground/75", open && "luca-identity-breath")}
            decorative
            publicKey={visit.resident}
            size={12}
          />
        ) : null}
        <span>
          <span className="text-foreground/70">{name}</span>
          {arrived ? " stepped in" : " stepped out"}
        </span>
      </span>
      <span aria-hidden className="luca-visit-threshold__rule" />
    </div>
  );
}
