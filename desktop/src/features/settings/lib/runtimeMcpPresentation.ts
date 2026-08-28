import type { RuntimeOwnedMcpCatalogV1 } from "@/shared/api/tauriMcp";

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
