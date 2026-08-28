import type {
  LucaMcpRegistryV1,
  RuntimeConnectionStatusV1,
  RuntimeOwnedMcpCatalogV1,
} from "@/shared/api/tauriMcp";

type McpSettingsLoaders = {
  registry: () => Promise<LucaMcpRegistryV1>;
  runtimes: () => Promise<RuntimeConnectionStatusV1[]>;
  runtimeMcps: () => Promise<RuntimeOwnedMcpCatalogV1[]>;
};

export type McpSettingsLoadResult = {
  registry: LucaMcpRegistryV1 | null;
  runtimes: RuntimeConnectionStatusV1[] | null;
  runtimeMcps: RuntimeOwnedMcpCatalogV1[] | null;
  errors: string[];
};

export async function loadMcpSettingsSections(
  loaders: McpSettingsLoaders,
): Promise<McpSettingsLoadResult> {
  const [registry, runtimes, runtimeMcps] = await Promise.allSettled([
    Promise.resolve().then(loaders.registry),
    Promise.resolve().then(loaders.runtimes),
    Promise.resolve().then(loaders.runtimeMcps),
  ]);
  const errors: string[] = [];
  if (registry.status === "rejected") {
    errors.push("Polyphonic MCP connections could not be loaded.");
  }
  if (runtimes.status === "rejected") {
    errors.push("Runtime readiness could not be loaded.");
  }
  if (runtimeMcps.status === "rejected") {
    errors.push("Runtime-owned MCP definitions could not be loaded.");
  }

  return {
    registry: registry.status === "fulfilled" ? registry.value : null,
    runtimes: runtimes.status === "fulfilled" ? runtimes.value : null,
    runtimeMcps: runtimeMcps.status === "fulfilled" ? runtimeMcps.value : null,
    errors,
  };
}

export function runtimeMcpCatalogStatusLabel(
  catalog: RuntimeOwnedMcpCatalogV1,
): string {
  switch (catalog.status) {
    case "configured":
      return `${catalog.servers.length} configured`;
    case "none_configured":
      return "None configured";
    case "unavailable":
      return "Unavailable";
    case "unsupported":
      return "Unsupported";
  }
}

export function runtimeMcpServerStatusLabel(
  status: RuntimeOwnedMcpCatalogV1["servers"][number]["status"],
): string {
  return status === "configured" ? "Configured" : "Disabled";
}
