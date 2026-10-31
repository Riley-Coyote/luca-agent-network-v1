import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import {
  parseProfilePanelTab,
  parseProfilePanelView,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "@/features/profile/ui/UserProfilePanelUtils";
import {
  parseMindSettingsAt,
  type MindSettingsAt,
} from "@/features/agents/space/mindSection";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type AgentsRouteSearch = {
  /** Under the shell, the rail's `+`: Add agent or New group (WP-10). */
  add?: "agent" | "group";
  /** Under the shell, the group picked in the rail. A connected app's card
   *  moved to Chats, under Apps (WP-34). */
  group?: string;
  /**
   * Under the shell: the page that slid in over a mind's own page
   * (BETA14_RELEASE.md WP-43, Decided 3): Settings or one of its panes,
   * Made, a piece, a page they write. None is their page.
   */
  page?: string;
  profile?: string;
  profilePersona?: string;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
  review?: "native";
  /**
   * A way in that names one of a mind's Settings panes (WP-26, Decided 4):
   * What they can read (`/brain`), their harness (an agent showing its
   * runtime), or their permissions (an agent asking for access). Under the
   * shell it is read once onto `page` (WP-43, Decided 3).
   */
  at?: MindSettingsAt;
  /** The classic page's section; under the shell an old way in, read once
   *  onto `page` (WP-43, Decided 3). */
  section?:
    | "place"
    | "documents"
    | "notebook"
    | "overview"
    | "self"
    | "settings";
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
    search.section === "overview" ||
    search.section === "self" ||
    search.section === "settings"
      ? search.section
      : undefined;
  return {
    add:
      search.add === "agent" || search.add === "group" ? search.add : undefined,
    at: parseMindSettingsAt(search.at),
    group: nonEmptyString(search.group),
    page: nonEmptyString(search.page),
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
