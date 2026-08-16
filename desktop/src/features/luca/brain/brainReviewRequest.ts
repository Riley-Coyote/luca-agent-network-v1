export const BRAIN_REVIEW_REQUEST = "brain_review_request" as const;

export type BrainReviewRequest = {
  type: typeof BRAIN_REVIEW_REQUEST;
  requestId: string;
  channelId: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseBrainReviewRequest(
  value: unknown,
): BrainReviewRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).length !== 3 ||
    payload.type !== BRAIN_REVIEW_REQUEST ||
    typeof payload.requestId !== "string" ||
    payload.requestId.trim().length === 0 ||
    typeof payload.channelId !== "string" ||
    !UUID_PATTERN.test(payload.channelId)
  ) {
    return null;
  }
  return {
    type: BRAIN_REVIEW_REQUEST,
    requestId: payload.requestId,
    channelId: payload.channelId,
  };
}
