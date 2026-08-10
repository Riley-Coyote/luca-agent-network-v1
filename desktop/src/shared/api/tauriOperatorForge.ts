import { invoke } from "@tauri-apps/api/core";

export type NativeRuntimeFamilyV1 = "hermes" | "openclaw";

export type AgentRuntimeTargetV1 =
  | { kind: "managed"; runtimeId: "codex" | "claude" }
  | { kind: "native"; runtime: NativeRuntimeFamilyV1 };

export type AgentProvisioningModeV1 = "fresh" | "template" | "advanced";

export type NativeProvisioningStatusV1 =
  | "planned"
  | "provisioning"
  | "native_created"
  | "resident_linked"
  | "complete"
  | "needs_attention"
  | "rolled_back";

export type NativeProvisioningTransactionV1 = {
  schemaVersion: 1;
  transactionId: string;
  ownerPubkey: string;
  runtime: NativeRuntimeFamilyV1;
  mode: AgentProvisioningModeV1;
  intendedSlug: string;
  requestHash: string;
  sourceHash: string | null;
  reservedResidentPubkey: string | null;
  nativeSemanticHash: string | null;
  status: NativeProvisioningStatusV1;
  errorCode: string | null;
  recoveryAction: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OperatorPreferencesV1 = {
  schemaVersion: 1;
  ownerPubkey: string;
  defaultRuntimeTarget: AgentRuntimeTargetV1 | null;
  runtimeConfirmed: boolean;
  lucaEnabled: boolean;
  updatedAt: string;
};

export type RuntimeTargetOptionV1 = {
  target: AgentRuntimeTargetV1;
  label: string;
  readiness: "ready" | "setup_required" | "unavailable";
  reason: string | null;
  recommended: boolean;
};

export type OperatorForgeSettingsV1 = {
  preferences: OperatorPreferencesV1;
  runtimeOptions: RuntimeTargetOptionV1[];
  recommendation: AgentRuntimeTargetV1 | null;
};

export type SaveOperatorPreferencesInputV1 = Pick<
  OperatorPreferencesV1,
  "defaultRuntimeTarget" | "runtimeConfirmed" | "lucaEnabled"
>;

export function getOperatorForgeSettings(): Promise<OperatorForgeSettingsV1> {
  return invoke("get_operator_forge_settings");
}

export function saveOperatorForgePreferences(
  input: SaveOperatorPreferencesInputV1,
): Promise<OperatorForgeSettingsV1> {
  return invoke("save_operator_forge_preferences", { input });
}
