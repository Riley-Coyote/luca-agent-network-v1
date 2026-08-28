import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { seedActiveIdentity } from "../../helpers/onboarding";

const LUCA_PUBKEY = "11".repeat(32);
const MARA_PUBKEY = "22".repeat(32);
const residents = [
  {
    agentCommand: "hermes",
    model: "gpt-5.6-sol",
    name: "Luca",
    provider: "ollama",
    pubkey: LUCA_PUBKEY,
    status: "running" as const,
  },
  {
    agentCommand: "openclaw",
    model: "claude-sonnet-4-6",
    name: "Mara",
    provider: "anthropic",
    pubkey: MARA_PUBKEY,
    status: "stopped" as const,
  },
];

test.beforeEach(async ({ page }, testInfo) => {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await installMockBridge(page, {
    managedAgents: residents,
    connectedBrainConnectDelayMs:
      testInfo.title.includes("queue") || testInfo.title.includes("stops")
        ? 120
        : undefined,
    connectedBrainConnectErrors: testInfo.title.includes("partial failure")
      ? ["fixture-source-failed", null]
      : undefined,
  });
});

test("an empty Brain opens as a usable clean-profile state", async ({
  page,
}) => {
  await page.goto(
    "/?e2e=mock#/brain?brainFixture=empty&brainConnections=empty",
  );

  await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("brain-card-files")).toContainText("Not found");
  await page
    .getByTestId("brain-card-files")
    .getByRole("button", { name: "Add files" })
    .click();
  await expect(page.getByText("No private sources yet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose folder" }),
  ).toBeEnabled();
});

test("Brain connects work while keeping controls and provenance quiet", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?e2e=mock#/brain");

  await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();
  await expect(page.getByTestId("brain-card-repository")).toContainText(
    "Current",
  );
  await expect(page.getByTestId("brain-card-codex_history")).toContainText(
    "Found",
  );
  await expect(page.getByTestId("brain-card-claude_history")).toContainText(
    "Found",
  );
  await expect(page.getByTestId("brain-card-files")).toContainText("Current");
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/luca-brain/brain-connections-overview.png",
  });

  const repositoryCard = page.getByTestId("brain-card-repository");
  await repositoryCard.getByRole("button", { name: "Add folder" }).click();
  await repositoryCard.getByRole("button", { name: "Details" }).click();
  await expect(
    page.getByTestId("connected-source-connected-repository-luca"),
  ).toContainText("luca-agent-network");
  const staleGrant = page.getByTestId(
    `connected-grant-connected-repository-luca-${MARA_PUBKEY}`,
  );
  await expect(staleGrant).toContainText("Review needed");
  await staleGrant.getByRole("button", { name: "Reconfirm" }).click();
  await expect(staleGrant).toContainText("Included");
  await page.getByRole("button", { name: "Close" }).click();

  await page
    .getByTestId("brain-card-codex_history")
    .getByRole("button", { name: "Connect sessions" })
    .click();
  const codexConnect = page.getByTestId("brain-connection-dialog");
  await codexConnect.getByRole("checkbox", { name: "Select Codex" }).click();
  await codexConnect.getByRole("button", { name: "Connect 1 source" }).click();
  await expect(codexConnect).toContainText("Current");
  await codexConnect.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("brain-card-codex_history")).toContainText(
    "Current",
  );

  await repositoryCard.getByRole("button", { name: "Details" }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  const disconnect = page.getByRole("alertdialog");
  await expect(disconnect).toContainText(
    "Recall and repository tools stop immediately",
  );
  await disconnect.getByRole("button", { name: "Disconnect" }).click();
  await expect(
    page.getByTestId("connected-source-connected-repository-luca"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  await page
    .getByTestId("brain-card-files")
    .getByRole("button", { name: "Details" })
    .click();
  await expect(
    page.getByText("Launch Notes", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("brain-access-panel")).toBeVisible();
  await page.getByRole("button", { name: "Preview update" }).click();
  await expect(page.getByTestId("brain-preview-panel")).toBeVisible();
  await page
    .getByTestId("brain-preview-panel")
    .getByRole("button", { name: "Close" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByTestId("brain-activity-list")).toContainText("read");
  await expect(page.getByTestId("brain-activity-list")).toContainText("Recall");

  const commandLog = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: unknown[];
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  );
  expect(
    commandLog.filter(
      (entry) =>
        (entry as { command?: string }).command === "add_connected_brain_root",
    ),
  ).toHaveLength(1);
  expect(
    commandLog.filter(
      (entry) =>
        (entry as { command?: string }).command ===
        "reconfirm_connected_brain_source",
    ),
  ).toHaveLength(1);
  expect(
    commandLog.filter(
      (entry) =>
        (entry as { command?: string }).command ===
        "disconnect_connected_brain_source",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(commandLog)).not.toContain("/Users/");
  expect(JSON.stringify(commandLog)).not.toContain("sourceBody");

  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/luca-brain/brain-connections-ready.png",
  });
  expect(errors).toEqual([]);
});

test("Brain separates source recovery from resident access", async ({
  page,
}) => {
  await page.goto("/?e2e=mock#/brain?brainConnections=attention");

  const repositoryCard = page.getByTestId("brain-card-repository");
  await expect(repositoryCard).toContainText("Needs attention");
  await repositoryCard.getByRole("button", { name: "Details" }).click();

  const source = page.getByTestId("connected-source-connected-repository-luca");
  await expect(source).toContainText("Source needs attention");
  await expect(
    page.getByTestId("connected-source-recovery-connected-repository-luca"),
  ).toContainText("resident access below is separate");
  await expect(
    page.getByTestId(
      `connected-grant-connected-repository-luca-${LUCA_PUBKEY}`,
    ),
  ).toContainText("Included");

  await source.getByRole("button", { name: "Retry source" }).click();
  await expect(source).toContainText("Current");

  const commandLog = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: unknown[];
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  );
  expect(
    commandLog.filter(
      (entry) =>
        (entry as { command?: string }).command ===
        "refresh_connected_brain_source",
    ),
  ).toHaveLength(1);
  expect(
    commandLog.filter(
      (entry) =>
        (entry as { command?: string }).command ===
        "reconfirm_connected_brain_source",
    ),
  ).toHaveLength(0);
});

