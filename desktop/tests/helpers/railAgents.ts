import type { Page } from "@playwright/test";

import { TEST_IDENTITIES } from "./bridge";

/**
 * Since 468075227 the rail shows only the agents the owner has chosen (plus the
 * companion and the default personas). Specs written before that expect every
 * agent in the rail, so they mark theirs as chosen, the way the owner would.
 *
 * Call AFTER installMockBridge: this init script reads the community the bridge
 * seeded. It only adds choices that are missing, so a spec that hides an agent
 * and reloads keeps its own choice.
 */
export async function chooseRailAgents(
  page: Page,
  extra: readonly string[] = [],
): Promise<void> {
  const pubkeys = [
    ...Object.values(TEST_IDENTITIES).map((identity) => identity.pubkey),
    // The shell specs' own residents (Luca, Atlas, Wren, Codex, …).
    ..."abcdef".split("").map((digit) => digit.repeat(64)),
    ...extra,
  ].map((key) => key.toLowerCase());
  await page.addInitScript((chosen) => {
    try {
      const communities = JSON.parse(
        window.localStorage.getItem("buzz-communities") ?? "[]",
      ) as { id: string; relayUrl: string; pubkey: string }[];
      const active = window.localStorage.getItem("buzz-active-community-id");
      const community = communities.find((entry) => entry.id === active);
      if (!community) return;
      const key = `polyphonic.agent-rail-visibility.v1:${encodeURIComponent(community.relayUrl)}:${encodeURIComponent(community.id)}:${community.pubkey.toLowerCase()}`;
      const stored = JSON.parse(
        window.localStorage.getItem(key) ?? "{}",
      ) as Record<string, boolean> | null;
      const choices = stored && typeof stored === "object" ? stored : {};
      for (const pubkey of chosen)
        if (!(pubkey in choices)) choices[pubkey] = true;
      window.localStorage.setItem(key, JSON.stringify(choices));
    } catch {
      // A malformed seed leaves the app's own defaults in place.
    }
  }, pubkeys);
}
