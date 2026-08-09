import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

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

test("Brain Setup previews imports grants and body-free provenance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?e2e=mock#/brain");

  await expect(
    page.getByRole("heading", { name: "Brain Setup" }),
  ).toBeVisible();
  await expect(
    page.getByText("Launch Notes", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("brain-access-panel")).toContainText(
    "Explicit grants only",
  );
  await expect(page.getByTestId(`brain-grant-${LUCA_PUBKEY}`)).toContainText(
    "Active",
  );
  await expect(page.getByTestId(`brain-grant-${MARA_PUBKEY}`)).toContainText(
    "Needs review",
  );
  await expect(page.getByTestId("brain-provenance-panel")).toContainText(
    "2 selected sections",
  );

  await page.getByRole("button", { name: "Preview update" }).click();
  await expect(page.getByTestId("brain-preview-panel")).toBeVisible();
  for (const status of [
    "changed",
    "duplicate",
    "credential_like",
    "unsupported",
  ]) {
    await expect(page.getByTestId(`brain-preview-row-${status}`)).toBeVisible();
  }

  await page.getByRole("button", { name: "Import source" }).click();
  await expect(page.getByRole("button", { name: "Importing" })).toBeVisible();
  await expect(page.getByTestId("brain-import-committed")).toContainText(
    "Source imported",
  );

  await page
    .getByTestId(`brain-grant-${MARA_PUBKEY}`)
    .getByRole("button", { name: "Reconfirm" })
    .click();
  await expect(page.getByTestId(`brain-grant-${MARA_PUBKEY}`)).toContainText(
    "Active",
  );

  await page
    .getByTestId(`brain-grant-${LUCA_PUBKEY}`)
    .getByRole("button", { name: "Revoke" })
    .click();
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByTestId(`brain-grant-${LUCA_PUBKEY}`)).toContainText(
    "Revoked",
  );

  const commandLog = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: unknown[];
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  );
  expect(JSON.stringify(commandLog)).not.toContain("/Users/");
  expect(JSON.stringify(commandLog)).not.toContain("sourceBody");

  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/luca-brain/brain-setup-ready.png",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await waitForAnimations(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/luca-brain/brain-setup-mobile.png",
  });
  expect(errors).toEqual([]);
});

test("Brain Setup fails soft across empty locked unavailable cancelled and failed states", async ({
  page,
}) => {
  await page.goto("/?e2e=mock#/brain?brainFixture=empty");
  await expect(page.getByText("No private sources yet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose folder" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Choose folder" }).click();
  await expect(page.getByTestId("brain-preview-panel")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("brain-import-cancelled")).toContainText(
    "Preview cancelled",
  );

  await page.goto("/?e2e=mock&brainVisit=failed#/brain?brainFixture=failed");
  await page.getByRole("button", { name: "Preview update" }).click();
  await page.getByRole("button", { name: "Import source" }).click();
  await expect(page.getByTestId("brain-import-failed")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "source changed after preview",
  );

  await page.goto("/?e2e=mock&brainVisit=locked#/brain?brainFixture=locked");
  await expect(
    page.getByRole("heading", { name: "Brain is locked" }),
  ).toBeVisible();

  await page.goto(
    "/?e2e=mock&brainVisit=unavailable#/brain?brainFixture=unavailable",
  );
  await expect(
    page.getByRole("heading", { name: "Brain store unavailable" }),
  ).toBeVisible();
});