test("Brain confirms each source selection and remains usable in compact layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    "/?e2e=mock#/brain?brainFixture=empty&brainConnections=empty",
  );

  const codex = page.getByTestId("brain-card-codex_history");
  await expect(codex).toContainText("Found");
  await codex.getByRole("button", { name: "Connect sessions" }).click();
  const consent = page.getByTestId("brain-connection-dialog");
  await expect(consent).toContainText("0 selected");
  await expect(consent).toContainText(
    "Luca keeps a private local index while your originals stay where they are.",
  );
  await consent.getByRole("checkbox", { name: "Select Codex" }).click();
  await consent.getByRole("button", { name: "Connect 1 source" }).click();
  await expect(consent).toContainText("Current");
  await consent.getByRole("button", { name: "Close" }).click();
  await expect(codex).toContainText("Current");

  const claude = page.getByTestId("brain-card-claude_history");
  await claude.getByRole("button", { name: "Connect sessions" }).click();
  const claudeConnect = page.getByTestId("brain-connection-dialog");
  await expect(claudeConnect).toContainText("0 selected");
  await claudeConnect
    .getByRole("checkbox", { name: "Select Claude Code" })
    .click();
  await claudeConnect.getByRole("button", { name: "Connect 1 source" }).click();
  await expect(claudeConnect).toContainText("Current");
  await claudeConnect.getByRole("button", { name: "Close" }).click();
  await expect(claude).toContainText("Current");

  await page
    .getByTestId("brain-card-files")
    .getByRole("button", { name: "Add files" })
    .click();
  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByTestId("brain-preview-panel")).toBeVisible();
  await page
    .getByTestId("brain-preview-panel")
    .getByRole("button", { name: "Close" })
    .click();
  await expect(page.getByTestId("brain-import-cancelled")).toContainText(
    "Preview cancelled",
  );

  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/luca-brain/brain-connections-mobile.png",
  });
});

