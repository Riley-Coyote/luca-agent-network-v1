import { CornerUpLeft, Pencil, X } from "lucide-react";

import { Button } from "@/shared/ui/button";

/**
 * The reply context is a RECESS: a well that opens below the conversation
 * surface, the composer card floating above it. Chosen 2026-08-24 from a
 * four-way lab comparison (seam deck, in-card row, shade tier, recess) —
 * the recess keeps the card itself a single clean object, gives replying a
 * direction (the message drops into the slot), and steps AWAY from the
 * crowded surface shades instead of squeezing between them. One line: it
 * names WHO you are replying to; the message is right there in the
 * timeline.
 */
const BANNER_CLASS =
  "luca-reply-sheet relative z-0 -mb-3.5 flex items-center gap-2 px-4 pb-5 pt-1 text-sm leading-5 text-muted-foreground";

/**
 * The "Editing message" / "Replying to …" context row at the top of the
 * composer card, above the text. Edit takes precedence over reply (matching the composer's own
 * `editTarget ? … : replyTarget ? …` ordering). Rendered as a sibling so
 * MessageComposer stays under the file-size guard; purely presentational.
 */
export function ComposerReplyEditBanner({
  isEditing,
  replyTarget,
  onCancelEdit,
  onCancelReply,
}: {
  isEditing: boolean;
  replyTarget?: { author: string; body: string; id: string } | null;
  onCancelEdit?: () => void;
  onCancelReply?: () => void;
}) {
  if (isEditing) {
    return (
      <div className={BANNER_CLASS} data-testid="edit-target">
        <Pencil aria-hidden className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-muted">Editing message</p>
        </div>
        {onCancelEdit ? (
          <Button
            aria-label="Cancel edit"
            className="-mr-1 h-7 w-7 shrink-0 px-0 text-muted-foreground hover:text-foreground"
            onClick={onCancelEdit}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    );
  }

  if (replyTarget) {
    const row = (
      <div className={BANNER_CLASS} data-testid="reply-target">
        <CornerUpLeft aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-muted">
            Replying to {replyTarget.author}
          </p>
        </div>
        {onCancelReply ? (
          <Button
            aria-label="Cancel reply"
            className="-mr-1 h-7 w-7 shrink-0 px-0 text-muted-foreground hover:text-foreground"
            onClick={onCancelReply}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    );
    return <div className="luca-sheet-deck">{row}</div>;
  }

  return null;
}
