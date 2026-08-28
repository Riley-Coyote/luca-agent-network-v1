import { expect, test } from "@playwright/test";

import type { NativeResidentDiscoveryOutcome } from "../../../src/shared/api/types";
import { installMockBridge } from "../../helpers/bridge";
import { LARGE_NATIVE_RESIDENT_DISCOVERY } from "./onboarding-agent-import-fixture";

const NO_AGENTS: NativeResidentDiscoveryOutcome = { runtimes: [] };
const ONE_NATIVE_AGENT: NativeResidentDiscoveryOutcome = {
  runtimes: LARGE_NATIVE_RESIDENT_DISCOVERY.runtimes.map((runtime) => ({
    ...runtime,
    candidates:
      runtime.nativeType === "hermes" ? runtime.candidates.slice(0, 1) : [],
  })),
};
const NATIVE_AGENT_NOTICE_MARKER = "polyphonic-native-agent-notice.v1";
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

test("the setup card follows the chosen application appearance", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: NO_AGENTS,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await page.getByRole("button", { name: "Begin setup" }).click();

  const onboarding = page.getByTestId("polyphonic-onboarding");
  const surface = page.getByTestId("polyphonic-setup-assistant");
  await expect(onboarding).toHaveAttribute("data-system-color-scheme", "dark");

  await page.getByRole("button", { name: "Light" }).click();
  await expect(onboarding).toHaveAttribute("data-system-color-scheme", "light");
  await expect(onboarding).toHaveCSS("background-color", "rgb(233, 232, 227)");
  await expect(surface).toHaveCSS("background-color", "rgb(246, 245, 241)");

  await page.getByRole("button", { name: "Dark" }).click();
  await expect(onboarding).toHaveAttribute("data-system-color-scheme", "dark");
  await expect(onboarding).toHaveCSS("background-color", "rgb(6, 6, 8)");
  await expect(surface).toHaveCSS("background-color", "rgb(20, 20, 22)");

  await page.getByRole("button", { name: "System" }).click();
  await expect(onboarding).toHaveAttribute("data-system-color-scheme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(onboarding).toHaveAttribute("data-system-color-scheme", "light");
  await expect(onboarding).toHaveCSS("background-color", "rgb(233, 232, 227)");
  await expect(surface).toHaveCSS("background-color", "rgb(246, 245, 241)");
});

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
      "Hey Riley — I’m Luca. I’ve had a quiet look around this Mac, so whenever you’re ready, tell me what you’re working on, or pick a place to begin.",
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
    evidence.payloads.find((entry) => entry.command === "create_luca_resident")
      ?.payload,
  ).toMatchObject({
    input: { spawnAfterCreate: true, startOnAppLaunch: true },
  });
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

test("the canonical Luca notice is trusted and published only once", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: ONE_NATIVE_AGENT,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await begin(page);
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(
    page.getByRole("heading", { name: "Bring in agents you already use" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Not now" }).click();

  await expect(page).toHaveURL(/#\/channels\//);
  const channelId = decodeURIComponent(
    page.url().match(/#\/channels\/([^?]+)/)?.[1] ?? "",
  );
  expect(channelId).not.toBe("");
  const lucaPubkey = await page.evaluate(async () => {
    const snapshot = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "list_luca_residents",
    )) as {
      residents: Array<{ personaId: string | null; residentPubkey: string }>;
    };
    return snapshot.residents.find(
      (resident) => resident.personaId === "builtin:fizz",
    )?.residentPubkey;
  });
  expect(lucaPubkey).toBeTruthy();

  await page.evaluate(
    async ({ currentChannelId, marker }) => {
      await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("send_channel_message", {
        channelId: currentChannelId,
        content: "I found agents already on this Mac.",
        mediaTags: [["client", marker]],
      });
    },
    { currentChannelId: channelId, marker: NATIVE_AGENT_NOTICE_MARKER },
  );
  await expect(page.getByTestId("native-agent-notice")).toHaveCount(0);

  await page.getByTestId("message-input").fill("Help me plan today.");
  await page.getByTestId("message-input").press("Enter");
  await page.evaluate(
    async ({ agentPubkey, currentChannelId }) => {
      await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "send_managed_agent_channel_message",
        {
          agentPubkey,
          channelId: currentChannelId,
          content: "I can help you choose the most important next step.",
        },
      );
    },
    { agentPubkey: lucaPubkey, currentChannelId: channelId },
  );

  await expect(page.getByTestId("native-agent-notice")).toHaveCount(1);
  await page.getByRole("button", { name: "Review agents" }).click();
  await expect(page).toHaveURL(/#\/agents/);
  await expect(
    page.getByRole("heading", { name: "Add an agent" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agents already on this Mac" }),
  ).toBeVisible();

  await page.evaluate((currentChannelId) => {
    window.location.hash = `#/channels/${currentChannelId}`;
  }, channelId);
  await expect(page.getByTestId("native-agent-notice")).toHaveCount(1);
  await page.waitForTimeout(100);
  const noticePublications = await page.evaluate(
    (marker) =>
      (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
        (entry) =>
          entry.command === "send_managed_agent_channel_message" &&
          (entry.payload as { marker?: string }).marker === marker,
      ),
    NATIVE_AGENT_NOTICE_MARKER,
  );
  expect(noticePublications).toHaveLength(1);
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
  await page.emulateMedia({ colorScheme: "dark" });
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
  await expect(inventory).toHaveCount(0);
  await expect(page.getByText("21 profiles found")).toBeVisible();
  await expect(page.getByText("21 agents found")).toBeVisible();
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(
    page.getByRole("heading", { name: "Choose agents" }),
  ).toBeFocused();
  await expect(inventory).toBeVisible();
  await expect(page.getByTestId("polyphonic-setup-continue")).toBeVisible();
  await expect(page.locator("h1:visible")).toHaveCount(1);
  await expect(page.getByPlaceholder("Search agents")).toHaveCSS(
    "background-color",
    "rgb(14, 14, 16)",
  );
  await expect(inventory).toHaveCSS("background-color", "rgb(10, 10, 12)");
  const pageOverflow = await page.evaluate(() => ({
    horizontal:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
    vertical:
      document.documentElement.scrollHeight >
      document.documentElement.clientHeight,
  }));
  expect(pageOverflow).toEqual({ horizontal: false, vertical: false });
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
