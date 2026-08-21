import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";
import { seedActiveIdentity } from "../../helpers/onboarding";

const POLYPHONIC_PUBKEY = "10".repeat(32);
const HERMES_PUBKEY = "11".repeat(32);
const OPENCLAW_PUBKEY = "22".repeat(32);

async function openSettingsSection(
  page: import("@playwright/test").Page,
  section: string,
) {
  await page.goto("/#/settings");
  if (section !== "profile") {
    await page.getByTestId(`settings-nav-${section}`).click();
  }
}

test.beforeEach(async ({ page }) => {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await installMockBridge(page, {
    managedAgents: [
      {
        agentCommand: "codex",
        model: "gpt-5.6-sol",
        name: "Sol",
        pubkey: POLYPHONIC_PUBKEY,
        status: "stopped",
      },
      {
        agentCommand: "hermes",
        model: "gpt-5.6-sol",
        name: "Luca",
        nativeRuntimeBinding: {
          kind: "hermes",
          schemaVersion: 1,
          profileName: "default",
          hermesHome: "/Users/demo/.hermes",
          executablePath: "/Users/demo/.local/bin/hermes",
          runtimeVersion: "1.9.0",
          defaultWorkspace: "/Users/demo/Projects/luca",
        },
        pubkey: HERMES_PUBKEY,
        status: "running",
      },
      {
        agentCommand: "openclaw",
        model: "claude-sonnet-4-6",
        name: "Mara",
        nativeRuntimeBinding: {
          kind: "openclaw",
          schemaVersion: 1,
          agentId: "main",
          executablePath: "/opt/homebrew/bin/openclaw",
          runtimeVersion: "2026.8.1",
          gatewayIdentity: "personal-gateway",
          gatewayUrlRef: {
            provider: "native_store",
            locator: "openclaw.gateway.url",
          },
          defaultWorkspace: "/Users/demo/Projects/research",
        },
        pubkey: OPENCLAW_PUBKEY,
        status: "stopped",
      },
    ],
  });
});

test("settings exposes only the Luca information architecture", async ({
  page,
}) => {
  await openSettingsSection(page, "profile");

  for (const label of [
    "Profile & identity",
    "Security & backup",
    "Appearance",
    "Notifications",
    "Mobile & devices",
    "Shortcuts",
    "Agents",
    "Connections & MCP",
    "Defaults & permissions",
    "Diagnostics",
    "Updates",
    "About Luca",
  ]) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  await expect(page.getByText("Hosted communities")).toHaveCount(0);
  await expect(page.getByText("Templates", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Custom emoji", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Compute", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Experiments", { exact: true })).toHaveCount(0);
});

test("one resident record agrees across settings, runtime, and MCP grants", async ({
  page,
}, testInfo) => {
  await openSettingsSection(page, "agents");

  await expect(page.getByTestId("settings-agents")).toBeVisible();
  await page.getByTestId(`agent-library-row-${HERMES_PUBKEY}`).click();
  await expect(page.getByRole("heading", { name: "Luca" })).toBeVisible();
  await expect(page.getByText("Hermes · Native-managed agent")).toBeVisible();
  await expect(
    page.getByText("Native-managed binding · Luca-managed overlays"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Runtime" }).click();
  await expect(page).toHaveURL(/settingsAgentTab=runtime/);
  await page.goBack();
  await expect(page.getByText("Configuration authority")).toBeVisible();

  await page.getByRole("button", { name: "Capabilities" }).click();
  await expect(page.getByTestId("resident-access-control")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Standard/ })).toBeChecked();
  await expect(page.getByText("Remembered permissions")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("capability-settings.png"),
  });
  await page.getByRole("button", { name: "Manage MCP access" }).click();
  await expect(page).toHaveURL(/section=connections/);
  await expect(page.getByText("Hermes", { exact: true })).toBeVisible();

  await page
    .getByTestId("settings-connections-mcp")
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  const grant = page.getByRole("switch", {
    name: "Grant Local project tools to Luca",
  });
  await expect(grant).toBeVisible();
  await grant.click();
  await expect(grant).toBeChecked();

  const grantCall = await page.evaluate(
    () =>
      window.__BUZZ_E2E_COMMAND_LOG__?.find(
        (entry) => entry.command === "set_agent_mcp_grant",
      ) ?? null,
  );
  expect(grantCall?.payload).toMatchObject({
    connectionId: "11111111-1111-4111-8111-111111111111",
    granted: true,
    residentPubkey: HERMES_PUBKEY,
  });
});

test("MCP connections can be edited, disabled, tested, and granted", async ({
  page,
}) => {
  await openSettingsSection(page, "connections");

  await expect(page.getByText("Runtime connections")).toBeVisible();
  await expect(page.getByText("Local project tools")).toBeVisible();

  const enabled = page.getByRole("switch", {
    name: "Disable Local project tools",
  });
  await expect(enabled).toBeChecked();
  await enabled.click();
  await expect(
    page.getByRole("switch", { name: "Enable Local project tools" }),
  ).not.toBeChecked();

  await page.getByRole("button", { name: "Edit Local project tools" }).click();
  await expect(page.getByTestId("mcp-connection-form")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Connection name", exact: true }),
  ).toHaveValue("Local project tools");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page
    .getByTestId("settings-connections-mcp")
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "Grant Local project tools to Luca" }),
  ).toBeVisible();
});

test("native runtime readiness exposes degraded reason and refresh feedback", async ({
  page,
}) => {
  await openSettingsSection(page, "connections");

  await expect(page.getByText("Gateway is currently offline.")).toBeVisible();

  await page.getByRole("button", { name: "Refresh runtimes" }).click();
  await expect(page.getByText("Runtime readiness rechecked")).toBeVisible();
});

test("mobile pairing remains a real Luca companion flow", async ({ page }) => {
  await openSettingsSection(page, "mobile");

  await expect(
    page.getByRole("heading", { name: "Mobile & devices" }),
  ).toBeVisible();
  await expect(page.getByTestId("pair-mobile-button")).toBeEnabled();
  await expect(page.getByText(/one-time pairing session/i)).toBeVisible();
  await expect(page.getByText(/persistent device registry/i)).toBeVisible();
});
