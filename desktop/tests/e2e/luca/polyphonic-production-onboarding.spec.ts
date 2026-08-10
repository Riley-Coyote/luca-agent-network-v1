import { hexToBytes } from "@noble/hashes/utils.js";
import { expect, test } from "@playwright/test";
import { nsecEncode } from "nostr-tools/nip19";

import type { NativeResidentDiscoveryOutcome } from "../../../src/shared/api/types";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

async function installFresh(
  page: import("@playwright/test").Page,
  mock?: Parameters<typeof installMockBridge>[1],
) {
  await installMockBridge(page, mock, {
    skipCommunitySeed: true,
    skipOnboardingSeed: true,
  });
}

const nativeResidents: NativeResidentDiscoveryOutcome = {
  runtimes: [
    {
      nativeType: "hermes",
      status: "available",
      candidates: [
        {
          nativeType: "hermes",
          nativeId: "default",
          semanticId: "hermes:default",
          bindingFingerprint: "sha256:hermes",
          displayName: "Hermes",
          readiness: { status: "ready" },
          warnings: [],
          bindingPreview: {
            kind: "hermes",
            schemaVersion: 1,
            profileName: "default",
            hermesHome: "fixture-hermes-home",
            executablePath: "hermes",
            runtimeVersion: "1.0.0",
          },
        },
      ],
    },
    {
      nativeType: "openclaw",
      status: "available",
      candidates: [
        {
          nativeType: "openclaw",
          nativeId: "main",
          semanticId: "openclaw:main",
          bindingFingerprint: "sha256:openclaw",
          displayName: "OpenClaw",
          readiness: { status: "ready" },
          warnings: [],
          bindingPreview: {
            kind: "openclaw",
            schemaVersion: 1,
            agentId: "main",
            executablePath: "openclaw",
            runtimeVersion: "1.0.0",
            gatewayIdentity: "fixture-gateway",
            gatewayUrlRef: {
              provider: "native_store",
              locator: "fixture-url",
            },
          },
        },
      ],
    },
  ],
};

async function beginFreshSetup(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { name: "Polyphonic" })).toBeVisible();
  await page.getByRole("button", { name: "Begin setup" }).click();
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).not.toContain("persist_current_identity");
}

test("production onboarding resumes, navigates back, and completes fail-soft", async ({
  page,
}) => {
  await installFresh(page);
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await beginFreshSetup(page);
  await expect(
    page.getByRole("heading", { name: "Make it yours" }),
  ).toBeFocused();
  await expect(page.getByText("Step 2 of 5", { exact: true })).toBeVisible();

  await page.getByLabel("Display name").fill("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Bring your agents together" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Display name")).toHaveValue("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: "Connect your work" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Everything is in its place" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Enter Polyphonic" }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("onboarding keeps its primary action reachable at 800 by 500", async ({
  page,
}) => {
  await installFresh(page);
  await page.setViewportSize({ width: 800, height: 500 });
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await beginFreshSetup(page);
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeVisible();
  const box = await continueButton.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 500) + (box?.height ?? 0)).toBeLessThanOrEqual(500);
  await expect(page.locator("html")).not.toHaveCSS("overflow-x", "scroll");
});

test("an existing owner identity enters the same production journey", async ({
  page,
}) => {
  await installFresh(page);
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await page.getByRole("button", { name: "Use an existing identity…" }).click();
  const nsec = nsecEncode(hexToBytes(TEST_IDENTITIES.alice.privateKey));
  await page.getByLabel("Private key").fill(nsec);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByRole("heading", { name: "Make it yours" }),
  ).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.__BUZZ_E2E_COMMANDS__ ?? []))
    .toContain("import_identity");
});

test("set up later lasts only for the current app session", async ({
  context,
  page,
}) => {
  await installFresh(page);
  await page.goto("/?e2e=mock");
  await page.getByRole("button", { name: "Set up later" }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  const relaunched = await context.newPage();
  await installFresh(relaunched);
  await relaunched.goto("/?e2e=mock");
  await expect(
    relaunched.getByRole("heading", { name: "Make it yours" }),
  ).toBeFocused();
});

test("Settings can reopen an incomplete journey", async ({ page }) => {
  await installFresh(page);
  await page.goto("/?e2e=mock");
  await page.getByRole("button", { name: "Set up later" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Finish setting up Polyphonic")).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Make it yours" }),
  ).toBeFocused();
});

