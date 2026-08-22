import { invoke } from "@tauri-apps/api/core";

export type ConversationContextStatus =
  | "empty"
  | "ready"
  | "missing_primary"
  | "degraded";

export type ConversationContextSource = {
  sourceId: string;
  label: string;
  role: "working_folder" | "additional_source";
  origin: "project" | "room";
  sourceKind: "repository" | "codex_history" | "claude_history";
  availability: "available" | "missing" | "needs_attention";
  nativeDirectory: boolean;
};

export type ConversationContextCapability = {
  label: string;
  state: "available" | "runtime_managed" | "needs_attention";
  detail: string;
};

export type ConversationContextView = {
  conversationId: string;
  projectId: string | null;
  primary: ConversationContextSource | null;
  additionalSources: ConversationContextSource[];
  status: ConversationContextStatus;
  revision: number;
  capabilities: ConversationContextCapability[];
};

export type ConversationContextScopeInput = {
  conversationId: string;
  projectId: string | null;
};

export type MutateConversationContextInput = ConversationContextScopeInput & {
  expectedRevision: number;
};

export type SyncConversationContextInput = ConversationContextScopeInput & {
  projectSourceIds: string[];
};

export type UpdateConversationContextInput = ConversationContextScopeInput & {
  expectedRevision: number;
  primaryMode: "inherit" | "none" | "source";
  primarySourceId: string | null;
  additionalSourceIds: string[];
};

export function syncConversationContext(
  input: SyncConversationContextInput,
): Promise<ConversationContextView> {
  return invoke("sync_conversation_context", { input });
}

export function getConversationContext(
  input: ConversationContextScopeInput,
): Promise<ConversationContextView> {
  return invoke("get_conversation_context", { input });
}

export function updateConversationContext(
  input: UpdateConversationContextInput,
): Promise<ConversationContextView> {
  return invoke("update_conversation_context", { input });
}

export function promoteConversationContextToProject(
  input: MutateConversationContextInput,
): Promise<ConversationContextView> {
  return invoke("promote_conversation_context_to_project", { input });
}

export function removeConversationContextOverride(
  input: MutateConversationContextInput,
): Promise<ConversationContextView> {
  return invoke("remove_conversation_context_override", { input });
}

export function pickConversationContextFolder(
  input: MutateConversationContextInput,
): Promise<ConversationContextView | null> {
  return invoke("pick_conversation_context_folder", { input });
}
