import type { ChatListItem } from "./chatListModel";

/** Expansion belongs to an owner in one workspace, never to a display name. */
export function agentRailStorageKey(
  owner: string,
  relay: string,
  community: string,
) {
  return `polyphonic.agent-rail.v1:${encodeURIComponent(relay)}:${encodeURIComponent(community)}:${owner.toLowerCase()}`;
}

export function readExpandedAgents(
  storage: Pick<Storage, "getItem">,
  key: string,
): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([pubkey, expanded]) =>
          /^[a-f0-9]{64}$/.test(pubkey) && typeof expanded === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

/** Luca's groups and historical conversations remain reachable outside the singleton row. */
export function standaloneConversations(
  items: readonly ChatListItem[],
  agents: readonly { pubkey: string }[],
  primary: string | null,
) {
  const known = new Set(agents.map((agent) => agent.pubkey.toLowerCase()));
  const primaryDms = items.filter(
    (item) =>
      item.channel.channelType === "dm" &&
      item.participants.length === 1 &&
      item.participants[0].toLowerCase() === primary,
  );
  return items.filter(
    (item) =>
      item.channel.channelType === "dm" &&
      (item.participants.length > 1 ||
        !item.participants.some((pubkey) => known.has(pubkey.toLowerCase())) ||
        (primaryDms.length > 1 && primaryDms.includes(item))),
  );
}
