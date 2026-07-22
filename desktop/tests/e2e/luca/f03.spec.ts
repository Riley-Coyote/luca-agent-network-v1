import { expect, test } from "@playwright/test";

import {
  LUCA_FEATURE_FLAGS,
  isLucaFeatureEnabled,
} from "../../../src/app/lucaFeatureFlags";
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
  ] as const) {
    expect(isLucaFeatureEnabled(feature)).toBe(false);
    expect(LUCA_FEATURE_FLAGS[feature].status).toBe("deferred");
  }
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
