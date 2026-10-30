import * as React from "react";
import { useRouterState } from "@tanstack/react-router";

import {
  BRAIN_VIEWS,
  firstPickId,
  LIBRARY_KINDS,
  PICK_KEYS,
  paramsOfPick,
  pickIdOf,
  readRememberedPick,
  rememberPick,
  type RailPlace,
} from "@/app/shell/placeRails/placePicks";
import { useArtifactLibrary } from "@/features/artifacts/hooks";
import { useCapabilitySkills } from "@/features/capabilities/hooks";
import { skillRuntimeLabel } from "@/features/capabilities/lib/skillHandoff";
import {
  useManagedAgentsQuery,
  usePersonasQuery,
  useTeamsQuery,
} from "@/features/agents/hooks";
import { getPersonaLibraryState } from "@/features/agents/lib/catalog";
import {
  mindStateOf,
  useMindSignals,
} from "@/features/agents/lib/useMindState";
import { buildResidentLibrary } from "@/features/agents/ui/agentLibraryViewModel";
import { useCommunities } from "@/features/communities/useCommunities";
import { useMindFreshness } from "@/features/agents/space/useMindFreshness";
import { useCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * Each place's rail, from the app's own data (NAVIGATION.md; SHELL_BUILD.md
 * WP-10, Decided 3, 5, 6). Rows only: what the rail draws, the lip names and
 * the cards pick by. A section with nothing in it hides, except Luca and
 * All activity (Decided 10; WP-34); a section with a `+` keeps its
 * heading, so its `+` is never out of reach.
 */

export type PlaceRailRow = {
  id: string;
  title: string;
  /** A quiet word at the row's end: a state. */
  note?: string;
  /** The place's own first row, set apart (Luca, in Agents). */
  main?: boolean;
  /** Something new since you last looked at this mind's page (WP-42,
   *  Decided 8): the small ink dot before the state. */
  fresh?: boolean;
};

export type PlaceRailAdd = "add-agent" | "new-group" | "import";

/** A place's rail, and whether every list it is built from has arrived (a
 *  pick the address names can only be called stale once they have). */
export type PlaceRail = { ready: boolean; sections: PlaceRailSection[] };

export type PlaceRailSection = {
  key: string;
  title?: string;
  add?: { action: PlaceRailAdd; label: string };
  rows: PlaceRailRow[];
};

/** The place's own name, for an untitled section's card. */
export const PLACE_NAMES: Record<RailPlace, string> = {
  agents: "Agents",
  activity: "Activity",
  library: "Library",
  brain: "Brain",
};

function useAgentsRail(): PlaceRail {
  const agentsQuery = useManagedAgentsQuery();
  const personasQuery = usePersonasQuery();
  const teamsQuery = useTeamsQuery();
  const luca = useCanonicalLucaPubkey();
  // Each mind's one state (WP-18, Decided 2): its live turn, its runtime
  // tasks, its live side conversations and its errors.
  const signals = useMindSignals();
  // Who has something new since you last looked (WP-42, Decided 8).
  const fresh = useMindFreshness();
  const ready =
    agentsQuery.data !== undefined &&
    personasQuery.data !== undefined &&
    teamsQuery.data !== undefined;
  const sections = React.useMemo(() => {
    const library = buildResidentLibrary(
      agentsQuery.data ?? [],
      getPersonaLibraryState(personasQuery.data ?? []).libraryPersonas,
    );
    const managed = new Map(
      (agentsQuery.data ?? []).map((agent) => [
        normalizePubkey(agent.pubkey),
        agent,
      ]),
    );
    const stateOf = (resident: (typeof library)[number]) => {
      const key = resident.pubkey ? normalizePubkey(resident.pubkey) : null;
      const agent = key ? managed.get(key) : undefined;
      return mindStateOf(signals, key, {
        availability: resident.availability,
        lastError: agent?.lastError,
        waking: Boolean(agent?.waking),
      });
    };
    const isLuca = (pubkey: string | null) =>
      Boolean(luca && pubkey && normalizePubkey(pubkey) === luca);
    const lucaResident = library.find((resident) => isLuca(resident.pubkey));
    const lucaRow: PlaceRailRow = lucaResident
      ? {
          fresh: fresh.has(normalizePubkey(lucaResident.pubkey ?? "")),
          id: `mind:${normalizePubkey(lucaResident.pubkey ?? "")}`,
          main: true,
          note: stateOf(lucaResident),
          title: lucaResident.displayName,
        }
      : { id: "luca", main: true, title: "Luca" };
    const others = library
      .filter((resident) => !isLuca(resident.pubkey))
      .map((resident) => ({
        fresh: resident.pubkey
          ? fresh.has(normalizePubkey(resident.pubkey))
          : false,
        id: resident.pubkey
          ? `mind:${normalizePubkey(resident.pubkey)}`
          : `persona:${resident.personaId ?? resident.residentId}`,
        note: stateOf(resident),
        title: resident.displayName,
      }));
    const groups = (teamsQuery.data ?? []).map((team) => ({
      id: `group:${team.id}`,
      title: team.name,
    }));
    const sections: PlaceRailSection[] = [
      { key: "luca", rows: [lucaRow] },
      {
        add: { action: "add-agent", label: "Add agent" },
        key: "agents",
        rows: others,
        title: "Agents",
      },
    ];
    // Connected left for the Chats rail, as Apps (WP-34, Decided 9).
    sections.push({
      add: { action: "new-group", label: "New group" },
      key: "groups",
      rows: groups,
      title: "Groups",
    });
    return sections;
  }, [
    agentsQuery.data,
    fresh,
    luca,
    personasQuery.data,
    signals,
    teamsQuery.data,
  ]);
  return { ready, sections };
}

/** Activity is the record (WP-34, Decided 10): All activity first, then
 *  each mind's signed record. Needs you moved to the top of Chats; Now and
 *  Side conversations retired, live work being in the Chats rail. */
function useActivityRail(): PlaceRail {
  const agentsQuery = useManagedAgentsQuery();
  const sections = React.useMemo(() => {
    const records = (agentsQuery.data ?? []).map((agent) => ({
      id: `record:${normalizePubkey(agent.pubkey)}`,
      title: agent.name,
    }));
    const sections: PlaceRailSection[] = [
      { key: "streams", rows: [{ id: "all", title: "All activity" }] },
    ];
    if (records.length > 0)
      sections.push({ key: "record", rows: records, title: "Signed record" });
    return sections;
  }, [agentsQuery.data]);
  return { ready: agentsQuery.data !== undefined, sections };
}

function useLibraryRail(): PlaceRail {
  const skillsQuery = useCapabilitySkills();
  const deleted = useArtifactLibrary({
    deletedState: "deleted",
    kind: "all",
    query: "",
  });
  const deletedCount =
    deleted.data?.pages[0]?.total ?? deleted.data?.pages[0]?.artifacts.length;
  // Recently deleted stays while it is the pick, emptied or not (the last
  // piece restored), so the pick never jumps away under you; it hides once
  // you leave it empty.
  const deletedPicked = usePlacePick("library").pick === "deleted";
  const sections = React.useMemo(() => {
    const skills = skillsQuery.data ?? [];
    const runtimeIds = [
      ...new Set(skills.flatMap((skill) => skill.runtimeIds)),
    ].sort((a, b) => skillRuntimeLabel(a).localeCompare(skillRuntimeLabel(b)));
    const sections: PlaceRailSection[] = [
      {
        add: { action: "import", label: "Import" },
        key: "made",
        rows: LIBRARY_KINDS.map((kind) => ({
          id: `made:${kind.id}`,
          title: kind.label,
        })),
        title: "Made",
      },
    ];
    if (skills.length > 0)
      sections.push({
        key: "skills",
        rows: [
          { id: "skills:all", title: "All" },
          ...runtimeIds.map((runtimeId) => ({
            id: `skills:${runtimeId}`,
            title: skillRuntimeLabel(runtimeId),
          })),
        ],
        title: "Skills",
      });
    if ((deletedCount ?? 0) > 0 || deletedPicked)
      sections.push({
        key: "deleted",
        rows: [{ id: "deleted", title: "Recently deleted" }],
      });
    return sections;
  }, [deletedCount, deletedPicked, skillsQuery.data]);
  return {
    ready:
      (skillsQuery.data !== undefined || skillsQuery.isError) &&
      (deleted.data !== undefined || deleted.isError),
    sections,
  };
}

/** Brain's rail (BETA14_RELEASE.md WP-38, Decided 2): its body's two views,
 *  Connections and Activity, as rows in one untitled section. */
function useBrainRail(): PlaceRail {
  const sections = React.useMemo(
    (): PlaceRailSection[] => [
      {
        key: "views",
        rows: BRAIN_VIEWS.map((each) => ({ id: each.id, title: each.label })),
      },
    ],
    [],
  );
  return { ready: true, sections };
}

/** Each place's rail hook. A component calls the one for its place and is
 *  keyed by the place, so the hooks it calls never change under it. */
export const PLACE_RAIL_HOOKS: Record<RailPlace, () => PlaceRail> = {
  activity: useActivityRail,
  agents: useAgentsRail,
  brain: useBrainRail,
  library: useLibraryRail,
};

const PLACE_ROUTES: Record<RailPlace, string> = {
  agents: "/agents",
  activity: "/pulse",
  library: "/artifacts",
  brain: "/brain",
};

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * What the place has picked (Decided 7): the address's row, else the last
 * one picked this session, else the place's first. Off the place's own route
 * nothing is picked. An address that names a row is
 * remembered for the session, by community.
 */
export function usePlacePick(place: RailPlace): {
  pick: string | null;
  /** The address names the pick itself (not the memory or the default). */
  inAddress: boolean;
  scope: string;
} {
  const location = useRouterState({ select: (state) => state.location });
  const { activeCommunity } = useCommunities();
  const luca = useCanonicalLucaPubkey();
  const scope = activeCommunity?.id ?? "local";
  const onRoute = location.pathname === PLACE_ROUTES[place];
  const fromAddress = onRoute
    ? pickIdOf(place, location.search as Record<string, unknown>)
    : null;
  const inAddress = fromAddress !== null;
  const resolved = onRoute
    ? (fromAddress ??
      readRememberedPick(sessionStore(), scope, place) ??
      firstPickId(place, luca))
    : null;
  // With no Luca there is nothing to open on: nothing is picked, and the lip
  // says the place's own name.
  const pick = resolved === "luca" ? null : resolved;
  React.useEffect(() => {
    if (inAddress && pick) rememberPick(sessionStore(), scope, place, pick);
  }, [inAddress, pick, place, scope]);
  return { inAddress, pick, scope };
}

/** The picked row, from a rail's sections. */
export function pickedRow(
  sections: readonly PlaceRailSection[],
  pick: string | null,
) {
  if (!pick) return null;
  for (const section of sections) {
    const row = section.rows.find((each) => each.id === pick);
    if (row) return { row, section };
  }
  return null;
}

/**
 * Keeps the place's pick in the address (Decided 7), for the place's own
 * card, which is on screen whenever the place is (the rail may be closed, or
 * a sheet). A visit that names no row takes the remembered or first one, in
 * place of the bare address; a row that no longer exists (a group deleted,
 * an app disconnected) gives way to the first. Both replace, so Back never
 * lands on an address that only redirects.
 */
export function useKeepPickInAddress(
  place: RailPlace,
  applyPatch: (
    patch: Record<string, string | null>,
    options?: { replace?: boolean },
  ) => void,
) {
  const { ready, sections } = PLACE_RAIL_HOOKS[place]();
  const { inAddress, pick } = usePlacePick(place);
  const luca = useCanonicalLucaPubkey();
  const stale = inAddress && ready && pickedRow(sections, pick) === null;
  const target = !pick
    ? null
    : !inAddress
      ? pick
      : stale
        ? firstPickId(place, luca)
        : null;
  React.useEffect(() => {
    if (!target || target === "luca" || (inAddress && target === pick)) return;
    const params = paramsOfPick(place, target);
    applyPatch(
      Object.fromEntries(
        PICK_KEYS[place].map((key) => [key, params[key] ?? null]),
      ),
      { replace: true },
    );
  }, [applyPatch, inAddress, pick, place, target]);
}
