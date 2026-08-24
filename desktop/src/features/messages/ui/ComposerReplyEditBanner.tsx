import { CornerUpLeft, Pencil, X } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

/**
 * TWO TREATMENTS, one being chosen in the lab (2026-08-23) — delete the
 * loser once Riley picks:
 *
 * "sheet" (default) — a layer that rises from behind the composer card,
 * at the card's exact width: the composer is one object with a deck of
 * its own sheets, not two stacked boxes. Intermediate shade between
 * ground and card, bottom tucked under the card past its radius, 220ms
 * rise. (Same-width per Riley: an inset sheet read as a separate object,
 * and a sheet taller than the card inverted the depth hierarchy.) The visual system lives
 * in conversation-shell.css as .luca-reply-sheet.
 *
 * "card" — the row lives inside the composer card above the text, the way
 * attachments stack; no surface of its own.
 *
 * Lab comparison: append ?replyStyle=card to the shell-lab URL.
 */
export function replyBannerVariant(): "card" | "sheet" {
  try {
    return new URLSearchParams(window.location.search).get("replyStyle") ===
      "card"
      ? "card"
      : "sheet";
  } catch {
    return "sheet";
  }
}

const IN_CARD_CLASS =
  "flex gap-2 px-1 pb-2 pt-1 text-sm leading-5 text-muted-foreground";
const SHEET_CLASS =
  "luca-reply-sheet relative z-0 -mb-3.5 flex gap-2 px-4 pb-5 pt-1 text-sm leading-5 text-muted-foreground";
const BANNER_CLASS =
  replyBannerVariant() === "sheet" ? SHEET_CLASS : IN_CARD_CLASS;

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
    return (
      <div
        className={cn(
          BANNER_CLASS,
          replyBannerVariant() === "sheet" ? "items-center" : "items-start",
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
  }

  return null;
}
