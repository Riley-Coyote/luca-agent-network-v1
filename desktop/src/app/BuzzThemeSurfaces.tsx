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

/**
 * The shell's focal card around the routed content. A route that brings its
 * own canvas (Library, Agents, Activity) stamps the floor host on its root and
 * paints its own card inside it; for those the shell steps aside and this is
 * a plain plane, or the route's card would sit inside the shell's — two edges,
 * one lip apart.
 */
export function ContentSurface({
  card = true,
  children,
}: {
  card?: boolean;
  children: ReactNode;
}) {
  if (!card) {
    return (
      <div
        className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden"
        data-buzz-content-plane
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className="relative z-10 mb-2 ml-px mr-2 mt-2 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-buzz-content-surface
      data-luca-conversation-surface
    >
      {children}
    </div>
  );
}
