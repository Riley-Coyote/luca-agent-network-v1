import type { ReactNode } from "react";

export function GradientLayer() {
  return (
    <div
      aria-hidden="true"
      className="luca-theme-shell-layer pointer-events-none absolute inset-0 -z-10"
      data-luca-theme-shell-layer
    />
  );
}

export function ContentSurface({
  children,
  floorHost = true,
}: {
  children: ReactNode;
  floorHost?: boolean;
}) {
  return (
    <div
      className="relative z-10 mb-2 ml-px mr-2 mt-2 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-buzz-content-surface
      data-luca-conversation-surface
      data-luca-floor-host={floorHost || undefined}
    >
      {children}
    </div>
  );
}
