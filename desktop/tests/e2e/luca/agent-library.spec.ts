import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const MARA_PUBKEY = "22".repeat(32);
const LUCA_PUBKEY = "11".repeat(32);
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
    needsRestart: true,
    pubkey: LUCA_PUBKEY,
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

type BridgeOptions = NonNullable<Parameters<typeof installMockBridge>[1]>;

async function installLibraryBridge(
  page: import("@playwright/test").Page,
  options: Omit<BridgeOptions, "managedAgents"> = {},
) {
  await installMockBridge(page, {
    managedAgents: MANAGED_RESIDENTS,
    ...options,
  });
}

async function openResident(
  page: import("@playwright/test").Page,
  pubkey: string,
) {
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");
  await page.getByTestId(`agent-library-row-${pubkey}`).click();
}

async function lifecycleCommands(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMANDS__ ?? []).filter(
      (command) =>
        command === "start_managed_agent" || command === "stop_managed_agent",
    ),
  );
}

async function readManagedResident(
  page: import("@playwright/test").Page,
  pubkey: string,
) {
  return page.evaluate(async (residentPubkey) => {
    const agents = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "list_managed_agents",
    )) as Array<{
      native_runtime_binding?: unknown;
      pubkey: string;
      start_on_app_launch: boolean;
      status: string;
    }>;
    return agents.find((agent) => agent.pubkey === residentPubkey) ?? null;
  }, pubkey);
}

test("agent library separates the roster, workspace, and notebook", async ({
  page,
}) => {
  await installLibraryBridge(page);
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
    workspaceNavigation.getByRole("button", { name: "Documents" }),
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
  await installLibraryBridge(page);
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

test("a stopped native resident starts without changing its stable binding", async ({
  page,
}) => {
  await installLibraryBridge(page);
  await openResident(page, MARA_PUBKEY);

  const before = await readManagedResident(page, MARA_PUBKEY);
  await page.getByRole("button", { name: "Start agent" }).click();

  await expect(page.getByRole("status")).toHaveText("Started Mara.");
  await expect(page.getByRole("button", { name: "Stop agent" })).toBeVisible();
  expect(await lifecycleCommands(page)).toEqual(["start_managed_agent"]);

  const after = await readManagedResident(page, MARA_PUBKEY);
  expect(after?.pubkey).toBe(before?.pubkey);
  expect(after?.native_runtime_binding).toEqual(before?.native_runtime_binding);
  expect(after?.status).toBe("running");
});

test("a running resident stops with visible confirmation", async ({ page }) => {
  await installLibraryBridge(page);
  await openResident(page, LUCA_PUBKEY);

  await page.getByRole("button", { name: "Stop agent" }).click();

  await expect(page.getByRole("status")).toHaveText("Stopped Luca.");
  await expect(page.getByRole("button", { name: "Start agent" })).toBeVisible();
  expect(await lifecycleCommands(page)).toEqual(["stop_managed_agent"]);
});

test("restart applies runtime drift with one stop and one start", async ({
  page,
}) => {
  await installLibraryBridge(page);
  await openResident(page, LUCA_PUBKEY);

  const before = await readManagedResident(page, LUCA_PUBKEY);
  await page.getByRole("button", { name: "Restart agent" }).click();

  await expect(page.getByRole("status")).toHaveText("Restarted Luca.");
  await expect(page.getByText("Restart required", { exact: true })).toHaveCount(
    0,
  );
  expect(await lifecycleCommands(page)).toEqual([
    "stop_managed_agent",
    "start_managed_agent",
  ]);

  const after = await readManagedResident(page, LUCA_PUBKEY);
  expect(after?.pubkey).toBe(before?.pubkey);
  expect(after?.native_runtime_binding).toEqual(before?.native_runtime_binding);
  expect(after?.status).toBe("running");
});

test("a failed restart remains stopped and recovers through Start only", async ({
  page,
}) => {
  await installLibraryBridge(page, {
    startManagedAgentErrors: ["Synthetic restart start failure"],
  });
  await openResident(page, LUCA_PUBKEY);

  await page.getByRole("button", { name: "Restart agent" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Luca stopped, but failed to restart: Synthetic restart start failure Use Start to try again.",
  );
  await expect(page.getByRole("button", { name: "Start agent" })).toBeVisible();
  expect(await lifecycleCommands(page)).toEqual([
    "stop_managed_agent",
    "start_managed_agent",
  ]);

  await page.getByRole("button", { name: "Start agent" }).click();
  await expect(page.getByRole("status")).toHaveText("Started Luca.");
  expect(await lifecycleCommands(page)).toEqual([
    "stop_managed_agent",
    "start_managed_agent",
    "start_managed_agent",
  ]);
});

test("start on open promises a fresh relaunch session and preserves identity", async ({
  page,
}) => {
  await installLibraryBridge(page);
  await openResident(page, MARA_PUBKEY);
  const before = await readManagedResident(page, MARA_PUBKEY);

  await page
    .getByRole("navigation", { name: "Agent workspace" })
    .getByRole("button", { name: "Settings" })
    .click();
  await expect(page.getByText(/Starts when Polyphonic opens/)).toBeVisible();
  const startOnOpen = page.getByRole("switch", {
    name: "Wakes with the app",
  });
  if ((await startOnOpen.getAttribute("aria-checked")) === "true") {
    await startOnOpen.click();
  }
  const commandCountBeforeEnable = (
    await page.evaluate(() => window.__BUZZ_E2E_COMMANDS__ ?? [])
  ).filter(
    (command) => command === "set_managed_agent_start_on_app_launch",
  ).length;
  await startOnOpen.click();

  await expect(page.getByRole("status")).toContainText(
    "Mara wakes with the app now.",
  );
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(
    commands.filter(
      (command) => command === "set_managed_agent_start_on_app_launch",
    ),
  ).toHaveLength(commandCountBeforeEnable + 1);

  const after = await readManagedResident(page, MARA_PUBKEY);
  expect(after?.pubkey).toBe(before?.pubkey);
  expect(after?.native_runtime_binding).toEqual(before?.native_runtime_binding);
  expect(after?.start_on_app_launch).toBe(true);

  await page.getByRole("button", { name: "Advanced…" }).click();
  await expect(page.getByTestId("edit-agent-dialog")).toBeVisible();
});
