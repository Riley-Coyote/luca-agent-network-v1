import * as React from "react";

import { msgContextKey } from "@/features/channels/readState/readStateFormat";
import {
  type ContextParentResolver,
  resolveEffectiveTimestamp,
} from "@/features/channels/readState/readStateManager";
import { readStoredReadState } from "@/features/channels/readState/readStateStorage";

/**
 * A pop-out's view of what has already been read.
 *
 * Read markers are NIP-RS events, and exactly one window may publish them: a
 * second ReadStateManager would race the main window for the same slot. So a
 * pop-out never owns read state — it PROJECTS it, read-only, from the
 * localStorage mirror the main window's manager keeps, and asks the main window
 * to do any actual marking.
 *
 * localStorage is shared across every webview on this origin and fires
 * `storage` in the other documents whenever one of them writes, so a mark made
 * in the main window reaches the pop-out on the same tick it lands on disk —
 * the same cross-window mechanism the preview-feature overrides already use.
 */
export type PopoutReadState = {
  getChannelReadAt: (channelId: string) => number | null;
  getMessageReadAt: (messageId: string) => number | null;
  getThreadReadAt: (rootId: string, channelId?: string | null) => number | null;
  readStateVersion: number;
  setContextParentResolver: (resolver: ContextParentResolver | null) => void;
};

const NO_CONTEXTS: Map<string, number> = new Map();

export function usePopoutReadState(
  pubkey: string | undefined,
): PopoutReadState {
  const [readStateVersion, bumpReadStateVersion] = React.useReducer(
    (version: number) => version + 1,
    0,
  );
  const contextsRef = React.useRef<Map<string, number>>(NO_CONTEXTS);
  // The thread → channel relationship is derived from the event graph, not
  // stored, so the active conversation surface hands it down. Held in a ref:
  // it changes as the timeline loads and must not re-render the whole subtree.
  const parentResolverRef = React.useRef<ContextParentResolver | null>(null);

  React.useEffect(() => {
    if (!pubkey) {
      contextsRef.current = NO_CONTEXTS;
      bumpReadStateVersion();
      return;
    }

    const reload = () => {
      try {
        contextsRef.current = readStoredReadState(pubkey).contexts;
      } catch {
        // A mirror we cannot read means "nothing known yet", which is the
        // same answer a first launch gives.
        contextsRef.current = NO_CONTEXTS;
      }
      bumpReadStateVersion();
    };

    reload();
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("storage", reload);
    };
  }, [pubkey]);

  const getChannelReadAt = React.useCallback(
    (channelId: string) =>
      resolveEffectiveTimestamp({
        effectiveState: contextsRef.current,
        contextId: channelId,
        parentResolver: parentResolverRef.current,
      }),
    [],
  );

  const getMessageReadAt = React.useCallback(
    (messageId: string) => getChannelReadAt(msgContextKey(messageId)),
    [getChannelReadAt],
  );

  // Mirrors AppShell's fold: a thread is read as far as its own frontier or the
  // channel's, whichever is later.
  const getThreadReadAt = React.useCallback(
    (rootId: string, channelId?: string | null) => {
      const threadReadAt = contextsRef.current.get(`thread:${rootId}`) ?? null;
      if (!channelId) {
        return threadReadAt;
      }
      const channelReadAt = getChannelReadAt(channelId);
      if (threadReadAt === null) return channelReadAt;
      if (channelReadAt === null) return threadReadAt;
      return Math.max(threadReadAt, channelReadAt);
    },
    [getChannelReadAt],
  );

  const setContextParentResolver = React.useCallback(
    (resolver: ContextParentResolver | null) => {
      parentResolverRef.current = resolver;
    },
    [],
  );

  // Memoised on purpose: this object becomes part of the AppShell context
  // value, and a fresh identity every render would re-render the whole
  // conversation. Only a real read-state change may move it.
  return React.useMemo(
    () => ({
      getChannelReadAt,
      getMessageReadAt,
      getThreadReadAt,
      readStateVersion,
      setContextParentResolver,
    }),
    [
      getChannelReadAt,
      getMessageReadAt,
      getThreadReadAt,
      readStateVersion,
      setContextParentResolver,
    ],
  );
}
