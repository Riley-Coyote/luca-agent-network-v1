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
  holdInitialChannelWindow = false,
  waitForArrivalRow = true,
) {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: ONE_NATIVE_AGENT,
      holdInitialChannelWindow,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/?e2e=mock&machineOnboarding=1");
  // The document can load before the dynamically imported mock bridge is ready.
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__ === "function",
  );
  await beforeBegin?.();
  await page.getByTestId("polyphonic-door-begin").click();
  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  await page.getByTestId("polyphonic-setup-continue").click();
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page).toHaveURL(/#\/channels\//, { timeout: 30_000 });
  await expect(page.getByTestId("conversation-workspace")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("polyphonic-onboarding-field")).toHaveCount(0);
  await expect(page.getByTestId("polyphonic-onboarding-veil")).toHaveCount(0);
  await expect(page.getByTestId("message-input")).toBeVisible();
  await expect(page.getByTestId("message-timeline")).toBeVisible();
  if (!holdInitialChannelWindow && waitForArrivalRow) {
    // The finite arrival assertions start at a committed row, not a URL hash
    // or a skeleton. Loading keeps the existing route-setup deadline.
    await expect(page.getByTestId("message-row").first()).toBeVisible({
      timeout: 30_000,
    });
  }
}

test("Luca is seen to be about to speak, then speaks once", async ({
  page,
}, testInfo) => {
  await arriveInLucaDm(page, () => observeVisibleArrival(page));
  // For a beat the greeting is withheld and Luca is thinking.
  await expect(page.getByText(GREETING)).toHaveCount(0);
  await expect(page.getByText(/thinking/i).first()).toBeVisible();
  // Then it lands — the same durable message, exactly once.
  await expect(page.getByText(GREETING)).toHaveCount(1, { timeout: 5000 });
  await expect(page.getByTestId("message-input")).toBeFocused();
  const samples = await page.evaluate(
    () =>
      (window as unknown as CanonicalArrivalProbe)
        .__LUCA_VISIBLE_ARRIVAL_SAMPLES__,
  );
  expect(samples?.map((sample) => sample.phase)).toEqual([
    "thinking",
    "writing",
    "greeting",
  ]);
  expect((samples?.[1].at ?? 0) - (samples?.[0].at ?? 0)).toBeGreaterThan(1000);
  await testInfo.attach("first-visible-arrival", {
    contentType: "application/json",
    body: JSON.stringify(samples),
  });
});

