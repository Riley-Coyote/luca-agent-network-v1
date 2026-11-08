import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const HomeDashboard = React.lazy(() =>
  import("@/features/dashboard/HomeDashboard").then((module) => ({
    default: module.HomeDashboard,
  })),
);

export const Route = createFileRoute("/dashboard")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    task?: string;
    session?: string;
    title?: string;
    runtime?: "claude_code" | "codex";
  } => ({
    task:
      typeof search.task === "string" ? search.task.slice(0, 128) : undefined,
    session:
      typeof search.session === "string"
        ? search.session.slice(0, 128)
        : undefined,
    title:
      typeof search.title === "string" ? search.title.slice(0, 240) : undefined,
    runtime:
      search.runtime === "claude_code" || search.runtime === "codex"
        ? search.runtime
        : undefined,
  }),
  component: DashboardRoute,
});
function DashboardRoute() {
  const { task, session, title, runtime } = Route.useSearch();
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <HomeDashboard
        aboutTaskId={task}
        initialContext={
          runtime && title
            ? {
                title,
                runtimeFamily: runtime,
                taskId: task,
                sessionId: session,
              }
            : undefined
        }
      />
    </React.Suspense>
  );
}
