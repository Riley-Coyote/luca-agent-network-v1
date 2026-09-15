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
const GREETING = /Hello, I’m Luca/;

/** Two questions and a waking: the whole walk. Nothing is read on the way
 *  through — Luca asks to look around once the conversation exists. */
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
  await expect(page.getByTestId("polyphonic-setup-continue")).toHaveText(
    "Meet Luca",
  );
  await page.getByTestId("polyphonic-setup-continue").click();
  await page
    .getByRole("heading", { name: "Luca is waking up." })
    .waitFor({ timeout: 10_000 });
  await expect(page).toHaveURL(/#\/channels\//, { timeout: 30_000 });
  await expect(page.getByTestId("message-input")).toBeVisible({
    timeout: 30_000,
  });
}

test("the walk never asks about agents or sources", async ({ page }) => {
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
  // Two questions, so two hairlines.
  await expect(
    page.getByRole("heading", { name: "What should Luca call you?" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("img", { name: "Step 1 of 2" })).toHaveCount(1);
  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  await page.getByTestId("polyphonic-setup-continue").click();
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await page
    .getByRole("heading", { name: "Luca is waking up." })
    .waitFor({ timeout: 10_000 });
  // The two chapters that were cut are never rendered on the way past.
  await expect(
    page.getByRole("heading", { name: "Who else lives here?" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "What should Luca read?" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("onboarding-agent-import-list")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/channels\//, { timeout: 30_000 });
});

test("the waking screen says what it is doing and then hands over", async ({
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
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await page.getByTestId("polyphonic-door-begin").click();
  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  await page.getByTestId("polyphonic-setup-continue").click();
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  const phase = page.getByTestId("polyphonic-reading-phase");
  await expect(phase).toBeVisible({ timeout: 10_000 });
  // Whichever phase this frame catches, it is one of the two true ones, and
  // no spinner stands in for either.
  await expect(phase).toHaveText(/Starting Luca|Luca is writing to you/);
  await expect(page.getByTestId("polyphonic-walkthrough-ticks")).toBeVisible();
  await expect(page).toHaveURL(/#\/channels\//, { timeout: 30_000 });
});

test("setup opens the ordinary conversation, not a stage", async ({ page }) => {
  await arriveInLucaDm(page);
  // The header and the timeline are the first thing the owner sees: this is
  // a conversation, and it was one before they said anything.
  await expect(page.getByTestId("chat-header")).toBeVisible();
  await expect(page.getByTestId("chat-title")).toHaveText("Luca");
  await expect(page.getByTestId("message-timeline")).toBeVisible();
  const opener = page.getByTestId("message-row").filter({ hasText: GREETING });
  await expect(opener).toHaveCount(1);
  await expect(page.getByText(GREETING).filter({ visible: true })).toHaveCount(
    1,
  );
  await expect(page.getByTestId("message-input")).toBeFocused();
  // The rail is where the owner left it — arrival no longer collapses it.
  await expect(
    page.locator('[data-state="expanded"][data-side="left"]'),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
});

test("Luca's opening offer is sent as the owner's words and then retires", async ({
  page,
}) => {
  await arriveInLucaDm(page);
  const choices = page.getByTestId("luca-greeting-choices");
  await expect(choices).toBeVisible({ timeout: 5000 });
  await expect(choices.getByRole("button")).toHaveCount(2);
  // In the row, not under the composer.
  await expect(
    page
      .getByTestId("message-row")
      .filter({ hasText: GREETING })
      .getByTestId("luca-greeting-choices"),
  ).toHaveCount(1);
  await page.getByTestId("luca-greeting-choice-1").focus();
  await page.getByTestId("luca-greeting-choice-1").press("Enter");
  await expect(page.getByText("Shape an idea", { exact: true })).toHaveCount(1);
  await expect(choices).toHaveCount(0);
});

test("a typed first message joins the same timeline", async ({ page }) => {
  await arriveInLucaDm(page);
  const composer = page.getByTestId("message-input");
  await expect(page.getByTestId("message-timeline")).toBeVisible();
  await composer.fill("Help me plan a small garden.");
  await composer.press("Enter");
  await expect(
    page.getByText("Help me plan a small garden.", { exact: true }),
  ).toBeVisible();
  // The opener stays where it was; only its choices retire.
  await expect(
    page.getByTestId("message-row").filter({ hasText: GREETING }),
  ).toHaveCount(1);
  await expect(page.getByTestId("chat-header")).toBeVisible();
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
    await expect(page.getByTestId("chat-header")).toBeInViewport();
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
  await expect(
    page.getByTestId("message-row").filter({ hasText: GREETING }),
  ).toHaveCount(1);
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
        (entry) => entry.command === "begin_luca_first_meeting",
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
    channelId: identity.channel?.id,
  });
});

test("all three residents exist from the first launch, and only Luca is awake", async ({
  page,
}) => {
  await arriveInLucaDm(page);
  const world = await page.evaluate(async () => {
    const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
    if (!invoke) throw new Error("Mock command boundary is unavailable");
    const registry = (await invoke("list_luca_residents")) as {
      residents: Array<{
        personaId: string | null;
        residentPubkey: string;
        status: string;
      }>;
    };
    const commands = window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [];
    return {
      residents: registry.residents,
      creates: commands
        .filter((entry) => entry.command === "create_luca_resident")
        .map(
          (entry) =>
            (
              entry.payload as {
                input: {
                  personaId: string | null;
                  spawnAfterCreate: boolean;
                  startOnAppLaunch: boolean;
                };
              }
            ).input,
        ),
    };
  });

  // Polyphonic ships three residents, so three exist before the application
  // opens — exactly one each, with nothing for the owner to have done.
  const byPersona = (personaId: string) =>
    world.residents.filter((resident) => resident.personaId === personaId);
  expect(byPersona("builtin:fizz")).toHaveLength(1);
  expect(byPersona("builtin:fifty")).toHaveLength(1);
  expect(byPersona("builtin:trinity")).toHaveLength(1);

  // Luca wakes with the app. The other two are here, not running: they wake
  // on the first message, like every other resident.
  expect(byPersona("builtin:fizz")[0].status).toBe("running");
  expect(byPersona("builtin:fifty")[0].status).toBe("stopped");
  expect(byPersona("builtin:trinity")[0].status).toBe("stopped");

  const createdFor = (personaId: string) =>
    world.creates.filter((input) => input.personaId === personaId);
  expect(createdFor("builtin:fizz")).toHaveLength(1);
  expect(createdFor("builtin:fizz")[0]).toMatchObject({
    spawnAfterCreate: true,
    startOnAppLaunch: true,
  });
  for (const personaId of ["builtin:fifty", "builtin:trinity"]) {
    expect(createdFor(personaId)).toHaveLength(1);
    expect(createdFor(personaId)[0]).toMatchObject({
      spawnAfterCreate: false,
      startOnAppLaunch: false,
    });
  }

  // And the rail simply lists all three.
  await expect(page.getByTestId("agent-rail-luca")).toBeVisible();
  await expect(page.getByTestId("agent-rail-fifty")).toBeVisible();
  await expect(page.getByTestId("agent-rail-trinity")).toBeVisible();
});

test("the becoming puts the window back: the app has its own ground again", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 656 });
  await arriveInLucaDm(page);

  // The card stopped floating the moment it started becoming the app — not
  // when the app finished arriving — so the growing shell never sat on a
  // transparent void.
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-luca-floating-card",
    "",
  );
  const bodyBackground = await page.evaluate(
    () => window.getComputedStyle(document.body).backgroundColor,
  );
  expect(bodyBackground).not.toBe("rgba(0, 0, 0, 0)");

  await waitForAnimations(page);
  const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
  if (evidenceDirectory) {
    await page.screenshot({
      animations: "allow",
      path: `${evidenceDirectory}/floating-card-after-becoming.png`,
    });
  } else {
    await testInfo.attach("app after becoming", {
      body: await page.screenshot({ animations: "allow" }),
      contentType: "image/png",
    });
  }
});
