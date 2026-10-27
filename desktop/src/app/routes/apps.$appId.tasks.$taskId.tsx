import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const AppTaskCard = React.lazy(async () => {
  const module = await import("@/app/shell/placeRails/AppTaskCard");
  return { default: module.AppTaskCard };
});

/**
 * One of a connected app's tasks, as the work (BETA14_RELEASE.md WP-35):
 * opened from its row under its app in the Chats rail, live or finished.
 * The address names the app by its family ("claude", "codex") and the task
 * by its own id.
 */
export const Route = createFileRoute("/apps/$appId/tasks/$taskId")({
  component: AppTaskRouteComponent,
});

function AppTaskRouteComponent() {
  const { taskId } = Route.useParams();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <React.Suspense
        fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
      >
        <AppTaskCard taskId={taskId} />
      </React.Suspense>
    </div>
  );
}
