import * as React from "react";

/**
 * A room's project — the work it belongs to, usually a local repo.
 *
 * LOCAL PROJECT PROJECTION. There is no relay project field on `Channel`, so
 * the device-local project catalog and one-project-per-room assignment map are
 * authoritative for this slice. With no assignments the map is empty and each
 * room remains directly accessible. The E2E runtime adds deterministic demo
 * assignments without seeding a real profile.
 *
 * Project is an ATTRIBUTE OF THE ROOM, not a mode you are in. A room bound to a
 * repo already carries its own working context, so residents in it get that
 * directory because the room says so — not because you navigated somewhere
 * first. That is what keeps this from becoming a workspace switcher.
 *
 * One project per room, deliberately. A repo-backed project cannot sensibly be
 * many-to-many, and grouping (unlike filter chips) requires a single home.
 */

export type RoomProject = {
  id: string;
  label: string;
  /** Opaque Brain source ids only. Paths and source bodies never enter this store. */
  sourceIds?: string[];
  workingContextStatus?: "attached" | "missing" | "none";
};

export type RoomProjectStoreV1 = {
  version: 1;
  projects: RoomProject[];
  assignments: Record<string, string>;
};

const STORE_KEY_PREFIX = "luca-room-projects.v1";
const LEGACY_PROJECTS_KEY = "luca.projects.v1";
const LEGACY_ASSIGNMENTS_KEY = "luca.roomProjects.v1";
const ROOM_PROJECTS_CHANGED_EVENT = "luca:room-projects-changed";

export const EMPTY_ROOM_PROJECT_STORE: RoomProjectStoreV1 = Object.freeze({
  version: 1,
  projects: [],
  assignments: {},
});

/** Demo assignment, mock only — never seeded into a real profile. */
const DEMO_PROJECTS: RoomProject[] = [
  { id: "luca", label: "Luca", workingContextStatus: "attached" },
  {
    id: "polyphonic",
    label: "Polyphonic",
    workingContextStatus: "attached",
  },
  { id: "field-unit", label: "Field Unit", workingContextStatus: "none" },
];
const DEMO_ASSIGNMENT: Record<string, string> = {
  general: "luca",
  engineering: "luca",
  "deep-history": "luca",
  agents: "polyphonic",
  random: "polyphonic",
};

function readJson<T>(
  key: string,
  fallback: T,
  storage: Storage | undefined = globalThis.localStorage,
): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeScopePart(value: string | undefined, fallback: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized ? encodeURIComponent(normalized) : fallback;
}

export function roomProjectStorageKey(
  ownerPubkey?: string,
  relayUrl?: string,
): string {
  return `${STORE_KEY_PREFIX}:${normalizeScopePart(ownerPubkey, "unknown-owner")}:${normalizeScopePart(relayUrl, "local")}`;
}

function sanitizeSourceIds(input: unknown): string[] {
  return Array.isArray(input)
    ? [
        ...new Set(
          input.filter(
            (value): value is string =>
              typeof value === "string" &&
              value.length <= 128 &&
              /^[A-Za-z0-9._:-]+$/.test(value),
          ),
        ),
      ].sort()
    : [];
}

function sanitizeProject(input: unknown): RoomProject | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const label =
    typeof candidate.label === "string" ? candidate.label.trim() : "";
  if (!id || !label) return null;
  const workingContextStatus =
    candidate.workingContextStatus === "attached" ||
    candidate.workingContextStatus === "missing" ||
    candidate.workingContextStatus === "none"
      ? candidate.workingContextStatus
      : "none";
  const sourceIds = sanitizeSourceIds(candidate.sourceIds);
  return { id, label, sourceIds, workingContextStatus };
}

export function parseRoomProjectStore(
  input: unknown,
): RoomProjectStoreV1 | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  if (candidate.version !== 1) return null;

  const projectsById = new Map<string, RoomProject>();
  if (Array.isArray(candidate.projects)) {
    for (const value of candidate.projects) {
      const project = sanitizeProject(value);
      if (project) projectsById.set(project.id, project);
    }
  }

  const assignments: Record<string, string> = {};
  if (
    candidate.assignments &&
    typeof candidate.assignments === "object" &&
    !Array.isArray(candidate.assignments)
  ) {
    for (const [channelId, projectId] of Object.entries(
      candidate.assignments as Record<string, unknown>,
    )) {
      if (
        channelId.trim() &&
        typeof projectId === "string" &&
        projectsById.has(projectId)
      ) {
        assignments[channelId] = projectId;
      }
    }
  }

  return {
    version: 1,
    projects: [...projectsById.values()],
    assignments,
  };
}

