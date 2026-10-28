import * as React from "react";

/**
 * Where a project's rooms are listed in the shell (docs/luca/rail-system/
 * SPEC.md, "Projects"): nested under the project in the rail (the default), or
 * in the project room column beside the conversation, as before the shell.
 * Settings → Appearance → "Project rooms". Read only under `shell-frame`.
 */
export type ProjectRoomsPlacement = "rail" | "column";

export const PROJECT_ROOMS_PLACEMENT_KEY = "luca.project-rooms-placement.v1";
const CHANGED_EVENT = "luca:project-rooms-placement-changed";

export function parseProjectRoomsPlacement(
  value: string | null | undefined,
): ProjectRoomsPlacement {
  return value === "column" ? "column" : "rail";
}

export function readProjectRoomsPlacement(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): ProjectRoomsPlacement {
  try {
    return parseProjectRoomsPlacement(
      storage?.getItem(PROJECT_ROOMS_PLACEMENT_KEY),
    );
  } catch {
    return "rail";
  }
}

export function setProjectRoomsPlacement(placement: ProjectRoomsPlacement) {
  try {
    globalThis.localStorage?.setItem(PROJECT_ROOMS_PLACEMENT_KEY, placement);
  } catch {
    // A preference that can't be stored still applies for this session.
  }
  globalThis.dispatchEvent?.(new Event(CHANGED_EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PROJECT_ROOMS_PLACEMENT_KEY) onChange();
  };
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useProjectRoomsPlacement(): ProjectRoomsPlacement {
  return React.useSyncExternalStore(
    subscribe,
    () => readProjectRoomsPlacement(),
    () => "rail",
  );
}
