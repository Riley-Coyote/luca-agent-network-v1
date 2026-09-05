import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

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

for (const compact of [false, true]) {
  test(`native started status stays truthful${compact ? " at narrow 150 percent" : " with filters and actions"}`, async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    if (compact) {
      await page.setViewportSize({ width: 860, height: 900 });
      await page.addInitScript(() => {
        localStorage.setItem("buzz:text-scale", "1.5");
      });
    }
    await installMockBridge(page, {
      managedAgents: [
        ...MANAGED_RESIDENTS.map((resident) => ({
          ...resident,
          needsRestart: false,
          status: "running" as const,
        })),
        {
          ...MANAGED_RESIDENTS[1],
          pubkey: "33".repeat(32),
          name: "Needs setup",
          status: "running",
          lastError: "Native configuration needs attention",
        },
      ],
    });
    await page.goto("/?e2e=mock&notebookDemo=1#/agents");
    await page.getByRole("tab", { name: "Running", exact: true }).click();
    for (const pubkey of [LUCA_PUBKEY, MARA_PUBKEY]) {
      const row = page.getByTestId(`agent-library-row-${pubkey}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText("Started");
      await expect(row).not.toContainText("Ready");
      await expect(row).toHaveAttribute(
        "title",
        /Native session readiness is not reported/,
      );
    }
    await expect(
      page.getByTestId(`agent-library-row-${"33".repeat(32)}`),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "Attention", exact: true }).click();
    await expect(
      page.getByTestId(`agent-library-row-${LUCA_PUBKEY}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`agent-library-row-${"33".repeat(32)}`),
    ).toContainText("Failed");
    await page.getByRole("tab", { name: "Running", exact: true }).click();
    await page.getByTestId(`agent-library-row-${MARA_PUBKEY}`).click();
    const state = page.getByTestId("agent-strip-state");
    await expect(state).toHaveText("Started");
    await expect(state.locator("span[aria-hidden]")).not.toHaveClass(
      /bg-primary/,
    );
    const note = page.getByTestId("agent-native-readiness-note");
    await expect(note).toHaveText(
      "Native session readiness is not reported by this status.",
    );
    await expect(note).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Stop agent", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Restart agent", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Message Mara", exact: true }),
    ).toBeVisible();
    expect(await lifecycleCommands(page)).toEqual([]);
    if (compact) {
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).fontSize,
        ),
      ).toBe("24px");
    }
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(
        compact ? "native-started-zoom150.png" : "native-started-wide.png",
      ),
    });
    expect(pageErrors).toEqual([]);
  });
}

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
    page.getByRole("button", { name: "Open Mara", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open Mara", exact: true }).click();
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

async function editResidentCommand(
  page: import("@playwright/test").Page,
  command: string,
) {
  await page
    .getByRole("navigation", { name: "Agent workspace" })
    .getByRole("button", { name: "Settings" })
    .click();
  await page.getByTestId("agent-settings-advanced").click();
  const dialog = page.getByTestId("edit-agent-dialog");
  await dialog.getByRole("button", { name: "Advanced" }).click();
  await dialog.getByLabel("Agent command").fill(command);
  await dialog.getByTestId("edit-agent-dialog-submit").click();
  return dialog;
}

test("editing a running resident runtime stops the stale process before starting the replacement", async ({
  page,
}) => {
  await installLibraryBridge(page);
  await openResident(page, LUCA_PUBKEY);

  const dialog = await editResidentCommand(
    page,
    "luca-acceptance-replacement-runtime",
  );

  await expect(dialog).toHaveCount(0);
  expect(await lifecycleCommands(page)).toEqual([
    "stop_managed_agent",
    "start_managed_agent",
  ]);
  const resident = await readManagedResident(page, LUCA_PUBKEY);
  expect(resident?.status).toBe("running");
});

test("an unavailable replacement runtime leaves the old process stopped and reports the failure", async ({
  page,
}) => {
  await installLibraryBridge(page, {
    startManagedAgentErrors: ["Replacement runtime is unavailable"],
  });
  await openResident(page, LUCA_PUBKEY);

  const dialog = await editResidentCommand(
    page,
    "luca-acceptance-missing-runtime",
  );

  await expect(
    dialog.getByText("Replacement runtime is unavailable"),
  ).toBeVisible();
  expect(await lifecycleCommands(page)).toEqual([
    "stop_managed_agent",
    "start_managed_agent",
  ]);
  const resident = await readManagedResident(page, LUCA_PUBKEY);
  expect(resident?.status).toBe("stopped");
});

test("editing a stopped resident runtime preserves its stopped state", async ({
  page,
}) => {
  await installLibraryBridge(page);
  await openResident(page, MARA_PUBKEY);

  const dialog = await editResidentCommand(
    page,
    "luca-acceptance-replacement-runtime",
  );

  await expect(dialog).toHaveCount(0);
  expect(await lifecycleCommands(page)).toEqual([]);
  const resident = await readManagedResident(page, MARA_PUBKEY);
  expect(resident?.status).toBe("stopped");
});
