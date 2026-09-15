import { expect, test } from "@playwright/test";

import type { NativeResidentDiscoveryOutcome } from "../../../src/shared/api/types";
import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";
import {
  LARGE_DISCOVERY_ROW_COUNT,
  LARGE_NATIVE_RESIDENT_DISCOVERY,
  THREE_NATIVE_AGENTS,
} from "./onboarding-agent-import-fixture";

const NO_AGENTS: NativeResidentDiscoveryOutcome = { runtimes: [] };
const ONE_NATIVE_AGENT: NativeResidentDiscoveryOutcome = {
  runtimes: LARGE_NATIVE_RESIDENT_DISCOVERY.runtimes.map((runtime) => ({
    ...runtime,
    candidates:
      runtime.nativeType === "hermes" ? runtime.candidates.slice(0, 1) : [],
  })),
};
const NATIVE_AGENT_NOTICE_MARKER = "polyphonic-native-agent-notice.v1";
/** Luca's opener, as the first-meeting kickoff writes it. */
const GREETING = /Hello, I’m Luca/;
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
    page.getByRole("heading", { name: "What should Luca call you?" }),
  ).toBeFocused();
  await page.getByTestId("polyphonic-owner-name").fill("Riley");
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(
    page.getByRole("heading", { name: "Who speaks for Luca?" }),
  ).toBeFocused();
}

/**
 * The agents chapter, taken without bringing anyone in. It is the last
 * question, so its one action reads "Meet Luca" — or "Continue" where the
 * Mac has nobody on it to decline.
 */
async function pastAgents(page: import("@playwright/test").Page) {
  await expect(
    page.getByRole("heading", { name: "Bring in your agents" }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("polyphonic-setup-continue").click();
}

/**
 * Into the waking. The caller has already taken the agents chapter; the loop
 * is only here for a press that landed while a chapter was committing.
 */
async function pastWaking(page: import("@playwright/test").Page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page
        .getByRole("heading", { name: "Luca is waking up." })
        .waitFor({ timeout: attempt === 0 ? 12_000 : 4_000 });
      // The card is still the card: the walkthrough plays inside it (or, when
      // Luca cannot be made ready, the error takes its place), with no footer
      // and the whole hairline lit.
      await expect(
        page
          .getByTestId("polyphonic-walkthrough-frame")
          .or(page.getByRole("alert")),
      ).toBeVisible();
      await expect(page.getByTestId("polyphonic-setup-continue")).toHaveCount(
        0,
      );
      return;
    } catch {
      await page
        .getByTestId("polyphonic-setup-continue")
        .click({ timeout: 5_000 })
        .catch(() => undefined);
    }
  }
  throw new Error("setup never reached the waking step");
}

