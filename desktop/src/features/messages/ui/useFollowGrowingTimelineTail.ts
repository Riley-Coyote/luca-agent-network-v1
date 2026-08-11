import * as React from "react";

export function useFollowGrowingTimelineTail(
  trailingContent: React.ReactNode,
  settleAtBottom: () => void,
) {
  const wasAtBottomRef = React.useRef(true);
  const previousContentRef = React.useRef(trailingContent);
  React.useLayoutEffect(() => {
    const changed = previousContentRef.current !== trailingContent;
    previousContentRef.current = trailingContent;
    if (changed && wasAtBottomRef.current) settleAtBottom();
  }, [settleAtBottom, trailingContent]);

  return React.useCallback((atBottom: boolean) => {
    wasAtBottomRef.current = atBottom;
  }, []);
}
