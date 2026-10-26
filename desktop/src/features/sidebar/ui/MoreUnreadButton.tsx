import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { topChromeInset } from "@/shared/layout/chromeLayout";
import { UnreadPill, unreadCountLabel } from "@/shared/ui/UnreadPill";

export function MoreUnreadButton({
  bottomClassName = "bottom-0",
  count,
  onClick,
  position,
  testId,
}: {
  bottomClassName?: string;
  count: number;
  onClick: () => void;
  position: "top" | "bottom";
  testId: string;
}) {
  const shellFrame = useShellFrameEnabled();
  const positionClassName =
    position === "top" ? topChromeInset.top : bottomClassName;
  // The rail's pill counts conversations out of view, not messages: under
  // the frame it says so, and its arrow says above or below (WP-22, 4). The
  // conversation's own pill keeps "N new messages".
  const where = position === "top" ? "above" : "below";

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center py-1 ${positionClassName}`}
    >
      <UnreadPill
        accessibleLabel={shellFrame ? `${count} unread ${where}` : undefined}
        direction={position === "top" ? "up" : "down"}
        label={shellFrame ? `${count} unread` : unreadCountLabel(count)}
        onClick={onClick}
        testId={testId}
      />
    </div>
  );
}