test("Brain queue continues after partial failure and retries only the failed source", async ({
  page,
}) => {
  await page.goto("/?e2e=mock#/brain");

  await page
    .getByTestId("brain-card-repository")
    .getByRole("button", { name: "Details" })
    .click();
  await page.getByRole("button", { name: "Connect sources" }).click();

  const dialog = page.getByTestId("brain-connection-dialog");
  await expect(dialog).toContainText("0 selected");
  await dialog.getByRole("button", { name: "Select all" }).click();
  await expect(dialog).toContainText("2 selected");
  await dialog.getByRole("button", { name: "Connect 2 sources" }).click();

  await expect(
    dialog.getByTestId("brain-connection-source-discovery-repository-atlas"),
  ).toContainText("Failed");
  await expect(
    dialog.getByTestId(
      "brain-connection-source-discovery-repository-field-kit",
    ),
  ).toContainText("Current");
  await expect(
    page.getByRole("button", { name: "Scan for Brain sources" }),
  ).toBeEnabled();

  await dialog.getByRole("button", { name: "Retry atlas-notes" }).click();
  await expect(
    dialog.getByTestId("brain-connection-source-discovery-repository-atlas"),
  ).toContainText("Current");

  const connectPayloads = await page.evaluate(() =>
    (
      (
        window as typeof window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{
            command?: string;
            payload?: { input?: { discoveryIds?: string[] } };
          }>;
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []
    ).filter((entry) => entry.command === "connect_connected_brain_source"),
  );
  expect(connectPayloads).toHaveLength(3);
  expect(
    connectPayloads.every(
      (entry) => entry.payload?.input?.discoveryIds?.length === 1,
    ),
  ).toBe(true);
  expect(connectPayloads[2]?.payload?.input?.discoveryIds).toEqual([
    "discovery-repository-atlas",
  ]);
});

test("Brain stops a multi-source queue after the current source", async ({
  page,
}) => {
  await page.goto(
    "/?e2e=mock#/brain?brainFixture=empty&brainConnections=empty",
  );

  await page
    .getByTestId("brain-card-repository")
    .getByRole("button", { name: "Connect repositories" })
    .click();
  const dialog = page.getByTestId("brain-connection-dialog");
  await dialog.getByRole("button", { name: "Select all" }).click();
  await expect(dialog).toContainText("3 selected");
  await dialog.getByRole("button", { name: "Connect 3 sources" }).click();
  await expect(dialog).toContainText("Connecting");
  await expect(
    page.getByRole("button", { name: "Scan for Brain sources" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Stop" }).click();
  await expect(
    dialog.getByRole("button", { name: "Stopping after current source" }),
  ).toBeDisabled();

  await expect(
    dialog.getByTestId("brain-connection-source-discovery-repository-luca"),
  ).toContainText("Current");
  await expect(
    dialog.getByTestId("brain-connection-source-discovery-repository-atlas"),
  ).toContainText("Cancelled");
  await expect(
    dialog.getByTestId(
      "brain-connection-source-discovery-repository-field-kit",
    ),
  ).toContainText("Cancelled");

  const connectCalls = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{ command?: string }>;
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
        (entry) => entry.command === "connect_connected_brain_source",
      ).length ?? 0,
  );
  expect(connectCalls).toBe(1);
});

test("Brain connection failures remain fail-soft", async ({ page }) => {
  await page.goto("/?e2e=mock#/brain?brainFixture=locked");
  await expect(page.getByRole("heading", { name: "Brain" })).toBeVisible();
  await page
    .getByTestId("brain-card-files")
    .getByRole("button", { name: "Add files" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Brain is locked" }),
  ).toBeVisible();
});
