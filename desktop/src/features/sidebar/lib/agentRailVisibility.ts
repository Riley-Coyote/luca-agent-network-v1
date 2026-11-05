import type { Channel } from "@/shared/api/types";

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

/** Only the owner's direct conversation or explicit tags reveal specialists.
 * Incoming replies, group membership and delegated work do not populate the rail. */
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
