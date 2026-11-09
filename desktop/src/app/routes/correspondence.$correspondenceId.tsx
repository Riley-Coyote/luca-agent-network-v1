import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { correspondenceSearch } from "@/features/exchange/correspondenceNavigation";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const CorrespondencePage = React.lazy(() =>
  import("@/features/exchange/ui/CorrespondencePage").then((module) => ({
    default: module.CorrespondencePage,
  })),
);

export const Route = createFileRoute("/correspondence/$correspondenceId")({
  validateSearch: correspondenceSearch,
  component: CorrespondenceRoute,
});

function CorrespondenceRoute() {
  const { correspondenceId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <React.Suspense
        fallback={<ViewLoadingFallback includeHeader kind="channel" />}
      >
        <CorrespondencePage correspondenceId={correspondenceId} {...search} />
      </React.Suspense>
    </div>
  );
}
