import * as React from "react";

import {
  getActivityTrace,
  getConversationActivityTraces,
  retainActivityTraceConversation,
  subscribeActivityTraces,
} from "./activityTraceStore";
import type { ActivityTrace, ActivityTraceLookup } from "./activityTraceTypes";

/** Subscribe to one immutable dispatch; hydration belongs to its conversation. */
export function useActivityTrace(
  lookup: ActivityTraceLookup | null,
): ActivityTrace | null {
  const conversationId = lookup?.conversationId;
  const residentPubkey = lookup?.residentPubkey;
  const dispatchReceiptId = lookup?.dispatchReceiptId;
  const finalMessageId = lookup?.finalMessageId;
  const getSnapshot = React.useCallback(
    () =>
      getActivityTrace(
        conversationId && residentPubkey
          ? {
              conversationId,
              residentPubkey,
              dispatchReceiptId,
              finalMessageId,
            }
          : null,
      ),
    [conversationId, residentPubkey, dispatchReceiptId, finalMessageId],
  );
  return React.useSyncExternalStore(
    subscribeActivityTraces,
    getSnapshot,
    getSnapshot,
  );
}

/** Mount once per visible conversation, including its restored no-final turns. */
export function useConversationActivityTraces(
  conversationId: string | null,
): readonly ActivityTrace[] {
  React.useEffect(
    () =>
      conversationId
        ? retainActivityTraceConversation(conversationId)
        : undefined,
    [conversationId],
  );
  const getSnapshot = React.useCallback(
    () => getConversationActivityTraces(conversationId),
    [conversationId],
  );
  return React.useSyncExternalStore(
    subscribeActivityTraces,
    getSnapshot,
    getSnapshot,
  );
}
