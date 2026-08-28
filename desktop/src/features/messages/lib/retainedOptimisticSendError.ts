const retainedOptimisticSendErrors = new WeakMap<Error, string>();

/** Mark a rejected send whose optimistic timeline row now owns retry. */
export function retainOptimisticSendError(error: Error, channelId: string) {
  retainedOptimisticSendErrors.set(error, channelId);
}

/** Channel whose visible failed row owns retry, or null for an ordinary error. */
export function retainedOptimisticSendChannel(error: unknown) {
  return error instanceof Error
    ? (retainedOptimisticSendErrors.get(error) ?? null)
    : null;
}
