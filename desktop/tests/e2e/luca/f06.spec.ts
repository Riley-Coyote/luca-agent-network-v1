import { expect, test } from "@playwright/test";
import { hexToBytes } from "@noble/hashes/utils.js";
import { nsecEncode } from "nostr-tools/nip19";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { seedActiveIdentity } from "../../helpers/onboarding";

test.use({ viewport: { width: 900, height: 700 } });

const READY_CODEX_RUNTIME = {
  id: "codex",
  label: "Codex",
  avatar_url: "",
  availability: "available",
  command: "codex",
  binary_path: "/synthetic/bin/codex",
  default_args: [],
  mcp_command: null,
  install_hint: "Install Codex",
  install_instructions_url: "https://example.invalid/codex",
  can_auto_install: false,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "logged_in" },
  login_hint: "Sign in to Codex",
};

test("F06: single-owner setup protects key material and makes recovery limits explicit", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await installMockBridge(
    page,
    { acpRuntimesCatalog: [READY_CODEX_RUNTIME] },
    {
      skipCommunitySeed: true,
      skipOnboardingSeed: true,
    },
  );
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: "Create owner identity" }),
  ).toBeVisible();
  await expect(page.getByTestId("luca-owner-mark")).toBeVisible();
  await expect(page.getByTestId("luca-owner-atmosphere")).toBeVisible();
  await expect(page.getByText("A personal home for the agents")).toBeVisible();
  await expect(page.locator("svg")).toHaveCount(0);
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
  await expect(page.getByTestId("onboarding-finish")).toBeEnabled();

  const commandCountBeforeFinish = await page.evaluate(
    () =>
      (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__?.length ?? 0,
  );
  await page.getByTestId("onboarding-finish").click();

  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("onboarding-page-1")).toHaveCount(0);
  await expect(page.getByTestId("machine-onboarding-gate")).toHaveCount(0);
  await expect(page.getByTestId("community-onboarding-flow")).toHaveCount(0);
  await expect(page.getByTestId("pending-invite-gate")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem("buzz-communities");
        return raw ? JSON.parse(raw) : [];
      }),
    )
    .toEqual([
      expect.objectContaining({
        id: "luca-personal-home",
        name: "Luca",
      }),
    ]);

  const starterInitializationCalls = await page.evaluate((commandCount) => {
    const commands =
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_LOG__?: Array<{
            command: string;
            payload: unknown;
          }>;
        }
      ).__BUZZ_E2E_COMMAND_LOG__?.slice(commandCount) ?? [];
    return commands.filter(
      ({ command }) =>
        command === "ensure_starter_channels" || command === "create_channel",
    );
  }, commandCountBeforeFinish);
  expect(starterInitializationCalls).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("F06: upgraded owner with only the machine marker discards first-community state", async ({
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
          id: "f06-first-owner-connect",
          source: "first-community",
          stage: "connecting",
          relayUrl: "wss://default.example.com",
          communityName: "Default",
          communityId: "not-yet-applied",
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

  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("community-onboarding-flow")).toHaveCount(0);
});

test("F06: machine completion clears first-community state created in the same session", async ({
  page,
}) => {
  await installMockBridge(
    page,
    { acpRuntimesCatalog: [READY_CODEX_RUNTIME] },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");

  await page.evaluate(() => {
    const timestamp = new Date().toISOString();
    window.localStorage.setItem(
      "buzz-community-onboarding-transaction.v1",
      JSON.stringify({
        id: "f06-same-session-first-community",
        source: "first-community",
        stage: "profile",
        relayUrl: "wss://default.example.com",
        communityName: "Default",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
  });

  await page.getByRole("button", { name: "Create owner identity" }).click();
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-setup-next").click();
  await expect(page.getByTestId("onboarding-finish")).toBeEnabled();
  await page.getByTestId("onboarding-finish").click();

  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("community-onboarding-flow")).toHaveCount(0);
  await expect(page.getByTestId("onboarding-page-1")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("buzz-community-onboarding-transaction.v1"),
      ),
    )
    .toBeNull();
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

test("F06: lost owner recovery remains Luca-owned", async ({ page }) => {
  await installMockBridge(
    page,
    { identityLost: true },
    { skipOnboardingSeed: true },
  );
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Re-import your key" }),
  ).toBeVisible();
  await expect(page.getByText(/Buzz/)).toHaveCount(0);
  await expect(
    page.locator('[data-testid="machine-onboarding-gate"] svg'),
  ).toHaveCount(0);

  const importedNsec = nsecEncode(hexToBytes(TEST_IDENTITIES.alice.privateKey));
  await page.getByTestId("nostr-import-nsec-input").fill(importedNsec);
  await page.getByTestId("nostr-import-submit").click();
  await expect(page.getByTestId("relaunch-required")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Relaunch Luca" }),
  ).toBeVisible();
  await expect(page.getByText(/Buzz/)).toHaveCount(0);
});

test("F06: locked owner recovery remains Luca-owned", async ({ page }) => {
  await installMockBridge(
    page,
    { identityLocked: true },
    { skipOnboardingSeed: true },
  );
  await page.goto("/");

  await expect(page.getByTestId("keyring-locked")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Relaunch Luca" }),
  ).toBeVisible();
  await expect(page.getByText(/Buzz/)).toHaveCount(0);
  await expect(page.getByTestId("keyring-locked").locator("svg")).toHaveCount(
    0,
  );
});
