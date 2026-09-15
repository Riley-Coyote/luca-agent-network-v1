import * as React from "react";

import { useChannelsQuery } from "@/features/channels/hooks";
import {
  useRoomProjectCatalog,
  useRoomProjects,
} from "@/features/channels/lib/roomProjects";
import { useCommunities } from "@/features/communities/useCommunities";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveChannelDisplayLabel } from "@/features/sidebar/lib/channelLabels";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { Channel } from "@/shared/api/types";

/** One conversation, under the name the owner would recognise it by. */
export type PopoutConversationEntry = {
  channel: Channel;
  label: string;
};

/** A project's rooms, the loose rooms, or the direct messages. */
export type PopoutConversationGroup = {
  id: string;
  label: string;
  entries: PopoutConversationEntry[];
};

export type PopoutConversations = {
  groups: PopoutConversationGroup[];
  entryCount: number;
  /** The conversation this window is showing, if the list has reached it. */
  selected: PopoutConversationEntry | null;
};

/**
 * Group every conversation the owner can reach the way the sidebar does:
 * each project's rooms under the project's own label, then the rooms that
 * belong to no project, then the direct messages.
 *
 * Projects come first because a project label is the only grouping here that
 * carries meaning the channel list cannot state for itself; "Rooms" and
 * "Direct" are kinds, and a kind is a weaker sort than a piece of work.
 */
function groupConversations(
  channels: readonly Channel[],
  labelFor: (channel: Channel) => string,
  projectByChannelId: ReadonlyMap<string, { id: string; label: string }>,
  projectOrder: readonly { id: string; label: string }[],
): PopoutConversationGroup[] {
  const byProject = new Map<string, PopoutConversationEntry[]>();
  const rooms: PopoutConversationEntry[] = [];
  const direct: PopoutConversationEntry[] = [];

  for (const channel of channels) {
    const entry = { channel, label: labelFor(channel) };
    if (channel.channelType === "dm") {
      direct.push(entry);
      continue;
    }
    const project = projectByChannelId.get(channel.id);
    if (!project) {
      rooms.push(entry);
      continue;
    }
    const bucket = byProject.get(project.id);
    if (bucket) bucket.push(entry);
    else byProject.set(project.id, [entry]);
  }

  const groups: PopoutConversationGroup[] = [];
  for (const project of projectOrder) {
    const entries = byProject.get(project.id);
    if (entries?.length) {
      groups.push({
        id: `project:${project.id}`,
        label: project.label,
        entries,
      });
    }
  }
  if (rooms.length)
    groups.push({ id: "rooms", label: "Rooms", entries: rooms });
  if (direct.length) {
    groups.push({ id: "direct", label: "Direct", entries: direct });
  }
  return groups;
}

/**
 * Every conversation a pop-out can reach, grouped and named.
 *
 * Shared by the bar's picker and by the bar's title, so the window title, the
 * document title and the menu in between can never disagree about what a
 * conversation is called — a direct message's stored `name` is "DM", and that
 * is what the window used to end up titled once the channel list loaded.
 *
 * Every query behind this is already mounted by `PopoutApp`, so a second
 * caller costs a memo, not a fetch.
 */
export function usePopoutConversations(
  channelId: string | null,
): PopoutConversations {
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const communities = useCommunities();

  const channels = React.useMemo(
    () => channelsQuery.data ?? [],
    [channelsQuery.data],
  );
  const currentPubkey = identityQuery.data?.pubkey;
  const relayUrl = communities.activeCommunity?.relayUrl;

  // Direct messages are named by who is in them, which needs the profiles the
  // sidebar already fetches for exactly this reason.
  const dmParticipantPubkeys = React.useMemo(
    () =>
      channels.flatMap((channel) =>
        channel.channelType === "dm"
          ? channel.participantPubkeys.filter(
              (pubkey) => pubkey.toLowerCase() !== currentPubkey?.toLowerCase(),
            )
          : [],
      ),
    [channels, currentPubkey],
  );
  const dmProfilesQuery = useUsersBatchQuery(dmParticipantPubkeys, {
    enabled: dmParticipantPubkeys.length > 0,
  });
  const dmProfiles = dmProfilesQuery.data?.profiles;

  const projectByChannelId = useRoomProjects(channels, currentPubkey, relayUrl);
  const projectCatalog = useRoomProjectCatalog(
    channels,
    currentPubkey,
    relayUrl,
  );

  const groups = React.useMemo(
    () =>
      groupConversations(
        channels,
        (channel) =>
          resolveChannelDisplayLabel(channel, currentPubkey, dmProfiles),
        projectByChannelId,
        projectCatalog,
      ),
    [channels, currentPubkey, dmProfiles, projectByChannelId, projectCatalog],
  );

  return React.useMemo(() => {
    let entryCount = 0;
    let selected: PopoutConversationEntry | null = null;
    for (const group of groups) {
      entryCount += group.entries.length;
      for (const entry of group.entries) {
        if (entry.channel.id === channelId) selected = entry;
      }
    }
    return { groups, entryCount, selected };
  }, [channelId, groups]);
}
