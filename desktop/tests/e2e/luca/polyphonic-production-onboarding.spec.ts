import { hexToBytes } from "@noble/hashes/utils.js";
import { expect, test } from "@playwright/test";
import { nsecEncode } from "nostr-tools/nip19";

import type { NativeResidentDiscoveryOutcome } from "../../../src/shared/api/types";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import {
  LARGE_DISCOVERY_READY_COUNT,
  LARGE_NATIVE_RESIDENT_DISCOVERY,
} from "./onboarding-agent-import-fixture";

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
  const primaryAction = page.getByTestId("polyphonic-setup-continue");
  await primaryAction.click();
  await approveNativeLucaReviewIfPresent(page, primaryAction);
  await expect(
    page.getByRole("heading", { name: "Connect your work" }),
  ).toBeFocused();
}

async function approveNativeLucaReviewIfPresent(
  page: import("@playwright/test").Page,
  primaryAction = page.getByTestId("polyphonic-setup-continue"),
) {
  const nativeReview = page.getByText(
    "Press Continue again to approve these exact changes.",
  );
  const needsApproval = await nativeReview
    .waitFor({ state: "visible", timeout: 1_500 })
    .then(() => true)
    .catch(() => false);
  if (needsApproval) {
    await primaryAction.click();
  }
}

