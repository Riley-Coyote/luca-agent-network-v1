import * as React from "react";

import type { AgentLibrarySection } from "@/features/agents/ui/AgentLibraryWorkspace";
import { useRouter } from "@tanstack/react-router";

import { useKeepPickInAddress } from "@/app/shell/placeRails/usePlaceRails";
import {
  mindPageOfLegacy,
  mindPageWord,
  parseMindPage,
  type MindPage,
} from "@/features/agents/space/mindSection";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const AgentsView = React.lazy(async () => {
  const module = await import("@/features/agents/ui/AgentsView");
  return { default: module.AgentsView };
});

const AGENT_LIBRARY_SEARCH_KEYS = [
  "add",
  "at",
  "group",
  "page",
  "profile",
  "profilePersona",
  "profileTab",
  "profileView",
  "review",
  "section",
] as const;

function sectionFromSearch(
  value: string | null,
  legacyTab: string | null,
): AgentLibrarySection {
  if (
    value === "place" ||
    value === "documents" ||
    value === "notebook" ||
    value === "settings"
  )
    return value;
  if (value === "overview") return "documents";
  if (legacyTab === "continuity" || legacyTab === "memories") {
    return "notebook";
  }
  if (legacyTab === "runtime") return "settings";
  return "place";
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
  const shellFrame = useShellFrameEnabled();
  // Under the shell a mind has their page and the pages that slide in over
  // it, in the address's `page` (BETA14_RELEASE.md WP-43, Decided 3). Every
  // old way in (`at`, the old `section` and `profileTab`) is read once onto
  // its new home, in place, so a reload keeps the page.
  const mindPage = React.useMemo(
    () => parseMindPage(values.page),
    [values.page],
  );
  // Read from one snapshot of the router's search, so a way in that names
  // both an old section and its `at` is read as a whole (the window's own
  // hash can run a render ahead of the router's).
  const legacyPage = shellFrame
    ? mindPageOfLegacy({
        at: values.at,
        profileTab: values.profileTab,
        section: values.section,
      })
    : null;
  const legacyWord = legacyPage ? (mindPageWord(legacyPage) ?? "") : null;
  React.useEffect(() => {
    if (legacyWord === null) return;
    applyPatch(
      {
        at: null,
        page: legacyWord || null,
        profileTab: null,
        profileView: null,
        section: null,
      },
      { replace: true },
    );
  }, [applyPatch, legacyWord]);
  const changeMindPage = React.useCallback(
    (next: MindPage, options?: { replace?: boolean }) => {
      applyPatch({ page: mindPageWord(next) }, options);
    },
    [applyPatch],
  );

  const selectResident = React.useCallback(
    (pubkey: string) => {
      const reselectingCurrentResident =
        values.profile?.toLowerCase() === pubkey.toLowerCase();
      applyPatch({
        at: null,
        page: null,
        profile: pubkey,
        profilePersona: null,
        profileTab: null,
        profileView: null,
        // A reload can leave the owner on a resident's deep-linked Notebook.
        // Re-selecting that same roster row must not discard the URL section.
        section: reselectingCurrentResident
          ? section === "place"
            ? null
            : section
          : null,
      });
    },
    [applyPatch, section, values.profile],
  );
  const selectPersona = React.useCallback(
    (personaId: string) => {
      applyPatch({
        profile: null,
        profilePersona: personaId,
        profileTab: null,
        profileView: null,
        section: null,
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
        section: next === "place" ? null : next,
      });
    },
    [applyPatch],
  );

  const consumeAdd = React.useCallback(
    () => applyPatch({ add: null }, { replace: true }),
    [applyPatch],
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {shellFrame ? <KeepAgentsPick applyPatch={applyPatch} /> : null}
      <React.Suspense fallback={<ViewLoadingFallback kind="agents" />}>
        <AgentsView
          addRequest={
            shellFrame && (values.add === "agent" || values.add === "group")
              ? values.add
              : null
          }
          groupId={shellFrame ? values.group : null}
          mindPage={mindPage}
          onAddConsumed={consumeAdd}
          onMindPage={changeMindPage}
          onClearSelection={clearSelection}
          onReviewNativeConsumed={() => applyPatch({ review: null })}
          onSectionChange={changeSection}
          onSelectPersona={selectPersona}
          onSelectResident={selectResident}
          section={section}
          reviewNative={values.review === "native"}
          selectedPersonaId={values.profilePersona}
          selectedPubkey={values.profile}
        />
      </React.Suspense>
    </div>
  );
}

/** Under the shell the rail picks, and the pick is in the address (WP-10). */
function KeepAgentsPick({
  applyPatch,
}: {
  applyPatch: (
    patch: Record<string, string | null>,
    options?: { replace?: boolean },
  ) => void;
}) {
  useKeepPickInAddress("agents", applyPatch);
  return null;
}
