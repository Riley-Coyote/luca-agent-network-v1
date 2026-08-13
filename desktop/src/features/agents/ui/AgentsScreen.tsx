import * as React from "react";

import type { AgentLibrarySection } from "@/features/agents/ui/AgentLibraryWorkspace";
import { useRouter } from "@tanstack/react-router";

import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const AgentsView = React.lazy(async () => {
  const module = await import("@/features/agents/ui/AgentsView");
  return { default: module.AgentsView };
});

const AGENT_LIBRARY_SEARCH_KEYS = [
  "profile",
  "profilePersona",
  "profileTab",
  "profileView",
  "section",
] as const;

function sectionFromSearch(
  value: string | null,
  legacyTab: string | null,
): AgentLibrarySection {
  if (value === "notebook" || value === "settings") return value;
  if (legacyTab === "continuity" || legacyTab === "memories") {
    return "notebook";
  }
  if (legacyTab === "runtime") return "settings";
  return "overview";
}

function sectionFromBrowserLocation(): string | null {
  const query = window.location.hash.split("?", 2)[1];
  return query ? new URLSearchParams(query).get("section") : null;
}

export function AgentsScreen() {
  const router = useRouter();
  const { applyPatch, values } = useHistorySearchState(
    AGENT_LIBRARY_SEARCH_KEYS,
  );
  const currentLocationSection = React.useSyncExternalStore(
    (onStoreChange) => router.history.subscribe(() => onStoreChange()),
    sectionFromBrowserLocation,
    () => null,
  );
  const section = sectionFromSearch(currentLocationSection, values.profileTab);

  const selectResident = React.useCallback(
    (pubkey: string) => {
      applyPatch({
        profile: pubkey,
        profilePersona: null,
        profileTab: null,
        profileView: null,
        section: "overview",
      });
    },
    [applyPatch],
  );
  const selectPersona = React.useCallback(
    (personaId: string) => {
      applyPatch({
        profile: null,
        profilePersona: personaId,
        profileTab: null,
        profileView: null,
        section: "overview",
      });
    },
    [applyPatch],
  );
  const clearSelection = React.useCallback(() => {
    applyPatch({
      profile: null,
      profilePersona: null,
      profileTab: null,
      profileView: null,
      section: null,
    });
  }, [applyPatch]);
  const changeSection = React.useCallback(
    (next: AgentLibrarySection) => {
      applyPatch({
        profileTab: null,
        profileView: null,
        section: next === "overview" ? null : next,
      });
    },
    [applyPatch],
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <React.Suspense fallback={<ViewLoadingFallback kind="agents" />}>
        <AgentsView
          onClearSelection={clearSelection}
          onSectionChange={changeSection}
          onSelectPersona={selectPersona}
          onSelectResident={selectResident}
          section={section}
          selectedPersonaId={values.profilePersona}
          selectedPubkey={values.profile}
        />
      </React.Suspense>
    </div>
  );
}
