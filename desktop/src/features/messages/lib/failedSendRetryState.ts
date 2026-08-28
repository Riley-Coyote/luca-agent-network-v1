import { resetRetainedOptimisticSendErrors } from "@/features/messages/lib/retainedOptimisticSendError";

/** Community-scoped, in-memory payloads for visible failed-send retries. */
const failedSendRetryVariables = new Map<string, unknown>();

export function retainFailedSendRetry<T>(optimisticId: string, variables: T) {
  failedSendRetryVariables.set(optimisticId, variables);
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
