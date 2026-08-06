import type { ObserverEvent } from "@/features/agents/ui/agentSessionTypes";
import type { AgentVisualState } from "@/shared/ui/AgentIdentitySpecimen";

/**
 * What a resident is doing right now, derived from the ACP frames the desktop
 * already ingests.
 *
 * This exists because Luca's residents reply SLOWLY AND AT LENGTH — a turn can
 * run forty seconds of thinking, three tool calls and four hundred words. No
 * consumer messenger has to solve that, so nothing in the borrowed quote-reply
 * model covers it: without this, the wait is simply silent and a working
 * resident is indistinguishable from a broken one.
 *
 * Only the PHASE and the tool's KIND cross into the conversation. Raw arguments
 * never do — "running a shell command", never `grep -r auth src/`. A shared room
 * is the wrong place for file paths and command lines.
 */
export type AgentActivityPhase = "thinking" | "working" | "responding";

export type AgentActivity = {
  phase: AgentActivityPhase;
  /** ACP tool kind (`read`, `search`, `execute`, …) while in `working`. */
  toolKind: string | null;
};

/**
 * NOTE ON REUSE: `agentSessionTranscript.ts` also parses these frames, and the
 * plan was to reuse it. It turned out to be the wrong tool — it is a stateful
 * accumulator that builds and retains a full transcript item list for the debug
 * panel. Running one per (agent, channel) just to answer "is a tool open?" would
 * retain the whole session in memory and couple the conversation timeline to a
 * debug view. So this reads the same two fields directly, and stays pure.
 */
export function deriveActivity(event: ObserverEvent): AgentActivity | null {
  if (event.kind !== "acp_read") return null;

  const payload = asRecord(event.payload);
  if (asString(payload.method) !== "session/update") return null;

  const update = asRecord(asRecord(payload.params).update);
  switch (asString(update.sessionUpdate)) {
    case "agent_thought_chunk":
      return { phase: "thinking", toolKind: null };
    case "tool_call":
      return { phase: "working", toolKind: asString(update.kind) ?? null };
    case "tool_call_update": {
      // A completing tool is not "working" any more; the turn falls back to
      // whatever comes next rather than sticking on a finished call.
      const status = asString(update.status);
      if (status === "completed" || status === "failed") return null;
      return { phase: "working", toolKind: asString(update.kind) ?? null };
    }
    case "agent_message_chunk":
      return { phase: "responding", toolKind: null };
    default:
      return null;
  }
}

/** Which phosphor scene the resident's mark runs while in this phase. */
export function visualStateForActivity(
  activity: AgentActivity | null,
): AgentVisualState {
  if (!activity) return "present";
  switch (activity.phase) {
    case "thinking":
      return "thinking";
    case "working":
      return "working";
    case "responding":
      return "responding";
  }
}

const TOOL_KIND_LABELS: Record<string, string> = {
  read: "reading files",
  edit: "editing files",
  delete: "changing files",
  move: "changing files",
  search: "searching",
  execute: "running a shell command",
  fetch: "fetching a page",
  think: "thinking",
};

/**
 * The phrase shown in the room. Deliberately plain: this sits inside a
 * conversation, so it has to read as a sentence about a person, not as a log
 * line. Unknown tool kinds fall back to the phase rather than leaking a raw
 * identifier.
 */
export function activityLabel(activity: AgentActivity | null): string {
  if (!activity) return "";
  if (activity.phase === "thinking") return "thinking";
  if (activity.phase === "responding") return "writing";
  const kind = activity.toolKind?.toLowerCase() ?? "";
  return TOOL_KIND_LABELS[kind] ?? "working";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
