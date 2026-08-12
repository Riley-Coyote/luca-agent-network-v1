import * as React from "react";

import { useAppShell } from "@/app/AppShellContext";
import {
  useHomeFeedQuery,
  useOwnerNativeInboxQuery,
} from "@/features/home/hooks";
import { mergeOwnerNativeInboxIntoHomeFeed } from "@/features/home/lib/unifiedInboxProjection";
import { HomeView } from "@/features/home/ui/HomeView";
import type { HomeFeedResponse } from "@/shared/api/types";
import {
  isRelayUnreachableError,
  RELAY_UNREACHABLE_MESSAGE,
} from "@/shared/lib/relayError";

type HomeScreenProps = {
  availableChannelIds: ReadonlySet<string>;
  currentPubkey?: string;
  onOpenContext: (
    channelId: string,
    messageId: string,
    threadRootId?: string | null,
  ) => void;
};

export function HomeScreen({
  availableChannelIds,
  currentPubkey,
  onOpenContext,
}: HomeScreenProps) {
  const homeFeedQuery = useHomeFeedQuery();
  const ownerNativeInboxQuery = useOwnerNativeInboxQuery();
  const { threadActivityFeedItems } = useAppShell();

  const augmentedFeed = React.useMemo((): HomeFeedResponse | undefined => {
    if (!homeFeedQuery.data) return undefined;
    return mergeOwnerNativeInboxIntoHomeFeed({
      legacy: homeFeedQuery.data,
      native: ownerNativeInboxQuery.data,
      threadActivity: threadActivityFeedItems,
    });
  }, [homeFeedQuery.data, ownerNativeInboxQuery.data, threadActivityFeedItems]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <HomeView
        availableChannelIds={availableChannelIds}
        currentPubkey={currentPubkey}
        errorMessage={
          homeFeedQuery.error !== null && homeFeedQuery.error !== undefined
            ? isRelayUnreachableError(homeFeedQuery.error)
              ? RELAY_UNREACHABLE_MESSAGE
              : homeFeedQuery.error instanceof Error
                ? homeFeedQuery.error.message
                : undefined
            : undefined
        }
        feed={augmentedFeed}
        isLoading={homeFeedQuery.isLoading}
        onOpenContext={onOpenContext}
        onRefresh={() => {
          void homeFeedQuery.refetch();
          void ownerNativeInboxQuery.refetch();
        }}
      />
    </div>
  );
}
