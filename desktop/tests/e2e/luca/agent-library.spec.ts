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
      schemaVersion: 1 as const,
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
      schemaVersion: 1 as const,
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

type CreateRuntimeTarget =
  import("../../../src/shared/api/tauriOperatorForge").AgentRuntimeTargetV1;
type CreateDefaultState = {
  mode: "ready" | "held" | "error";
  settingsCalls: number;
  release: () => void;
  calls: Array<{ command: string; payload: unknown }>;
};
declare global {
  interface Window {
    __CREATE_DEFAULT_TEST__?: CreateDefaultState;
  }
}

// Hold only the real settings IPC boundary; all forms and creation commands
// still run through the production UI and the existing mock bridge.
async function installCreateDefaultBridge(
  page: import("@playwright/test").Page,
  options: {
    target?: CreateRuntimeTarget;
    confirmed?: boolean;
    mode?: CreateDefaultState["mode"];
  } = {},
) {
  await page.addInitScript(
    ({ target, confirmed, mode }) => {
      const state: CreateDefaultState = {
        mode,
        settingsCalls: 0,
        release: () => {},
        calls: [],
      };
      const held = new Promise<void>((resolve) => {
        state.release = () => {
          state.mode = "ready";
          resolve();
        };
      });
      window.__CREATE_DEFAULT_TEST__ = state;
      type Invoke = (
        command: string,
        payload?: unknown,
        options?: unknown,
      ) => Promise<unknown>;
      let realInvoke: Invoke | undefined;
      const targetWindow = window as unknown as {
        __TAURI_INTERNALS__?: Record<string, unknown>;
      };
      const internals = targetWindow.__TAURI_INTERNALS__ ?? {};
      targetWindow.__TAURI_INTERNALS__ = internals;
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        set: (invoke: Invoke) => {
          realInvoke = invoke;
        },
        get:
          () =>
          async (command: string, payload?: unknown, options?: unknown) => {
            state.calls.push({
              command,
              payload: structuredClone(payload ?? null),
            });
            if (command === "get_operator_forge_settings") {
              state.settingsCalls += 1;
              if (state.mode === "held") await held;
              if (state.mode === "error")
                throw new Error("Runtime defaults unavailable");
            }
            if (!realInvoke) throw new Error("Mock IPC missing");
            const result = await realInvoke(command, payload, options);
            if (command !== "get_operator_forge_settings") return result;
            const settings =
              result as import("../../../src/shared/api/tauriOperatorForge").OperatorForgeSettingsV1;
            return {
              ...settings,
              preferences: {
                ...settings.preferences,
                runtimeConfirmed: confirmed,
                defaultRuntimeTarget: target,
              },
              // An unconfirmed saved value must not override recommendation.
              recommendation: { kind: "native", runtime: "hermes" },
            };
          },
      });
    },
    {
      target: options.target ?? { kind: "native", runtime: "hermes" },
      confirmed: options.confirmed ?? true,
      mode: options.mode ?? "ready",
    },
  );
  await installLibraryBridge(page, {
    globalAgentConfig: {
      env_vars: {},
      provider: null,
      model: null,
      preferred_runtime: "buzz-agent",
    },
    acpRuntimesCatalog: [
      {
        id: "codex",
        label: "Codex",
        availability: "available",
        command: "codex-acp",
        binary_path: "/fixture/bin/codex-acp",
        default_args: [],
        auth_status: { status: "authenticated" },
      },
      {
        id: "buzz-agent",
        label: "Buzz Agent",
        availability: "available",
        command: "buzz-agent",
        binary_path: "/fixture/bin/buzz-agent",
        default_args: [],
        auth_status: { status: "not_applicable" },
      },
    ],
  });
}

async function openLibraryCreate(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Add agent", exact: true }).click();
  await page
    .getByRole("button", { name: "Create another resident", exact: true })
    .click();
}

async function libraryCreationCalls(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    (window.__CREATE_DEFAULT_TEST__?.calls ?? []).filter(({ command }) =>
      [
        "create_persona",
        "create_luca_resident",
        "create_managed_agent",
        "execute_native_agent_provisioning",
      ].includes(command),
    ),
  );
}

