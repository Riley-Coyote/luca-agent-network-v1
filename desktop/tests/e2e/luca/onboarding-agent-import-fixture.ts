import type {
  DiscoveredResidentCandidate,
  NativeResidentDiscoveryOutcome,
} from "../../../src/shared/api/types";

const READY_PER_RUNTIME = 20;

function hermesCandidate(index: number): DiscoveredResidentCandidate {
  const suffix = String(index).padStart(2, "0");
  return {
    nativeType: "hermes",
    nativeId: `profile-${suffix}`,
    semanticId: `hermes:profile-${suffix}`,
    bindingFingerprint: `sha256:hermes-${suffix}`,
    displayName: `Hermes profile ${suffix}`,
    readiness: { status: "ready" },
    warnings: [],
    bindingPreview: {
      kind: "hermes",
      schemaVersion: 1,
      profileName: `profile-${suffix}`,
      hermesHome: `/fixture/hermes/${suffix}`,
      executablePath: "hermes",
      runtimeVersion: "1.0.0",
    },
  };
}

function openClawCandidate(index: number): DiscoveredResidentCandidate {
  const suffix = String(index).padStart(2, "0");
  return {
    nativeType: "openclaw",
    nativeId: `agent-${suffix}`,
    semanticId: `openclaw:agent-${suffix}`,
    bindingFingerprint: `sha256:openclaw-${suffix}`,
    displayName: `OpenClaw agent ${suffix}`,
    readiness: { status: "ready" },
    warnings: [],
    bindingPreview: {
      kind: "openclaw",
      schemaVersion: 1,
      agentId: `agent-${suffix}`,
      executablePath: "openclaw",
      runtimeVersion: "1.0.0",
      gatewayIdentity: "fixture-gateway",
      gatewayUrlRef: {
        provider: "native_store",
        locator: `fixture-url-${suffix}`,
      },
    },
  };
}

export const LARGE_NATIVE_RESIDENT_DISCOVERY: NativeResidentDiscoveryOutcome = {
  runtimes: [
    {
      nativeType: "hermes",
      status: "available",
      candidates: [
        ...Array.from({ length: READY_PER_RUNTIME }, (_, index) =>
          hermesCandidate(index + 1),
        ),
        {
          ...hermesCandidate(99),
          nativeId: "unavailable",
          semanticId: "hermes:unavailable",
          bindingFingerprint: "sha256:hermes-unavailable",
          displayName: "Hermes unavailable",
          readiness: {
            status: "unavailable",
            code: "PROFILE_LOCKED",
            message: "This Hermes profile needs attention before import.",
          },
          bindingPreview: {
            kind: "hermes",
            schemaVersion: 1,
            profileName: "unavailable",
            hermesHome: "/fixture/hermes/unavailable",
            executablePath: "hermes",
            runtimeVersion: "1.0.0",
          },
        },
      ],
    },
    {
      nativeType: "openclaw",
      status: "available",
      candidates: [
        ...Array.from({ length: READY_PER_RUNTIME }, (_, index) =>
          openClawCandidate(index + 1),
        ),
        {
          ...openClawCandidate(99),
          nativeId: "unavailable",
          semanticId: "openclaw:unavailable",
          bindingFingerprint: "sha256:openclaw-unavailable",
          displayName: "OpenClaw unavailable",
          readiness: {
            status: "unavailable",
            code: "GATEWAY_UNAVAILABLE",
            message: "Start the OpenClaw gateway before importing this agent.",
          },
          bindingPreview: {
            kind: "openclaw",
            schemaVersion: 1,
            agentId: "unavailable",
            executablePath: "openclaw",
            runtimeVersion: "1.0.0",
            gatewayIdentity: "fixture-gateway",
            gatewayUrlRef: {
              provider: "native_store",
              locator: "fixture-url-unavailable",
            },
          },
        },
      ],
    },
  ],
};

export const LARGE_DISCOVERY_READY_COUNT = READY_PER_RUNTIME * 2;

/**
 * What this Mac actually looks like: a couple of Hermes profiles that are
 * ready, and an OpenClaw that reads its agents out of `openclaw.json` because
 * its own config needs repair — so it reports every one of them unavailable.
 * The owner can still tick them; the import is no longer in their way.
 */
export const THREE_NATIVE_AGENTS: NativeResidentDiscoveryOutcome = {
  runtimes: [
    {
      nativeType: "hermes",
      status: "available",
      candidates: [
        { ...hermesCandidate(1), modelSummary: "Sonnet 4.5" },
        hermesCandidate(2),
      ],
    },
    {
      nativeType: "openclaw",
      status: "degraded",
      message:
        "OpenClaw's own config needs repair — run `openclaw doctor --fix`. Agents were read from openclaw.json instead.",
      candidates: [
        {
          ...openClawCandidate(1),
          readiness: {
            status: "unavailable",
            code: "GATEWAY_IDENTITY",
            message: "Run `openclaw doctor --fix`.",
          },
        },
      ],
    },
  ],
};

/**
 * Twenty of them, plus one each that a runtime will not vouch for. Every one
 * is a row: the old "past eight, show an inventory instead" rule is gone.
 */
export const LARGE_DISCOVERY_ROW_COUNT =
  LARGE_NATIVE_RESIDENT_DISCOVERY.runtimes.reduce(
    (total, runtime) => total + runtime.candidates.length,
    0,
  );
