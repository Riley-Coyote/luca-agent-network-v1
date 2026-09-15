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
 * Runtimes write their sentences in markdown, and a row's status line is not
 * markdown: a command in backticks would arrive on the card as backticks.
 * The line takes the words; the notice above the rows, which has room for it,
 * sets the command in the app's mono instead.
 */
export function withoutCodeTicks(message: string): string {
  return message.replace(/`([^`]+)`/g, "$1");
}

/**
 * The first clause of a runtime's reason.
 *
 * Runtimes explain themselves in full sentences — "OpenClaw has no stable
 * configured Gateway locator; this agent cannot be imported safely." — and a
 * 52px row has one line. Where the sentence offers a seam (a semicolon, or a
 * dashed aside) the line is cut there, so what the owner reads is a whole
 * thought rather than an arbitrary number of characters. Everything the
 * runtime said is still on the row, in its title.
 */
export function firstClause(reason: string): string {
  const seam = reason.search(/;| — | – |\. /);
  const head = (seam > 0 ? reason.slice(0, seam) : reason).trim();
  return head.replace(/[,;:—–-]$/, "").trim();
}

/**
 * One plain line under a discovered agent's name: what the owner would say
 * about it out loud. "Ready" when there is nothing to say, the runtime's own
 * sentence when something needs doing, and never more than one line — the
 * warnings and codes belong to the Agents page, not to a setup card.
 *
 * `full` is everything the runtime said, for the row's title; `short` is what
 * fits on the line. They are the same string whenever the sentence was short
 * enough to need no cutting.
 */
export function describeResidentCandidate(
  candidate: DiscoveredResidentCandidate,
): { full: string; short: string } {
  const readiness = candidate.readiness;
  switch (readiness.status) {
    case "ready": {
      const line = candidate.modelSummary?.trim() || "Ready";
      return { full: line, short: line };
    }
    case "discovered":
    case "degraded": {
      const message = withoutCodeTicks(readiness.message.trim());
      const fallback =
        readiness.status === "discovered" ? "Ready" : "Needs attention";
      const full = message || fallback;
      return { full, short: message ? firstClause(message) : fallback };
    }
    case "unavailable": {
      const message = withoutCodeTicks(readiness.message.trim());
      if (!message) return { full: "Unavailable", short: "Unavailable" };
      // The cut is always made inside the reason, never at the dash between
      // it and the opening word: "Unavailable" is the first clause and it
      // survives whichever way the runtime wrote the sentence.
      if (/^unavailable/i.test(message)) {
        const opener =
          /^unavailable\s*(?:[—–:-]\s*)?/i.exec(message)?.[0] ?? "";
        const reason = message.slice(opener.length);
        return {
          full: message,
          short: reason ? `${opener}${firstClause(reason)}` : message,
        };
      }
      const reason = joinable(message);
      return {
        full: `Unavailable — ${reason}`,
        short: `Unavailable — ${firstClause(reason)}`,
      };
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
