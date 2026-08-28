import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import type { RuntimeConnectionStatusV1 } from "@/shared/api/tauriMcp";

export const RUNTIME_RAIL_PINS_VERSION = 1 as const;

export type RuntimeRailFamilyId = "claude" | "codex" | "kimi" | "grok";

export type RuntimeRailPinsV1 = {
  version: typeof RUNTIME_RAIL_PINS_VERSION;
  pinnedFamilies: RuntimeRailFamilyId[];
};

export const SUPPORTED_RUNTIME_RAIL_FAMILIES: readonly RuntimeRailFamilyId[] = [
  "claude",
  "codex",
  "kimi",
  "grok",
];

export const DEFAULT_RUNTIME_RAIL_PINS: RuntimeRailPinsV1 = {
  version: RUNTIME_RAIL_PINS_VERSION,
  pinnedFamilies: [...SUPPORTED_RUNTIME_RAIL_FAMILIES],
};

const STORAGE_PREFIX = "luca.runtime-rail-pins.v1";
const OWNER_PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
const SUPPORTED_FAMILIES = new Set<string>(SUPPORTED_RUNTIME_RAIL_FAMILIES);
const FAMILY_ORDER = new Map(
  SUPPORTED_RUNTIME_RAIL_FAMILIES.map((family, index) => [family, index]),
);

export type RuntimeRailPreferenceScope = {
  ownerPubkey?: string | null;
  workspaceId?: string | null;
};

export function runtimeRailPinsStorageKey({
  ownerPubkey,
  workspaceId,
}: RuntimeRailPreferenceScope): string | null {
  const owner = ownerPubkey?.trim().toLowerCase() ?? "";
  const workspace = workspaceId?.trim() ?? "";
  if (!OWNER_PUBKEY_PATTERN.test(owner) || workspace.length === 0) return null;
  return `${STORAGE_PREFIX}:${owner}:${encodeURIComponent(workspace)}`;
}

function defaultPins(): RuntimeRailPinsV1 {
  return {
    version: RUNTIME_RAIL_PINS_VERSION,
    pinnedFamilies: [...DEFAULT_RUNTIME_RAIL_PINS.pinnedFamilies],
  };
}

export function parseRuntimeRailPins(
  rawValue: string | null | undefined,
): RuntimeRailPinsV1 {
  if (!rawValue) return defaultPins();
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { version?: unknown }).version !== RUNTIME_RAIL_PINS_VERSION ||
      !Array.isArray((parsed as { pinnedFamilies?: unknown }).pinnedFamilies)
    ) {
      return defaultPins();
    }

    const pinnedFamilies = [
      ...new Set(
        (parsed as { pinnedFamilies: unknown[] }).pinnedFamilies.filter(
          (family): family is RuntimeRailFamilyId =>
            typeof family === "string" && SUPPORTED_FAMILIES.has(family),
        ),
      ),
    ].sort(
      (left, right) =>
        (FAMILY_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (FAMILY_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER),
    );

    return { version: RUNTIME_RAIL_PINS_VERSION, pinnedFamilies };
  } catch {
    return defaultPins();
  }
}

export function runtimeRailFamilyFromRuntimeId(
  runtimeId: string | null | undefined,
): RuntimeRailFamilyId | null {
  const normalized = runtimeId?.trim().toLowerCase() ?? "";
  if (normalized === "claude" || normalized === "claude_code") {
    return "claude";
  }
  if (
    normalized === "codex" ||
    normalized === "kimi" ||
    normalized === "grok"
  ) {
    return normalized;
  }
  return null;
}

function authenticationFromCatalog(
  runtime: AcpRuntimeCatalogEntry,
): RuntimeConnectionStatusV1["authentication"] {
  switch (runtime.authStatus.status) {
    case "logged_in":
      return "ready";
    case "logged_out":
    case "config_invalid":
      return "required";
    case "not_applicable":
      return "not_applicable";
    case "unknown":
      return "unknown";
  }
}

function readinessFromCatalog(
  runtime: AcpRuntimeCatalogEntry,
): RuntimeConnectionStatusV1["readiness"] {
  if (runtime.availability === "available") return "ready";
  if (
    runtime.availability === "adapter_missing" ||
    runtime.availability === "adapter_outdated"
  ) {
    return "degraded";
  }
  return "unavailable";
}

function connectionFromCatalog(
  runtime: AcpRuntimeCatalogEntry,
): RuntimeConnectionStatusV1 | null {
  const family = runtimeRailFamilyFromRuntimeId(runtime.id);
  const executable = runtime.binaryPath ?? runtime.underlyingCliPath;
  if (!family || !executable?.trim()) return null;

  return {
    statusId: `catalog:${family}`,
    runtimeId: family === "claude" ? "claude_code" : family,
    label: runtime.label,
    executable,
    version: null,
    readiness: readinessFromCatalog(runtime),
    authentication: authenticationFromCatalog(runtime),
    lastVerifiedAt: null,
    reason:
      runtime.availability === "available" ? null : runtime.installHint || null,
    readinessBasis: "discovery_only",
  };
}

/**
 * Collapse native status rows and ACP catalog entries to one row per supported
 * harness family. Native Hermes/OpenClaw identities intentionally never enter
 * this projection; they remain residents in the Agent Library.
 */
export function buildRuntimeRailConnections(
  statuses: readonly RuntimeConnectionStatusV1[],
  catalog: readonly AcpRuntimeCatalogEntry[],
): RuntimeConnectionStatusV1[] {
  const byFamily = new Map<RuntimeRailFamilyId, RuntimeConnectionStatusV1>();

  for (const status of statuses) {
    const family = runtimeRailFamilyFromRuntimeId(status.runtimeId);
    if (!family || !status.executable?.trim()) continue;
    byFamily.set(family, status);
  }

  for (const runtime of catalog) {
    const connection = connectionFromCatalog(runtime);
    const family = runtimeRailFamilyFromRuntimeId(runtime.id);
    if (!connection || !family || byFamily.has(family)) continue;
    byFamily.set(family, connection);
  }

  return [...byFamily.entries()]
    .sort(
      ([left], [right]) =>
        (FAMILY_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (FAMILY_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([, connection]) => connection);
}

export function filterPinnedRuntimeRailConnections(
  connections: readonly RuntimeConnectionStatusV1[],
  pins: RuntimeRailPinsV1,
): RuntimeConnectionStatusV1[] {
  const pinned = new Set(pins.pinnedFamilies);
  return connections.filter((connection) => {
    const family = runtimeRailFamilyFromRuntimeId(connection.runtimeId);
    return family !== null && pinned.has(family);
  });
}

export function updateRuntimeRailFamilyPin(
  pins: RuntimeRailPinsV1,
  family: RuntimeRailFamilyId,
  enabled: boolean,
): RuntimeRailPinsV1 {
  const next = new Set(pins.pinnedFamilies);
  if (enabled) next.add(family);
  else next.delete(family);
  return parseRuntimeRailPins(
    JSON.stringify({
      version: RUNTIME_RAIL_PINS_VERSION,
      pinnedFamilies: [...next],
    }),
  );
}
