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
  /** Under the shell, the rail's `+`: Add agent or New group (WP-10). */
  add?: "agent" | "group";
  /** Under the shell, the connected app or group picked in the rail. */
  connected?: string;
  group?: string;
  profile?: string;
  profilePersona?: string;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
  review?: "native";
  /** Under the shell: a mind's space opened at What they can read (`/brain`). */
  at?: "read";
  /** A mind's tab. Under the shell: notebook, self or settings (WP-13). */
  section?: "place" | "documents" | "notebook" | "self" | "settings";
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validateAgentsSearch(
  search: Record<string, unknown>,
): AgentsRouteSearch {
  const section =
    search.section === "place" ||
    search.section === "documents" ||
    search.section === "notebook" ||
    search.section === "self" ||
    search.section === "settings"
      ? search.section
      : undefined;
  return {
    add:
      search.add === "agent" || search.add === "group" ? search.add : undefined,
    at: search.at === "read" ? "read" : undefined,
    connected: nonEmptyString(search.connected),
    group: nonEmptyString(search.group),
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
