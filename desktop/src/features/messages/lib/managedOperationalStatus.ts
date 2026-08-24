import type {
  ManagedPermissionResolutionOutcome,
  ManagedConversationOperationalStatus,
} from "@/shared/api/types";
import type {
  ManagedPresentationDisplayPhase,
  ManagedPresentationFailure,
} from "@/features/messages/managedPresentationTypes";

export type ManagedOperationalCopy = {
  label: string;
  tone: "quiet" | "attention";
};

export function managedOperationalCopy(
  phase: ManagedPresentationDisplayPhase,
  failure: ManagedPresentationFailure | null,
): ManagedOperationalCopy | null {
  if (phase === "finalizing") {
    return { label: "Finalizing response", tone: "quiet" };
  }
  if (phase === "stopped") {
    return {
      label: "Stopped · Response may be incomplete",
      tone: "quiet",
    };
  }
  if (phase !== "failed" && phase !== "needs_attention") return null;
  switch (failure) {
    case "unavailable":
      return {
        label: "Resident unavailable · Check setup, then retry",
        tone: "attention",
      };
    case "publication":
      return {
        label: "Response couldn’t be published · Retry",
        tone: "attention",
      };
    case "runtime":
      return {
        label: "Resident couldn’t respond · Retry",
        tone: "attention",
      };
    default:
      return {
        label:
          phase === "needs_attention"
            ? "No response arrived"
            : "No response arrived · Retry",
        tone: "attention",
      };
  }
}

export function dedupeManagedOperationalStatuses(
  statuses: readonly ManagedConversationOperationalStatus[],
): ManagedConversationOperationalStatus[] {
  const seen = new Set<string>();
  return statuses.filter((status) => {
    if (
      status.status !== "interrupted_after_restart" ||
      !status.dispatchReceiptId ||
      seen.has(status.dispatchReceiptId)
    ) {
      return false;
    }
    seen.add(status.dispatchReceiptId);
    return true;
  });
}

export function managedPermissionOutcomeCopy(
  outcome: ManagedPermissionResolutionOutcome,
): string {
  switch (outcome) {
    case "approved":
      return "Permission approved";
    case "rejected":
      return "Permission rejected";
    case "expired":
      return "Permission request expired";
    case "session_replaced":
      return "Permission request closed when the resident restarted";
    case "application_closed":
      return "Permission request closed with Luca";
    case "cancelled":
      return "Permission request cancelled";
  }
}

export function sanitizedAttachmentFailure(): string {
  return "Attachment couldn’t be uploaded. You can keep typing and try the attachment again.";
}
