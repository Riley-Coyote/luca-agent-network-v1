import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { HomeScreen } from "@/features/home/ui/HomeScreen";
import { useIdentityQuery } from "@/shared/api/hooks";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type InboxRouteSearch = {
  item?: string;
  profile?: string;
  profileTab?: string;
  profileView?: string;
};

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const Route = createFileRoute("/inbox")({
  validateSearch: (search: Record<string, unknown>): InboxRouteSearch => ({
    item: nonEmptyString(search.item),
    profile: nonEmptyString(search.profile),
    profileTab: nonEmptyString(search.profileTab),
    profileView: nonEmptyString(search.profileView),
  }),
  component: InboxRouteComponent,
});

function InboxRouteComponent() {
  const { goChannel } = useAppNavigation();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const availableChannelIds = React.useMemo(
    () => new Set((channelsQuery.data ?? []).map((channel) => channel.id)),
    [channelsQuery.data],
  );

  if (channelsQuery.isLoading) {
    return <ViewLoadingFallback includeHeader kind="channel" />;
  }

  return (
    <HomeScreen
      availableChannelIds={availableChannelIds}
      currentPubkey={identityQuery.data?.pubkey}
      onOpenContext={(channelId, messageId, threadRootId) => {
        void goChannel(channelId, { messageId, threadRootId });
      }}
    />
  );
}
