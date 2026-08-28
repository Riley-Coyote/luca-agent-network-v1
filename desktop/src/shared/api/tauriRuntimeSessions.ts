import { invoke } from "@tauri-apps/api/core";

import type { RuntimeConnectionStatusV1 } from "@/shared/api/tauriMcp";

export type IndexedRuntimeId = Extract<
  RuntimeConnectionStatusV1["runtimeId"],
  "codex" | "claude_code"
>;

export type ConnectedRuntimeSessionSourceStatus =
  | "not_connected"
  | "connecting"
  | "current"
  | "needs_attention"
  | "unavailable"
  | "unsupported";

export type ConnectedRuntimeSession = {
  sessionId: string;
  title: string;
  preview: string;
  visibleMessageCount: number;
  updatedAt: string | null;
  available: boolean;
};

export type ConnectedRuntimeSessionList = {
  runtimeId: RuntimeConnectionStatusV1["runtimeId"];
  sourceStatus: ConnectedRuntimeSessionSourceStatus;
  sessions: ConnectedRuntimeSession[];
  totalSessionCount: number;
  truncated: boolean;
};

export type ConnectedRuntimeSessionContext = {
  runtimeId: IndexedRuntimeId;
  runtimeLabel: string;
  sessionId: string;
  title: string;
  summary: string;
  visibleMessageCount: number;
  updatedAt: string | null;
};

export function listConnectedRuntimeSessions(
  runtimeId: RuntimeConnectionStatusV1["runtimeId"],
): Promise<ConnectedRuntimeSessionList> {
  return invoke("list_connected_runtime_sessions", { runtimeId });
}

export function getConnectedRuntimeSessionContext(input: {
  runtimeId: IndexedRuntimeId;
  sessionId: string;
}): Promise<ConnectedRuntimeSessionContext> {
  return invoke("get_connected_runtime_session_context", { input });
}
