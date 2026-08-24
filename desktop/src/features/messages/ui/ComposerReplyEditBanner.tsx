import { CornerUpLeft, Pencil, X } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

/**
 * FOUR TREATMENTS under comparison in the lab (2026-08-24) — the loser set
 * gets deleted once Riley picks. Switch with ?replyStyle= in the lab URL:
 *
 * "seam" (default) — the choreographer's deck: the sheet is the SAME shade
 *   as the card; depth comes from the dark seam where the card occludes it,
 *   and the sheet is REVEALED by a clip, not translated.
 * "card" — the craftsman's one-box: the row lives inside the composer card.
 * "tier" — the colorist's shade-tier, previewed on the taller ladder the
 *   lab injects for this variant only.
 * "recess" — Riley's idea, the colorist's plan B: the reply opens a well
 *   BELOW the conversation shade instead of a shelf above it.
 */
export type ReplyBannerVariant = "seam" | "card" | "tier" | "recess";

export function replyBannerVariant(): ReplyBannerVariant {
  try {
    const v = new URLSearchParams(window.location.search).get("replyStyle");
    if (v === "card" || v === "tier" || v === "recess") return v;
    return "seam";
  } catch {
    return "seam";
  }
}

const IN_CARD_CLASS =
  "flex gap-2 px-1 pb-2 pt-1 text-sm leading-5 text-muted-foreground";
const SHEET_CLASS =
  "luca-reply-sheet relative z-0 -mb-3.5 flex gap-2 px-4 pb-5 pt-1 text-sm leading-5 text-muted-foreground";
const BANNER_CLASS =
  replyBannerVariant() === "card" ? IN_CARD_CLASS : SHEET_CLASS;

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
      <div
        className={cn(BANNER_CLASS, "items-center")}
        data-testid="edit-target"
      >
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
    const variant = replyBannerVariant();
    const row = (
      <div
        className={cn(
          BANNER_CLASS,
          variant === "card" ? "items-start" : "items-center",
        )}
        data-testid="reply-target"
      >
        <CornerUpLeft aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-muted">
            Replying to {replyTarget.author}
          </p>
          {/* The sheet names WHO — the message itself is right there in the
           * timeline. The in-card fallback keeps the quote line. */}
          {replyTarget.body && replyBannerVariant() === "card" ? (
            <p className="truncate text-ink-faint">{replyTarget.body}</p>
          ) : null}
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
    if (variant === "card") return row;
    return (
      <div className="luca-sheet-deck" data-variant={variant}>
        {row}
      </div>
    );
  }

  return null;
}
