function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const capacityMessage =
  "Brain's index has reached its size limit. Your existing data is preserved, but this update could not be saved. Reducing what is indexed may be needed before retrying.";

export function readableOwnerBrainError(
  error: unknown,
  context: "preview" | "access",
): string {
  const message = errorCode(error);
  const shared: Record<string, string> = {
    "owner-brain-cancelled": "The import was cancelled before it committed.",
    "owner-brain-locked": "Unlock Luca, then try this operation again.",
    "owner-brain-runtime-unavailable":
      "This agent needs a valid runtime before access can be changed.",
    "owner-brain-timeout": "The operation timed out without a partial write.",
    "owner-brain-unavailable": "Brain data could not be opened. Try again.",
    "owner-brain-capacity": capacityMessage,
  };
  if (message === "owner-brain-invalid") {
    return context === "preview"
      ? "Luca could not preview that source. Choose it again."
      : "Luca could not update access for this Brain source. Refresh it and try again.";
  }
  if (message === "owner-brain-stale") {
    return context === "preview"
      ? "The source changed or the preview expired. Preview it again."
      : "This Brain source or agent binding changed. Refresh it and try again.";
  }
  return shared[message] ?? message.replaceAll("-", " ");
}

export function readableConnectedBrainError(error: unknown): string {
  const message = errorCode(error);
  const values: Record<string, string> = {
    "connected-source-watch-unavailable":
      "Luca can read this source, but could not keep its connection active. Check that the original location is available, then retry the source.",
    "owner-brain-invalid":
      "Luca could not open this Brain source. Scan again, then retry the connection.",
    "owner-brain-locked": "Unlock Luca, then try this operation again.",
    "owner-brain-stale":
      "The source changed or the preview expired. Scan again, then retry.",
    "owner-brain-unavailable": "Brain data could not be opened. Try again.",
    "owner-brain-capacity": capacityMessage,
  };
  return values[message] ?? message.replaceAll("-", " ");
}
