import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const MARA_PUBKEY = "22".repeat(32);
const MANAGED_RESIDENTS = [
  {
    agentCommand: "hermes",
    channelNames: ["agents"],
    model: "gpt-5.6-sol",
    name: "Luca",
    nativeRuntimeBinding: {
      kind: "hermes" as const,
      schemaVersion: 1,
      profileName: "default",
      hermesHome: "/Users/demo/.hermes",
      executablePath: "/Users/demo/.local/bin/hermes",
      runtimeVersion: "1.9.0",
      defaultWorkspace: "/Users/demo/Projects/luca",
    },
    pubkey: "11".repeat(32),
    status: "running" as const,
  },
  {
    agentCommand: "openclaw",
    channelNames: ["general"],
    model: "claude-sonnet-4-6",
    name: "Mara",
    nativeRuntimeBinding: {
      kind: "openclaw" as const,
      schemaVersion: 1,
      agentId: "main",
      executablePath: "/opt/homebrew/bin/openclaw",
      runtimeVersion: "2026.8.1",
      gatewayIdentity: "personal-gateway",
      gatewayUrlRef: {
        provider: "native_store" as const,
        locator: "openclaw.gateway.url",
      },
      defaultWorkspace: "/Users/demo/Projects/research",
    },
    pubkey: MARA_PUBKEY,
    status: "stopped" as const,
  },
];

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, { managedAgents: MANAGED_RESIDENTS });
});

test("agent library separates the roster, workspace, and notebook", async ({
  page,
}) => {
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");

  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  await expect(page.getByText("Mock data", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId(`agent-library-row-${MARA_PUBKEY}`),
  ).toContainText("Mara");

  await page.getByTestId(`agent-library-row-${MARA_PUBKEY}`).click();
  await expect(page.getByRole("heading", { name: "Mara" })).toBeVisible();
  const workspaceNavigation = page.getByRole("navigation", {
    name: "Agent workspace",
  });
  await expect(
    workspaceNavigation.getByRole("button", { name: "Overview" }),
  ).toBeVisible();
  await expect(
    workspaceNavigation.getByRole("button", { name: "Notebook" }),
  ).toBeVisible();
  await expect(
    workspaceNavigation.getByRole("button", { name: "Settings" }),
  ).toBeVisible();

  await workspaceNavigation.getByRole("button", { name: "Notebook" }).click();
  await expect(
    page.getByRole("region", { name: "Mara notebook field" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /Continuity Notes/ }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /Journal Pages/ })).toBeVisible();
});

test("a managed chat participant links to its full agent workspace", async ({
  page,
}) => {
  await page.goto(
    "/?e2e=mock&notebookDemo=1#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
  );

  await page.getByRole("button", { name: "Open conversation details" }).click();
  await page.getByTestId(`drawer-context-agent-${MARA_PUBKEY}`).click();

  await expect(page.getByRole("heading", { name: "Mara" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open full agent profile" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open full agent profile" }).click();
  await expect(page).toHaveURL(/#\/agents\?profile=/);
  await expect(page.getByRole("heading", { name: "Mara" })).toBeVisible();
});
