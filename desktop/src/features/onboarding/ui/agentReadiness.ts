import { requiredCredentialEnvKeys } from "@/features/agents/ui/agentConfigOptions";
import type {
  AcpRuntimeCatalogEntry,
  DiscoveredResidentCandidate,
  GlobalAgentConfig,
  NativeRuntimeDiscoveryOutcome,
} from "@/shared/api/types";

const NATIVE_SOURCE_LABELS = {
  hermes: "Hermes",
  openclaw: "OpenClaw",
} as const satisfies Record<DiscoveredResidentCandidate["nativeType"], string>;

export type NativeSourceLabel =
  (typeof NATIVE_SOURCE_LABELS)[keyof typeof NATIVE_SOURCE_LABELS];

export function nativeSourceLabel(
  nativeType: DiscoveredResidentCandidate["nativeType"],
): NativeSourceLabel {
  return NATIVE_SOURCE_LABELS[nativeType];
}

/**
 * Lower a leading word that is only capitalised because it started a sentence,
 * so it can be joined onto "Unavailable — " without reading as two sentences.
 * A word with any other capital in it ("OpenClaw", "Hermes") is a name and is
 * left exactly as the runtime wrote it.
 */
function joinable(message: string): string {
  const [first = ""] = message.split(/\s/, 1);
  const sentenceCased = /^[A-Z][a-z']*$/.test(first);
  return sentenceCased
    ? `${message.charAt(0).toLocaleLowerCase()}${message.slice(1)}`
    : message;
}

/**
 * One plain line under a discovered agent's name: what the owner would say
 * about it out loud. "Ready" when there is nothing to say, the runtime's own
 * sentence when something needs doing, and never more than one line — the
 * warnings and codes belong to the Agents page, not to a setup card.
 */
export function describeResidentCandidate(
  candidate: DiscoveredResidentCandidate,
): string {
  const readiness = candidate.readiness;
  switch (readiness.status) {
    case "ready":
      return candidate.modelSummary?.trim() || "Ready";
    case "discovered":
      return readiness.message.trim() || "Ready";
    case "degraded":
      // The source's own explanation is printed once above the rows; the row
      // says what is true of this agent.
      return readiness.message.trim() || "Needs attention";
    case "unavailable": {
      const message = readiness.message.trim();
      if (!message) return "Unavailable";
      return /^unavailable/i.test(message)
        ? message
        : `Unavailable — ${joinable(message)}`;
    }
  }
}

/**
 * What a source itself has to say, when it is not simply available: OpenClaw
 * reading its agents out of `openclaw.json` because its own config needs
 * repair, for instance. Shown once, above that source's rows.
 */
export function describeDiscoverySources(
  outcomes: readonly NativeRuntimeDiscoveryOutcome[],
): Array<{
  nativeType: DiscoveredResidentCandidate["nativeType"];
  message: string;
}> {
  // "absent" is not news — the list itself already says nobody is there.
  return outcomes.flatMap((outcome) =>
    (outcome.status === "degraded" || outcome.status === "failed") &&
    outcome.message?.trim()
      ? [{ nativeType: outcome.nativeType, message: outcome.message.trim() }]
      : [],
  );
}

export type AgentReadinessResult =
  | { ready: true; reason: "cli"; runtimeLabel: string }
  | { ready: true; reason: "buzz-agent" }
  | { ready: false };

/**
 * Determine whether the user has a working agent path configured.
 *
 * CLI path: the preferred Claude or Codex runtime is available and logged in.
 * Provider path: the preferred Buzz Agent or Goose runtime has provider and
 * model set, plus all required credential env vars for that provider.
 *
 * Returns enough info for the UI to say which path matched, or that neither did.
 */
export function resolveAgentReadiness(
  runtimes: readonly AcpRuntimeCatalogEntry[],
  globalConfig: GlobalAgentConfig,
  scope: "any" | "preferred" = "any",
): AgentReadinessResult {
  if (scope === "any") {
    for (const runtime of runtimes) {
      if (runtime.id === "buzz-agent") continue;
      if (
        runtime.availability === "available" &&
        (runtime.authStatus.status === "logged_in" ||
          runtime.authStatus.status === "not_applicable")
      ) {
        return { ready: true, reason: "cli", runtimeLabel: runtime.label };
      }
    }
  }

  const preferredRuntime =
    scope === "preferred"
      ? runtimes.find(
          (runtime) => runtime.id === globalConfig.preferred_runtime,
        )
      : runtimes.find((runtime) => runtime.id === "buzz-agent");
  if (preferredRuntime?.availability !== "available") {
    return { ready: false };
  }

  if (
    (preferredRuntime.id === "claude" || preferredRuntime.id === "codex") &&
    (preferredRuntime.authStatus.status === "logged_in" ||
      preferredRuntime.authStatus.status === "not_applicable")
  ) {
    return {
      ready: true,
      reason: "cli",
      runtimeLabel: preferredRuntime.label,
    };
  }

  if (preferredRuntime.id !== "buzz-agent" && preferredRuntime.id !== "goose") {
    return { ready: false };
  }

  const provider = globalConfig.provider?.trim() ?? "";
  const model = globalConfig.model?.trim() ?? "";
  if (provider.length > 0 && model.length > 0) {
    const required = requiredCredentialEnvKeys(preferredRuntime.id, provider);
    const allKeysPresent = required.every(
      (key) => (globalConfig.env_vars[key] ?? "").trim().length > 0,
    );
    if (allKeysPresent) {
      return { ready: true, reason: "buzz-agent" };
    }
  }

  return { ready: false };
}
