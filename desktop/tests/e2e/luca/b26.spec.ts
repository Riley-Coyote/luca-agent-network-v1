import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

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

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, { managedAgents: residents });
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

test("Brain first connection asks once and remains usable in compact layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    "/?e2e=mock#/brain?brainFixture=empty&brainConnections=empty",
  );

  const codex = page.getByTestId("brain-card-codex_history");
  await expect(codex).toContainText("Found");
  await codex.getByRole("button", { name: "Connect sessions" }).click();
  const consent = page.getByTestId("brain-consent-dialog");
  await expect(consent).toContainText(
    "Luca keeps a private local index while your originals stay where they are.",
  );
  await expect(consent).toContainText("every current resident");
  await consent
    .getByRole("button", { name: "Connect for all residents" })
    .click();
  await expect(codex).toContainText("Current");

  const claude = page.getByTestId("brain-card-claude_history");
  await claude.getByRole("button", { name: "Connect sessions" }).click();
  await expect(page.getByTestId("brain-consent-dialog")).toBeHidden();
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