test("Agents Create honors confirmed Hermes over the managed app default", async ({
  page,
}, testInfo) => {
  await installCreateDefaultBridge(page);
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");
  await openLibraryCreate(page);
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Runtime", exact: true }),
  ).toHaveValue("hermes");
  await expect(page.getByLabel("Agent harness", { exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel("Name", { exact: true }).fill("Default Hermes Scout");
  await page
    .getByLabel("Purpose and instructions")
    .fill("Read this project's sources and return a concise summary.");
  expect(await libraryCreationCalls(page)).toEqual([]);
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Provisioning review" }),
  ).toContainText("Hermes profile");
  expect(await libraryCreationCalls(page)).toEqual([]);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("confirmed-hermes-create-review.png"),
  });
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create a native agent" }),
  ).toHaveCount(0);
  const calls = await libraryCreationCalls(page);
  expect(calls.map(({ command }) => command)).toEqual([
    "create_persona",
    "execute_native_agent_provisioning",
  ]);
  expect(calls[1].payload).toMatchObject({
    input: {
      request: {
        runtime: "hermes",
        mode: "fresh",
        displayName: "Default Hermes Scout",
      },
    },
  });
  await expect(
    page.getByText("Default Hermes Scout", { exact: true }).first(),
  ).toBeVisible();
  const residents = await page.evaluate(
    async () =>
      (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "list_managed_agents",
      )) as Array<{ name: string; pubkey: string }>,
  );
  expect(
    residents.filter(({ name }) => name === "Default Hermes Scout"),
  ).toHaveLength(1);
  expect(
    residents.filter(({ pubkey }) =>
      [LUCA_PUBKEY, MARA_PUBKEY].includes(pubkey),
    ),
  ).toHaveLength(2);
});

test("Agents Create uses the recommendation until the owner confirms a runtime", async ({
  page,
}) => {
  await installCreateDefaultBridge(page, {
    target: { kind: "managed", runtimeId: "codex" },
    confirmed: false,
  });
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");
  await openLibraryCreate(page);
  await expect(
    page.getByRole("combobox", { name: "Runtime", exact: true }),
  ).toHaveValue("hermes");
  expect(await libraryCreationCalls(page)).toEqual([]);
});