async function reachAgentImportStep(
  page: import("@playwright/test").Page,
  viewport: { width: number; height: number },
  mock?: Parameters<typeof installMockBridge>[1],
) {
  await installFresh(page, mock);
  await page.setViewportSize(viewport);
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await beginFreshSetup(page);
  await page.getByLabel("Display name").fill("Riley");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Bring your agents together" }),
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

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 800, height: 500 },
]) {
  test(`large agent inventory stays contained at ${viewport.width} by ${viewport.height}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await reachAgentImportStep(page, viewport, {
      managedAgents: [
        {
          pubkey: "9".repeat(64),
          name: "Existing companion",
          status: "stopped",
        },
      ],
      nativeResidentDiscovery: LARGE_NATIVE_RESIDENT_DISCOVERY,
    });

    const assistant = page.getByTestId("polyphonic-setup-assistant");
    const primaryAction = page.getByTestId("polyphonic-setup-continue");
    const inventory = page.getByTestId("onboarding-agent-import-list");
    await expect(primaryAction).toHaveText("Continue");
    await expect(primaryAction).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^Luca Can help organize your Luca home/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: /^Hermes profile 01/ }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByText(/Already in Luca · Existing companion/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Existing companion/ }),
    ).toHaveCount(0);

    const assistantBox = await assistant.boundingBox();
    const primaryBox = await primaryAction.boundingBox();
    expect(assistantBox).not.toBeNull();
    expect(primaryBox).not.toBeNull();
    expect(assistantBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect(
      (assistantBox?.y ?? 0) + (assistantBox?.height ?? 0),
    ).toBeLessThanOrEqual(viewport.height);
    expect(
      (primaryBox?.y ?? 0) + (primaryBox?.height ?? 0),
    ).toBeLessThanOrEqual(viewport.height);

    await inventory.scrollIntoViewIfNeeded();
    await expect(inventory).toBeVisible();
    expect(
      await inventory.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await inventory.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    expect(
      await inventory.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
    await inventory.focus();
    await expect(inventory).toBeFocused();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });
}

test("agent inventory search, bulk selection, rescan, and Back keep selection intentional", async ({
  page,
}) => {
  await reachAgentImportStep(
    page,
    { width: 1440, height: 900 },
    {
      nativeResidentDiscovery: LARGE_NATIVE_RESIDENT_DISCOVERY,
    },
  );

  const primaryAction = page.getByTestId("polyphonic-setup-continue");
  const search = page.getByLabel("Search agents");
  await search.fill("profile 17");
  await expect(
    page.getByText("Hermes profile 17", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("OpenClaw agent 17", { exact: true }),
  ).toHaveCount(0);
  await search.fill("");

  const unavailable = page.getByRole("button", {
    name: /^Hermes unavailable/,
  });
  await expect(unavailable).toBeDisabled();
  await expect(
    page.getByText("This Hermes profile needs attention before import."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Select all ready" }).click();
  await expect(
    page.getByText(`${LARGE_DISCOVERY_READY_COUNT} selected`, { exact: true }),
  ).toBeVisible();
  await expect(primaryAction).toHaveText(
    `Import ${LARGE_DISCOVERY_READY_COUNT} and continue`,
  );
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await expect(primaryAction).toHaveText("Continue");

  await page.getByRole("button", { name: /^Hermes profile 01/ }).click();
  await expect(primaryAction).toHaveText("Import 1 and continue");
  await page.getByRole("button", { name: "Scan again" }).click();
  await expect(primaryAction).toHaveText("Import 1 and continue");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMANDS__ ?? []).filter(
            (command) => command === "discover_native_residents",
          ).length,
      ),
    )
    .toBe(2);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Bring your agents together" }),
  ).toBeFocused();
  await expect(primaryAction).toHaveText("Continue");
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Hermes profile 01/ }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(primaryAction).toHaveText("Continue");
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
});

test("imports selected agents without starting them or rescanning after each import", async ({
  page,
}) => {
  await reachAgentImportStep(
    page,
    { width: 1440, height: 900 },
    {
      createManagedAgentDelayMs: 120,
      nativeResidentDiscovery: LARGE_NATIVE_RESIDENT_DISCOVERY,
    },
  );

  for (const name of [
    "Hermes profile 01",
    "Hermes profile 02",
    "OpenClaw agent 01",
  ]) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  }
  const primaryAction = page.getByTestId("polyphonic-setup-continue");
  await expect(primaryAction).toHaveText("Import 3 and continue");
  await primaryAction.click();
  await approveNativeLucaReviewIfPresent(page, primaryAction);
  await expect(primaryAction).toHaveText(/Importing [1-3] of 3/);
  await expect(
    page.getByRole("heading", { name: "Connect your work" }),
  ).toBeFocused();

  const commandEvidence = await page.evaluate(() => ({
    commands: window.__BUZZ_E2E_COMMANDS__ ?? [],
    payloads: window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  }));
  const importedNames = new Set([
    "Hermes profile 01",
    "Hermes profile 02",
    "OpenClaw agent 01",
  ]);
  const importPayloads = commandEvidence.payloads
    .filter(
      (entry) =>
        entry.command === "create_luca_resident" &&
        importedNames.has(
          (
            entry.payload as {
              input?: { name?: string };
            }
          ).input?.name ?? "",
        ),
    )
    .map(
      (entry) =>
        (
          entry.payload as {
            input?: {
              name?: string;
              spawnAfterCreate?: boolean;
              startOnAppLaunch?: boolean;
            };
          }
        ).input,
    );
  expect(importPayloads).toHaveLength(3);
  for (const input of importPayloads) {
    expect(input).toMatchObject({
      spawnAfterCreate: false,
      startOnAppLaunch: false,
    });
  }
  expect(
    commandEvidence.commands.filter(
      (command) => command === "discover_native_residents",
    ),
  ).toHaveLength(1);
  expect(
    commandEvidence.commands.filter(
      (command) => command === "start_managed_agent",
    ),
  ).toHaveLength(0);

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Luca is ready" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Start a conversation" }).click();
  await expectFirstUsefulDestination(page);
  await page.getByTestId("channel-general").click();

  async function mentionImportedAgent(message: string) {
    const input = page.getByTestId("message-input");
    await input.fill(`${message} @Hermes pro`);
    const mention = page
      .getByTestId("mention-autocomplete")
      .locator("button", { hasText: "Hermes profile 01" });
    await expect(mention).toBeVisible();
    await mention.click();
    await page.getByTestId("send-message").click();
  }

  await mentionImportedAgent("First use");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMANDS__ ?? []).filter(
            (command) => command === "start_managed_agent",
          ).length,
      ),
    )
    .toBe(1);
  await mentionImportedAgent("Second use");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMANDS__ ?? []).filter(
            (command) => command === "start_managed_agent",
          ).length,
      ),
    )
    .toBe(1);
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

test("partial resident failure can be retried before continuing to Brain", async ({
  page,
}) => {
  await installFresh(page, {
    nativeResidentDiscovery: nativeResidents,
    // Native Luca consumes its provisioning and resident-create steps first;
    // Hermes and OpenClaw then fail, and the Hermes retry succeeds.
    createManagedAgentErrors: [
      null,
      null,
      "Hermes import failed",
      "OpenClaw import failed",
      null,
    ],
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
  await page.getByRole("button", { name: /^Hermes Hermes/ }).click();
  await page.getByRole("button", { name: /^OpenClaw OpenClaw/ }).click();
  const primaryAction = page.getByTestId("polyphonic-setup-continue");
  await primaryAction.click();
  await approveNativeLucaReviewIfPresent(page, primaryAction);

  await expect(
    page.getByRole("heading", { name: "Bring your agents together" }),
  ).toBeVisible();
  await expect(page.getByText("Hermes import failed")).toBeVisible();
  await expect(page.getByText("OpenClaw import failed")).toBeVisible();
  await expect(page.getByTestId("polyphonic-setup-continue")).toHaveText(
    "Continue anyway",
  );

  const hermesRow = page.getByTestId("onboarding-agent-row-hermes:default");
  await hermesRow.getByRole("button", { name: "Retry" }).click();
  await expect(hermesRow.getByText("Imported", { exact: true })).toBeVisible();
  await expect(page.getByText("OpenClaw import failed")).toBeVisible();
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(
    page.getByRole("heading", { name: "Connect your work" }),
  ).toBeFocused();

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
  ).toHaveLength(3);
  expect(
    commands.filter((command) => command === "set_resident_continuity_enabled"),
  ).toHaveLength(1);
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