function parseStoredValue(raw: string | null): RoomProjectStoreV1 | null {
  if (!raw) return null;
  try {
    return parseRoomProjectStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Read the device-local project projection for one owner and relay.
 *
 * Older prototypes stored the project catalog and assignments in two global
 * keys. The first scoped read migrates that data atomically and removes the
 * legacy keys so it cannot bleed into another owner or relay.
 */
export function readRoomProjectStore(
  ownerPubkey?: string,
  relayUrl?: string,
  storage: Storage | undefined = globalThis.localStorage,
): RoomProjectStoreV1 {
  if (!storage) return EMPTY_ROOM_PROJECT_STORE;
  try {
    const key = roomProjectStorageKey(ownerPubkey, relayUrl);
    const existing = parseStoredValue(storage.getItem(key));
    if (existing) return existing;

    const legacyProjects = readJson<unknown[]>(
      LEGACY_PROJECTS_KEY,
      [],
      storage,
    );
    const legacyAssignments = readJson<Record<string, unknown>>(
      LEGACY_ASSIGNMENTS_KEY,
      {},
      storage,
    );
    const migrated = parseRoomProjectStore({
      version: 1,
      projects: legacyProjects,
      assignments: legacyAssignments,
    });
    if (!migrated || migrated.projects.length === 0) {
      return EMPTY_ROOM_PROJECT_STORE;
    }

    storage.setItem(key, JSON.stringify(migrated));
    storage.removeItem(LEGACY_PROJECTS_KEY);
    storage.removeItem(LEGACY_ASSIGNMENTS_KEY);
    return migrated;
  } catch {
    return EMPTY_ROOM_PROJECT_STORE;
  }
}

export function writeRoomProjectStore(
  ownerPubkey: string | undefined,
  relayUrl: string | undefined,
  store: RoomProjectStoreV1,
  storage: Storage | undefined = globalThis.localStorage,
): boolean {
  const normalized = parseRoomProjectStore(store);
  if (!storage || !normalized) return false;
  try {
    storage.setItem(
      roomProjectStorageKey(ownerPubkey, relayUrl),
      JSON.stringify(normalized),
    );
    globalThis.window?.dispatchEvent(new Event(ROOM_PROJECTS_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Brain uses this seam to commit its reviewed local project catalog. */
export function replaceRoomProjects(
  ownerPubkey: string | undefined,
  relayUrl: string | undefined,
  projects: readonly RoomProject[],
): boolean {
  const current = readRoomProjectStore(ownerPubkey, relayUrl);
  return writeRoomProjectStore(ownerPubkey, relayUrl, {
    version: 1,
    projects: [...projects],
    assignments: current.assignments,
  });
}

function projectIdForLabel(label: string, existingIds: ReadonlySet<string>) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project";
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/** Atomically creates a local project and assigns its first canonical room. */
export function createRoomProject(
  ownerPubkey: string | undefined,
  relayUrl: string | undefined,
  input: { label: string; roomId: string; sourceIds?: readonly string[] },
): RoomProject | null {
  const label = input.label.trim();
  if (!label || !input.roomId.trim()) return null;
  const current = readRoomProjectStore(ownerPubkey, relayUrl);
  const sourceIds = sanitizeSourceIds(input.sourceIds);
  const id = projectIdForLabel(
    label,
    new Set(current.projects.map((project) => project.id)),
  );
  const project = sanitizeProject({
    id,
    label,
    sourceIds,
    workingContextStatus: sourceIds.length ? "attached" : "none",
  });
  if (!project) return null;
  return writeRoomProjectStore(ownerPubkey, relayUrl, {
    version: 1,
    projects: [...current.projects, project],
    assignments: { ...current.assignments, [input.roomId]: project.id },
  })
    ? project
    : null;
}

export function updateRoomProjectSources(
  ownerPubkey: string | undefined,
  relayUrl: string | undefined,
  projectId: string,
  sourceIds: readonly string[],
): boolean {
  const current = readRoomProjectStore(ownerPubkey, relayUrl);
  const sanitizedSourceIds = sanitizeSourceIds(sourceIds);
  const projects: RoomProject[] = current.projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          sourceIds: sanitizedSourceIds,
          workingContextStatus: sanitizedSourceIds.length
            ? ("attached" as const)
            : ("none" as const),
        }
      : project,
  );
  return writeRoomProjectStore(ownerPubkey, relayUrl, {
    ...current,
    projects,
  });
}

/** Assign or unassign one room without changing its messaging identity. */
export function assignRoomProject(
  ownerPubkey: string | undefined,
  relayUrl: string | undefined,
  channelId: string,
  projectId: string | null,
): boolean {
  const current = readRoomProjectStore(ownerPubkey, relayUrl);
  const assignments = { ...current.assignments };
  if (projectId) assignments[channelId] = projectId;
  else delete assignments[channelId];
  return writeRoomProjectStore(ownerPubkey, relayUrl, {
    ...current,
    assignments,
  });
}

function useRoomProjectRevision(): number {
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener(ROOM_PROJECTS_CHANGED_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(ROOM_PROJECTS_CHANGED_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return revision;
}

function isMockRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as { __BUZZ_E2E__?: unknown }).__BUZZ_E2E__)
  );
}

function isProjectDemoRuntime(): boolean {
  if (!isMockRuntime() || typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get("projectDemo") === "1" || params.get("notebookDemo") === "1"
  );
}

/**
 * Resolve each room's project. Keyed by channel id, with the demo map falling
 * back to channel NAME so it survives the mock's regenerated ids.
 */
export function useRoomProjects(
  channels: readonly { id: string; name: string }[],
  ownerPubkey?: string,
  relayUrl?: string,
): ReadonlyMap<string, RoomProject> {
  const revision = useRoomProjectRevision();
  return React.useMemo(() => {
    void revision;
    const includeDemoProjects = isProjectDemoRuntime();
    const store = readRoomProjectStore(ownerPubkey, relayUrl);
    const projects = new Map(
      [...store.projects, ...(includeDemoProjects ? DEMO_PROJECTS : [])].map(
        (project) => [project.id, project],
      ),
    );
    const assignments = store.assignments;

    const resolved = new Map<string, RoomProject>();
    for (const channel of channels) {
      const projectId =
        assignments[channel.id] ??
        (includeDemoProjects ? DEMO_ASSIGNMENT[channel.name] : undefined);
      const project = projectId ? projects.get(projectId) : undefined;
      if (project) resolved.set(channel.id, project);
    }
    return resolved;
  }, [channels, ownerPubkey, relayUrl, revision]);
}

export function useRoomProjectCatalog(
  channels: readonly { id: string; name: string }[],
  ownerPubkey?: string,
  relayUrl?: string,
): readonly RoomProject[] {
  const revision = useRoomProjectRevision();
  return React.useMemo(() => {
    void revision;
    const includeDemoProjects = isProjectDemoRuntime();
    const store = readRoomProjectStore(ownerPubkey, relayUrl);
    const projects = [
      ...store.projects,
      ...(includeDemoProjects ? DEMO_PROJECTS : []),
    ];
    const unique = new Map<string, RoomProject>();
    for (const project of projects) {
      if (!project?.id || !project?.label) continue;
      unique.set(project.id, {
        id: project.id,
        label: project.label,
        sourceIds: project.sourceIds ?? [],
        workingContextStatus: project.workingContextStatus ?? "none",
      });
    }

    // Keep the hook reactive to the channel source. Project assignments are a
    // local projection today; when they become a real query this dependency is
    // the seam that will update the catalog without changing its consumers.
    void channels;
    return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [channels, ownerPubkey, relayUrl, revision]);
}

const LAST_PROJECT_ROOMS_KEY = "luca.lastProjectRooms.v1";

export function rememberLastProjectRoom(
  projectId: string,
  channelId: string,
): void {
  try {
    const current = readJson<Record<string, string>>(
      LAST_PROJECT_ROOMS_KEY,
      {},
    );
    globalThis.localStorage?.setItem(
      LAST_PROJECT_ROOMS_KEY,
      JSON.stringify({ ...current, [projectId]: channelId }),
    );
  } catch {
    // Losing a navigation preference must never affect the conversation.
  }
}

export function readLastProjectRoom(projectId: string): string | null {
  const channelId = readJson<Record<string, string>>(
    LAST_PROJECT_ROOMS_KEY,
    {},
  )[projectId];
  return typeof channelId === "string" && channelId.length > 0
    ? channelId
    : null;
}
