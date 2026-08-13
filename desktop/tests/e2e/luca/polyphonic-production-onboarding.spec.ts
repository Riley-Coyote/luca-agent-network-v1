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
  await expect(page.getByRole("heading", { name: "Luca" })).toBeVisible();
  await expect(page.getByText("Polyphonic", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Begin setup" }).click();
  await expect(page.getByTestId("polyphonic-onboarding")).toContainText("Luca");
  await expect(page.getByText("Polyphonic", { exact: true })).toHaveCount(0);
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).not.toContain("persist_current_identity");
}

async function expectFirstUsefulDestination(
  page: import("@playwright/test").Page,
) {
  await expect(page).toHaveURL(/\/messages\/new$/);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expect(page.getByTestId("new-message-page")).toBeVisible();
  await expect(page.getByTestId("new-message-to-field")).toBeVisible();
}

async function continueFromAgents(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Continue" }).click();
  const nativeReview = page.getByText(
    "Press Continue again to approve these exact changes.",
  );
  if (await nativeReview.isVisible()) {
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Connect your work" }),
  ).toBeFocused();
}

test("clean onboarding resumes, completes fail-soft, and returns to a useful destination", async ({
  context,
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
  await continueFromAgents(page);

  await expect(
    page.getByRole("heading", { name: "Connect your work" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Luca is ready" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Start a conversation" }).click();
  await expectFirstUsefulDestination(page);

  const returning = await context.newPage();
  await installFresh(returning);
  await returning.goto("/?e2e=mock");
  await expect(returning.getByTestId("polyphonic-onboarding")).toHaveCount(0);
  await expectFirstUsefulDestination(returning);
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
  await expect(page.getByText("Finish setting up Luca")).toBeVisible();
  await page.getByTestId("profile-identity-toggle").click();
  await page.getByTestId("profile-protected-backup-toggle").click();
  await expect(
    page.getByText(
      "Choose a unique passphrase. Luca never displays or copies the private key.",
    ),
  ).toBeVisible();
  await expect(page.getByText(/Polyphonic never displays/)).toHaveCount(0);
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

  await continueFromAgents(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connect your work" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Luca is ready" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Start a conversation" }).click();
  await expectFirstUsefulDestination(page);
});

test("no agents and no selected sources remain valid", async ({ page }) => {
  await installFresh(page);
  await page.goto("/?e2e=mock#/?brainConnections=empty");
  await beginFreshSetup(page);
  await page.getByLabel("Display name").fill("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("No agents found yet.")).toBeVisible();
  await continueFromAgents(page);

  for (const label of ["Repositories", "Codex", "Claude Code"]) {
    const category = page.getByRole("button", { name: new RegExp(label) });
    await expect(category).toHaveAttribute("aria-pressed", "true");
    await category.click();
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Luca is ready" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Start a conversation" }).click();
  await expectFirstUsefulDestination(page);
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
  await continueFromAgents(page);

  await page.getByRole("button", { name: "Add file…" }).click();
  await expect(
    page.getByRole("button", { name: "Import selected source" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import selected source" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("brain-consent-dialog")).toBeVisible();
  await page.getByRole("button", { name: "Connect for all residents" }).click();
  await expect(
    page.getByRole("heading", { name: "Luca is ready" }),
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
  await continueFromAgents(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Connect for all residents" }).click();
  await expect(
    page.getByRole("heading", { name: "Luca is ready" }),
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
  ).toHaveLength(2);
  expect(commands).toContain("connect_connected_brain_source");
});

test("native discovery failure remains visible in final readiness", async ({
  page,
}) => {
  await installFresh(page, {
    nativeResidentDiscoveryError: "Native resident discovery unavailable",
  });
  await page.goto("/?e2e=mock#/?brainConnections=empty");
  await beginFreshSetup(page);
  await page.getByLabel("Display name").fill("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText("Native resident discovery unavailable"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan again" })).toBeVisible();
  await continueFromAgents(page);

  for (const label of ["Repositories", "Codex", "Claude Code"]) {
    const category = page.getByRole("button", { name: new RegExp(label) });
    await expect(category).toHaveAttribute("aria-pressed", "true");
    await category.click();
  }
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Luca is ready" }),
  ).toBeFocused();
  await expect(page.getByText("1 item needs attention")).toBeVisible();
  await expect(page.getByText("Setup is complete")).toHaveCount(0);
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

test("compact reduced-motion onboarding keeps semantics and controls reachable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installFresh(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?e2e=mock&machineOnboarding=1");

  const beginSetup = page.getByRole("button", { name: "Begin setup" });
  await beginSetup.focus();
  await expect(beginSetup).toBeFocused();
  await page.keyboard.press("Enter");

  const onboarding = page.getByTestId("polyphonic-onboarding");
  const assistant = page.getByTestId("polyphonic-setup-assistant");
  const heading = page.getByRole("heading", { name: "Make it yours" });
  await expect(heading).toBeFocused();
  await expect(assistant).toHaveAttribute(
    "aria-labelledby",
    "polyphonic-you-heading",
  );
  await expect(
    onboarding.getByRole("status").filter({ hasText: "Step 2 of 5: You" }),
  ).toBeAttached();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole("button", { name: "Back", exact: true }),
  ).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Display name")).toBeFocused();
  await page.getByLabel("Display name").fill("Riley");
  const continueButton = page.getByRole("button", { name: "Continue" });
  await continueButton.scrollIntoViewIfNeeded();
  await expect(continueButton).toBeVisible();
  await continueButton.focus();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Bring your agents together" }),
  ).toBeFocused();
  await expect(
    onboarding
      .getByRole("status")
      .filter({ hasText: "Step 3 of 5: Your agents" }),
  ).toBeAttached();
  expect(
    await page
      .locator(".polyphonic-onboarding-main")
      .evaluate(
        (element) =>
          element
            .getAnimations()
            .filter((animation) => animation.playState !== "finished").length,
      ),
  ).toBe(0);
});
