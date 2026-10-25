import {
  resolveIdentityDisplayName,
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { formatDmParticipantDisplayName } from "@/features/channels/lib/dmParticipantDisplay";
import { membersName } from "@/features/sidebar/lib/railHomes";
import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

function isGenericDmChannelName(name: string) {
  const normalized = name.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "dm" ||
    normalized === "direct message" ||
    normalized === "direct messages" ||
    /^group dm\s*(\(\d+\))?$/.test(normalized)
  );
}

export function resolveChannelDisplayLabel(
  channel: Channel,
  currentPubkey: string | undefined,
  profiles: UserProfileLookup | undefined,
) {
  if (channel.channelType !== "dm" || !isGenericDmChannelName(channel.name)) {
    return channel.name;
  }

  const participants = channel.participantPubkeys.map((pubkey, index) => ({
    fallbackName: channel.participants[index] ?? null,
    pubkey,
  }));
  const otherParticipants = currentPubkey
    ? participants.filter(
        (participant) =>
          participant.pubkey.toLowerCase() !== currentPubkey.toLowerCase(),
      )
    : participants;
  const resolvedLabels = (
    otherParticipants.length > 0 ? otherParticipants : participants
  ).map((participant) =>
    resolveUserLabel({
      currentPubkey,
      fallbackName: participant.fallbackName,
      profiles,
      pubkey: participant.pubkey,
    }),
  );
  const uniqueLabels = [...new Set(resolvedLabels)];

  return uniqueLabels.length > 0
    ? formatDmParticipantDisplayName(
        uniqueLabels.map((displayName) => ({ displayName })),
      )
    : channel.name;
}

/** Who else is in a chat (lowercase, deduplicated): the rail's own members. */
function otherMembers(channel: Channel, currentPubkey: string | undefined) {
  const me = currentPubkey ? normalizePubkey(currentPubkey) : null;
  return [...new Set(channel.participantPubkeys.map(normalizePubkey))]
    .filter((pubkey) => pubkey !== me)
    .sort();
}

/**
 * An unnamed group chat's name under the shell's frame: its members, "Luca +
 * Wren", Luca first, as the rail names its group (railHomes.ts, membersName),
 * never the comma form. A person is named as the rail names them: an agent by
 * its name, anyone else by the label of their 1:1, else by their profile.
 * Null for anything that is not an unnamed chat with two or more others.
 */
export function resolveGroupChatMembersName(
  channel: Channel,
  {
    agents,
    channels,
    currentPubkey,
    primaryPubkey,
    profiles,
  }: {
    agents: readonly { name: string; pubkey: string }[];
    channels: readonly Channel[];
    currentPubkey: string | undefined;
    primaryPubkey: string | null;
    profiles: UserProfileLookup | undefined;
  },
): string | null {
  if (channel.channelType !== "dm" || !isGenericDmChannelName(channel.name)) {
    return null;
  }
  const members = otherMembers(channel, currentPubkey);
  if (members.length < 2) return null;
  const agentNames = new Map(
    agents.map((agent) => [normalizePubkey(agent.pubkey), agent.name]),
  );
  const nameOf = (pubkey: string) => {
    const known = agentNames.get(pubkey);
    if (known) return known;
    const direct = channels.find((candidate) => {
      if (candidate.channelType !== "dm") return false;
      const others = otherMembers(candidate, currentPubkey);
      return others.length === 1 && others[0] === pubkey;
    });
    if (direct) {
      return resolveChannelDisplayLabel(direct, currentPubkey, profiles);
    }
    const profile = profiles?.[pubkey];
    if (!profile) return null;
    const name = resolveIdentityDisplayName({
      displayName: profile.displayName,
      name: profile.name,
      nip05Handle: profile.nip05Handle,
      pubkey,
    });
    // "Person" is the resolver's own stand-in, not a name.
    return name === "Person" ? null : name;
  };
  const name = membersName(
    members,
    nameOf,
    primaryPubkey ? normalizePubkey(primaryPubkey) : null,
  );
  return name.length > 0 ? name : null;
}
