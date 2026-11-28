import { createHash } from "node:crypto";

import type { Page } from "@playwright/test";

import type { AgentInboxFixture } from "../../src/testing/agentInboxFixture";

/** The mock's own identity and community (tests/helpers/bridge.ts). */
export const INBOX_OWNER = "deadbeef".repeat(8);
export const INBOX_COMMUNITY = "e2e-default-community";

/** The mock rooms a seeded exchange can live in. */
export const INBOX_ROOMS = {
  design: "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e",
  engineering: "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9",
  general: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
} as const;

/** An exchange the native inbox lists for the owner, as a spec seeds it. */
export type InboxExchange = {
  exchangeId: string;
  members: string[];
  openedBy: string;
  channelName: string;
  rootEventId: string;
  bucket: number;
  deadline: number;
  state?: "open" | "closed";
  /** What was said in it, as the task's read returns it. */
  said?: Array<{ id: string; pubkey: string; content: string; at: number }>;
};

const scope = { communityId: INBOX_COMMUNITY, ownerPubkey: INBOX_OWNER };

/** The pair's identity as the native inbox derives it
 *  (desktop/src-tauri/src/luca/agent_inbox.rs, `correspondence_id`):
 *  versioned, symmetric, scoped to the community and owner. */
export function correspondenceIdOf(members: readonly string[]): string | null {
  if (members.length !== 2 || members[0] === members[1]) return null;
  const pair = [...members].sort();
  const tuple = JSON.stringify([
    "luca.correspondence.v1",
    scope.communityId,
    scope.ownerPubkey,
    pair[0],
    pair[1],
  ]);
  return `correspondence-v1-${createHash("sha256").update(tuple).digest("hex")}`;
}

function roomOf(channelName: string): string {
  const room = INBOX_ROOMS[channelName as keyof typeof INBOX_ROOMS];
  if (!room) throw new Error(`No mock room named ${channelName}.`);
  return room;
}

/** The native inbox's answer for these exchanges, in its canonical shape:
 *  one page listing every task, and each task readable on its own. */
export function railInboxFixture(
  exchanges: readonly InboxExchange[],
  now = Math.floor(Date.now() / 1000),
): AgentInboxFixture {
  const tasks = exchanges.map((exchange) => ({
    correspondenceId: correspondenceIdOf(exchange.members),
    record: {
      protocol: "luca.exchange.v1",
      exchange_id: exchange.exchangeId,
      owner: INBOX_OWNER,
      members: [...exchange.members].sort(),
      conversation_id: roomOf(exchange.channelName),
      root_event_id: exchange.rootEventId,
      depth: 1,
      bucket: exchange.bucket,
      state: exchange.state ?? "open",
      deadline: exchange.deadline,
      opened_by: exchange.openedBy,
    },
    recordEventId: exchange.exchangeId,
    recordUpdatedAt: now,
    outcome: "unknown",
  }));
  return {
    pages: [
      {
        scope,
        tasks,
        nextCursor: null,
        historySource: "canonical_relay",
        partial: false,
      },
    ],
    reads: Object.fromEntries(
      exchanges.map((exchange, index) => [
        exchange.exchangeId,
        {
          scope,
          task: tasks[index],
          // The root message, then each turn tagged with its count.
          events: (exchange.said ?? []).map((each, turn) => ({
            id: each.id,
            pubkey: each.pubkey,
            content: each.content,
            created_at: each.at,
            kind: 9,
            tags: [
              ["h", roomOf(exchange.channelName)],
              ...(turn > 0
                ? [["exchange", exchange.exchangeId, String(turn)]]
                : []),
            ],
            sig: "",
          })),
          historySource: "canonical_relay",
          partial: false,
        },
      ]),
    ),
  };
}

/** Put the inbox's say-so on the page before it loads. */
export async function installRailInbox(
  page: Page,
  exchanges: readonly InboxExchange[],
) {
  await page.addInitScript((data) => {
    window.__BUZZ_E2E_AGENT_INBOX__ = data;
  }, railInboxFixture(exchanges));
}
