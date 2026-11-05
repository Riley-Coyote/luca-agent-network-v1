import type { Channel } from "@/shared/api/types";
import type { ExchangeEntry } from "@/features/exchange/exchangeStore";
import type { WorkingChannelSummary } from "@/features/agents/agentWorkingSignal";

const PUBKEY = /^[a-f0-9]{64}$/;
const DEFAULT_PERSONAS = new Set([
  "builtin:fizz",
  "builtin:honey",
  "builtin:bumble",
]);

export type RailResident = { pubkey: string; personaId?: string | null };
export type AgentRailVisibility = Readonly<Record<string, boolean>>;

/** Device-local display choices, isolated by owner, relay and workspace. */
export function agentRailVisibilityKey(
  owner: string | null | undefined,
  relay: string | null | undefined,
  community: string | null | undefined,
): string | null {
  const key = owner?.toLowerCase() ?? "";
  return PUBKEY.test(key) && relay && community
    ? `polyphonic.agent-rail-visibility.v1:${encodeURIComponent(relay)}:${encodeURIComponent(community)}:${key}`
    : null;
}

/** Ignore malformed entries without changing agent records or conversations. */
export function parseAgentRailVisibility(
  raw: string | null,
): AgentRailVisibility {
  try {
    const value: unknown = JSON.parse(raw ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, visible]) => PUBKEY.test(key) && typeof visible === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

/** The companion is always reachable; other agents use a choice or the core defaults. */
export function isAgentVisibleInRail(
  agent: RailResident,
  primary: string | null,
  choices: AgentRailVisibility,
): boolean {
  const key = agent.pubkey.toLowerCase();
  if (key === primary?.toLowerCase()) return true;
  return choices[key] ?? DEFAULT_PERSONAS.has(agent.personaId ?? "");
}

/** A successful owner conversation or explicit tag also reveals specialists. */
export function directlyAddressedRailAgents(
  channel: Channel,
  owner: string,
  explicitMentions: readonly string[],
  residents: readonly RailResident[],
): string[] {
  const known = new Set(residents.map((agent) => agent.pubkey.toLowerCase()));
  const guests = new Set(
    channel.guestPubkeys?.map((key) => key.toLowerCase()) ?? [],
  );
  const others = [
    ...new Set(channel.participantPubkeys.map((key) => key.toLowerCase())),
  ].filter((key) => key !== owner.toLowerCase() && !guests.has(key));
  const direct =
    channel.channelType === "dm" && others.length === 1 ? others : [];
  return [
    ...new Set([
      ...direct,
      ...explicitMentions.map((key) => key.toLowerCase()),
    ]),
  ].filter((key) => known.has(key));
}

/** Current work and newly delivered exchanges reveal their actual participants.
 * An old Open label is not evidence of work: backfilled exchange heads have no
 * liveObservedAt, and only real working signals restore active work on restart. */
export function railEngagements(
  owner: string,
  residents: readonly RailResident[],
  channels: readonly Pick<Channel, "id">[],
  exchanges: readonly ExchangeEntry[],
  working: readonly WorkingChannelSummary[],
): Array<{ token: string; pubkeys: string[] }> {
  const known = new Set(residents.map((agent) => agent.pubkey.toLowerCase()));
  const currentChannels = new Set(channels.map((channel) => channel.id));
  const engagements: Array<{ token: string; pubkeys: string[] }> = [];
  for (const { record, liveObservedAt } of exchanges) {
    if (
      liveObservedAt === null ||
      record.owner.toLowerCase() !== owner.toLowerCase() ||
      !currentChannels.has(record.conversationId)
    )
      continue;
    const pubkeys = record.members
      .map((pubkey) => pubkey.toLowerCase())
      .filter((pubkey) => known.has(pubkey));
    if (pubkeys.length)
      engagements.push({
        token: `exchange:${record.exchangeId}:${liveObservedAt}:${pubkeys.join(",")}`,
        pubkeys,
      });
  }
  for (const channel of working) {
    if (!currentChannels.has(channel.channelId)) continue;
    for (const value of channel.agentPubkeys) {
      const pubkey = value.toLowerCase();
      if (known.has(pubkey))
        engagements.push({
          token: `work:${channel.channelId}:${channel.anchorAt}:${pubkey}`,
          pubkeys: [pubkey],
        });
    }
  }
  return engagements;
}
