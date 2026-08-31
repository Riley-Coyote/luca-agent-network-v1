import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ProjectsScreen = React.lazy(async () => {
  const module = await import("@/features/luca-projects/LucaProjectsScreen");
  return { default: module.LucaProjectsScreen };
});

export const Route = createFileRoute("/projects")({
  validateSearch: (search: Record<string, unknown>) => ({
    collection: search.collection === "project" ? "project" : undefined,
    collectionId:
      typeof search.collectionId === "string" && search.collectionId.length > 0
        ? search.collectionId
        : undefined,
  }),
  component: ProjectsRouteComponent,
});

function ProjectsRouteComponent() {
  const { goProjects } = useAppNavigation();
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <ProjectsScreen
        onOpenProject={(projectId) =>
          void goProjects({ collectionId: projectId })
        }
      />
    </React.Suspense>
  );
}
