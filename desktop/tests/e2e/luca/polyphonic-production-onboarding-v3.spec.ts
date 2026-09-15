import { expect, test } from "@playwright/test";

import type { NativeResidentDiscoveryOutcome } from "../../../src/shared/api/types";
import { installMockBridge } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";
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
 * Past the runtime and into the waking. There is nothing between them any
 * more — no agents question, no sources question — so the only press is the
 * caller's own, repeated once if it landed while the runtime was committing.
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
    await pastWaking(page);
    await expect(page).toHaveURL(/#\/channels\//);
    // The agents question is not asked at all now, so the import surface can
    // never appear on the way through — empty discovery or otherwise.
    await expect(
      page.getByRole("heading", { name: "Bring in agents you already use" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("onboarding-agent-import-list")).toHaveCount(
      0,
    );
  });
}

test("large native inventories never delay first chat or import extra agents", async ({
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
  await pastWaking(page);
  await expect(
    page.getByTestId("message-row").filter({ hasText: GREETING }),
  ).toHaveCount(1);
  await expect(page.getByTestId("message-input")).toBeVisible();
  await expect(page.getByTestId("onboarding-agent-import-list")).toHaveCount(0);
  const created = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
      (entry) => entry.command === "create_luca_resident",
    ),
  );
  // The three residents that ship with Polyphonic, and no one from the
  // native inventory.
  expect(created).toHaveLength(3);
  expect(
    created.map(
      (entry) => (entry.payload as { input: { name: string } }).input.name,
    ),
  ).toEqual(["Luca", "Fifty", "Trinity"]);
});
