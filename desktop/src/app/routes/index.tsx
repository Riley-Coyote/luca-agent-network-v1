import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { readLastConversation } from "@/app/navigation/lastConversation";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  consumePendingWelcomeChannel,
  WELCOME_CHANNEL_READY_EVENT,
} from "@/features/onboarding/welcome";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type HomeRouteSearch = {
  item?: string;
  profile?: string;
  profileTab?: string;
  profileView?: string;
};

function validateHomeSearch(search: Record<string, unknown>): HomeRouteSearch {
  return {
    item:
      typeof search.item === "string" && search.item.length > 0
        ? search.item
        : undefined,
    profile:
      typeof search.profile === "string" && search.profile.length > 0
        ? search.profile
        : undefined,
    profileTab:
      typeof search.profileTab === "string" && search.profileTab.length > 0
        ? search.profileTab
        : undefined,
    profileView:
      typeof search.profileView === "string" && search.profileView.length > 0
        ? search.profileView
        : undefined,
  };
}

export const Route = createFileRoute("/")({
  validateSearch: validateHomeSearch,
  component: HomeRouteComponent,
});

function HomeRouteComponent() {
  const { goChannel, goNewMessage } = useAppNavigation();
  const channelsQuery = useChannelsQuery();
  const channels = channelsQuery.data ?? [];
  const availableChannelIds = React.useMemo(
    () => new Set(channels.map((channel) => channel.id)),
    [channels],
  );
  const availableChannelIdsRef = React.useRef(availableChannelIds);
  const openPendingWelcomeChannel = React.useCallback(
    (ids: ReadonlySet<string>) => {
      const welcomeChannelId = consumePendingWelcomeChannel(ids);
      if (!welcomeChannelId) {
        return;
      }

      void goChannel(welcomeChannelId, { replace: true });
    },
    [goChannel],
  );

  React.useEffect(() => {
    availableChannelIdsRef.current = availableChannelIds;
  }, [availableChannelIds]);

  React.useEffect(() => {
    function handleWelcomeChannelReady() {
      openPendingWelcomeChannel(availableChannelIdsRef.current);
    }

    window.addEventListener(
      WELCOME_CHANNEL_READY_EVENT,
      handleWelcomeChannelReady,
    );
    return () => {
      window.removeEventListener(
        WELCOME_CHANNEL_READY_EVENT,
        handleWelcomeChannelReady,
      );
    };
  }, [openPendingWelcomeChannel]);

  React.useEffect(() => {
    if (channelsQuery.isLoading || channelsQuery.isFetching) {
      return;
    }

    const pendingWelcomeChannelId =
      consumePendingWelcomeChannel(availableChannelIds);
    if (pendingWelcomeChannelId) {
      void goChannel(pendingWelcomeChannelId, { replace: true });
      return;
    }

    const lastConversationId = readLastConversation(availableChannelIds);
    if (lastConversationId) {
      void goChannel(lastConversationId, { replace: true });
      return;
    }

    void goNewMessage({ replace: true });
  }, [
    availableChannelIds,
    channelsQuery.isFetching,
    channelsQuery.isLoading,
    goChannel,
    goNewMessage,
  ]);

  return <ViewLoadingFallback includeHeader kind="channel" />;
}
