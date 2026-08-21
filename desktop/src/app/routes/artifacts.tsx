import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ArtifactLibraryScreen = React.lazy(async () => {
  const module = await import("@/features/artifacts/ui/ArtifactLibraryScreen");
  return { default: module.ArtifactLibraryScreen };
});

export const Route = createFileRoute("/artifacts")({
  component: ArtifactsRouteComponent,
});

function ArtifactsRouteComponent() {
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <ArtifactLibraryScreen />
    </React.Suspense>
  );
}
