const MISSING_PRIMARY_CONTEXT_ERROR = "conversation_context:missing_primary";

/** Whether a failed send should refresh the room's local context status. */
export function isMissingPrimaryContextSendError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === MISSING_PRIMARY_CONTEXT_ERROR
  );
}
