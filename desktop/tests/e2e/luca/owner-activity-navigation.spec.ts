import { expect, test, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const RESIDENTS = [
  {
    channelNames: ["general"],
    name: "Anima",
    pubkey: TEST_IDENTITIES.bob.pubkey,
    status: "stopped" as const,
  },
  {
    channelNames: ["general"],
    name: "Vektor",
    pubkey: TEST_IDENTITIES.alice.pubkey,
    status: "running" as const,
  },
] as const;

async function openActivity(page: Page) {
  await installMockBridge(page, { managedAgents: [...RESIDENTS] });
  await page.goto("/?e2e=mock");
  await page.getByTestId("open-activity-view").click();
  await expect(page).toHaveURL(/\/pulse$/);
  await expect(page.getByTestId("owner-activity-view")).toBeVisible();
}

test("Activity shows deterministic truthful resident state without legacy Pulse records", async ({
  page,
}) => {
  await openActivity(page);

  const list = page.getByTestId("owner-activity-list");
  await expect(list).toBeVisible();
  const anima = page.getByTestId(
    `owner-activity-resident-${TEST_IDENTITIES.bob.pubkey}`,
  );
  const vektor = page.getByTestId(
    `owner-activity-resident-${TEST_IDENTITIES.alice.pubkey}`,
  );
  await expect(anima).toContainText("Anima");
  await expect(vektor).toContainText("Vektor");
  await expect
    .poll(() =>
      page.evaluate(
        ([animaId, vektorId]) => {
          const cards = [
            ...document.querySelectorAll(
              "[data-testid^='owner-activity-resident-']",
            ),
          ];
          return (
            cards.findIndex(
              (card) => card.getAttribute("data-testid") === animaId,
            ) <
            cards.findIndex(
              (card) => card.getAttribute("data-testid") === vektorId,
            )
          );
        },
        [
          `owner-activity-resident-${TEST_IDENTITIES.bob.pubkey}`,
          `owner-activity-resident-${TEST_IDENTITIES.alice.pubkey}`,
        ],
      ),
    )
    .toBe(true);
  await expect(list).toContainText("Runtime stopped");
  await expect(list).toContainText("Runtime ready");
  await expect(page.getByText("Everyone", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Liked", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /post/i })).toHaveCount(0);
});

test("Activity projects working and completed or failed resident updates without bodies", async ({
  page,
}) => {
  await openActivity(page);
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
  await page.evaluate(
    ({ channelId, pubkey }) => {
      window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey: pubkey,
        channelId,
        turnId: "activity-turn",
      });
      window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey: pubkey,
        channelId,
        turnId: "activity-turn",
        kind: "acp_read",
        payload: {
          method: "session/update",
          params: {
            update: {
              kind: "search",
              sessionUpdate: "tool_call",
              toolCallId: "activity-tool",
              title: "Sensitive owner query must not appear",
            },
          },
        },
      });
    },
    { channelId: CHANNEL_ID, pubkey: TEST_IDENTITIES.alice.pubkey },
  );

  const resident = page.getByTestId(
    `owner-activity-resident-${TEST_IDENTITIES.alice.pubkey}`,
  );
  await expect(resident).toHaveAttribute("data-activity-state", "working");
  await expect(resident).toContainText("Working now");
  await expect(resident).not.toContainText("Sensitive owner query");

  await page.evaluate(
    ({ channelId, pubkey }) => {
      window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey: pubkey,
        channelId,
        turnId: "activity-turn",
        kind: "acp_read",
        payload: {
          method: "session/update",
          params: {
            update: {
              kind: "search",
              sessionUpdate: "tool_call_update",
              status: "completed",
              toolCallId: "activity-tool",
            },
          },
        },
      });
      window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey: pubkey,
        channelId,
        turnId: "activity-turn",
        kind: "turn_completed",
      });
    },
    { channelId: CHANNEL_ID, pubkey: TEST_IDENTITIES.alice.pubkey },
  );
  await expect(resident).toHaveAttribute("data-activity-state", "success");
  await expect(resident).toContainText("Action completed");
});

test("Activity survives reload and opens the existing protected activity destination", async ({
  page,
}) => {
  await openActivity(page);
  await page.reload();
  await expect(page.getByTestId("owner-activity-view")).toBeVisible();
  await expect(
    page.getByTestId(`owner-activity-resident-${TEST_IDENTITIES.bob.pubkey}`),
  ).toContainText("Anima");
  await expect(
    page.getByTestId(`owner-activity-resident-${TEST_IDENTITIES.alice.pubkey}`),
  ).toContainText("Vektor");

  const resident = page.getByTestId(
    `owner-activity-resident-${TEST_IDENTITIES.alice.pubkey}`,
  );
  await resident.getByRole("button", { name: "Open activity" }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/channels/${CHANNEL_ID}\\?agentSession=${TEST_IDENTITIES.alice.pubkey}`,
    ),
  );
  const activityPanel = page.getByRole("complementary");
  await expect(activityPanel).toBeVisible();
  await expect(activityPanel).toHaveAttribute(
    "data-testid",
    "agent-session-thread-panel",
  );
});
