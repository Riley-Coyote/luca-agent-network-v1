import { createFileRoute, redirect } from "@tanstack/react-router";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { HomeScreen } from "@/features/home/ui/HomeScreen";
import { useIdentityQuery } from "@/shared/api/hooks";
import { readInboxSurfaceEnabled } from "@/shared/features/useInboxSurfaceEnabled";
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
  // The Inbox surface is gated off by default (shared/features/inboxSurface.ts).
  // While it is off, a direct link, a restored session, or a stale history
  // entry lands on the normal home route, which forwards to the last
  // conversation (or the new-conversation screen). `replace` keeps `/inbox`
  // out of history so Back does not bounce through the redirect.
  beforeLoad: () => {
    if (!readInboxSurfaceEnabled()) {
      throw redirect({ to: "/", replace: true });
    }
  },
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
