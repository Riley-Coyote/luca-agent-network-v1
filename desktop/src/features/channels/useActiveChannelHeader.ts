import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useEphemeralChannelDisplay } from "@/features/channels/useEphemeralChannelDisplay";
import { useCanonicalLucaPubkey } from "@/features/luca/canonicalLucaResident";
import { usePresenceQuery } from "@/features/presence/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import {
  resolveChannelDisplayLabel,
  resolveGroupChatMembersName,
} from "@/features/sidebar/lib/channelLabels";
import { useShellFrameEnabled } from "@/shared/features/useShellFrameEnabled";
import type { Channel, PresenceStatus } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export type ActiveDmHeaderParticipant = {
  pubkey: string;
  displayName: string;
  avatarUrl: string | null;
};

export function useActiveChannelHeader(
  activeChannel: Channel | null,
  currentPubkey?: string,
) {
  const activeDmParticipants = React.useMemo(() => {
    if (activeChannel?.channelType !== "dm") {
      return [];
    }

    const normalizedCurrentPubkey = currentPubkey
      ? normalizePubkey(currentPubkey)
      : null;

    return activeChannel.participantPubkeys
      .map((pubkey, index) => ({
        fallbackName: activeChannel.participants[index] ?? null,
        pubkey,
      }))
      .filter(
        (participant) =>
          normalizePubkey(participant.pubkey) !== normalizedCurrentPubkey,
      );
  }, [activeChannel, currentPubkey]);
  const activeDmParticipantPubkeys = React.useMemo(
    () => activeDmParticipants.map((participant) => participant.pubkey),
    [activeDmParticipants],
  );
  const activeDmPresenceQuery = usePresenceQuery(activeDmParticipantPubkeys, {
    enabled: activeDmParticipantPubkeys.length > 0,
  });
  const activeDmProfilesQuery = useUsersBatchQuery(activeDmParticipantPubkeys, {
    enabled: activeDmParticipantPubkeys.length > 0,
  });
  const activeChannelEphemeralDisplay =
    useEphemeralChannelDisplay(activeChannel);
  const activeDmPresenceStatus: PresenceStatus | null =
    activeDmParticipantPubkeys.length > 0
      ? (activeDmPresenceQuery.data?.[
          activeDmParticipantPubkeys[0]?.toLowerCase()
        ] ?? null)
      : null;
  const activeDmAvatarUrl =
    activeDmParticipantPubkeys.length > 0
      ? (activeDmProfilesQuery.data?.profiles?.[
          normalizePubkey(activeDmParticipantPubkeys[0] ?? "")
        ]?.avatarUrl ?? null)
      : null;
  const activeDmHeaderParticipants = React.useMemo(
    () =>
      activeDmParticipants.map((participant) => {
        const profile =
          activeDmProfilesQuery.data?.profiles?.[
            normalizePubkey(participant.pubkey)
          ] ?? null;

        return {
          pubkey: participant.pubkey,
          displayName: resolveUserLabel({
            currentPubkey,
            fallbackName: participant.fallbackName,
            profiles: activeDmProfilesQuery.data?.profiles,
            pubkey: participant.pubkey,
          }),
          avatarUrl: profile?.avatarUrl ?? null,
        };
      }),
    [activeDmParticipants, activeDmProfilesQuery.data?.profiles, currentPubkey],
  );

  // Under the shell's frame an unnamed group chat is named by its members,
  // as the rail names it ("Luca + Wren"), wherever its name is shown: the
  // lip, a pane's quiet name, the window a pop-out opens (WP-04b).
  const shellFrame = useShellFrameEnabled();
  const namesGroup = shellFrame && activeDmParticipants.length > 1;
  const agentsQuery = useManagedAgentsQuery({ enabled: namesGroup });
  const channelsQuery = useChannelsQuery({ enabled: namesGroup });
  const primaryPubkey = useCanonicalLucaPubkey();
  const groupName =
    namesGroup && activeChannel
      ? resolveGroupChatMembersName(activeChannel, {
          agents: agentsQuery.data ?? [],
          channels: channelsQuery.data ?? [],
          currentPubkey,
          primaryPubkey,
          profiles: activeDmProfilesQuery.data?.profiles,
        })
      : null;

  return {
    activeChannelTitle: activeChannel
      ? (groupName ??
        resolveChannelDisplayLabel(
          activeChannel,
          currentPubkey,
          activeDmProfilesQuery.data?.profiles,
        ))
      : "Channels",
    activeDmAvatarUrl,
    activeDmHeaderParticipants,
    activeDmPresenceStatus,
    activeChannelEphemeralDisplay,
  };
}
