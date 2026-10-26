import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ArtifactLibraryScreen = React.lazy(async () => {
  const module = await import("@/features/artifacts/ui/ArtifactLibraryScreen");
  return { default: module.ArtifactLibraryScreen };
});

type ArtifactsRouteSearch = {
  /** Under the shell, the list the rail picked (WP-10): Made by kind,
   *  Skills by runtime, or Recently deleted. */
  deleted?: "recently";
  made?: string;
  skills?: string;
  /** Under the shell, the rail's Import, answered by the Library. */
  import?: "file";
};

// Words, never numbers: the router reads `1` in an address as a number.
function word(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validateArtifactsSearch(
  search: Record<string, unknown>,
): ArtifactsRouteSearch {
  return {
    deleted: search.deleted === "recently" ? "recently" : undefined,
    import: search.import === "file" ? "file" : undefined,
    made: word(search.made),
    skills: word(search.skills),
  };
}

export const Route = createFileRoute("/artifacts")({
  validateSearch: validateArtifactsSearch,
  component: ArtifactsRouteComponent,
});

function ArtifactsRouteComponent() {
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <ArtifactLibraryScreen />
    </React.Suspense>
  );
}
