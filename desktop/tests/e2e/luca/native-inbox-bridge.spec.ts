import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const MANAGED_AGENT_PUBKEY = "f".repeat(64);

type NativeInboxResponse = {
  projection: {
    protocol: string;
    owner_pubkey: string;
    viewer_pubkey: string;
    items: Array<Record<string, unknown>>;
    has_more: boolean;
  };
  presentation_items: Array<{
    source_event_id: string;
    kind: number;
    author_pubkey: string;
    created_at: number;
    channel_id: string;
    channel_type: "direct" | "room";
    structural_tags: string[][];
    categories: Array<"direct" | "agents">;
  }>;
  sources: Array<{
    source: string;
    availability: string;
    diagnostic_code?: string;
  }>;
};

async function invokeOwnerInbox(
  page: import("@playwright/test").Page,
  payload: { since?: number; limit?: number } = {},
): Promise<NativeInboxResponse> {
  await page.waitForFunction(
    () =>
      typeof (
        window as Window & {
          __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: unknown;
        }
      ).__BUZZ_E2E_INVOKE_MOCK_COMMAND__ === "function",
  );

  return page.evaluate(async (args) => {
    const invoke = (
      window as Window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
          command: string,
          payload?: Record<string, unknown>,
        ) => Promise<unknown>;
      }
    ).__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
    if (!invoke) throw new Error("Mock invoke bridge is unavailable.");
    return (await invoke("get_luca_owner_inbox", args)) as NativeInboxResponse;
  }, payload);
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: MANAGED_AGENT_PUBKEY,
        name: "Luca",
        status: "running",
        channelNames: ["agents"],
      },
    ],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof (
        window as Window & {
          __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: unknown;
        }
      ).__BUZZ_E2E_INVOKE_MOCK_COMMAND__ === "function",
  );
  await page.evaluate(() => {
    (
      window as Window & {
        __BUZZ_E2E_COMMANDS__?: string[];
      }
    ).__BUZZ_E2E_COMMANDS__ = [];
  });
});

test("projects exact direct and managed-agent sources without activation", async ({
  page,
}) => {
  const first = await invokeOwnerInbox(page);
  const second = await invokeOwnerInbox(page);

  expect(second).toEqual(first);
  expect(first.projection).toMatchObject({
    protocol: "luca.inbox.projection.v1",
    has_more: false,
  });
  expect(first.projection.owner_pubkey).toBe(first.projection.viewer_pubkey);
  expect(first.presentation_items).toHaveLength(2);
  expect(
    first.presentation_items.map((item) => item.categories[0]).sort(),
  ).toEqual(["agents", "direct"]);

  const direct = first.presentation_items.find((item) =>
    item.categories.includes("direct"),
  );
  expect(direct).toMatchObject({ kind: 9, channel_type: "direct" });
  expect(direct?.structural_tags.map((tag) => tag[0]).sort()).toEqual([
    "h",
    "p",
  ]);

  const agent = first.presentation_items.find((item) =>
    item.categories.includes("agents"),
  );
  expect(agent).toMatchObject({
    kind: 9,
    author_pubkey: MANAGED_AGENT_PUBKEY,
    channel_type: "room",
  });
  expect(
    first.sources.map(({ source, availability, diagnostic_code }) => ({
      source,
      availability,
      diagnostic_code,
    })),
  ).toEqual([
    {
      source: "conversation_membership",
      availability: "ready",
      diagnostic_code: undefined,
    },
    {
      source: "direct_messages",
      availability: "ready",
      diagnostic_code: undefined,
    },
    {
      source: "managed_agent_messages",
      availability: "ready",
      diagnostic_code: undefined,
    },
    {
      source: "read_state",
      availability: "ready",
      diagnostic_code: "frontend_read_state_authority",
    },
  ]);

  const commands = await page.evaluate(
    () =>
      (
        window as Window & {
          __BUZZ_E2E_COMMANDS__?: string[];
        }
      ).__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(
    commands.filter((command) => command === "get_luca_owner_inbox"),
  ).toHaveLength(2);
  expect(
    commands.filter((command) =>
      [
        "start_managed_agent",
        "send_channel_message",
        "create_channel",
        "add_channel_members",
      ].includes(command),
    ),
  ).toEqual([]);
});

test("applies the native since and limit window without synthetic rows", async ({
  page,
}) => {
  const limited = await invokeOwnerInbox(page, { limit: 1 });
  expect(limited.presentation_items).toHaveLength(1);
  expect(limited.presentation_items[0].categories).toEqual(["agents"]);
  expect(
    limited.sources.find((source) => source.source === "direct_messages"),
  ).toMatchObject({ availability: "empty" });

  const afterNewest = await invokeOwnerInbox(page, {
    since: limited.presentation_items[0].created_at + 1,
  });
  expect(afterNewest.presentation_items).toEqual([]);
  expect(afterNewest.projection.items).toEqual([]);
  expect(
    afterNewest.sources
      .filter(
        (source) =>
          source.source === "direct_messages" ||
          source.source === "managed_agent_messages",
      )
      .map((source) => source.availability),
  ).toEqual(["empty", "empty"]);
});
