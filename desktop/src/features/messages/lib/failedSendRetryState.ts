import { resetRetainedOptimisticSendErrors } from "@/features/messages/lib/retainedOptimisticSendError";

/** Community-scoped, in-memory payloads for visible failed-send retries. */
const failedSendRetryVariables = new Map<string, unknown>();
const MAX_RETAINED_FAILED_SENDS = 100;

export function retainFailedSendRetry<T>(optimisticId: string, variables: T) {
  // Refresh insertion order when the same visible row fails again.
  failedSendRetryVariables.delete(optimisticId);
  failedSendRetryVariables.set(optimisticId, variables);
  while (failedSendRetryVariables.size > MAX_RETAINED_FAILED_SENDS) {
    const oldestId = failedSendRetryVariables.keys().next().value;
    if (typeof oldestId !== "string") break;
    failedSendRetryVariables.delete(oldestId);
  }
}

export function failedSendRetry<T>(optimisticId: string): T | undefined {
  return failedSendRetryVariables.get(optimisticId) as T | undefined;
}

export function removeFailedSendRetry(optimisticId: string) {
  failedSendRetryVariables.delete(optimisticId);
}

/** Drop message bodies and failure ownership when the active community changes. */
export function resetFailedSendRetryState() {
  failedSendRetryVariables.clear();
  resetRetainedOptimisticSendErrors();
}
