import { invokeTauri } from "@/shared/api/tauri";

export type HarnessRuntimeFamily = "claude_code" | "codex";

export type HarnessSessionRouting =
  | "claude_live"
  | "saved_claude"
  | "codex_app"
  | "saved_codex_cli"
  | "unavailable";

export type HarnessSession = {
  /** Short-lived opaque selection, never a provider UUID or filesystem path. */
  sessionId: string;
  /** Stable owner/profile identity for selection only, never action authority. */
  selectionKey: string;
  /** Exact native identity match, scoped to the current owner and relay. */
  latestTaskId: string | null;
  title: string;
  workspace: string;
  /** Local owner UI only; this is never a resident lookup grant. */
  workingFolder: string;
  updatedAt: string | null;
  routing: HarnessSessionRouting;
  liveState: "live" | "saved" | "unknown";
  /** Dispatch rechecks native controller, policy and lease authority. */
  canSend: boolean;
  canContinue: boolean;
  reason: string | null;
};

export type HarnessSessionList = {
  sourceId: string | null;
  runtimeFamily: HarnessRuntimeFamily;
  sessions: HarnessSession[];
  truncated: boolean;
  notice: string | null;
};

export type GetHarnessSessionInput = {
  runtimeFamily: HarnessRuntimeFamily;
  sourceId: string;
  sessionId: string;
  conversationId: string;
  residentPubkey: string;
};

export type HarnessSessionMessage = {
  role: "user" | "assistant";
  text: string;
};

export type HarnessSessionUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type HarnessSessionDetail = {
  sessionId: string;
  title: string;
  messages: HarnessSessionMessage[];
  truncated: boolean;
  /** Unknown unless verified native usage metadata is available. Not billing. */
  usage: HarnessSessionUsage | null;
};

/** Read bounded native metadata as the owner; no grant, observation or send. */
export function listHarnessSessions(
  runtimeFamily: HarnessRuntimeFamily,
  conversationId: string,
  residentPubkey: string,
): Promise<HarnessSessionList> {
  return invokeTauri("list_harness_sessions", {
    runtimeFamily,
    conversationId,
    residentPubkey,
  });
}

/** Read only a listed selection. Expired handles require refresh and reselection. */
export function getHarnessSession(
  input: GetHarnessSessionInput,
): Promise<HarnessSessionDetail> {
  return invokeTauri("get_harness_session", { input });
}
