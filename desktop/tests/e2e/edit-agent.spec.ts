import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const BAKED_DEFAULTS = [
  { key: "BUZZ_AGENT_PROVIDER", value: "anthropic", masked: false },
  {
    key: "BUZZ_AGENT_MODEL",
    value: "claude-opus-4-8",
    masked: false,
  },
  { key: "BUZZ_AGENT_THINKING_EFFORT", value: "high", masked: false },
  { key: "ANTHROPIC_API_KEY", value: "sk-ant-baked-test", masked: true },
];

// Edit-agent dialog coverage (Phase 1B.3b-pre). Written against TODAY'S
// EditAgentDialog, before the B3b re-host, so the re-host is guarded by a
// pre-existing spec rather than one written alongside it.
//
// Mock-boundary caveat: the e2eBridge `update_managed_agent` handler echoes
// name/model/systemPrompt/envVars/respondTo/respondToAllowlist into the
// mock store — it does NOT
// model the diff-based partial-update wire semantics (change-detected-or-omit,
// tri-state provider, harnessOverride derivation), and it ignores
// agentCommand/harnessOverride entirely. This spec therefore pins UI behavior
// (open → edit → save → persisted in UI), not wire semantics. The inherit
// toggle is not reachable here at all (see the routing pin below) — its
// behavior is covered by B3b's component-level pinning test (inherit-toggle
// → gate → submit); wire semantics stay component-test territory
// (personaRuntimeModel.test.mjs).

// Tyler's pubkey maps to gooseSurface in the mock bridge (runtimeId "goose"),
// which supports LLM provider selection — same seed the readiness-screenshot
// spec uses for its edit-dialog shot.
const AGENT_PUBKEY = TEST_IDENTITIES.tyler.pubkey;
const AGENT_NAME = "Tyler Agent";
const PERSONA_ID = "persona-edit-e2e";

/**
 * Open the Edit Agent dialog for the seeded managed agent via the current
 * resident workspace (agents view → resident selector → Edit action).
 */
async function openEditDialog(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("open-agents-view").click();

  const residentButton = page.getByRole("button", {
    name: new RegExp(`^${AGENT_NAME} identity, idle`),
  });
  await expect(residentButton).toBeVisible({ timeout: 10_000 });
  await residentButton.click();
  await page.getByRole("button", { name: "Edit agent" }).click();

  await expect(page.getByTestId("edit-agent-dialog")).toBeVisible({
    timeout: 10_000,
  });
  // The current editor exposes the runtime as Provider and keeps Model
  // available for Codex. Both controls visible means the catalog and form have
  // settled; no runtime change is required merely to edit another field.
  await expect(
    page.getByRole("button", { name: "Provider", exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: /^Model(?:Optional)?$/ }),
  ).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Pick an option from a PersonaDropdownField (menu-based, not a native
 * <select> — Create's fields are selects, Edit's are not).
 */
async function pickDropdownOption(
  page: import("@playwright/test").Page,
  fieldName: string,
  optionName: string | RegExp,
) {
  await page.getByRole("button", { name: fieldName, exact: true }).click();
  await page.getByRole("menuitemradio", { name: optionName }).click();
}

test.describe("edit agent dialog", () => {
  test("edits the agent name and persists it across a dialog reopen", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    const nameInput = page.locator("#edit-agent-name");
    await expect(nameInput).toHaveValue(AGENT_NAME);
    await nameInput.fill("Tyler Agent Renamed");

    await page.getByTestId("edit-agent-dialog-submit").click();
    await expect(page.getByTestId("edit-agent-dialog")).not.toBeVisible();

    // Reopen: the dialog re-reads the managed-agents store, proving the save
    // survived the dialog lifecycle rather than living in local state. (The
    // panel HEADER is not asserted — it renders the relay profile name, which
    // the update path does not touch.)
    await page.getByRole("button", { name: "Edit agent" }).click();
    await expect(page.locator("#edit-agent-name")).toHaveValue(
      "Tyler Agent Renamed",
      { timeout: 10_000 },
    );
  });

  test("changes the model via custom entry and persists it", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    // Set a custom model through the current accessible Model control.
    await pickDropdownOption(page, "ModelOptional", "Custom model...");
    await page.locator("#edit-agent-custom-model").fill("claude-opus-4-5");

    const submit = page.getByTestId("edit-agent-dialog-submit");
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();
    await expect(page.getByTestId("edit-agent-dialog")).not.toBeVisible();

    await page.getByRole("button", { name: "Edit agent" }).click();
    await expect(page.getByTestId("edit-agent-dialog")).toBeVisible({
      timeout: 10_000,
    });
    // Custom model round-trips: the reopened dialog shows it in the custom
    // input (the discovered-model lists don't contain it).
    await expect(page.locator("#edit-agent-custom-model")).toHaveValue(
      "claude-opus-4-5",
      { timeout: 10_000 },
    );
  });

  test("shows baked defaults in the instance editor", async ({ page }) => {
    await installMockBridge(page, {
      bakedBuildEnv: BAKED_DEFAULTS,
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    await expect(
      page.getByRole("button", { name: "Provider", exact: true }),
    ).toHaveText("Codex (not installed)");
    await expect(page.locator("#edit-agent-model")).toHaveText(
      "Inherit build default (claude-opus-4-8)",
    );
    const defaults = page.getByTestId("agent-ai-defaults-notice");
    await expect(
      defaults.getByText("Anthropic", { exact: true }),
    ).toBeVisible();
    await expect(
      defaults.getByText("claude-opus-4-8", { exact: true }),
    ).toBeVisible();
  });

  test("explicit global defaults override baked labels in the instance editor", async ({
    page,
  }) => {
    await installMockBridge(page, {
      bakedBuildEnv: BAKED_DEFAULTS,
      globalAgentConfig: {
        provider: "anthropic",
        model: "claude-opus-4-5",
        env_vars: { BUZZ_AGENT_THINKING_EFFORT: "low" },
      },
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
    });

    await openEditDialog(page);

    await expect(
      page.getByRole("button", { name: "Provider", exact: true }),
    ).toHaveText("Codex (not installed)");
    await expect(page.locator("#edit-agent-model")).toHaveText(
      "Use agent defaults (claude-opus-4-5)",
    );
    const defaults = page.getByTestId("agent-ai-defaults-notice");
    await expect(
      defaults.getByText("Anthropic", { exact: true }),
    ).toBeVisible();
    await expect(
      defaults.getByText("claude-opus-4-5", { exact: true }),
    ).toBeVisible();
  });

  test("workspace Edit opens the current instance editor for persona-linked agents", async ({
    page,
  }) => {
    // The resident workspace owns instance lifecycle configuration, including
    // for residents linked to an editable persona definition.
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: AGENT_PUBKEY,
          name: AGENT_NAME,
          personaId: PERSONA_ID,
          status: "stopped",
          channelNames: ["agents"],
        },
      ],
      personas: [
        {
          id: PERSONA_ID,
          displayName: "Edit E2E Persona",
          systemPrompt: "You are the edit-agent e2e persona.",
        },
      ],
    });

    await page.goto("/");
    await page.getByTestId("open-agents-view").click();

    // Persona-linked residents now open through the same identity workspace.
    const residentButton = page.getByRole("button", {
      name: new RegExp(`^${AGENT_NAME} identity, idle`),
    });
    await expect(residentButton).toBeVisible({ timeout: 10_000 });
    await residentButton.click();
    await page.getByRole("button", { name: "Edit agent" }).click();

    await expect(page.getByTestId("edit-agent-dialog")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("#edit-agent-name")).toHaveValue(AGENT_NAME);
  });
});
