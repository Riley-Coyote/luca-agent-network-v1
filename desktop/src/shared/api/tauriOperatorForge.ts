import { invoke } from "@tauri-apps/api/core";

/** App-owned installation choice; selected does not assert provider readiness. */
export type HermesRuntimeSelectionV1 = {
  mode: "automatic" | "selected";
  status: "automatic" | "selected" | "invalid";
  executablePath: string | null;
  runtimeVersion: string | null;
  message: string | null;
};

export function getHermesRuntimeSelection(): Promise<HermesRuntimeSelectionV1> {
  return invoke("get_hermes_runtime_selection");
}

/** Null means the native picker was cancelled and the selection is unchanged. */
export function chooseHermesRuntimeSelection(): Promise<HermesRuntimeSelectionV1 | null> {
  return invoke("choose_hermes_runtime_selection");
}

export function clearHermesRuntimeSelection(): Promise<HermesRuntimeSelectionV1> {
  return invoke("clear_hermes_runtime_selection");
}

export type NativeRuntimeFamilyV1 = "hermes" | "openclaw";

export type AgentRuntimeTargetV1 =
  | { kind: "managed"; runtimeId: string }
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
  personaId: string | null;
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

export type NativeProvisioningRequestV1 = {
  displayName: string;
  systemPrompt: string;
  runtime: NativeRuntimeFamilyV1;
  mode: AgentProvisioningModeV1;
  sourceSemanticId?: string;
  selectedSkills: string[];
  includeMemory: boolean;
  workspaceDocuments: string[];
};

export type NativeProvisioningPreviewV1 = {
  schemaVersion: 1;
  transactionId: string;
  displayName: string;
  runtime: NativeRuntimeFamilyV1;
  mode: AgentProvisioningModeV1;
  intendedSlug: string;
  sourceLabel: string | null;
  changes: Array<{ subject: string; action: string; detail: string }>;
  permissionDefaults: string;
  recoveryAction: string;
};

export type NativeProvisioningReceiptV1 = {
  schemaVersion: 1;
  transactionId: string;
  runtime: NativeRuntimeFamilyV1;
  residentPubkey: string | null;
  nativeSemanticHash: string | null;
  status: NativeProvisioningStatusV1;
  reused: boolean;
  needsAttention: boolean;
  recoveryAction: string | null;
  retainedWorkspace: boolean;
};

export function getOperatorForgeSettings(): Promise<OperatorForgeSettingsV1> {
  return invoke("get_operator_forge_settings");
}

export function saveOperatorForgePreferences(
  input: SaveOperatorPreferencesInputV1,
): Promise<OperatorForgeSettingsV1> {
  return invoke("save_operator_forge_preferences", { input });
}

export function listNativeProvisioningTransactions(): Promise<
  NativeProvisioningTransactionV1[]
> {
  return invoke("list_native_provisioning_transactions");
}

export function previewNativeAgentProvisioning(
  request: NativeProvisioningRequestV1,
): Promise<NativeProvisioningPreviewV1> {
  return invoke("preview_native_agent_provisioning", { request });
}

export function executeNativeAgentProvisioning(
  transactionId: string,
  personaId: string,
  request: NativeProvisioningRequestV1,
  residentProposalId?: string,
): Promise<NativeProvisioningReceiptV1> {
  return invoke("execute_native_agent_provisioning", {
    input: {
      transactionId,
      personaId,
      request,
      ...(residentProposalId ? { residentProposalId } : {}),
    },
  });
}

export function reconcileNativeAgentProvisioning(
  transactionId: string,
): Promise<NativeProvisioningReceiptV1> {
  return invoke("reconcile_native_agent_provisioning", {
    input: { transactionId },
  });
}

export function rollbackNativeAgentProvisioning(
  transactionId: string,
): Promise<NativeProvisioningReceiptV1> {
  return invoke("rollback_native_agent_provisioning", {
    input: { transactionId },
  });
}
