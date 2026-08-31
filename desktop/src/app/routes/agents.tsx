import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import {
  parseProfilePanelTab,
  parseProfilePanelView,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "@/features/profile/ui/UserProfilePanelUtils";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type AgentsRouteSearch = {
  collection?: "agent";
  collectionId?: string;
  profile?: string;
  profilePersona?: string;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
  review?: "native";
  section?: "documents" | "notebook" | "settings";
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validateAgentsSearch(
  search: Record<string, unknown>,
): AgentsRouteSearch {
  const section =
    search.section === "documents" ||
    search.section === "notebook" ||
    search.section === "settings"
      ? search.section
      : undefined;
  return {
    collection: search.collection === "agent" ? "agent" : undefined,
    collectionId: nonEmptyString(search.collectionId),
    profile: nonEmptyString(search.profile),
    profilePersona: nonEmptyString(search.profilePersona),
    profileTab: parseProfilePanelTab(search.profileTab) ?? undefined,
    profileView: parseProfilePanelView(search.profileView) ?? undefined,
    review: search.review === "native" ? "native" : undefined,
    section,
  };
}

const AgentsScreen = React.lazy(async () => {
  const module = await import("@/features/agents/ui/AgentsScreen");
  return { default: module.AgentsScreen };
});

export const Route = createFileRoute("/agents")({
  validateSearch: validateAgentsSearch,
  component: AgentsRouteComponent,
});

function AgentsRouteComponent() {
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="agents" />}>
      <AgentsScreen />
    </React.Suspense>
  );
}
