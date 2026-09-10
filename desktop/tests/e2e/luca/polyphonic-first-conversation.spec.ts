import { expect, test } from "@playwright/test";

import type { NativeResidentDiscoveryOutcome } from "../../../src/shared/api/types";
import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { LARGE_NATIVE_RESIDENT_DISCOVERY } from "./onboarding-agent-import-fixture";

const ONE_NATIVE_AGENT: NativeResidentDiscoveryOutcome = {
  runtimes: LARGE_NATIVE_RESIDENT_DISCOVERY.runtimes.map((runtime) => ({
    ...runtime,
    candidates:
      runtime.nativeType === "hermes" ? runtime.candidates.slice(0, 1) : [],
  })),
};
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
const GREETING = /Hi Riley. I’m Luca/;

async function arriveInLucaDm(page: import("@playwright/test").Page) {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: ONE_NATIVE_AGENT,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await page.getByTestId("polyphonic-door-begin").click();
  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  await page.getByTestId("polyphonic-setup-continue").click();
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(page).toHaveURL(/#\/channels\//, { timeout: 30_000 });
}

test("setup opens an immediately usable composer with the rail collapsed", async ({
  page,
}) => {
  await arriveInLucaDm(page);
  await expect(page.getByTestId("luca-first-conversation")).toBeVisible();
  await expect(page.getByText(GREETING).filter({ visible: true })).toHaveCount(
    1,
  );
  await expect(page.getByTestId("message-input")).toBeFocused();
  await expect(
    page.locator('[data-state="collapsed"][data-side="left"]'),
  ).toHaveCount(1);
  await expect(page.getByText(/thinking/i)).toHaveCount(0);
  // The owner can expand the rail without the first-run effect fighting them.
  await page
    .getByRole("button", { name: "Toggle Sidebar", exact: true })
    .click();
  await expect(
    page.locator('[data-state="expanded"][data-side="left"]'),
  ).toHaveCount(1);
});

test("Luca's opening offer is sent as the owner's words and then retires", async ({
  page,
}) => {
  await arriveInLucaDm(page);
  const choices = page.getByTestId("luca-greeting-choices");
  await expect(choices).toBeVisible({ timeout: 5000 });
  await expect(choices.getByRole("button")).toHaveCount(2);
  await page.getByTestId("luca-greeting-choice-1").click();
  await expect(page.getByText("Start something", { exact: true })).toHaveCount(
    1,
  );
  await expect(choices).toHaveCount(0);
});

test("a typed first message replaces the welcome with the ordinary timeline", async ({
  page,
}) => {
  await arriveInLucaDm(page);
  const composer = page.getByTestId("message-input");
  await expect(page.getByTestId("luca-first-conversation")).toBeVisible();
  await composer.fill("Help me plan a small garden.");
  await composer.press("Enter");
  await expect(page.getByTestId("luca-first-conversation")).toHaveCount(0);
  await expect(
    page.getByText("Help me plan a small garden.", { exact: true }),
  ).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(page.getByTestId("luca-greeting-choices")).toHaveCount(0);
});

test("first chat fits compact windows in light and dark appearance", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await arriveInLucaDm(page);
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.setViewportSize({ width: 800, height: 500 });
    await expect(page.getByTestId("message-input")).toBeInViewport();
    await expect(page.getByTestId("luca-greeting-choices")).toBeInViewport();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(overflow).toBe(false);
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/onboarding-walkthrough/first-chat-${colorScheme}-compact.png`,
    });
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/onboarding-walkthrough/first-chat-dark-desktop.png",
  });
});

test("first-use layout preserves the canonical resident and one durable greeting", async ({
  page,
}) => {
  await arriveInLucaDm(page);
  await expect(page.getByTestId("luca-first-conversation")).toBeVisible();
  const identity = await page.evaluate(async () => {
    const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
    if (!invoke) throw new Error("Mock command boundary is unavailable");
    const registry = (await invoke("list_luca_residents")) as {
      residents: Array<{ residentPubkey: string; personaId: string | null }>;
    };
    const owner = (await invoke("get_identity")) as { pubkey: string };
    const channels = (await invoke("get_channels")) as Array<{
      id: string;
      channel_type: string;
      participant_pubkeys: string[];
    }>;
    const channelId = window.location.hash.split("/channels/")[1];
    const commands = window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [];
    return {
      canonical: registry.residents.filter(
        (resident) => resident.personaId === "builtin:fizz",
      ),
      ownerPubkey: owner.pubkey,
      channel: channels.find((channel) => channel.id === channelId),
      greetings: commands.filter(
        (entry) => entry.command === "send_managed_agent_channel_message",
      ),
    };
  });
  expect(identity.canonical).toHaveLength(1);
  const residentPubkey = identity.canonical[0].residentPubkey;
  expect(residentPubkey).not.toBe(identity.ownerPubkey);
  expect(identity.channel?.channel_type).toBe("dm");
  expect(identity.channel?.participant_pubkeys.toSorted()).toEqual(
    [identity.ownerPubkey, residentPubkey].toSorted(),
  );
  expect(identity.greetings).toHaveLength(1);
  expect(identity.greetings[0].payload).toMatchObject({
    agentPubkey: residentPubkey,
    channelId: identity.channel?.id,
    markerScope: "channel",
  });
});
