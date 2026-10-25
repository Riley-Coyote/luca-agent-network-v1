import type { RuntimeConnectionStatusV1 } from "@/shared/api/tauriMcp";

/**
 * In the shell, Runtimes lives on the Agents page rather than in the rail
 * (docs/luca/rail-system/SPEC.md, Decisions 1). Choosing one there opens the
 * same local-sessions panel the rail opened, which the sidebar owns: the page
 * asks for it with this event and the sidebar answers. No payload is kept
 * beyond the event itself, so nothing outlives a community switch.
 */
const OPEN_RUNTIME_SESSIONS_EVENT = "luca:open-runtime-sessions";

export function requestOpenRuntimeSessions(runtime: RuntimeConnectionStatusV1) {
  window.dispatchEvent(
    new CustomEvent<RuntimeConnectionStatusV1>(OPEN_RUNTIME_SESSIONS_EVENT, {
      detail: runtime,
    }),
  );
}

export function subscribeOpenRuntimeSessions(
  handler: (runtime: RuntimeConnectionStatusV1) => void,
) {
  function handleOpen(event: Event) {
    if (event instanceof CustomEvent && event.detail) {
      handler(event.detail as RuntimeConnectionStatusV1);
    }
  }
  window.addEventListener(OPEN_RUNTIME_SESSIONS_EVENT, handleOpen);
  return () =>
    window.removeEventListener(OPEN_RUNTIME_SESSIONS_EVENT, handleOpen);
}
