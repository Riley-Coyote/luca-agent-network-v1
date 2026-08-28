import { invoke } from "@tauri-apps/api/core";

export type ConfigAuthorityV1 =
  | "luca_managed"
  | "native_managed"
  | "inherited"
  | "session_only"
  | "harness_locked"
  | "unsupported";

export type RuntimeConnectionStatusV1 = {
  statusId?: string;
  runtimeId: "claude_code" | "codex" | "hermes" | "openclaw";
  label: string;
  executable: string | null;
  version: string | null;
  readiness: "ready" | "degraded" | "unavailable";
  authentication: "ready" | "required" | "unknown" | "not_applicable";
  lastVerifiedAt: string | null;
  reason: string | null;
  nativeSemanticId?: string;
  nativeDisplayName?: string;
  readinessBasis?:
    | "bounded_probe"
    | "discovery_only"
    | "native_reported"
    | "binding_validation";
};

export type RuntimeOwnedMcpCatalogV1 = {
  runtimeId: "claude_code" | "codex" | "goose" | "hermes" | "openclaw";
  label: string;
  source: string | null;
  status: "configured" | "none_configured" | "unavailable" | "unsupported";
  servers: Array<{
    name: string;
    status: "configured" | "disabled";
  }>;
  reason: string | null;
};

export type McpEnvironmentBindingV1 = {
  name: string;
  kind: "plain" | "secret";
  value?: string;
  secretRef?: string;
};

export type LucaMcpConnectionV1 = {
  schemaVersion: 1;
  connectionId: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  enabled: boolean;
  environment: McpEnvironmentBindingV1[];
  createdAt: string;
  updatedAt: string;
};

export type AgentMcpGrantV1 = {
  schemaVersion: 1;
  connectionId: string;
  residentPubkey: string;
  grantedAt: string;
};

export type McpConnectionHealthV1 = {
  connectionId: string;
  readiness: "ready" | "disabled" | "locked" | "failed" | "untested";
  toolCount: number | null;
  lastTestedAt: string | null;
  errorCode: string | null;
  diagnostic: string | null;
};

export type SaveLucaMcpConnectionInputV1 = {
  connectionId?: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  environment: Array<{
    name: string;
    kind: "plain" | "secret";
    value?: string;
  }>;
};

export type LucaMcpRegistryV1 = {
  connections: LucaMcpConnectionV1[];
  grants: AgentMcpGrantV1[];
  health: McpConnectionHealthV1[];
};

export function listLucaMcpRegistry(): Promise<LucaMcpRegistryV1> {
  return invoke("list_luca_mcp_registry");
}

export function saveLucaMcpConnection(
  input: SaveLucaMcpConnectionInputV1,
): Promise<LucaMcpRegistryV1> {
  return invoke("save_luca_mcp_connection", { input });
}

export function testLucaMcpConnection(
  connectionId: string,
): Promise<McpConnectionHealthV1> {
  return invoke("test_luca_mcp_connection", { connectionId });
}

export function deleteLucaMcpConnection(
  connectionId: string,
): Promise<LucaMcpRegistryV1> {
  return invoke("delete_luca_mcp_connection", { connectionId });
}

export function setAgentMcpGrant(
  connectionId: string,
  residentPubkey: string,
  granted: boolean,
): Promise<LucaMcpRegistryV1> {
  return invoke("set_agent_mcp_grant", {
    connectionId,
    residentPubkey,
    granted,
  });
}

export function listRuntimeConnectionStatus(): Promise<
  RuntimeConnectionStatusV1[]
> {
  return invoke("list_runtime_connection_status");
}

export function listRuntimeOwnedMcpCatalog(): Promise<
  RuntimeOwnedMcpCatalogV1[]
> {
  return invoke("list_runtime_owned_mcp_catalog");
}
