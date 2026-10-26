import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { readLastConversation } from "@/app/navigation/lastConversation";
import { useChannelsQuery, useOpenDmMutation } from "@/features/channels/hooks";
import {
  canonicalLucaResidentPubkey,
  isCanonicalLucaDm,
} from "@/features/luca/canonicalLucaResident";
import { useLucaResidentsQuery } from "@/features/luca/residents/hooks";
import {
  consumePendingWelcomeChannel,
  WELCOME_CHANNEL_READY_EVENT,
} from "@/features/onboarding/welcome";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { Channel } from "@/shared/api/types";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

/** How long the app waits, at most, for Luca's unread dot to be known when
 *  Luca's conversation has news its read marker hasn't covered. */
const LUCA_UNREAD_GRACE_MS = 1500;

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
  const shellFrame = useShellFrameEnabled();
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
    if (shellFrame || channelsQuery.isLoading || channelsQuery.isFetching) {
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
    shellFrame,
  ]);

  return (
    <>
      {shellFrame ? (
        <ShellLanding
          channels={channels}
          channelsSettled={
            !channelsQuery.isLoading && !channelsQuery.isFetching
          }
        />
      ) : null}
      <ViewLoadingFallback includeHeader kind="channel" />
    </>
  );
}

/**
 * Where the app opens under the shell's frame (NAVIGATION.md, "Chats";
 * SHELL_BUILD.md WP-11): a pending welcome first, as always; then Luca, when
 * Luca's conversation has something unread; else the conversation you left;
 * else Luca, opened or created. Never New conversation, unless there is no
 * Luca to open at all.
 */
function ShellLanding({
  channels,
  channelsSettled,
}: {
  channels: readonly Channel[];
  channelsSettled: boolean;
}) {
  const { goChannel, goNewMessage } = useAppNavigation();
  const { getChannelReadAt, readStateVersion, unreadChannelIds } =
    useAppShell();
  const owner = useIdentityQuery().data?.pubkey;
  const residentsQuery = useLucaResidentsQuery();
  const residentsSettled =
    Boolean(residentsQuery.data) || residentsQuery.isError;
  const luca = canonicalLucaResidentPubkey(residentsQuery.data?.residents);
  const openDm = useOpenDmMutation().mutateAsync;
  const decided = React.useRef(false);
  const [graceOver, setGraceOver] = React.useState(false);
  const graceTimer = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (graceTimer.current !== null) window.clearTimeout(graceTimer.current);
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: readStateVersion is the read marker's change signal for getChannelReadAt.
  React.useEffect(() => {
    if (decided.current || !channelsSettled || !residentsSettled) return;
    if (luca && !owner) return;
    const ids = new Set(channels.map((channel) => channel.id));
    const go = (channelId: string) => {
      decided.current = true;
      void goChannel(channelId, { replace: true });
    };

    const welcome = consumePendingWelcomeChannel(ids);
    if (welcome) return go(welcome);

    const lucaDm =
      channels.find((channel) => isCanonicalLucaDm(channel, owner, luca)) ??
      null;
    const last = readLastConversation(ids);
    if (lucaDm && unreadChannelIds?.has(lucaDm.id)) return go(lucaDm.id);
    // Luca has news its read marker hasn't covered: the dot may be on its
    // way (the unread catch-up runs after the list), so wait a moment for it
    // before landing anywhere else.
    if (lucaDm && last !== lucaDm.id && !graceOver) {
      const said = lucaDm.lastMessageAt ? Date.parse(lucaDm.lastMessageAt) : 0;
      const readAt = getChannelReadAt(lucaDm.id);
      if (said > 0 && (readAt === null || said / 1000 > readAt)) {
        graceTimer.current ??= window.setTimeout(
          () => setGraceOver(true),
          LUCA_UNREAD_GRACE_MS,
        );
        return;
      }
    }
    if (last) return go(last);
    if (lucaDm) return go(lucaDm.id);
    decided.current = true;
    if (!luca) {
      void goNewMessage({ replace: true });
      return;
    }
    void (async () => {
      try {
        // Get-or-create: the relay keeps one thread per owner and Luca.
        const thread = await openDm({ pubkeys: [luca] });
        await goChannel(thread.id, { replace: true });
      } catch {
        await goNewMessage({ replace: true });
      }
    })();
  }, [
    channels,
    channelsSettled,
    getChannelReadAt,
    goChannel,
    goNewMessage,
    graceOver,
    luca,
    openDm,
    owner,
    readStateVersion,
    residentsSettled,
    unreadChannelIds,
  ]);

  return null;
}
