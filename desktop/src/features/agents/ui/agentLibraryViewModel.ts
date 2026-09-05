import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import type { ConfigAuthorityV1 } from "@/shared/api/tauriMcp";

export type ResidentKind =
  | "managed_native"
  | "managed_luca"
  | "persona_only"
  | "external_agent";

export type ResidentAvailability =
  | "ready"
  | "started"
  | "working"
  | "idle"
  | "degraded"
  | "offline"
  | "failed";

export type ResidentNativeSource =
  | "hermes"
  | "openclaw"
  | "codex"
  | "claude_code"
  | "other";

export type ResidentSummaryViewModel = {
  residentId: string;
  pubkey: string | null;
  personaId: string | null;
  displayName: string;
  kind: ResidentKind;
  availability: ResidentAvailability;
  nativeSource: ResidentNativeSource | null;
  runtimeLabel: string | null;
  modelLabel: string | null;
  needsAttention: boolean;
  /** Starts when the app opens (Luca by default); everyone else wakes on send. */
  wakesWithApp: boolean;
  lastActiveAt: string | null;
};

export type AgentConfigurationViewModelV1 = {
  schemaVersion: 1;
  resident: ResidentSummaryViewModel;
  origin: "polyphonic" | "hermes" | "openclaw" | "external";
  authorities: {
    identity: ConfigAuthorityV1;
    nativeBinding: ConfigAuthorityV1;
    runtime: ConfigAuthorityV1;
    model: ConfigAuthorityV1;
    workspace: ConfigAuthorityV1;
    continuity: ConfigAuthorityV1;
    permissions: ConfigAuthorityV1;
    mcpGrants: ConfigAuthorityV1;
  };
};

const LUCA_BUILTIN_AGENT_NAMES: Readonly<Record<string, string>> = {
  "builtin:fizz": "Luca",
  "builtin:honey": "Vektor",
  "builtin:bumble": "Anima",
};

export function agentConfigurationViewModel(
  resident: ResidentSummaryViewModel,
): AgentConfigurationViewModelV1 {
  const isNative = resident.kind === "managed_native";
  const origin =
    resident.nativeSource === "hermes"
      ? "hermes"
      : resident.nativeSource === "openclaw"
        ? "openclaw"
        : resident.kind === "managed_luca" || resident.kind === "persona_only"
          ? "polyphonic"
          : "external";
  return {
    schemaVersion: 1,
    resident,
    origin,
    authorities: {
      identity: resident.pubkey ? "harness_locked" : "luca_managed",
      nativeBinding: isNative ? "native_managed" : "luca_managed",
      runtime: isNative ? "native_managed" : "luca_managed",
      model: isNative ? "native_managed" : "inherited",
      workspace: isNative ? "native_managed" : "inherited",
      continuity: "luca_managed",
      permissions: "luca_managed",
      mcpGrants: resident.pubkey ? "luca_managed" : "unsupported",
    },
  };
}

function namedRuntime(command: string | null | undefined) {
  const normalized = command?.trim().toLowerCase() ?? "";
  if (!normalized) return { label: null, source: null };
  if (normalized.includes("hermes")) {
    return { label: "Hermes", source: "hermes" as const };
  }
  if (normalized.includes("openclaw")) {
    return { label: "OpenClaw", source: "openclaw" as const };
  }
  if (normalized.includes("codex")) {
    return { label: "Codex", source: "codex" as const };
  }
  if (normalized.includes("claude")) {
    return { label: "Claude Code", source: "claude_code" as const };
  }
  if (normalized === "buzz-agent") {
    return { label: "Polyphonic runtime", source: "other" as const };
  }
  return {
    label: command?.trim() || null,
    source: "other" as const,
  };
}

function availabilityForManagedAgent(
  agent: ManagedAgent,
): ResidentAvailability {
  if (agent.lastError) return "failed";
  if (agent.needsRestart || agent.personaOutOfDate || agent.personaOrphaned) {
    return "degraded";
  }
  if (agent.status === "running" || agent.status === "deployed") {
    return agent.nativeRuntimeBinding ? "started" : "ready";
  }
  if (agent.status === "stopped") return "idle";
  return "offline";
}

export function managedAgentSummary(
  agent: ManagedAgent,
): ResidentSummaryViewModel {
  const nativeSource = agent.nativeRuntimeBinding?.kind ?? null;
  const runtime = nativeSource
    ? {
        label: nativeSource === "hermes" ? "Hermes" : "OpenClaw",
        source: nativeSource,
      }
    : namedRuntime(agent.agentCommand);
  const availability = availabilityForManagedAgent(agent);

  return {
    residentId: agent.pubkey,
    pubkey: agent.pubkey,
    personaId: agent.personaId,
    displayName: agent.name,
    kind: nativeSource ? "managed_native" : "managed_luca",
    availability,
    nativeSource: runtime.source,
    runtimeLabel: runtime.label,
    modelLabel: agent.model,
    needsAttention: availability === "degraded" || availability === "failed",
    wakesWithApp: agent.startOnAppLaunch,
    lastActiveAt:
      agent.lastStartedAt ?? agent.lastStoppedAt ?? agent.updatedAt ?? null,
  };
}

export function personaSummary(
  persona: AgentPersona,
): ResidentSummaryViewModel {
  const runtime = namedRuntime(persona.runtime);
  const displayName =
    LUCA_BUILTIN_AGENT_NAMES[persona.id] ?? persona.displayName;
  return {
    residentId: `persona:${persona.id}`,
    pubkey: null,
    personaId: persona.id,
    displayName,
    kind: "persona_only",
    availability: "offline",
    nativeSource: runtime.source,
    runtimeLabel: runtime.label,
    modelLabel: persona.model,
    needsAttention: true,
    wakesWithApp: false,
    lastActiveAt: persona.updatedAt,
  };
}

export function buildResidentLibrary(
  agents: readonly ManagedAgent[],
  personas: readonly AgentPersona[],
): ResidentSummaryViewModel[] {
  const linkedPersonaIds = new Set(
    agents.flatMap((agent) => (agent.personaId ? [agent.personaId] : [])),
  );
  const managed = agents.map(managedAgentSummary);
  const setup = personas
    .filter((persona) => !linkedPersonaIds.has(persona.id))
    .map(personaSummary);

  return [...managed, ...setup].sort((left, right) => {
    const stateRank: Record<ResidentAvailability, number> = {
      working: 0,
      ready: 1,
      started: 1,
      idle: 2,
      degraded: 3,
      failed: 4,
      offline: 5,
    };
    const stateDifference =
      stateRank[left.availability] - stateRank[right.availability];
    return stateDifference || left.displayName.localeCompare(right.displayName);
  });
}

export function residentAvailabilityLabel(availability: ResidentAvailability) {
  switch (availability) {
    case "ready":
      return "Ready";
    case "started":
      return "Started";
    case "working":
      return "Working";
    case "idle":
      return "Idle";
    case "degraded":
      return "Needs attention";
    case "offline":
      return "Offline";
    case "failed":
      return "Failed";
  }
}

/** Process presence does not attest to the exact native session's health. */
export const NATIVE_STARTED_DETAIL =
  "Started means the app process is running. Native session readiness is not reported by this status.";

export function residentSourceLabel(resident: ResidentSummaryViewModel) {
  return (
    resident.runtimeLabel ??
    (resident.kind === "persona_only" ? "Not configured" : "Local runtime")
  );
}
