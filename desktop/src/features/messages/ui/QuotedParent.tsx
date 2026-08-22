import { cn } from "@/shared/lib/cn";

/**
 * The quoted message attached above a reply — the iMessage / WhatsApp /
 * Telegram / Signal convention.
 *
 * The whole point is that a reply is SELF-CONTAINED. It sits at its own
 * chronological position in one flow, and it carries what it is answering, so
 * there is nothing to protect from group traffic and nothing to go hunting for.
 * That is why every consumer messenger converged here.
 *
 * Two details do the work, and both come from the prior art:
 *
 * - A vertical bar on the leading edge, not a box. The quote must read as a
 *   subordinate fragment of the reply, never as its own message. A bordered
 *   card would compete with the real messages around it.
 * - Clamped to two lines. A resident's reply can run hundreds of words; quoting
 *   it whole would make the quote longer than the answer. Truncation is not a
 *   compromise here, it is the feature.
 */
export function QuotedParent({
  author,
  body,
  resolved,
  onJump,
  className,
}: {
  author: string;
  body: string;
  /** False when the parent has scrolled out of the loaded window. */
  resolved: boolean;
  onJump?: () => void;
  className?: string;
}) {
  const label = resolved
    ? `Jump to ${author}'s message`
    : "Original message not loaded";
  return (
    <button
      aria-label={label}
      className={cn(
        "group/quote mb-1 flex w-full max-w-full cursor-pointer items-stretch gap-2 text-left",
        !resolved && "cursor-default",
        className,
      )}
      data-testid="quoted-parent"
      disabled={!resolved}
      onClick={resolved ? onJump : undefined}
      title={label}
      type="button"
    >
      {/* Leading bar, not a box — subordinate fragment, not a second message. */}
      <span
        aria-hidden
        className="w-0.5 shrink-0 rounded-full bg-muted-foreground/25 transition-colors group-hover/quote:bg-muted-foreground/60"
      />
      <span className="min-w-0 flex-1 py-0.5">
        {/* Normal case, not letterspaced caps. The quote is a fragment of
            conversation, and caps make it read as a system label — which is
            exactly what every messenger avoids here. */}
        <span className="block truncate text-xs font-medium leading-4 text-ink-faint">
          {resolved ? author : "message unavailable"}
        </span>
        {resolved ? (
          <span className="line-clamp-2 block text-sm leading-5 text-ink-faint transition-colors group-hover/quote:text-ink-faint">
            {body}
          </span>
        ) : null}
      </span>
    </button>
  );
}
