import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const BrainScreen = React.lazy(async () => {
  const module = await import("@/features/luca/brain/BrainScreen");
  return { default: module.BrainScreen };
});

export const Route = createFileRoute("/brain")({
  component: BrainRouteComponent,
});

function BrainRouteComponent() {
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="agents" />}>
      <BrainScreen />
    </React.Suspense>
  );
}
