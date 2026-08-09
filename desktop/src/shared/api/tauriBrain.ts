import { invoke } from "@tauri-apps/api/core";

export type OwnerBrainAvailability =
  | "ready"
  | "empty"
  | "locked"
  | "unavailable";

export type OwnerBrainSourceKind =
  | "markdown_file"
  | "text_file"
  | "text_folder";

export type OwnerBrainPreviewRowStatus =
  | "accepted"
  | "skipped"
  | "unsupported"
  | "oversized"
  | "binary"
  | "credential_like"
  | "duplicate"
  | "changed"
  | "unsafe_path";

export type OwnerBrainPreviewRow = {
  relativePath: string;
  status: OwnerBrainPreviewRowStatus;
  byteCount: number;
  reasonCode: string | null;
};

export type OwnerBrainPreview = {
  previewId: string;
  previewToken: string;
  sourceKind: OwnerBrainSourceKind;
  displayName: string;
  acceptedBytes: number;
  writeCount: 0;
  expiresAt: string;
  canCommit: boolean;
  rows: OwnerBrainPreviewRow[];
};

export type OwnerBrainImportState =
  | "pending"
  | "running"
  | "committed"
  | "cancelled"
  | "failed";

export type OwnerBrainImport = {
  importTransactionId: string;
  state: OwnerBrainImportState;
  completedItems: number;
  totalItems: number;
  errorCode: string | null;
  canCancel: boolean;
  canRetry: boolean;
};

export type OwnerBrainSource = {
  sourceId: string;
  sourceKind: OwnerBrainSourceKind;
  displayName: string;
  status: "ready" | "unavailable" | "removed";
  fileCount: number;
  chunkCount: number;
  changedFileCount: number;
  indexedAt: string;
};

export type OwnerBrainGrant = {
  grantId: string;
  sourceId: string;
  residentPubkey: string;
  residentName: string;
  state: "active" | "revoked" | "stale";
  providerEgress: "local" | "remote" | "unknown";
  canReconfirm: boolean;
};

export type OwnerBrainReceipt = {
  receiptId: string;
  sourceId: string;
  residentPubkey: string;
  status:
    | "ready"
    | "empty"
    | "denied"
    | "stale"
    | "locked"
    | "unavailable"
    | "timeout"
    | "invalid";
  selectedChunkCount: number;
  truncated: boolean;
  createdAt: string;
};

export type OwnerBrainFixtureState = {
  availability: OwnerBrainAvailability;
  sources: OwnerBrainSource[];
  grants: OwnerBrainGrant[];
  receipts: OwnerBrainReceipt[];
};

export type OwnerBrainFixtures = {
  preview: OwnerBrainPreview;
  imports: OwnerBrainImport[];
  ready: OwnerBrainFixtureState;
  empty: OwnerBrainFixtureState;
  locked: OwnerBrainFixtureState;
  unavailable: OwnerBrainFixtureState;
};

export type PreviewOwnerBrainSourceInput = {
  selectedPath: string;
};

export type PickOwnerBrainSourceInput = {
  selectionKind: "file" | "folder";
};

export type CommitOwnerBrainImportInput = {
  previewId: string;
  previewToken: string;
};

export type OwnerBrainGrantInput = {
  sourceId: string;
  residentPubkey: string;
};

export type OwnerBrainGrantMutation = {
  grant: OwnerBrainGrant;
  replayed: boolean;
};

export type OwnerBrainImportCommit = {
  importTransactionId: string;
  previewId: string;
  sourceId: string;
  rootSnapshotHash: string;
  state: "committed";
  importedFileCount: number;
  importedChunkCount: number;
  completedAt: string;
  replayed: boolean;
};

export type ConnectedBrainSourceKind =
  | "repository"
  | "codex_history"
  | "claude_history";

export type ConnectedBrainDiscovery = {
  discoveryId: string;
  sourceKind: ConnectedBrainSourceKind;
  displayName: string;
  itemCount: number;
  earliestAt: string | null;
  latestAt: string | null;
};

export type ConnectedBrainSource = {
  sourceId: string;
  sourceKind: ConnectedBrainSourceKind;
  displayName: string;
  status:
    | "connecting"
    | "current"
    | "needs_attention"
    | "unavailable"
    | "disconnected";
  itemCount: number;
  entryCount: number;
  lastRefreshedAt: string | null;
};

