import { ArrowDown, ArrowUp } from "lucide-react";

import { Button } from "@/shared/ui/button";

const UNREAD_PILL_CLASS =
  "luca-glass-pill pointer-events-auto h-7 min-h-7 gap-1.5 rounded-full border-border/70 bg-background/95 px-2 py-1 text-xs font-medium text-ink-faint shadow-xs backdrop-blur-sm hover:bg-muted/70 hover:text-foreground [&_svg]:size-4";

export function unreadCountLabel(count: number) {
  return `${count} new message${count === 1 ? "" : "s"}`;
}

export function UnreadPill({
  accessibleLabel,
  direction,
  label,
  onClick,
  testId,
}: {
  /** What the pill is called when its arrow is not seen; the label by default. */
  accessibleLabel?: string;
  direction: "up" | "down";
  label: string;
  onClick: () => void;
  testId: string;
}) {
  const Arrow = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <Button
      aria-label={accessibleLabel}
      className={UNREAD_PILL_CLASS}
      data-testid={testId}
      onClick={onClick}
      size="sm"
      type="button"
      variant="outline"
    >
      <Arrow aria-hidden />
      {label}
    </Button>
  );
}