test("Luca's opening offer is sent as the owner's words and then retires", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
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

test("Luca preserves the visible arrival while initial history is held", async ({
  page,
}, testInfo) => {
  await arriveInLucaDm(page, undefined, true);
  await page.waitForFunction(() => {
    const channelId = window.location.hash.split("/channels/")[1];
    return window.__BUZZ_E2E_INITIAL_CHANNEL_WINDOWS_PENDING__?.includes(
      channelId,
    );
  });
  // Keep the real history request unresolved longer than both existing phases.
  // A route-based clock expires behind the skeleton; readiness must own it.
  await page.waitForTimeout(3600);
  expect(
    await page.evaluate(() =>
      window.sessionStorage.getItem("polyphonic-onboarding.luca-arrival.v1"),
    ),
  ).toBe((await page.url()).split("/channels/")[1]);
  await expect(page.getByText(GREETING, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("luca-greeting-choices")).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("luca-history-held.png") });
  const releasedAt = await page.evaluate(() => {
    const release = window.__BUZZ_E2E_RELEASE_INITIAL_CHANNEL_WINDOWS__;
    if (!release) throw new Error("Initial-history release boundary missing");
    const released = release();
    if (released < 1) throw new Error("No initial history response was held");
    return performance.now();
  });
  await expect(page.getByTestId("message-row").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/thinking/i).first()).toBeVisible();
  const thinkingId = await page
    .getByTestId("message-row")
    .first()
    .getAttribute("data-message-id");
  const thinkingAt = await page.evaluate(() => performance.now());
  await expect(page.getByText(GREETING, { exact: true })).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("luca-history-thinking.png"),
  });
  await expect(page.getByText(GREETING, { exact: true })).toHaveCount(1, {
    timeout: 5000,
  });
  const greetingAt = await page.evaluate(() => performance.now());
  await expect(page.getByTestId("message-input")).toBeFocused();
  const choices = page.getByTestId("luca-greeting-choices");
  await expect(choices).toBeVisible();
  await expect(choices.getByRole("button")).toHaveCount(5);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("luca-history-greeting.png"),
  });
  const durable = await page.evaluate(async (marker) => {
    const invoke = window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
    if (!invoke) throw new Error("Mock command boundary is unavailable");
    const channelId = window.location.hash.split("/channels/")[1];
    const events = (await invoke("get_channel_window", {
      channelId,
    })) as Array<{
      id: string;
      pubkey: string;
      content: string;
      tags: string[][];
    }>;
    const registry = (await invoke("list_luca_residents")) as {
      residents: Array<{ residentPubkey: string; personaId: string | null }>;
    };
    return {
      channelId,
      arrivalIntent: window.sessionStorage.getItem(
        "polyphonic-onboarding.luca-arrival.v1",
      ),
      greetings: events.filter((event) =>
        event.tags.some((tag) => tag[0] === "client" && tag[1] === marker),
      ),
      canonical: registry.residents.filter(
        (resident) => resident.personaId === "builtin:fizz",
      ),
      greetingCommands: (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
        (entry) =>
          entry.command === "send_managed_agent_channel_message" &&
          (entry.payload as { marker?: string }).marker === marker,
      ).length,
    };
  }, GREETING_MARKER);
  expect(durable.arrivalIntent).toBeNull();
  expect(durable.canonical).toHaveLength(1);
  expect(durable.greetings).toHaveLength(1);
  expect(durable.greetingCommands).toBe(1);
  expect(durable.greetings[0]).toMatchObject({
    id: thinkingId,
    pubkey: durable.canonical[0].residentPubkey,
    content: GREETING,
  });
  await page.getByTestId("open-settings-view").click();
  await expect(page).toHaveURL(/#\/settings/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(durable.channelId));
  await expect(page.getByText(GREETING, { exact: true })).toHaveCount(1);
  await expect(page.getByText(/thinking/i)).toHaveCount(0);
  await expect(choices.getByRole("button")).toHaveCount(5);
  await page.getByTestId("luca-greeting-choice-1").click();
  await expect(
    page.getByText("Show me what you found", { exact: true }),
  ).toHaveCount(1);
  await expect(choices).toHaveCount(0);
  await testInfo.attach("history-arrival-timing", {
    contentType: "application/json",
    body: JSON.stringify({
      releasedAt,
      thinkingAt,
      greetingId: thinkingId,
      canonicalPubkey: durable.canonical[0].residentPubkey,
      greetingCommands: durable.greetingCommands,
      greetingAt,
    }),
  });
});

type CanonicalArrivalProbe = {
  __LUCA_CANONICAL_HELD__?: number;
  __LUCA_HISTORY_READY__?: number;
  __LUCA_RELEASE_CANONICAL__?: () => number;
  __LUCA_VISIBLE_ARRIVAL_PHASES__?: string[];
  __LUCA_VISIBLE_ARRIVAL_SAMPLES__?: Array<{ phase: string; at: number }>;
};