export type ConnectedBrainGrant = {
  grantId: string;
  sourceId: string;
  residentPubkey: string;
  state: "active" | "revoked" | "stale";
  canReconfirm: boolean;
};

export type RepositoryWorkGrant = Omit<ConnectedBrainGrant, "canReconfirm">;

export type RepositoryToolReceipt = {
  receiptId: string;
  sourceId: string;
  residentPubkey: string;
  operation: string;
  status: "completed" | "denied" | "failed" | "cancelled" | "stale";
  changedPathCount: number;
  createdAt: string;
};

export type ConnectedBrainInventory = {
  consentCopy: string;
  discoveries: ConnectedBrainDiscovery[];
  sources: ConnectedBrainSource[];
  recallGrants: ConnectedBrainGrant[];
  repositoryGrants: RepositoryWorkGrant[];
  repositoryReceipts: RepositoryToolReceipt[];
};

export type ConnectConnectedBrainSourceInput = {
  discoveryIds: string[];
  consentAccepted: boolean;
};

export type ConnectedBrainSourceInput = {
  sourceId: string;
};

export type ConnectedBrainResidentInput = ConnectedBrainSourceInput & {
  residentPubkey: string;
};

export function previewOwnerBrainSource(
  input: PreviewOwnerBrainSourceInput,
): Promise<OwnerBrainPreview> {
  return invoke("preview_owner_brain_source", { input });
}

export function pickAndPreviewOwnerBrainSource(
  input: PickOwnerBrainSourceInput,
): Promise<OwnerBrainPreview | null> {
  return invoke("pick_and_preview_owner_brain_source", { input });
}

export function commitOwnerBrainImport(
  input: CommitOwnerBrainImportInput,
): Promise<OwnerBrainImportCommit> {
  return invoke("commit_owner_brain_import", { input });
}

export function cancelOwnerBrainImport(
  input: CommitOwnerBrainImportInput,
): Promise<boolean> {
  return invoke("cancel_owner_brain_import", { input });
}

export function getOwnerBrainState(): Promise<OwnerBrainFixtureState> {
  return invoke("get_owner_brain_state");
}

export function grantOwnerBrainSource(
  input: OwnerBrainGrantInput,
): Promise<OwnerBrainGrantMutation> {
  return invoke("grant_owner_brain_source", { input });
}

export function revokeOwnerBrainSource(
  input: OwnerBrainGrantInput,
): Promise<OwnerBrainGrantMutation> {
  return invoke("revoke_owner_brain_source", { input });
}

export function reconfirmOwnerBrainSource(
  input: OwnerBrainGrantInput,
): Promise<OwnerBrainGrantMutation> {
  return invoke("reconfirm_owner_brain_source", { input });
}

export function getOwnerBrainFixtures(): Promise<OwnerBrainFixtures> {
  return invoke("get_owner_brain_fixtures");
}

export function discoverConnectedBrainSources(): Promise<ConnectedBrainInventory> {
  return invoke("discover_connected_brain_sources");
}

export function listConnectedBrainSources(): Promise<ConnectedBrainInventory> {
  return invoke("list_connected_brain_sources");
}

export function addConnectedBrainRoot(): Promise<ConnectedBrainInventory | null> {
  return invoke("add_connected_brain_root");
}

export function connectConnectedBrainSource(
  input: ConnectConnectedBrainSourceInput,
): Promise<{ sources: ConnectedBrainSource[]; replayed: boolean }> {
  return invoke("connect_connected_brain_source", { input });
}

export function refreshConnectedBrainSource(
  input: ConnectedBrainSourceInput,
): Promise<{ sources: ConnectedBrainSource[]; replayed: boolean }> {
  return invoke("refresh_connected_brain_source", { input });
}

export function disconnectConnectedBrainSource(
  input: ConnectedBrainSourceInput,
): Promise<ConnectedBrainInventory> {
  return invoke("disconnect_connected_brain_source", { input });
}

export function reconfirmConnectedBrainSource(
  input: ConnectedBrainResidentInput,
): Promise<ConnectedBrainInventory> {
  return invoke("reconfirm_connected_brain_source", { input });
}

export function revokeConnectedBrainResident(
  input: ConnectedBrainResidentInput,
): Promise<ConnectedBrainInventory> {
  return invoke("revoke_connected_brain_resident", { input });
}
