import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const NeedsYouCard = React.lazy(async () => {
  const module = await import("@/app/shell/placeRails/NeedsYouCard");
  return { default: module.NeedsYouCard };
});

/**
 * What needs you, opened from the top of the Chats rail (BETA14_RELEASE.md
 * WP-34, Decided 2): a page in the Chats card, never a conversation, so it
 * takes no tab.
 */
export const Route = createFileRoute("/needs-you")({
  component: NeedsYouRouteComponent,
});

function NeedsYouRouteComponent() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <React.Suspense
        fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
      >
        <NeedsYouCard />
      </React.Suspense>
    </div>
  );
}