async function observeVisibleArrival(page: import("@playwright/test").Page) {
  await page.evaluate((greeting) => {
    const probe = window as unknown as CanonicalArrivalProbe;
    const phases: string[] = [];
    const samples: Array<{ phase: string; at: number }> = [];
    probe.__LUCA_VISIBLE_ARRIVAL_PHASES__ = phases;
    probe.__LUCA_VISIBLE_ARRIVAL_SAMPLES__ = samples;
    const observeFrame = () => {
      const row = document.querySelector<HTMLElement>(
        '[data-testid="message-row"]',
      );
      const covered = document.querySelector(
        '[data-testid="polyphonic-onboarding-field"], [data-testid="polyphonic-onboarding-veil"]',
      );
      if (!covered && row && row.getClientRects().length > 0) {
        const phase = row.innerText.includes(greeting)
          ? "greeting"
          : /thinking/i.test(row.innerText)
            ? "thinking"
            : "writing";
        if (phases.at(-1) !== phase) {
          phases.push(phase);
          samples.push({ phase, at: performance.now() });
        }
        if (phase === "greeting") return;
      }
      requestAnimationFrame(observeFrame);
    };
    requestAnimationFrame(observeFrame);
  }, GREETING);
}

test("Luca waits for canonical identity before revealing its durable greeting", async ({
  page,
}, testInfo) => {
  await arriveInLucaDm(
    page,
    async () => {
      await page.evaluate(() => {
        const target = window as unknown as CanonicalArrivalProbe & {
          __TAURI_INTERNALS__: {
            invoke: (command: string, payload?: unknown) => Promise<unknown>;
          };
        };
        const invoke = target.__TAURI_INTERNALS__.invoke;
        let held = true;
        const queued: Array<() => void> = [];
        target.__LUCA_CANONICAL_HELD__ = 0;
        target.__LUCA_HISTORY_READY__ = 0;
        target.__LUCA_RELEASE_CANONICAL__ = () => {
          held = false;
          const waiting = queued.splice(0);
          for (const resolve of waiting) resolve();
          return waiting.length;
        };
        target.__TAURI_INTERNALS__.invoke = async (command, payload) => {
          const result = await invoke(command, payload);
          if (command === "get_channel_window") {
            target.__LUCA_HISTORY_READY__ = performance.now();
          }
          if (
            command === "list_luca_residents" &&
            held &&
            (
              result as { residents: Array<{ personaId: string | null }> }
            ).residents.some(
              (resident) => resident.personaId === "builtin:fizz",
            )
          ) {
            target.__LUCA_CANONICAL_HELD__ =
              (target.__LUCA_CANONICAL_HELD__ ?? 0) + 1;
            await new Promise<void>((resolve) => queued.push(resolve));
          }
          return result;
        };
      });
    },
    false,
    false,
  );
  await page.waitForFunction(() => {
    const probe = window as unknown as CanonicalArrivalProbe;
    return (
      (probe.__LUCA_CANONICAL_HELD__ ?? 0) > 0 &&
      (probe.__LUCA_HISTORY_READY__ ?? 0) > 0
    );
  });
  // History has resolved, while the independent canonical registry query has
  // not. Its durable body must not appear and then rewind into thinking.
  await page.waitForTimeout(3600);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("luca-canonical-held.png"),
  });
  await expect(page.getByText(GREETING, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("luca-greeting-choices")).toHaveCount(0);
  await observeVisibleArrival(page);
  const releaseCount = await page.evaluate(() =>
    (window as unknown as CanonicalArrivalProbe).__LUCA_RELEASE_CANONICAL__?.(),
  );
  expect(releaseCount).toBeGreaterThan(0);
  await expect(page.getByTestId("message-row").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/thinking/i).first()).toBeVisible();
  await expect(page.getByText(GREETING, { exact: true })).toHaveCount(0);
  await expect(page.getByText(GREETING, { exact: true })).toHaveCount(1, {
    timeout: 5000,
  });
  await expect(
    page.getByTestId("luca-greeting-choices").getByRole("button"),
  ).toHaveCount(5);
  await expect(page.getByTestId("message-input")).toBeFocused();
  const phases = await page.evaluate(
    () =>
      (window as unknown as CanonicalArrivalProbe)
        .__LUCA_VISIBLE_ARRIVAL_PHASES__,
  );
  expect(phases?.[0]).toBe("thinking");
  expect(phases?.at(-1)).toBe("greeting");
  await testInfo.attach("canonical-arrival-frames", {
    contentType: "application/json",
    body: JSON.stringify(phases),
  });
});