test("a failed profile publication retries once on the next launch", async ({
  context,
  page,
}) => {
  await installFresh(page, { profileUpdateError: "relay unavailable" });
  await page.goto("/?e2e=mock");
  await beginFreshSetup(page);
  await page.getByLabel("Display name").fill("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.close();

  const relaunched = await context.newPage();
  await installFresh(relaunched);
  await relaunched.goto("/?e2e=mock");
  await expect(
    relaunched.getByRole("heading", { name: "Bring your agents together" }),
  ).toBeFocused();
  await expect
    .poll(() =>
      relaunched.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMANDS__ ?? []).filter(
            (command) => command === "update_profile",
          ).length,
      ),
    )
    .toBe(1);
  const pendingDrafts = await relaunched.evaluate(() =>
    Object.keys(localStorage).filter((key) =>
      key.startsWith("polyphonic-pending-profile.v1:"),
    ),
  );
  expect(pendingDrafts).toEqual([]);
});

test("the last safe chapter survives a relaunch", async ({ page }) => {
  await installFresh(page);
  await page.goto("/?e2e=mock");
  await beginFreshSetup(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Make it yours" }),
  ).toBeFocused();

  await page.getByLabel("Display name").fill("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Bring your agents together" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connect your work" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Everything is in its place" }),
  ).toBeFocused();
});

test("no agents and no selected sources remain valid", async ({ page }) => {
  await installFresh(page);
  await page.goto("/?e2e=mock#/?brainConnections=empty");
  await beginFreshSetup(page);
  await page.getByLabel("Display name").fill("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("No agents found yet.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  for (const label of ["Repositories", "Codex", "Claude Code"]) {
    const category = page.getByRole("button", { name: new RegExp(label) });
    await expect(category).toHaveAttribute("aria-pressed", "true");
    await category.click();
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Everything is in its place" }),
  ).toBeFocused();
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).not.toContain("connect_connected_brain_source");
});

test("Brain preview requires confirmation and first connection requires consent", async ({
  page,
}) => {
  await installFresh(page);
  await page.goto("/?e2e=mock#/?brainConnections=empty");
  await beginFreshSetup(page);
  await page.getByLabel("Display name").fill("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Add file…" }).click();
  await expect(
    page.getByRole("button", { name: "Import selected source" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import selected source" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("brain-consent-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Connect for all residents" }).click();
  await expect(
    page.getByRole("heading", { name: "Everything is in its place" }),
  ).toBeFocused();
  await expect(page.getByText("3 source groups connected")).toBeVisible();

  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).toContain("pick_and_preview_owner_brain_source");
  expect(commands).toContain("commit_owner_brain_import");
  expect(commands).toContain("connect_connected_brain_source");
});

test("partial resident and Brain failures are body-free, reviewable outcomes", async ({
  page,
}) => {
  await installFresh(page, {
    nativeResidentDiscovery: nativeResidents,
    createManagedAgentErrors: ["Hermes import failed", null],
    connectedBrainConnectErrors: ["Brain connection failed"],
  });
  await page.goto("/?e2e=mock#/?brainConnections=empty");
  await beginFreshSetup(page);
  await page.getByLabel("Display name").fill("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("button", { name: /^Hermes Hermes/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^OpenClaw OpenClaw/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Connect for all residents" }).click();
  await expect(
    page.getByRole("heading", { name: "Everything is in its place" }),
  ).toBeFocused();
  await expect(page.getByText("2 items need attention")).toBeVisible();

  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(
    commands.filter((command) => command === "create_luca_resident"),
  ).toHaveLength(2);
  expect(
    commands.filter((command) => command === "set_resident_continuity_enabled"),
  ).toHaveLength(1);
  expect(commands).toContain("connect_connected_brain_source");
});

test("keyboard focus and 200 percent text remain navigable", async ({
  page,
}) => {
  await installFresh(page);
  await page.setViewportSize({ width: 800, height: 500 });
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await page.getByRole("button", { name: "Begin setup" }).press("Enter");
  await page.locator("html").evaluate((element) => {
    element.style.fontSize = "200%";
  });
  const continueButton = page.getByRole("button", { name: "Continue" });
  await continueButton.scrollIntoViewIfNeeded();
  await expect(continueButton).toBeVisible();
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole("heading", { name: "Make it yours" }),
  ).toBeFocused();
});
