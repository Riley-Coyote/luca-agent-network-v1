import { expect, test } from "@playwright/test";

import {
  LUCA_FEATURE_FLAGS,
  isLucaFeatureEnabled,
} from "../../../src/app/lucaFeatureFlags";
import {
  PERSONAL_HOME_TENANCY_ID,
  PERSONAL_HOME_TENANCY_NAME,
  createPersonalHomeTenancy,
} from "../../../src/app/personalHomeTenancy";
import { installMockBridge } from "../../helpers/bridge";

test("Luca defaults retain the conversation plane and defer out-of-scope Buzz surfaces", () => {
  for (const feature of [
    "coreChat",
    "rooms",
    "threads",
    "attachments",
    "search",
    "agents",
  ] as const) {
    expect(isLucaFeatureEnabled(feature)).toBe(true);
    expect(LUCA_FEATURE_FLAGS[feature].status).toBe("retained");
  }

  for (const feature of [
    "brainDashboard",
    "atlas",
    "inbox",
    "browserObservation",
    "workflows",
    "schedules",
    "forgeGit",
    "huddlesVoice",
    "sharedCanvas",
    "whiteboard",
    "invitedHumans",
    "organizations",
    "externalCommunityConnections",
  ] as const) {
    expect(isLucaFeatureEnabled(feature)).toBe(false);
    expect(LUCA_FEATURE_FLAGS[feature].status).toBe("deferred");
  }
});

test("personal home tenancy is Luca-owned and deterministic", () => {
  const tenancy = createPersonalHomeTenancy(
    "ws://localhost:3000",
    "owner-pubkey",
    new Date("2026-07-31T00:00:00.000Z"),
  );

  expect(tenancy).toEqual({
    id: PERSONAL_HOME_TENANCY_ID,
    name: PERSONAL_HOME_TENANCY_NAME,
    relayUrl: "ws://localhost:3000",
    pubkey: "owner-pubkey",
    addedAt: "2026-07-31T00:00:00.000Z",
  });
});

test("clean Luca start provisions the internal personal home without community setup", async ({
  page,
}) => {
  await installMockBridge(page, undefined, { skipCommunitySeed: true });
  await page.goto("/");

  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(
    page.getByTestId("personal-home-provisioning-error"),
  ).toHaveCount(0);
  await expect(
    page.getByText(/join a community|create a community/i),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("buzz-communities");
        return raw ? JSON.parse(raw) : [];
      }),
    )
    .toEqual([
      expect.objectContaining({
        id: PERSONAL_HOME_TENANCY_ID,
        name: PERSONAL_HOME_TENANCY_NAME,
      }),
    ]);
});

test("Luca defaults preserve the Buzz chat surface", async ({ page }) => {
  await installMockBridge(page);
  await page.goto("/");

  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await page.getByTestId("message-input").fill("F03 retained chat check");
  await expect(page.getByTestId("send-message")).toBeEnabled();
});
