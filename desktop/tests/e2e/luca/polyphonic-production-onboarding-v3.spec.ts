import { expect, test } from "@playwright/test";

import type { NativeResidentDiscoveryOutcome } from "../../../src/shared/api/types";
import { installMockBridge } from "../../helpers/bridge";
import { LARGE_NATIVE_RESIDENT_DISCOVERY } from "./onboarding-agent-import-fixture";

const NO_AGENTS: NativeResidentDiscoveryOutcome = { runtimes: [] };
const READY_CODEX_RUNTIME = {
  id: "codex",
  label: "Codex",
  avatar_url: "",
  availability: "available",
  command: "codex",
  binary_path: "/synthetic/bin/codex",
  default_args: [],
  mcp_command: null,
  install_hint: "Install Codex",
  install_instructions_url: "https://example.invalid/codex",
  can_auto_install: false,
  underlying_cli_path: null,
  node_required: false,
  auth_status: { status: "logged_in" },
  login_hint: "Sign in to Codex",
};

async function begin(page: import("@playwright/test").Page) {
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await page.getByRole("button", { name: "Begin setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Bring your agents together." }),
  ).toBeFocused();
  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(
    page.getByRole("heading", { name: "Choose what powers Luca" }),
  ).toBeFocused();
}

test("a ready runtime enters the real Luca DM with one inert canonical greeting", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: NO_AGENTS,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await begin(page);
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();

  await expect(page).toHaveURL(/#\/channels\//);
  await expect(
    page.getByText(
      "Hi, Riley — I’m Luca. I’m ready. What would you like help with first?",
      { exact: true },
    ),
  ).toHaveCount(1);
  await expect(page.getByTestId("message-input")).toBeFocused();

  const evidence = await page.evaluate(() => ({
    commands: window.__BUZZ_E2E_COMMANDS__ ?? [],
    payloads: window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  }));
  expect(
    evidence.commands.filter((command) => command === "create_luca_resident"),
  ).toHaveLength(1);
  expect(
    evidence.commands.filter(
      (command) => command === "send_managed_agent_channel_message",
    ),
  ).toHaveLength(1);
  expect(
    evidence.commands.filter((command) => command === "start_managed_agent"),
  ).toHaveLength(0);
  expect(
    evidence.payloads.find(
      (entry) => entry.command === "send_managed_agent_channel_message",
    )?.payload,
  ).toMatchObject({
    marker: "polyphonic-onboarding.luca-greeting.v1",
    markerScope: "channel",
  });
});

for (const runtime of ["Hermes", "OpenClaw"]) {
  test(`${runtime} can power Luca and an empty discovery skips import`, async ({
    page,
  }) => {
    await installMockBridge(
      page,
      { nativeResidentDiscovery: NO_AGENTS },
      { skipCommunitySeed: true, skipOnboardingSeed: true },
    );
    await begin(page);
    await page.getByRole("radio", { name: new RegExp(runtime) }).check();
    await page.getByTestId("polyphonic-setup-continue").click();
    await expect(page).toHaveURL(/#\/channels\//);
    await expect(
      page.getByRole("heading", { name: "Bring in agents you already use" }),
    ).toHaveCount(0);
  });
}

test("large native inventories stay contained and imports do not start agents", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: LARGE_NATIVE_RESIDENT_DISCOVERY,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.setViewportSize({ width: 800, height: 500 });
  await begin(page);
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(
    page.getByRole("heading", { name: "Bring in agents you already use" }),
  ).toBeFocused();

  const inventory = page.getByTestId("onboarding-agent-import-list");
  await expect(inventory).toBeVisible();
  await expect(page.getByTestId("polyphonic-setup-continue")).toBeVisible();
  expect(
    await inventory.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Hermes profile 01" }).click();
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(page).toHaveURL(/#\/channels\//);

  const evidence = await page.evaluate(() => ({
    commands: window.__BUZZ_E2E_COMMANDS__ ?? [],
    payloads: window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  }));
  const imported = evidence.payloads.find(
    (entry) =>
      entry.command === "create_luca_resident" &&
      (entry.payload as { input?: { name?: string } }).input?.name ===
        "Hermes profile 01",
  );
  expect(imported?.payload).toMatchObject({
    input: { spawnAfterCreate: false, startOnAppLaunch: false },
  });
  expect(
    evidence.commands.filter((command) => command === "start_managed_agent"),
  ).toHaveLength(0);
});
