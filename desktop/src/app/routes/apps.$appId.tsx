import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const AppPage = React.lazy(async () => {
  const module = await import("@/app/shell/placeRails/ConnectedAppCard");
  return { default: module.AppPage };
});

/**
 * A connected app's page, opened from its row under Apps in the Chats rail
 * (BETA14_RELEASE.md WP-34, Decided 1 and 9): what the Agents place's
 * Connected card held, in the Chats card. The address names the app by its
 * family ("claude", "codex"), so it outlives a reconnect.
 */
export const Route = createFileRoute("/apps/$appId")({
  component: AppRouteComponent,
});

function AppRouteComponent() {
  const { appId } = Route.useParams();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <React.Suspense
        fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
      >
        <AppPage family={appId} />
      </React.Suspense>
    </div>
  );
}
