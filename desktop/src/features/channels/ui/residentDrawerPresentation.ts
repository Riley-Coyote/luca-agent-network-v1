import type { ChannelAgentActivity } from "@/features/agents/activeAgentTurnsStore";
import type { ActivityTrace } from "@/features/messages/activity/activityTraceTypes";
import type { ManagedConversationActivity } from "@/features/messages/managedPresentationTypes";
import type {
  ManagedAgent,
  PendingManagedPermission,
} from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import type { AgentVisualState } from "@/shared/ui/AgentIdentitySpecimen";

export type ResidentDrawerPresentation = {
  label: string;
  mark: AgentVisualState;
  /** The model menu must not change a resident's model mid-turn. */
  replying: boolean;
};

export type ResidentDrawerPresentationInput = {
  conversationId: string;
  residentPubkey: string;
  runtimeStatus: ManagedAgent["status"] | null;
  managed: {
    conversationId: string;
    activity: ManagedConversationActivity;
  } | null;
  observer: {
    conversationId: string;
    activity: readonly ChannelAgentActivity[];
  } | null;
  working: {
    conversationId: string;
    pubkeys: readonly string[];
  } | null;
  permissions: readonly PendingManagedPermission[];
  traces: readonly ActivityTrace[];
};

const result = (
  label: string,
  mark: AgentVisualState,
  replying = false,
): ResidentDrawerPresentation => ({ label, mark, replying });

/**
 * Map only scoped, observed facts to a resident's drawer state. Process status
 * proves that a harness started, not that a model is ready for a new turn.
 */
export function residentDrawerPresentation({
  conversationId,
  residentPubkey,
  runtimeStatus,
  managed,
  observer,
  working,
  permissions,
  traces,
}: ResidentDrawerPresentationInput): ResidentDrawerPresentation {
  const pubkey = normalizePubkey(residentPubkey);
  // The activity store publishes one selected candidate per normalized
  // resident key (newest active, otherwise newest terminal).
  const managedTurn =
    managed?.conversationId === conversationId
      ? managed.activity.get(pubkey)
      : null;
  const latestTrace = traces
    .filter(
      (trace) =>
        trace.conversationId === conversationId &&
        normalizePubkey(trace.residentPubkey) === pubkey,
    )
    .reduce<ActivityTrace | null>(
      (latest, trace) =>
        !latest ||
        trace.startedAt > latest.startedAt ||
        (trace.startedAt === latest.startedAt &&
          trace.dispatchReceiptId > latest.dispatchReceiptId)
          ? trace
          : latest,
      null,
    );

  // A terminal dispatch outranks a lagging permission/observer notification.
  switch (managedTurn?.phase) {
    case "stopped":
      return result("Cancelled", "present");
    case "failed":
      return result(
        managedTurn.failure === "publication"
          ? "Reply not published"
          : "Failed",
        "fault",
      );
    case "needs_attention":
      if (
        latestTrace?.status === "interrupted" &&
        managedTurn.dispatchReceiptId === latestTrace.dispatchReceiptId
      ) {
        return result("Interrupted", "unavailable");
      }
      return result("Needs attention", "fault");
  }

  if (
    (runtimeStatus === "stopped" || runtimeStatus === "not_deployed") &&
    managedTurn?.phase !== "waking"
  ) {
    return result("Unavailable", "unavailable");
  }

  const waitingForPermission = permissions.some(
    ({ request }) =>
      request.conversationId === conversationId &&
      normalizePubkey(request.residentPubkey) === pubkey &&
      // A delayed permission-list update must not revive a completed older
      // dispatch when its exact turn already has a terminal activity record.
      !traces.some(
        (trace) =>
          trace.conversationId === conversationId &&
          normalizePubkey(trace.residentPubkey) === pubkey &&
          trace.turnId === request.turnId &&
          trace.status !== "working",
      ),
  );
  if (waitingForPermission) {
    return result("Waiting for permission", "idle", true);
  }

  switch (managedTurn?.phase) {
    case "waking":
      return result("Starting", "idle", true);
    case "thinking":
      return result("Preparing reply", "thinking", true);
    case "working":
      return result("Working", "working", true);
    case "writing":
      return result("Responding", "responding", true);
    case "finalizing":
      return result("Finishing reply", "responding", true);
    case "stopping":
      return result("Stopping", "working", true);
  }

  const observedTurn =
    observer?.conversationId === conversationId
      ? observer.activity.find(
          (activity) => normalizePubkey(activity.agentPubkey) === pubkey,
        )
      : null;
  if (observedTurn) {
    switch (observedTurn.activity?.phase) {
      case "thinking":
        return result("Preparing reply", "thinking", true);
      case "working":
        return result("Working", "working", true);
      case "responding":
        return result("Responding", "responding", true);
      default:
        return result("Working", "working", true);
    }
  }
  if (
    working?.conversationId === conversationId &&
    working.pubkeys.some((candidate) => normalizePubkey(candidate) === pubkey)
  ) {
    // Typing is a fallback for missing observer frames, not proof of a phase.
    return result("Active in this conversation", "working", true);
  }

  switch (latestTrace?.status) {
    // Restored working records can outlive a crash or restart. Only the live
    // managed/observer/typing signals above may claim current work.
    case "completed":
      return result("Last turn completed", "present");
    case "cancelled":
      return result("Last turn cancelled", "present");
    case "failed":
      return result("Last turn failed", "fault");
    case "interrupted":
      return result("Last turn interrupted", "unavailable");
  }

  if (runtimeStatus === "running" || runtimeStatus === "deployed") {
    return result("Started", "present");
  }
  return result("Status unknown", "unavailable");
}
