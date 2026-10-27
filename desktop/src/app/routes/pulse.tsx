import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import {
  ACTIVITY_STREAMS,
  type ActivityStream,
} from "@/app/shell/placeRails/placePicks";
import {
  parseProfilePanelTab,
  parseProfilePanelView,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "@/features/profile/ui/UserProfilePanelUtils";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const PulseScreen = React.lazy(async () => {
  const module = await import("@/features/pulse/ui/PulseScreen");
  return { default: module.PulseScreen };
});

type PulseRouteSearch = {
  profile?: string;
  /** Under the shell, what the rail picked (WP-10, WP-34): All activity,
   *  or one resident's signed record. */
  record?: string;
  stream?: ActivityStream;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
};

function validatePulseSearch(
  search: Record<string, unknown>,
): PulseRouteSearch {
  return {
    profile:
      typeof search.profile === "string" && search.profile.length > 0
        ? search.profile
        : undefined,
    profileTab: parseProfilePanelTab(search.profileTab) ?? undefined,
    profileView: parseProfilePanelView(search.profileView) ?? undefined,
    record:
      typeof search.record === "string" && search.record.length > 0
        ? search.record
        : undefined,
    stream: (ACTIVITY_STREAMS as readonly unknown[]).includes(search.stream)
      ? (search.stream as ActivityStream)
      : undefined,
  };
}

export const Route = createFileRoute("/pulse")({
  validateSearch: validatePulseSearch,
  component: PulseRouteComponent,
});

function PulseRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <PulseScreen />
    </React.Suspense>
  );
}
