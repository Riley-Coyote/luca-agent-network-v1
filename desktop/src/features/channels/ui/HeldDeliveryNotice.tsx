import { CornerDownLeft } from "lucide-react";

import type { HeldDeliveryNotice as HeldDeliveryNoticeState } from "./useHeldDeliveryNotice";

/**
 * The held-delivery card. Residents run in queue mode: a message sent while
 * a turn is in flight waits and is delivered when the turn finishes. This
 * card narrates the hold — without it the wait is invisible and reads as a
 * hang — and carries the one explicit way to jump the queue.
 */
export function HeldDeliveryNotice({
  notice,
  residentName,
  onInterrupt,
}: {
  notice: HeldDeliveryNoticeState;
  residentName: string;
  onInterrupt: () => void;
}) {
  const several = notice.residentPubkeys.length > 1;
  return (
    <div
      className="luca-measure pointer-events-auto mb-2"
      data-testid="held-delivery-notice"
    >
      <div className="flex items-center gap-3 rounded-xl bg-muted/70 px-4 py-2.5">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {several ? "Residents are" : `${residentName} is`} still working —
          your message is queued and will be delivered when{" "}
          {several ? "they finish" : "they're done"}.
        </p>
        <button
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-background/80 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background disabled:cursor-default disabled:opacity-45"
          data-testid="held-delivery-interrupt"
          disabled={!notice.canInterrupt}
          onClick={onInterrupt}
          type="button"
        >
          <CornerDownLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Interrupt · deliver now
        </button>
      </div>
    </div>
  );
}
