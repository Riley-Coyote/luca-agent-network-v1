import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { usePreviewFeatureWarning } from "@/shared/features";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const RepositoriesScreen = React.lazy(async () => {
  const module = await import("@/features/projects/ui/ProjectsScreen");
  return { default: module.ProjectsScreen };
});

export const Route = createFileRoute("/repositories")({
  component: RepositoriesRouteComponent,
});

function RepositoriesRouteComponent() {
  usePreviewFeatureWarning("projects");
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <RepositoriesScreen />
    </React.Suspense>
  );
}