test("the setup card follows the application appearance", async ({ page }) => {
  // Setup no longer asks for an appearance — it is a preference the owner can
  // find later, and the first question should be one question. The card still
  // adopts whatever appearance the application is following.
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
  // The card's own surface is drawn by the layer that carried it here from the
  // door; the frame in the tree holds only the column content, so the colour
  // that must follow the application is the shell's.
  const surface = page.getByTestId("polyphonic-onboarding-shell");
  const frame = page.getByTestId("polyphonic-setup-assistant");
  await expect(onboarding).toHaveAttribute("data-system-color-scheme", "dark");
  // The canvas behind the card is not painted while the card floats on its
  // own transparent window, so the appearance the card follows is carried by
  // the token and shown by the shell.
  await expect(onboarding).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const canvasToken = await onboarding.evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--prototype-canvas").trim(),
  );
  expect(canvasToken).toBe("#060608");
  // The floating card is glass: the dark surface at 76% over the blurred
  // desktop, not the opaque plate it was when a canvas sat behind it.
  await expect(surface).toHaveCSS("background-color", "rgba(20, 20, 22, 0.76)");
  await expect(frame).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  // Setup does not ask for an appearance any more: the application's own
  // setting decides, and the owner changes it there.
  await expect(page.getByRole("button", { name: "Light" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dark" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "System" })).toHaveCount(0);
  await expect(page.getByText("Appearance", { exact: true })).toHaveCount(0);
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
  await pastAgents(page);
  await pastWaking(page);

  await expect(page).toHaveURL(/#\/channels\//);
  // An ordinary conversation with an ordinary first row in it.
  await expect(page.getByTestId("chat-header")).toBeVisible();
  await expect(
    page.getByTestId("message-row").filter({ hasText: GREETING }),
  ).toHaveCount(1);
  await expect(page.getByTestId("message-input")).toBeFocused();

  const evidence = await page.evaluate(() => ({
    commands: window.__BUZZ_E2E_COMMANDS__ ?? [],
    payloads: window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  }));
  // The three residents Polyphonic ships are made once each, and only Luca
  // is asked to wake with the application.
  expect(
    evidence.commands.filter((command) => command === "create_luca_resident"),
  ).toHaveLength(3);
  const creations = evidence.payloads
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
    );
  expect(creations.map((input) => input.personaId)).toEqual([
    "builtin:fizz",
    "builtin:fifty",
    "builtin:trinity",
  ]);
  expect(creations[0]).toMatchObject({
    spawnAfterCreate: true,
    startOnAppLaunch: true,
  });
  for (const input of creations.slice(1)) {
    expect(input).toMatchObject({
      spawnAfterCreate: false,
      startOnAppLaunch: false,
    });
  }
  expect(
    evidence.commands.filter((command) => command === "start_managed_agent"),
  ).toHaveLength(0);
  // The opener is Luca's own first meeting, kicked off exactly once for this
  // conversation — not a greeting the desktop writes on Luca's behalf.
  const kickoffs = evidence.payloads.filter(
    (entry) => entry.command === "begin_luca_first_meeting",
  );
  expect(kickoffs).toHaveLength(1);
  expect(kickoffs[0].payload).toMatchObject({
    channelId: decodeURIComponent(
      page.url().match(/#\/channels\/([^?]+)/)?.[1] ?? "",
    ),
  });
});

test("a saved Luca survives a failed managed refresh and retries only the handoff", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: NO_AGENTS,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await begin(page);
  await page.evaluate(() => {
    const target = window as typeof window & {
      __TAURI_INTERNALS__: {
        invoke: (
          command: string,
          payload?: unknown,
          options?: unknown,
        ) => Promise<unknown>;
      };
      __EXP04_HANDOFF_TEST__?: {
        allowRefresh: boolean;
        pubkey: string | null;
        failedRefreshes: number;
      };
    };
    const state = {
      allowRefresh: false,
      pubkey: null as string | null,
      failedRefreshes: 0,
    };
    target.__EXP04_HANDOFF_TEST__ = state;
    const invoke = target.__TAURI_INTERNALS__.invoke.bind(
      target.__TAURI_INTERNALS__,
    );
    target.__TAURI_INTERNALS__.invoke = async (command, payload, options) => {
      if (
        command === "list_managed_agents" &&
        state.pubkey &&
        !state.allowRefresh
      ) {
        state.failedRefreshes += 1;
        throw new Error(
          "Luca's saved setup could not be refreshed. Try again.",
        );
      }
      const result = await invoke(command, payload, options);
      if (
        command === "create_luca_resident" &&
        (payload as { input?: { personaId?: string } } | undefined)?.input
          ?.personaId === "builtin:fizz"
      ) {
        state.pubkey = (
          result as { resident: { residentPubkey: string } }
        ).resident.residentPubkey;
      }
      return result;
    };
  });
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await pastAgents(page);
  await pastWaking(page);
  await expect(page.getByRole("alert")).toContainText(
    "Luca's saved setup could not be refreshed",
    { timeout: 15000 },
  );
  await expect(page).not.toHaveURL(/#\/channels\//);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("saved-luca-refresh-error.png"),
  });
  const saved = await page.evaluate(async () => {
    const state = (
      window as typeof window & {
        __EXP04_HANDOFF_TEST__?: {
          allowRefresh: boolean;
          pubkey: string | null;
          failedRefreshes: number;
        };
      }
    ).__EXP04_HANDOFF_TEST__;
    if (!state?.pubkey) throw new Error("No Luca was prepared.");
    const before = window.__BUZZ_E2E_COMMANDS__?.length ?? 0;
    state.allowRefresh = true;
    return {
      pubkey: state.pubkey,
      failedRefreshes: state.failedRefreshes,
      before,
    };
  });
  expect(saved.failedRefreshes).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page).toHaveURL(/#\/channels\//);
  await expect(page.getByTestId("message-input")).toBeVisible();
  await expect(
    page.getByTestId("message-row").filter({ hasText: GREETING }),
  ).toHaveCount(1);
  await page.getByTestId("message-input").fill("Hello, Luca.");
  await page.getByTestId("message-input").press("Enter");
  await page
    .getByRole("button", { name: "Open conversation details", exact: true })
    .click();
  await expect(
    page.getByTestId(`drawer-context-agent-${saved.pubkey}`),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("resident-drawer")).toBeVisible();
  await page.getByRole("tab", { name: "Conversation", exact: true }).click();
  const resident = page.getByTestId(`conversation-resident-${saved.pubkey}`);
  await expect(resident).toContainText("Notebook available");
  await expect(resident).not.toContainText("External agent");
  await page.getByTestId(`drawer-context-agent-${saved.pubkey}`).click();
  await expect(page.getByTestId("resident-drawer")).toBeVisible();
  const evidence = await page.evaluate(
    (before) => ({
      all: window.__BUZZ_E2E_COMMANDS__ ?? [],
      retried: window.__BUZZ_E2E_COMMANDS__?.slice(before) ?? [],
      greeting: (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
        (entry) => entry.command === "begin_luca_first_meeting",
      ),
    }),
    saved.before,
  );
  // The three ship-with residents were made once each, before the refresh
  // failed; the retry below is checked to add none.
  expect(
    evidence.all.filter((command) => command === "create_luca_resident"),
  ).toHaveLength(3);
  // The first meeting was kicked off once, before the refresh failed, and the
  // retry does not start a second one.
  expect(evidence.greeting).toHaveLength(1);
  expect(evidence.retried).toContain("list_managed_agents");
  for (const command of [
    "create_luca_resident",
    "execute_native_agent_provisioning",
    "open_dm",
    "begin_luca_first_meeting",
    "get_managed_agent_log",
  ]) {
    expect(evidence.retried).not.toContain(command);
  }
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("saved-luca-managed-drawer.png"),
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
  await pastAgents(page);
  await pastWaking(page);

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
  test(`${runtime} can power Luca and an empty Mac says so plainly`, async ({
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
    // The question is still asked, and the answer on a Mac with nobody on it
    // is a sentence, not an empty box — with an action that just carries on.
    await expect(
      page.getByRole("heading", { name: "Bring in your agents" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId("onboarding-agent-import-list"),
    ).toContainText(
      "No agents found on this Mac yet. You can bring agents in later from the Agents page.",
    );
    await expect(page.getByTestId("polyphonic-setup-continue")).toHaveText(
      "Continue",
    );
    // Nothing to decline, so nothing offers to decline it.
    await expect(page.getByTestId("polyphonic-agents-skip")).toHaveCount(0);
    await page.getByTestId("polyphonic-setup-continue").click();
    await pastWaking(page);
    await expect(page).toHaveURL(/#\/channels\//);
    const imported = await page.evaluate(() =>
      (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
        (entry) =>
          entry.command === "create_luca_resident" &&
          (entry.payload as { input: { nativeRuntimeBinding?: unknown } }).input
            .nativeRuntimeBinding,
      ),
    );
    expect(imported).toHaveLength(0);
  });
}

test("a large inventory is rows, none ticked, and first chat is not delayed", async ({
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
  // Looking around the Mac starts while the runtime question is still on
  // screen, so the chapter after it opens onto rows and not a spinner.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMANDS__ ?? []).filter(
            (command) => command === "discover_native_residents",
          ).length,
      ),
    )
    .toBe(1);
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(
    page.getByRole("heading", { name: "Bring in your agents" }),
  ).toBeVisible({ timeout: 10_000 });
  // …and the chapter reads that one scan rather than starting its own.
  expect(
    await page.evaluate(
      () =>
        (window.__BUZZ_E2E_COMMANDS__ ?? []).filter(
          (command) => command === "discover_native_residents",
        ).length,
    ),
  ).toBe(1);

  // Forty-two of them, and every one is a row the owner can read and tick.
  // The old "past eight, show an inventory instead" rule is gone, and so is
  // the search box that came with it.
  const rows = page
    .getByTestId("onboarding-agent-import-list")
    .locator('[data-testid^="onboarding-agent-row-"]');
  await expect(rows).toHaveCount(LARGE_DISCOVERY_ROW_COUNT);
  await expect(
    page.getByRole("textbox", { name: "Search agents" }),
  ).toHaveCount(0);
  // None of them is ticked for the owner, so the action is the plain one.
  await expect(
    page.getByTestId("onboarding-agent-import-list").getByRole("button", {
      pressed: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByTestId("polyphonic-setup-continue")).toHaveText(
    "Meet Luca",
  );
  // The list scrolls inside the card rather than growing it.
  await expect(
    page.getByTestId("onboarding-agent-import-list"),
  ).toHaveAttribute("data-prototype-scroll-owner", "true");

  await page.getByTestId("polyphonic-setup-continue").click();
  await pastWaking(page);
  await expect(
    page.getByTestId("message-row").filter({ hasText: GREETING }),
  ).toHaveCount(1);
  await expect(page.getByTestId("message-input")).toBeVisible();
  const created = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
      (entry) => entry.command === "create_luca_resident",
    ),
  );
  // The three residents that ship with Polyphonic, and no one from the
  // native inventory: nobody was ticked.
  expect(created).toHaveLength(3);
  expect(
    created.map(
      (entry) => (entry.payload as { input: { name: string } }).input.name,
    ),
  ).toEqual(["Luca", "Fifty", "Trinity"]);
});

test("one agent is ticked, and arrives behind the first conversation", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: THREE_NATIVE_AGENTS,
      // Held open so the row is observable on its way in: the first
      // conversation is already up several seconds before this lands.
      nativeAgentImportDelayMs: 10_000,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await begin(page);
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(
    page.getByRole("heading", { name: "Bring in your agents" }),
  ).toBeVisible({ timeout: 10_000 });
  // What a source has to say about itself is said once, above its rows — and
  // the command inside it is set as a command, not shown with its backticks.
  const openClawNotice = page.getByTestId("onboarding-agent-source-openclaw");
  await expect(openClawNotice).toHaveCount(1);
  await expect(openClawNotice).toContainText("run openclaw doctor --fix");
  await expect(openClawNotice).not.toContainText("`");
  const command = openClawNotice.locator("code");
  await expect(command).toHaveText("openclaw doctor --fix");
  expect(
    await command.evaluate((el) => getComputedStyle(el).fontFamily),
  ).toMatch(/Fragment Mono/);
  // And an agent that source will not vouch for is still a row, still
  // tickable, saying in one line what is true of it.
  await expect(
    page.getByTestId("onboarding-agent-row-openclaw:agent-01"),
  ).toContainText("Unavailable — run openclaw doctor --fix.");

  // The rows wear exactly what the runtime rows one page earlier wear: 52px
  // on the pane's own ground, a 12px radius, a hairline and no fill.
  const firstRow = page
    .getByTestId("onboarding-agent-row-hermes:profile-01")
    .getByRole("button")
    .first();
  const box = await firstRow.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      height: el.getBoundingClientRect().height,
      radius: style.borderTopLeftRadius,
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
    };
  });
  expect(box).toMatchObject({
    height: 52,
    radius: "12px",
    background: "rgba(0, 0, 0, 0)",
    borderWidth: "1px",
  });
  // The list itself is not a plate either.
  expect(
    await page
      .getByTestId("onboarding-agent-import-list")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");

  await firstRow.click();
  await expect(page.getByTestId("polyphonic-setup-continue")).toHaveText(
    "Bring in 1 agent",
  );
  // Chosen is the row's own hairline coming up, not a fill.
  expect(
    await firstRow.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  await expect(page.getByTestId("polyphonic-agents-skip")).toBeVisible();
  await page.getByTestId("polyphonic-setup-continue").click();
  await pastWaking(page);

  // Luca's first words are there on time: the import is behind them.
  await expect(page).toHaveURL(/#\/channels\//);
  await expect(
    page.getByTestId("message-row").filter({ hasText: GREETING }),
  ).toHaveCount(1);
  await expect(page.getByTestId("message-input")).toBeVisible();

  // The agent is in the rail while it is still coming, in the state the rail
  // already has for a resident that is not up yet.
  const railRow = page.getByTestId("agent-rail-hermes profile 01");
  await expect(railRow).toBeVisible();
  await expect(
    page.getByTestId("agent-rail-status-hermes profile 01"),
  ).toHaveText("Waking…");
  // …and settles into an ordinary row once the record is real.
  await expect(
    page.getByTestId("agent-rail-status-hermes profile 01"),
  ).toHaveCount(0, { timeout: 20_000 });
  await expect(railRow).toBeVisible();

  const imports = await page.evaluate(() => {
    const payloads = window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [];
    const creations = payloads.filter(
      (entry) => entry.command === "create_luca_resident",
    );
    return {
      names: creations.map(
        (entry) => (entry.payload as { input: { name: string } }).input.name,
      ),
      native: creations
        .filter(
          (entry) =>
            (entry.payload as { input: { nativeRuntimeBinding?: unknown } })
              .input.nativeRuntimeBinding,
        )
        .map(
          (entry) => (entry.payload as { input: { name: string } }).input.name,
        ),
    };
  });
  // The three that ship with Polyphonic first, then the one the owner chose.
  expect(imports.names).toEqual([
    "Luca",
    "Fifty",
    "Trinity",
    "Hermes profile 01",
  ]);
  expect(imports.native).toEqual(["Hermes profile 01"]);
});

test("an import that fails says so on its own row and stops nothing", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: THREE_NATIVE_AGENTS,
      // The queue runs in the order the rows were listed, so the Hermes
      // profile goes first and the OpenClaw agent is the one that fails.
      nativeAgentImportErrors: [
        null,
        "Start the OpenClaw gateway before importing this agent.",
      ],
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await begin(page);
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await expect(
    page.getByRole("heading", { name: "Bring in your agents" }),
  ).toBeVisible({ timeout: 10_000 });
  // The one that will fail, and one that will not: a failure must not take
  // the rest of the queue with it.
  await page
    .getByTestId("onboarding-agent-row-openclaw:agent-01")
    .getByRole("button")
    .first()
    .click();
  await page
    .getByTestId("onboarding-agent-row-hermes:profile-02")
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByTestId("polyphonic-setup-continue")).toHaveText(
    "Bring in 2 agents",
  );
  await page.getByTestId("polyphonic-setup-continue").click();
  await pastWaking(page);

  await expect(page).toHaveURL(/#\/channels\//);
  await expect(
    page.getByTestId("message-row").filter({ hasText: GREETING }),
  ).toHaveCount(1);
  // The one before it arrived and is an ordinary row…
  await expect(page.getByTestId("agent-rail-hermes profile 02")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByTestId("agent-rail-status-hermes profile 02"),
  ).toHaveCount(0, { timeout: 20_000 });
  // …the one that failed keeps its reason on its own row…
  await expect(
    page.getByTestId("agent-rail-status-openclaw agent 01"),
  ).toHaveText("Needs attention", { timeout: 20_000 });
  // …and nothing about it was ever a dialog.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

/**
 * The becoming asks the window for a place on the desk. There is no window
 * server in the harness, so what is asserted is the ask: the command log.
 */
async function asNativeWindow(
  page: import("@playwright/test").Page,
  work: { availWidth: number; availHeight: number },
) {
  await page.addInitScript((area) => {
    (window as typeof window & { isTauri?: boolean }).isTauri = true;
    Object.defineProperty(window.screen, "availWidth", {
      configurable: true,
      get: () => area.availWidth,
    });
    Object.defineProperty(window.screen, "availHeight", {
      configurable: true,
      get: () => area.availHeight,
    });
  }, work);
}

function windowPlacement(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const payloads = window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [];
    const sized = payloads.filter(
      (entry) => entry.command === "plugin:window|set_size",
    );
    return {
      sizes: sized.map(
        (entry) =>
          (entry.payload as { value?: { Logical?: unknown } } | undefined)
            ?.value?.Logical,
      ),
      centred: payloads.filter(
        (entry) => entry.command === "plugin:window|center",
      ).length,
      maximised: payloads.filter(
        (entry) => entry.command === "plugin:window|maximize",
      ).length,
    };
  });
}

/** The whole walk, on a Mac with nobody else on it, to the first conversation. */
async function walkToFirstConversation(page: import("@playwright/test").Page) {
  await begin(page);
  await page.getByRole("radio", { name: /Codex/ }).check();
  await page.getByTestId("polyphonic-setup-continue").click();
  await pastAgents(page);
  await expect(page).toHaveURL(/#\/channels\//, { timeout: 30_000 });
}

test("the becoming lands the app at a standard size, centred — never maximised", async ({
  page,
}) => {
  // An ultrawide: the case Riley named. Nobody wants their first window to be
  // a yard across.
  await asNativeWindow(page, { availWidth: 3440, availHeight: 1440 });
  await page.setViewportSize({ width: 1040, height: 584 });
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: NO_AGENTS,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await walkToFirstConversation(page);

  const placement = await windowPlacement(page);
  expect(placement.sizes).toContainEqual({ width: 1280, height: 800 });
  expect(placement.centred).toBeGreaterThan(0);
  // The whole point: the application does not swallow the screen.
  expect(placement.maximised).toBe(0);
});

test("a small display gets its work area back, less a margin", async ({
  page,
}) => {
  // A 13" Mac's work area: 1280×800 plus 48px of room will not fit, so the
  // window takes what there is and leaves the margin.
  await asNativeWindow(page, { availWidth: 1280, availHeight: 747 });
  await page.setViewportSize({ width: 1040, height: 584 });
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: NO_AGENTS,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await walkToFirstConversation(page);

  const placement = await windowPlacement(page);
  expect(placement.sizes).toContainEqual({ width: 1232, height: 699 });
  expect(placement.centred).toBeGreaterThan(0);
  expect(placement.maximised).toBe(0);
});
