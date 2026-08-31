import { createFileRoute } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { LucaProjectsScreen } from "@/features/luca-projects/LucaProjectsScreen";

type ProjectsRouteSearch = {
  collection?: "project";
  collectionId?: string;
};

function validateProjectsSearch(
  search: Record<string, unknown>,
): ProjectsRouteSearch {
  const collectionId =
    typeof search.collectionId === "string" && search.collectionId.length > 0
      ? search.collectionId
      : undefined;
  return {
    collection:
      search.collection === "project" && collectionId ? "project" : undefined,
    collectionId: search.collection === "project" ? collectionId : undefined,
  };
}

export const Route = createFileRoute("/projects")({
  validateSearch: validateProjectsSearch,
  component: ProjectsRouteComponent,
});

function ProjectsRouteComponent() {
  const { goProjects } = useAppNavigation();
  return (
    <LucaProjectsScreen
      onOpenProject={(projectId) =>
        void goProjects({ collectionId: projectId })
      }
    />
  );
}
