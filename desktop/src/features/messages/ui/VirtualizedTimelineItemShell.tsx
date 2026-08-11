import * as React from "react";

type VirtualizedTimelineItemShellProps = {
  children: React.ReactNode;
  index: number;
  ref?: React.LegacyRef<HTMLDivElement>;
  style: React.CSSProperties;
};

export const PreserveVirtualizedItemVisibilityContext =
  React.createContext(false);

export function VirtualizedTimelineItemShell({
  children,
  ref,
  style,
}: VirtualizedTimelineItemShellProps) {
  const preserveVisibility = React.useContext(
    PreserveVirtualizedItemVisibilityContext,
  );

  return (
    <div
      ref={ref}
      style={preserveVisibility ? style : { ...style, visibility: undefined }}
    >
      {children}
    </div>
  );
}