test("Agents Create preserves the confirmed managed resident creation path", async ({
  page,
}) => {
  await installCreateDefaultBridge(page, {
    target: { kind: "managed", runtimeId: "codex" },
  });
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");
  await openLibraryCreate(page);
  await expect(page.getByLabel("Agent harness", { exact: true })).toContainText(
    "Codex",
  );
  await expect(
    page.getByRole("combobox", { name: "Runtime", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Agent name", { exact: true })
    .fill("Managed Default Scout");
  await page
    .getByLabel("Agent instructions", { exact: true })
    .fill("Summarize this project's sources.");
  expect(await libraryCreationCalls(page)).toEqual([]);
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(page.getByLabel("Agent name", { exact: true })).toHaveCount(0);
  const calls = await libraryCreationCalls(page);
  expect(calls.map(({ command }) => command)).toEqual([
    "create_persona",
    "create_luca_resident",
  ]);
  expect(calls[0].payload).toMatchObject({
    input: { runtime: "codex", displayName: "Managed Default Scout" },
  });
  expect(calls[1].payload).toMatchObject({
    input: { agentCommand: "codex-acp", name: "Managed Default Scout" },
  });
  expect(await lifecycleCommands(page)).toEqual([]);
});

test("Agents Create waits for a held runtime default without opening a different form", async ({
  page,
}, testInfo) => {
  await installCreateDefaultBridge(page, { mode: "held" });
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");
  await openLibraryCreate(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.__CREATE_DEFAULT_TEST__?.settingsCalls ?? 0),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("status")).toHaveText(
    "Loading your runtime default…",
  );
  await expect(page.getByLabel("Agent harness", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("combobox", { name: "Runtime", exact: true }),
  ).toHaveCount(0);
  expect(await libraryCreationCalls(page)).toEqual([]);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("create-default-loading.png"),
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.evaluate(() => window.__CREATE_DEFAULT_TEST__?.release());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await openLibraryCreate(page);
  await expect(
    page.getByRole("combobox", { name: "Runtime", exact: true }),
  ).toHaveValue("hermes");
  expect(await libraryCreationCalls(page)).toEqual([]);
});

test("Agents Create retries an unavailable default and preserves explicit native choices", async ({
  page,
}, testInfo) => {
  await installCreateDefaultBridge(page, { mode: "error" });
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");
  await openLibraryCreate(page);
  await expect(page.getByRole("alert")).toContainText(
    "Your runtime default could not be loaded.",
  );
  await expect(page.getByLabel("Agent harness", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("combobox", { name: "Runtime", exact: true }),
  ).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("create-default-unavailable.png"),
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const runtime of ["Hermes", "OpenClaw"] as const) {
    await page.getByRole("button", { name: "Add agent", exact: true }).click();
    await page
      .getByRole("button", { name: `New ${runtime} agent…`, exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Runtime", exact: true }),
    ).toHaveValue(runtime.toLowerCase());
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await openLibraryCreate(page);
  await expect(page.getByRole("alert")).toContainText(
    "Your runtime default could not be loaded.",
  );
  await page.evaluate(() => {
    if (window.__CREATE_DEFAULT_TEST__)
      window.__CREATE_DEFAULT_TEST__.mode = "ready";
  });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Runtime", exact: true }),
  ).toHaveValue("hermes");
  expect(await libraryCreationCalls(page)).toEqual([]);
});

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

type ImportSelection =
  import("../../../src/shared/api/tauriResidentProposals").NativeImportSelection;
type ImportResult =
  import("../../../src/shared/api/tauriResidentProposals").NativeImportResult;
type ImportCall = { command: string; payload: unknown };
type OrdinaryImportHost = {
  calls: ImportCall[];
  fail: "continuity" | "launch" | "start" | null;
  lostAcks: number;
  revoked: boolean;
  hideCandidate: boolean;
  held: boolean;
  imports: Record<
    string,
    {
      selection: ImportSelection;
      admitted: boolean;
      busy: boolean;
      applied: boolean;
      result: ImportResult | null;
    }
  >;
};
declare global {
  interface Window {
    __ORDINARY_IMPORT_TEST__?: OrdinaryImportHost;
  }
}
const IMPORT_PROFILE = {
  nativeType: "hermes" as const,
  nativeId: "research",
  semanticId: "hermes:/fixture/hermes/research:research",
  bindingFingerprint: "reviewed-hermes-binding",
  displayName: "Research",
  canonicalLocation: "/fixture/hermes/research",
  readiness: {
    status: "discovered" as const,
    message: "Native connection not checked yet.",
  },
  warnings: [],
  bindingPreview: {
    kind: "hermes" as const,
    schemaVersion: 1 as const,
    profileName: "research",
    hermesHome: "/fixture/hermes/research",
    executablePath: "/fixture/bin/hermes",
    runtimeVersion: "fixture-1",
  },
};

// Only the host boundary is simulated; the ordinary review, saved result and
// recovery controls are production UI. Rust tests run the shared coordinator.
async function installOrdinaryImport(
  page: import("@playwright/test").Page,
  options: {
    fail?: OrdinaryImportHost["fail"];
    lostAcks?: number;
    reuse?: boolean;
    held?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({ candidate, options }) => {
      const state: OrdinaryImportHost = {
        calls: [],
        fail: options.fail ?? null,
        lostAcks: options.lostAcks ?? 0,
        revoked: false,
        hideCandidate: false,
        held: options.held ?? false,
        imports: {},
      };
      window.__ORDINARY_IMPORT_TEST__ = state;
      type Invoke = (
        command: string,
        payload?: unknown,
        invokeOptions?: unknown,
      ) => Promise<unknown>;
      let realInvoke: Invoke | undefined;
      const target = window as unknown as {
        __TAURI_INTERNALS__?: Record<string, unknown>;
      };
      const internals = target.__TAURI_INTERNALS__ ?? {};
      target.__TAURI_INTERNALS__ = internals;
      const ipc: Invoke = async (command, payload, invokeOptions) => {
        state.calls.push({
          command,
          payload: structuredClone(payload ?? null),
        });
        if (
          command === "set_resident_continuity_enabled" &&
          state.fail === "continuity"
        )
          throw new Error("Consent store unavailable");
        if (
          command === "set_managed_agent_start_on_app_launch" &&
          state.fail === "launch"
        )
          throw new Error("Launch store unavailable");
        if (command === "start_managed_agent" && state.fail === "start")
          throw new Error("Native startup unavailable");
        if (!realInvoke) throw new Error("Mock IPC missing");
        return realInvoke(command, payload, invokeOptions);
      };
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        set: (invoke: Invoke) => {
          realInvoke = invoke;
        },
        get:
          () =>
          async (
            command: string,
            payload?: unknown,
            invokeOptions?: unknown,
          ) => {
            if (command === "discover_native_residents" && state.hideCandidate)
              return {
                runtimes: [
                  { nativeType: "hermes", status: "absent", candidates: [] },
                ],
              };
            if (
              command !== "prepare_native_resident_import" &&
              command !== "import_native_resident"
            )
              return ipc(command, payload, invokeOptions);
            state.calls.push({
              command,
              payload: structuredClone(payload ?? null),
            });
            if (state.revoked)
              throw new Error(
                "This import review has expired or its owner/workspace changed.",
              );
            if (command === "prepare_native_resident_import") {
              const { selection } = payload as { selection: ImportSelection };
              if (
                selection.semanticId !== candidate.semanticId ||
                selection.bindingFingerprint !== candidate.bindingFingerprint
              )
                throw new Error("Selected profile changed");
              const prior = Object.entries(state.imports).find(
                ([, entry]) =>
                  entry.admitted &&
                  (entry.busy || !entry.applied || entry.result?.startupError),
              );
              if (prior)
                return {
                  attemptId: prior[0],
                  selection: structuredClone(prior[1].selection),
                  admitted: true,
                };
              const id = `host-import-${Object.keys(state.imports).length + 1}`;
              state.imports[id] = {
                selection: structuredClone(selection),
                admitted: false,
                busy: false,
                applied: false,
                result: null,
              };
              return {
                attemptId: id,
                selection: structuredClone(selection),
                admitted: false,
              };
            }
            const { attemptId, action } = payload as {
              attemptId: string;
              action: "import" | "verify" | "retry_settings" | "retry_start";
            };
            const entry = state.imports[attemptId];
            if (!entry || entry.busy)
              throw new Error("Import unavailable or busy");
            const first = !entry.admitted;
            if (first && action !== "import")
              throw new Error("No saved import");
            entry.admitted = true;
            entry.busy = true;
            try {
              if (first) {
                const residents = (await ipc("list_managed_agents")) as Array<{
                  pubkey: string;
                  native_runtime_binding: {
                    hermesHome?: string;
                    profileName?: string;
                  } | null;
                  status: string;
                }>;
                const existing = residents.find(
                  (resident) =>
                    resident.native_runtime_binding?.hermesHome ===
                      candidate.bindingPreview.hermesHome &&
                    resident.native_runtime_binding.profileName ===
                      candidate.nativeId,
                );
                const created = existing
                  ? null
                  : ((await ipc("create_luca_resident", {
                      input: {
                        name: candidate.displayName,
                        agentCommand: candidate.bindingPreview.executablePath,
                        agentArgs: ["acp"],
                        harnessOverride: true,
                        parallelism: 1,
                        nativeRuntimeBinding: candidate.bindingPreview,
                        spawnAfterCreate: false,
                        startOnAppLaunch: false,
                      },
                    })) as { resident: { residentPubkey: string } });
                const key =
                  existing?.pubkey ?? created?.resident.residentPubkey;
                if (!key) throw new Error("Saved key missing");
                entry.applied = !!existing;
                entry.result = {
                  residentPubkey: key,
                  displayName: candidate.displayName,
                  nativeProfileName: candidate.nativeId,
                  reused: !!existing,
                  processRunning: existing?.status === "running",
                  authenticatedReady: false,
                  startupError: null,
                  warning: null,
                  preferencesError: null,
                };
              }
              while (state.held)
                await new Promise((resolve) => setTimeout(resolve, 10));
              if (state.revoked || !entry.result)
                throw new Error("This import review has ended.");
              const result = entry.result;
              if ((first || action === "retry_settings") && !entry.applied) {
                try {
                  await ipc("set_resident_continuity_enabled", {
                    residentPubkey: result.residentPubkey,
                    enabled: entry.selection.continuityEnabled,
                  });
                  await ipc("set_managed_agent_start_on_app_launch", {
                    pubkey: result.residentPubkey,
                    startOnAppLaunch: entry.selection.startOnAppLaunch,
                  });
                  entry.applied = true;
                  result.preferencesError = null;
                } catch (cause) {
                  result.preferencesError = String(cause);
                }
              }
              if (
                entry.applied &&
                !result.processRunning &&
                entry.selection.startNow &&
                (first ||
                  action === "retry_settings" ||
                  action === "retry_start")
              ) {
                try {
                  await ipc("start_managed_agent", {
                    pubkey: result.residentPubkey,
                  });
                  result.processRunning = true;
                  result.startupError = null;
                } catch (cause) {
                  result.startupError = String(cause);
                }
              }
              if (state.lostAcks > 0) {
                state.lostAcks -= 1;
                throw new Error(
                  "Import acknowledgment interrupted after save.",
                );
              }
              return structuredClone(result);
            } finally {
              entry.busy = false;
            }
          },
      });
    },
    { candidate: IMPORT_PROFILE, options },
  );
  await installMockBridge(page, {
    nativeResidentDiscovery: {
      runtimes: [
        {
          nativeType: "hermes",
          status: "available",
          candidates: [IMPORT_PROFILE],
        },
      ],
    },
    ...(options.reuse
      ? {
          managedAgents: [
            {
              name: "Research",
              pubkey: "44".repeat(32),
              status: "stopped" as const,
              startOnAppLaunch: true,
              nativeRuntimeBinding: IMPORT_PROFILE.bindingPreview,
            },
          ],
        }
      : {}),
  });
}
async function openOrdinaryImport(page: import("@playwright/test").Page) {
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");
  await page
    .getByRole("button", { name: "Add agent", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Add an agent" });
  await expect(
    dialog.getByRole("heading", { name: "Agents already on this Mac" }),
  ).toBeVisible();
  return dialog;
}
async function importEffects(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      window.__ORDINARY_IMPORT_TEST__?.calls.filter((call) =>
        [
          "create_luca_resident",
          "set_resident_continuity_enabled",
          "set_managed_agent_start_on_app_launch",
          "start_managed_agent",
        ].includes(call.command),
      ) ?? [],
  );
}
async function importResult(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      Object.values(window.__ORDINARY_IMPORT_TEST__?.imports ?? {})[0]?.result,
  );
}

for (const failure of ["continuity", "launch"] as const) {
  test(`ordinary Hermes ${failure} failure keeps the saved identity stopped until reviewed-settings retry`, async ({
    page,
  }, testInfo) => {
    await installOrdinaryImport(page, { fail: failure });
    const dialog = await openOrdinaryImport(page);
    await dialog
      .getByRole("switch", {
        name: "Enable Luca continuity for Research",
        exact: true,
      })
      .uncheck();
    await dialog.getByRole("button", { name: /^Import(?: profile)?$/ }).click();
    await expect
      .poll(
        async () =>
          (await importEffects(page)).filter(
            (call) => call.command === "create_luca_resident",
          ).length,
      )
      .toBe(1);
    const first = (await importEffects(page))[0].payload as {
      input: Record<string, unknown>;
    };
    expect(first.input).toMatchObject({
      spawnAfterCreate: false,
      startOnAppLaunch: false,
      nativeRuntimeBinding: IMPORT_PROFILE.bindingPreview,
      parallelism: 1,
    });
    const result = dialog.getByRole("region", {
      name: "Import result for Research",
    });
    await expect(result).toContainText("Startup from this review is blocked");
    const saved = await importResult(page);
    expect(saved?.processRunning).toBe(false);
    expect(
      (await importEffects(page)).some(
        (call) => call.command === "start_managed_agent",
      ),
    ).toBe(false);
    if (failure === "continuity")
      expect(
        (await importEffects(page)).some(
          (call) => call.command === "set_managed_agent_start_on_app_launch",
        ),
      ).toBe(false);
    const effects = await importEffects(page);
    await page.evaluate(() => {
      if (window.__ORDINARY_IMPORT_TEST__)
        window.__ORDINARY_IMPORT_TEST__.hideCandidate = true;
    });
    await dialog.getByRole("button", { name: "Scan for agents again" }).click();
    await expect(
      dialog.getByRole("button", { name: "Scan for agents again" }),
    ).toBeEnabled();
    await expect(result).toContainText("Startup from this review is blocked");
    await expect(
      dialog.getByRole("button", { name: "Reuse profile", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        Object.keys(window.__ORDINARY_IMPORT_TEST__?.imports ?? {}),
      ),
    ).toEqual(["host-import-1"]);
    await dialog
      .getByRole("button", { name: "Verify import", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Verify import", exact: true }),
    ).toBeEnabled();
    expect(await importEffects(page)).toEqual(effects);
    await page.evaluate(() => {
      if (window.__ORDINARY_IMPORT_TEST__)
        window.__ORDINARY_IMPORT_TEST__.hideCandidate = false;
    });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await page
      .getByRole("button", { name: "Add agent", exact: true })
      .first()
      .click();
    await dialog
      .getByRole("switch", { name: "Start Research now", exact: true })
      .uncheck();
    await dialog
      .getByRole("button", { name: "Reuse profile", exact: true })
      .click();
    await expect(dialog).toContainText("Resumed earlier review: start now.");
    const resumedSelection = await page.evaluate(
      () =>
        window.__ORDINARY_IMPORT_TEST__?.calls
          .filter((call) => call.command === "prepare_native_resident_import")
          .at(-1)?.payload as { selection: ImportSelection },
    );
    expect(resumedSelection.selection.startNow).toBe(false);
    await expect(
      dialog.getByRole("button", {
        name: "Retry settings and start",
        exact: true,
      }),
    ).toBeVisible();
    await expect(result).toContainText("Startup from this review is blocked");
    await expect(dialog).toContainText("Luca handoff off; start with Luca off");
    expect(await importEffects(page)).toEqual(effects);
    expect(
      await page.evaluate(() =>
        Object.keys(window.__ORDINARY_IMPORT_TEST__?.imports ?? {}),
      ),
    ).toEqual(["host-import-1"]);
    await dialog
      .getByRole("button", { name: "Retry settings and start" })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Retry settings and start" }),
    ).toBeEnabled();
    expect((await importResult(page))?.residentPubkey).toBe(
      saved?.residentPubkey,
    );
    await waitForAnimations(page);
    await result.screenshot({
      path: testInfo.outputPath(`ordinary-${failure}-failure.png`),
    });
    await page.evaluate(() => {
      if (window.__ORDINARY_IMPORT_TEST__)
        window.__ORDINARY_IMPORT_TEST__.fail = null;
    });
    await dialog
      .getByRole("button", { name: "Retry settings and start" })
      .click();
    await expect(result).toContainText("process is started");
    expect((await importResult(page))?.residentPubkey).toBe(
      saved?.residentPubkey,
    );
    expect(
      (await importEffects(page)).filter(
        (call) => call.command === "create_luca_resident",
      ),
    ).toHaveLength(1);
    expect(
      (await importEffects(page)).slice(-3).map((call) => call.command),
    ).toEqual([
      "set_resident_continuity_enabled",
      "set_managed_agent_start_on_app_launch",
      "start_managed_agent",
    ]);
    await expect(
      dialog.getByRole("button", { name: "Import profile", exact: true }),
    ).toHaveCount(0);
  });
}

test("ordinary Hermes startup retry and lost acknowledgment keep one key and never repeat settings", async ({
  page,
}) => {
  await installOrdinaryImport(page, { fail: "start", lostAcks: 1 });
  const dialog = await openOrdinaryImport(page);
  await dialog
    .getByRole("button", { name: "Import profile", exact: true })
    .click();
  await expect(dialog).toContainText("acknowledgment interrupted");
  const saved = await importResult(page);
  const effects = await importEffects(page);
  await dialog
    .getByRole("button", { name: "Verify import", exact: true })
    .click();
  await expect(dialog).toContainText("Could not start");
  expect(await importEffects(page)).toEqual(effects);
  await page.evaluate(() => {
    if (window.__ORDINARY_IMPORT_TEST__)
      window.__ORDINARY_IMPORT_TEST__.fail = null;
  });
  await dialog
    .getByRole("button", { name: "Retry start", exact: true })
    .click();
  await expect(dialog).toContainText("process is started");
  expect((await importResult(page))?.residentPubkey).toBe(
    saved?.residentPubkey,
  );
  expect((await importEffects(page)).slice(0, -1)).toEqual(effects);
  expect((await importEffects(page)).at(-1)?.command).toBe(
    "start_managed_agent",
  );
});

test("ordinary Hermes true reuse keeps existing preferences and the exact stable identity", async ({
  page,
}) => {
  await installOrdinaryImport(page, { reuse: true });
  const dialog = await openOrdinaryImport(page);
  await expect(dialog).toContainText(
    "keep its existing handoff and launch settings",
  );
  await expect(
    dialog.getByRole("switch", { name: "Enable Luca continuity for Research" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Reuse profile", exact: true })
    .click();
  await expect(dialog).toContainText("Reused the existing identity");
  expect((await importResult(page))?.residentPubkey).toBe("44".repeat(32));
  expect((await importEffects(page)).map((call) => call.command)).toEqual([
    "start_managed_agent",
  ]);
});

test("ordinary Hermes recovery refuses an expired owner or workspace review without further effects", async ({
  page,
}) => {
  await installOrdinaryImport(page, { fail: "continuity" });
  const dialog = await openOrdinaryImport(page);
  await dialog
    .getByRole("button", { name: "Import profile", exact: true })
    .click();
  await expect(dialog).toContainText("Startup from this review is blocked");
  const before = await importEffects(page);
  await page.evaluate(() => {
    if (window.__ORDINARY_IMPORT_TEST__)
      window.__ORDINARY_IMPORT_TEST__.revoked = true;
  });
  await dialog
    .getByRole("button", { name: "Retry settings and start" })
    .click();
  await expect(dialog).toContainText("owner/workspace changed");
  expect(await importEffects(page)).toEqual(before);
});

test("ordinary Hermes compact 150 percent review exposes exact profile and stopped import consent", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.addInitScript(() =>
    localStorage.setItem("buzz:text-scale", "1.5"),
  );
  await installOrdinaryImport(page);
  const dialog = await openOrdinaryImport(page);
  const row = dialog.getByTestId(
    `ordinary-hermes-import-${IMPORT_PROFILE.semanticId}`,
  );
  await row
    .getByRole("switch", { name: "Start Research now", exact: true })
    .uncheck();
  await row
    .getByRole("switch", { name: "Start Research with Luca", exact: true })
    .check();
  await row
    .getByRole("switch", {
      name: "Enable Luca continuity for Research",
      exact: true,
    })
    .uncheck();
  await expect(row).toContainText(IMPORT_PROFILE.canonicalLocation);
  const action = row.getByRole("button", {
    name: "Import profile",
    exact: true,
  });
  await row.scrollIntoViewIfNeeded();
  await expect(
    row.getByRole("heading", { name: "Research", exact: true }),
  ).toBeInViewport();
  await expect(
    row.getByText(
      `${IMPORT_PROFILE.nativeId} · ${IMPORT_PROFILE.canonicalLocation}`,
      { exact: true },
    ),
  ).toBeInViewport();
  await expect(action).toBeInViewport();
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("ordinary-hermes-review-zoom150.png"),
  });
  await action.click();
  const result = row.getByRole("region", {
    name: "Import result for Research",
  });
  await expect(result).toContainText("is imported and stopped");
  await expect(result).toBeFocused();
  await expect(result).toBeInViewport();
  await row.scrollIntoViewIfNeeded();
  expect((await importEffects(page)).map((call) => call.command)).toEqual([
    "create_luca_resident",
    "set_resident_continuity_enabled",
    "set_managed_agent_start_on_app_launch",
  ]);
  const prepared = await page.evaluate(
    () =>
      Object.values(window.__ORDINARY_IMPORT_TEST__?.imports ?? {})[0]
        ?.selection,
  );
  expect(prepared).toEqual({
    semanticId: IMPORT_PROFILE.semanticId,
    bindingFingerprint: IMPORT_PROFILE.bindingFingerprint,
    startNow: false,
    startOnAppLaunch: true,
    continuityEnabled: false,
  });
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("ordinary-hermes-stopped-zoom150.png"),
  });
});
