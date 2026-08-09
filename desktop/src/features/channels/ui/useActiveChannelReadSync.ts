import * as React from "react";

import {
  MSG_PREFIX,
  THREAD_PREFIX,
} from "@/features/channels/readState/readStateFormat";
import type { ContextParentResolver } from "@/features/channels/readState/readStateManager";
import { getThreadReference } from "@/features/messages/lib/threading";
import type { RelayEvent } from "@/shared/api/types";

type UseActiveChannelReadSyncInput = {
  activeChannelId: string | null;
  isMember: boolean | undefined;
  markChannelRead: (
    channelId: string,
    readAt: string | null | undefined,
    options?: { topLevelOnly?: boolean },
  ) => void;
  messages: RelayEvent[] | undefined;
  setContextParentResolver: (resolver: ContextParentResolver | null) => void;
};

export function useActiveChannelReadSync({
  activeChannelId,
  isMember,
  markChannelRead,
  messages,
  setContextParentResolver,
}: UseActiveChannelReadSyncInput) {
  const activeReadAt = React.useMemo(() => {
    if (!messages) return null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (getThreadReference(message.tags).parentId === null) {
        return new Date(message.created_at * 1_000).toISOString();
      }
    }
    return null;
  }, [messages]);

  React.useEffect(() => {
    if (!activeChannelId || isMember === false) return;
    markChannelRead(activeChannelId, activeReadAt, { topLevelOnly: true });
  }, [activeChannelId, activeReadAt, isMember, markChannelRead]);

  React.useEffect(() => {
    if (!activeChannelId) {
      setContextParentResolver(null);
      return;
    }
    setContextParentResolver((contextId) =>
      contextId.startsWith(THREAD_PREFIX) || contextId.startsWith(MSG_PREFIX)
        ? activeChannelId
        : null,
    );
    return () => setContextParentResolver(null);
  }, [activeChannelId, setContextParentResolver]);
}
