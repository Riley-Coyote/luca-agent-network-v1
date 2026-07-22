import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { seedActiveIdentity } from "../../helpers/onboarding";

test.use({ viewport: { width: 900, height: 700 } });

test("F06: single-owner setup protects key material and makes recovery limits explicit", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await installMockBridge(page, undefined, {
    skipCommunitySeed: true,
    skipOnboardingSeed: true,
  });
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: "Create owner identity" }),
  ).toBeVisible();
  await expect(page.getByTestId("luca-owner-mark")).toBeVisible();
  await expect(page.getByText("A personal home for the agents")).toBeVisible();
  await expect(
    page.locator('img[src="/landing/buzz-wordmark.png"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Create owner identity" }).click();

  const disclosure = page.getByTestId("onboarding-recovery-disclosure");
  await expect(disclosure).toBeVisible();
  await expect(page.getByTestId("onboarding-page-backup")).toContainText(
    "cryptographic identity",
  );
  await expect(page.getByTestId("onboarding-page-backup")).toContainText(
    "never shown or copied during setup",
  );
  await expect(disclosure).toContainText(
    "Protected recovery is not available yet",
  );
  await expect(
    page.getByTestId("onboarding-protected-export-unavailable"),
  ).toBeDisabled();
  await expect(page.getByTestId("nsec-value")).toHaveCount(0);
  await expect(page.getByTestId("nsec-copy")).toHaveCount(0);
  await expect(page.getByTestId("nsec-reveal-toggle")).toHaveCount(0);

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
  expect(consoleErrors).toEqual([]);

  await page.getByTestId("onboarding-next").click();
  await expect(page.getByTestId("onboarding-page-2")).toBeVisible();
  await expect(page.getByTestId("onboarding-logo")).toHaveAttribute(
    "data-brand",
    "luca",
  );
  await page.getByTestId("onboarding-setup-next").click();
  await expect(page.getByTestId("onboarding-page-config")).toBeVisible();
  await expect(
    page.getByText(
      "Your owner identity stays the same when you replace the runtime",
    ),
  ).toBeVisible();
});

test("F06: first owner connects a personal home without starter-team initialization", async ({
  page,
}) => {
  const blankOwner = { ...TEST_IDENTITIES.alice, username: "" };
  await seedActiveIdentity(page, blankOwner);
  await page.addInitScript(
    ({ pubkey }) => {
      window.localStorage.setItem(
        `buzz-machine-onboarding-complete.v2:${pubkey}`,
        "true",
      );
      const timestamp = new Date().toISOString();
      window.localStorage.setItem(
        "buzz-community-onboarding-transaction.v1",
        JSON.stringify({
          id: "f06-first-owner",
          source: "first-community",
          stage: "connecting",
          relayUrl: "wss://default.example.com",
          communityName: "Default",
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    },
    { pubkey: blankOwner.pubkey },
  );
  await installMockBridge(page, undefined, {
    skipCommunitySeed: true,
    skipOnboardingSeed: true,
  });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Connecting your personal home" }),
  ).toBeVisible();
  await expect(page.getByText("Connecting Luca securely…")).toBeVisible();
  await expect(
    page.getByText(/Joining |community|starter team|Buzz/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Set up your owner profile" }),
  ).toBeVisible();
  await expect(page.getByTestId("onboarding-logo")).toHaveAttribute(
    "data-brand",
    "luca",
  );
  await expect(
    page.getByText(/Joining |Meet your starter team|workspace|Buzz/),
  ).toHaveCount(0);

  await page.getByLabel("Owner display name").fill("Riley");
  await page.getByTestId("community-profile-next").click();
  await expect(page.getByTestId("community-onboarding-flow")).toHaveCount(0);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        ({ pubkey, relayUrl }) =>
          window.localStorage.getItem(
            `luca-personal-owner-onboarding.v1:${encodeURIComponent(relayUrl)}:${pubkey}`,
          ),
        { pubkey: blankOwner.pubkey, relayUrl: "wss://default.example.com" },
      ),
    )
    .toBe("true");

  const forbiddenInitializationCalls = await page.evaluate(() => {
    const commands =
      (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__ ?? [];
    return commands.filter(
      (command) => command === "list_personas" || command === "create_channel",
    );
  });
  expect(forbiddenInitializationCalls).toEqual([]);
});

test("F06: existing identity input stays masked", async ({ page }) => {
  await installMockBridge(page, undefined, {
    skipCommunitySeed: true,
    skipOnboardingSeed: true,
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect an existing identity" })
    .click();

  const input = page.getByTestId("nostr-import-nsec-input");
  await expect(input).toHaveAttribute("type", "password");
  await expect(page.getByTestId("nostr-import-reveal-toggle")).toHaveCount(0);
});
