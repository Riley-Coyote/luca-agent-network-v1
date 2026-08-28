import type { RuntimeConnectionStatusV1 } from "@/shared/api/tauriMcp";
import type {
  ConnectedRuntimeSessionContext,
  IndexedRuntimeId,
} from "@/shared/api/tauriRuntimeSessions";

const RUNTIME_ORDER: Record<RuntimeConnectionStatusV1["runtimeId"], number> = {
  codex: 0,
  claude_code: 1,
  kimi: 2,
  grok: 3,
  hermes: 4,
  openclaw: 5,
};

export function runtimeConnectionKey(runtime: RuntimeConnectionStatusV1) {
  return runtime.statusId ?? `${runtime.runtimeId}:${runtime.label}`;
}

export function installedRuntimeConnections(
  runtimes: readonly RuntimeConnectionStatusV1[],
) {
  return runtimes
    .filter((runtime) => Boolean(runtime.executable?.trim()))
    .sort(
      (left, right) =>
        RUNTIME_ORDER[left.runtimeId] - RUNTIME_ORDER[right.runtimeId] ||
        left.label.localeCompare(right.label),
    );
}

export function indexedRuntimeId(
  runtimeId: RuntimeConnectionStatusV1["runtimeId"],
): IndexedRuntimeId | null {
  return runtimeId === "codex" || runtimeId === "claude_code"
    ? runtimeId
    : null;
}

export function runtimeReadinessLabel(runtime: RuntimeConnectionStatusV1) {
  if (runtime.authentication === "required") return "Sign in required";
  if (runtime.readiness === "ready") return "Installed";
  if (runtime.readiness === "degraded") return "Needs attention";
  return "Unavailable";
}

export type RuntimeSessionStartSnapshot = {
  mounted: boolean;
  requestId: number;
  runtimeKey: string;
  scopeKey: string;
};

export function isRuntimeSessionStartCurrent(
  expected: RuntimeSessionStartSnapshot,
  current: RuntimeSessionStartSnapshot,
) {
  return (
    current.mounted &&
    current.requestId === expected.requestId &&
    current.runtimeKey === expected.runtimeKey &&
    current.scopeKey === expected.scopeKey
  );
}

export function runtimeSessionActionLabel(title: string, position: number) {
  return `Start with this context: ${title} (${position})`;
}

export function buildRuntimeSessionContextEnvelope(
  context: ConnectedRuntimeSessionContext,
) {
  return [
    `Context from local ${context.runtimeLabel} session`,
    `Session: ${context.title}`,
    "",
    context.summary,
    "",
    `Boundary: This starts a new Polyphonic conversation. It does not resume or synchronize the ${context.runtimeLabel} session.`,
  ].join("\n");
}
