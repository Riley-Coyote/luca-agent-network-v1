import { ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";

import { cn } from "@/shared/lib/cn";

/**
 * Collapses an over-long message body to a readable height.
 *
 * This is the one piece of the conversation model that is Luca-specific rather
 * than borrowed. WhatsApp and iMessage never had to solve it, because humans
 * write short messages — but a resident routinely answers with several hundred
 * words, and a single such reply will otherwise own the entire channel and push
 * every other voice off screen.
 *
 * Design notes:
 * - The measurement is on RENDERED height, not character count. A 400-word
 *   answer and a 40-line code block are the same problem, and only one of them
 *   is long by character count.
 * - The fade is a CSS mask, not a gradient overlay. An overlay has to match
 *   whatever is behind it, and the row background changes on hover, focus and
 *   unread — a mask fades the content itself and is background-independent.
 * - Collapsing is never automatic after expansion. Once you have chosen to read
 *   something, having it fold back up under you is hostile.
 */

/** Bodies taller than this collapse. ~15 lines of chat text. */
const COLLAPSE_THRESHOLD_REM = 15;
/** Height shown while collapsed. Slightly under the threshold so a collapsed
 *  body is always visibly shorter than one that just missed the cut. */
const COLLAPSED_HEIGHT_REM = 13;

function remToPx(rem: number): number {
  if (typeof window === "undefined") return rem * 16;
  const root = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  // The app implements Cmd +/- zoom by scaling the root font-size, so this must
  // be read live rather than assumed to be 16.
  return rem * (Number.isFinite(root) && root > 0 ? root : 16);
}

export function CollapsibleMessageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      // scrollHeight is the natural height even while the wrapper is clamped.
      setOverflows(el.scrollHeight > remToPx(COLLAPSE_THRESHOLD_REM));
    };
    measure();

    // Bodies grow after mount: images decode, code blocks highlight, markdown
    // hydrates. Measuring once would leave late-growing messages uncollapsed.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const collapsed = overflows && !expanded;

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className={cn("relative", collapsed && "overflow-hidden")}
        style={
          collapsed
            ? {
                maxHeight: `${COLLAPSED_HEIGHT_REM}rem`,
                // Fade the content itself, so this works over any row state.
                maskImage:
                  "linear-gradient(to bottom, #000 65%, rgb(0 0 0 / 0) 100%)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, #000 65%, rgb(0 0 0 / 0) 100%)",
              }
            : undefined
        }
      >
        <div ref={contentRef}>{children}</div>
      </div>

      {overflows ? (
        <button
          aria-expanded={expanded}
          className="mt-1 inline-flex w-fit items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="message-body-expand"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
