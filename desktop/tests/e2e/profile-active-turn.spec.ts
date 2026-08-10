import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Charlie is a `bot` member of #agents and authors the seeded "Indexing the
// channel catalog now." message (see e2eBridge.ts). Seeding a managed agent
// with this same pubkey makes the message author open a managed-agent profile
// panel — the surface that renders the active-turn badges.
const AGENT_PUBKEY =
  "554cef57437abac34522ac2c9f0490d685b72c80478cf9f7ed6f9570ee8624ea";

// Channel IDs the seeded turns point at. The badge labels resolve these to
// #general / #engineering via the channels query.
const CHANNEL_GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const CHANNEL_ENGINEERING = "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9";

function seedAgent() {
  return {
    managedAgents: [
      {
        pubkey: AGENT_PUBKEY,
        name: "Charlie",
        status: "running" as const,
        channelNames: ["agents"],
      },
    ],
  };
}

async function waitForBridge(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () =>
      typeof (window as Window & { __BUZZ_E2E_SEED_ACTIVE_TURNS__?: unknown })
        .__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
    null,
    { timeout: 10_000 },
  );
}

async function openAgentsChannel(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForBridge(page);
  await page.getByTestId("channel-agents").click();
  await expect(page.getByTestId("chat-title")).toHaveText("agents");
}

async function seedActiveTurns(
  page: import("@playwright/test").Page,
  turns: { channelId: string; turnId: string }[],
) {
  await page.evaluate(
    ({ pubkey, seeds }) => {
      const win = window as Window & {
        __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (input: {
          agentPubkey: string;
          channelId: string;
          turnId: string;
        }) => void;
      };
      for (const { channelId, turnId } of seeds) {
        win.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
          agentPubkey: pubkey,
          channelId,
          turnId,
        });
      }
    },
    { pubkey: AGENT_PUBKEY, seeds: turns },
  );
}

// The avatar-free transcript keeps the author name as the profile trigger.
function agentAuthor(page: import("@playwright/test").Page) {
  return page
    .getByTestId("message-row")
    .filter({
      has: page.getByTestId("message-author").filter({ hasText: "Charlie" }),
    })
    .last()
    .getByTestId("message-author");
}

async function openAgentProfilePanel(page: import("@playwright/test").Page) {
  await agentAuthor(page).hover();
  const popover = page.getByTestId("user-profile-popover");
  await expect(popover).toBeVisible({ timeout: 5_000 });
  await popover.getByRole("button").first().click();
  return page
    .getByRole("complementary")
    .filter({ has: page.getByTestId("user-profile-panel") });
}

test.describe("profile active turn indicator", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("01 — author profile: agent working in one channel", async ({
    page,
  }) => {
    await installMockBridge(page, seedAgent());
    await openAgentsChannel(page);
    await seedActiveTurns(page, [
      { channelId: CHANNEL_GENERAL, turnId: "turn-101" },
    ]);

    await agentAuthor(page).hover();
    const popover = page.getByTestId("user-profile-popover");
    await expect(popover).toContainText("Working in #general");
    const panel = await openAgentProfilePanel(page);
    await expect(panel).toBeVisible();
  });

  test("02 — author profile: agent working in two channels", async ({
    page,
  }) => {
    await installMockBridge(page, seedAgent());
    await openAgentsChannel(page);
    await seedActiveTurns(page, [
      { channelId: CHANNEL_GENERAL, turnId: "turn-201" },
      { channelId: CHANNEL_ENGINEERING, turnId: "turn-202" },
    ]);

    await agentAuthor(page).hover();
    const popover = page.getByTestId("user-profile-popover");
    await expect(popover).toContainText("Working in #general");
    await expect(popover).toContainText("Working in #engineering");
    const panel = await openAgentProfilePanel(page);
    await expect(panel).toBeVisible();
  });

  test("03 — hover popover: agent working", async ({ page }) => {
    await installMockBridge(page, seedAgent());
    await openAgentsChannel(page);
    await seedActiveTurns(page, [
      { channelId: CHANNEL_GENERAL, turnId: "turn-301" },
    ]);

    await agentAuthor(page).hover();

    const popover = page.getByTestId("user-profile-popover");
    await expect(popover).toBeVisible({ timeout: 5_000 });
    await expect(popover).toContainText("Working in #general");
  });
});
