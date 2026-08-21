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
  /** Arrival rows: the visit is still under way (plate open, mark breathing). */
  open?: boolean;
  profiles?: UserProfileLookup;
  visit: VisitEvent;
};

/**
 * The two house notes that bracket a visit. Arrival is the boundary line — it
 * tells the room the guest sees the conversation from here, and nothing
 * above. Departure is an exhale: name and verb, no mark, no line. Both sit in
 * the meta register so they never compete with what was said.
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
        "mx-1 flex items-center gap-2.5 px-2",
        arrived ? "pb-1 pt-2.5" : "pb-2 pt-1.5",
      )}
      data-message-id={message.id}
      data-testid={arrived ? "visit-arrived-row" : "visit-left-row"}
      data-visit-open={arrived && open ? "" : undefined}
    >
      <span className="flex w-[21px] shrink-0 justify-center">
        {arrived ? (
          <ResidentIdentityMark
            accessibleName={name}
            // Presence is lighter: the mark on the threshold line sits at
            // meta ink; it breathes while the visit is still under way.
            className={cn("text-foreground/70", open && "luca-identity-breath")}
            decorative
            publicKey={visit.resident}
            size={13}
          />
        ) : null}
      </span>
      <p className="min-w-0 truncate text-2xs leading-4 text-muted-foreground">
        <span className="font-medium text-foreground/70">{name}</span>
        {arrived ? " stepped in" : " stepped out"}
        {arrived ? (
          <>
            <span className="px-1.5 text-muted-foreground/50">·</span>
            sees the conversation from here
          </>
        ) : null}
      </p>
    </div>
  );
}
