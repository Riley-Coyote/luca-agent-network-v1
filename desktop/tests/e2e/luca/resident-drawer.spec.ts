import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

/**
 * The right drawer of a direct conversation with a resident is the resident:
 * their mark and state, an authorized model control, the first lines of
 * their instructions, their last handoff, and a way to their page. A DM with
 * a person keeps the conversation view.
 */

const RESIDENT = TEST_IDENTITIES.alice.pubkey;

test("a resident DM's drawer is the resident, and opens their page", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["alice-tyler"],
        name: "alice",
        pubkey: RESIDENT,
        status: "running",
      },
    ],
    searchProfiles: [{ displayName: "alice", isAgent: true, pubkey: RESIDENT }],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await expect(page.getByTestId("chat-title")).toHaveText("alice-tyler");
  await page.getByRole("button", { name: "Open conversation details" }).click();

  const drawer = page.getByTestId("resident-drawer");
  await expect(drawer).toBeVisible();
  await expect(page.getByTestId("resident-drawer-state")).toContainText(
    "Ready",
  );
  await expect(page.getByTestId("resident-drawer-model-trigger")).toBeVisible();
  await expect(
    page.getByTestId("resident-drawer-runtime-metadata"),
  ).toHaveCount(0);
  await expect(page.getByTestId("resident-drawer-handoff")).toBeVisible();

  await page.getByTestId("resident-drawer-open-agent").click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toMatch(/#\/agents\?/);
});

test("a DM with a person keeps the conversation view", async ({ page }) => {
  await installMockBridge(page);
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-bob-tyler").click();
  await expect(page.getByTestId("chat-title")).toHaveText("bob-tyler");
  await page.getByRole("button", { name: "Open conversation details" }).click();
  await expect(page.getByTestId("conversation-context-panel")).toBeVisible();
  await expect(page.getByTestId("resident-drawer")).toHaveCount(0);
  await expect(page.getByTestId("conversation-context-panel")).toContainText(
    "At a glance",
  );
});

test("an active guest visit can be ended without changing the DM", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["bob-tyler"],
        name: "alice",
        pubkey: RESIDENT,
        status: "running",
      },
    ],
    searchProfiles: [{ displayName: "alice", isAgent: true, pubkey: RESIDENT }],
  });
  await page.goto("/?e2e=mock");
  const dm = page.getByTestId("channel-bob-tyler");
  const dmId = await dm.getAttribute("data-channel-id");
  expect(dmId).toBeTruthy();
  await dm.click();

  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "bob-tyler",
            kind: 40099,
          }),
        ),
      ),
    )
    .toBe(true);

  await page.evaluate((resident) => {
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "bob-tyler",
      content: JSON.stringify({
        type: "visit_arrived",
        resident,
        exchange_id: "b".repeat(64),
        text: "alice is visiting.",
      }),
      kind: 40099,
    });
  }, RESIDENT);
  await expect(page.getByText("alice stepped in")).toBeVisible();

  await page.getByRole("button", { name: "Open conversation details" }).click();
  const endVisit = page.getByTestId(`end-visit-${RESIDENT}`);
  await expect(endVisit).toBeVisible();
  await endVisit.click();

  const command = await page.evaluate(() =>
    window.__BUZZ_E2E_COMMAND_LOG__?.find(
      (entry) => entry.command === "end_resident_visit",
    ),
  );
  expect(command?.payload).toEqual({ channelId: dmId, pubkey: RESIDENT });
  await expect(
    page.locator("[data-active='true'][data-channel-id]"),
  ).toHaveAttribute("data-channel-id", dmId ?? "");
});
