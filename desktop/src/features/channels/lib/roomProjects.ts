import * as React from "react";

/**
 * A room's project — the work it belongs to, usually a local repo.
 *
 * PROTOTYPE DATA SOURCE. There is no project field on `Channel` yet, so this
 * reads a local assignment map. Production behaviour is unchanged by design:
 * with no assignments the map is empty, every room is ungrouped, and the rail
 * renders exactly the flat list it does today. Only the mock seeds a demo
 * assignment, so the grouping can be seen and judged before the field exists.
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
};

const PROJECTS_KEY = "luca.projects.v1";
const ASSIGNMENTS_KEY = "luca.roomProjects.v1";

/** Demo assignment, mock only — never seeded into a real profile. */
const DEMO_PROJECTS: RoomProject[] = [
  { id: "luca", label: "Luca" },
  { id: "polyphonic", label: "Polyphonic" },
];
const DEMO_ASSIGNMENT: Record<string, string> = {
  general: "luca",
  engineering: "luca",
  "deep-history": "luca",
  agents: "polyphonic",
  random: "polyphonic",
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function isMockRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as { __BUZZ_E2E__?: unknown }).__BUZZ_E2E__)
  );
}

/**
 * Resolve each room's project. Keyed by channel id, with the demo map falling
 * back to channel NAME so it survives the mock's regenerated ids.
 */
export function useRoomProjects(
  channels: readonly { id: string; name: string }[],
): ReadonlyMap<string, RoomProject> {
  return React.useMemo(() => {
    const projects = new Map(
      [
        ...readJson<RoomProject[]>(PROJECTS_KEY, []),
        ...(isMockRuntime() ? DEMO_PROJECTS : []),
      ].map((project) => [project.id, project]),
    );
    const assignments = readJson<Record<string, string>>(ASSIGNMENTS_KEY, {});

    const resolved = new Map<string, RoomProject>();
    for (const channel of channels) {
      const projectId =
        assignments[channel.id] ??
        (isMockRuntime() ? DEMO_ASSIGNMENT[channel.name] : undefined);
      const project = projectId ? projects.get(projectId) : undefined;
      if (project) resolved.set(channel.id, project);
    }
    return resolved;
  }, [channels]);
}
