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
const GREETING =
  "Hey Riley — I’m Luca. Tell me what you’re working on, or choose a place to begin.";
const GREETING_MARKER = "polyphonic-onboarding.luca-greeting.v1";
const FIXED_LUCA_SEED =
  "9dee6768a16dc99a2f399672eabffe3d1c2d30cd9daaeda8ae0c36074751b9f2";

async function arriveInLucaDm(
  page: import("@playwright/test").Page,
  beforeBegin?: () => Promise<void>,
) {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: ONE_NATIVE_AGENT,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await beforeBegin?.();
  await page.getByTestId("polyphonic-door-begin").click();
  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  await page.getByTestId("polyphonic-setup-continue").click();
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page).toHaveURL(/#\/channels\//, { timeout: 30_000 });
}

test("Luca is seen to be about to speak, then speaks once", async ({
  page,
}) => {
  await arriveInLucaDm(page);
  // For a beat the greeting is withheld and Luca is thinking.
  await expect(page.getByText(GREETING)).toHaveCount(0);
  await expect(page.getByText(/thinking/i).first()).toBeVisible();
  // Then it lands — the same durable message, exactly once.
  await expect(page.getByText(GREETING)).toHaveCount(1, { timeout: 5000 });
  await expect(page.getByTestId("message-input")).toBeFocused();
});

test("Luca's opening offer is sent as the owner's words and then retires", async ({
  page,
}) => {
  await arriveInLucaDm(page);
  const choices = page.getByTestId("luca-greeting-choices");
  await expect(choices).toBeVisible({ timeout: 5000 });
  await expect(choices.getByRole("button")).toHaveCount(5);
  await page.getByTestId("luca-greeting-choice-1").click();
  await expect(
    page.getByText("Show me what you found", { exact: true }),
  ).toHaveCount(1);
  await expect(choices).toHaveCount(0);
});

test("Luca keeps the doorway identity in the canonical resident details", async ({
  page,
}, testInfo) => {
  let doorSeed = "";
  await arriveInLucaDm(page, async () => {
    // Exercise creation through onboarding; do not seed a canonical resident.
    const canonicalBefore = await page.evaluate(async () => {
      const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      if (!invoke) throw new Error("Mock command boundary is unavailable");
      const registry = (await invoke("list_luca_residents")) as {
        residents: Array<{ personaId: string | null }>;
      };
      return registry.residents.filter(
        (resident) => resident.personaId === "builtin:fizz",
      );
    });
    expect(canonicalBefore).toHaveLength(0);
    const doorMark = page
      .getByTestId("polyphonic-onboarding-field")
      .locator('canvas[aria-label="Polyphonic mark"]');
    await expect(doorMark).toHaveCount(1);
    await expect(doorMark).toBeVisible();
    await expect(doorMark).toHaveAttribute("data-seed", FIXED_LUCA_SEED);
    doorSeed = (await doorMark.getAttribute("data-seed")) ?? "";
    await waitForAnimations(page);
    await page.screenshot({ path: testInfo.outputPath("luca-doorway.png") });
  });
  await expect(page.getByText(GREETING, { exact: true })).toHaveCount(1, {
    timeout: 5000,
  });
  const identity = await page.evaluate(async (marker) => {
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
      creations: commands.filter(
        (entry) =>
          entry.command === "create_luca_resident" &&
          (entry.payload as { input?: { personaId?: string } }).input
            ?.personaId === "builtin:fizz",
      ),
      greetings: commands.filter(
        (entry) =>
          entry.command === "send_managed_agent_channel_message" &&
          (entry.payload as { marker?: string }).marker === marker,
      ),
    };
  }, GREETING_MARKER);
  expect(identity.canonical).toHaveLength(1);
  const canonicalPubkey = identity.canonical[0].residentPubkey;
  // Luca's fixed visual identity is distinct from this installation's key.
  expect(canonicalPubkey).not.toBe(FIXED_LUCA_SEED);
  expect(canonicalPubkey).not.toBe(identity.ownerPubkey);
  expect(identity.creations).toHaveLength(1);
  expect(identity.channel?.channel_type).toBe("dm");
  expect(identity.channel?.participant_pubkeys.toSorted()).toEqual(
    [identity.ownerPubkey, canonicalPubkey].toSorted(),
  );
  expect(identity.greetings).toHaveLength(1);
  expect(identity.greetings[0].payload).toMatchObject({
    agentPubkey: canonicalPubkey,
    channelId: identity.channel?.id,
    marker: GREETING_MARKER,
    markerScope: "channel",
    content: GREETING,
  });
  await expect(page.getByTestId("message-input")).toBeFocused();

  await page
    .getByRole("button", { name: "Open conversation details", exact: true })
    .click();
  await expect(
    page.getByTestId(`drawer-context-agent-${canonicalPubkey}`),
  ).toHaveAttribute("aria-selected", "true");
  const drawer = page.getByTestId("resident-drawer");
  await expect(drawer).toBeVisible();
  const specimen = drawer.getByRole("img", {
    name: "Luca identity, present",
    exact: true,
  });
  await expect(specimen).toBeVisible();
  await expect(specimen).toHaveAttribute("data-custody", "managed");
  const residentMark = specimen.locator("canvas[data-seed]");
  await expect(residentMark).toHaveCount(1);
  await expect(residentMark).toBeVisible();
  await expect(residentMark).toHaveAttribute("data-seed", FIXED_LUCA_SEED);
  await expect(residentMark).toHaveAttribute("data-seed", doorSeed);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("luca-resident-details.png"),
  });
  await testInfo.attach("canonical-luca-identity", {
    contentType: "application/json",
    body: JSON.stringify({
      fixedSeed: FIXED_LUCA_SEED,
      doorSeed,
      detailSeed: await residentMark.getAttribute("data-seed"),
      canonicalPubkey,
      ownerPubkey: identity.ownerPubkey,
      channelId: identity.channel?.id,
      participantPubkeys: identity.channel?.participant_pubkeys,
      creationCount: identity.creations.length,
      greetingCount: identity.greetings.length,
      greetingSigner: canonicalPubkey,
    }),
  });
});
