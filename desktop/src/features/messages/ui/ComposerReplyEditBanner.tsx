import { CornerUpLeft, Pencil, X } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

const BANNER_CLASS =
  "relative z-0 -mb-2 flex transform-gpu gap-2 rounded-t-lg border border-b-0 border-border bg-muted px-4 pb-4 pt-2.5 text-sm leading-5 text-muted-foreground transition-colors";

/**
 * The "Editing message" / "Replying to …" banner that sits above the composer
 * input. Edit takes precedence over reply (matching the composer's own
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
          <p className="truncate font-medium text-foreground">
            Editing message
          </p>
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
        className={cn(BANNER_CLASS, "items-start")}
        data-testid="reply-target"
      >
        <CornerUpLeft aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">
            Replying to {replyTarget.author}
          </p>
          {replyTarget.body ? (
            <p className="truncate text-muted-foreground/80">
              {replyTarget.body}
            </p>
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
