import { expect, test, type Page } from "@playwright/test";

import type { RuntimeTargetOptionV1 } from "../../../src/shared/api/tauriOperatorForge";
import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { seedActiveIdentity } from "../../helpers/onboarding";

/**
 * WP-SETUP1. A clean Mac reached the runtime step and could not get past it:
 * the app asked the owner to install an adapter they should never have to
 * think about, asked them to sign in to something they were already signed
 * in to, and put the one required control below the fold.
 *
 * These are the three shapes that must never come back.
 */

const SHOT_DIR =
  process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim() ||
  "/Volumes/LaCie/Luca-Development/wp/setup1";

/** The smallest window the app supports (tauri.conf.json minWidth/minHeight). */
const SMALLEST_SUPPORTED = { width: 800, height: 500 };

const clean = { skipCommunitySeed: true, skipOnboardingSeed: true };

const baseRuntime = {
  id: "codex",
  label: "Codex",
  avatar_url: "",
  command: "codex-acp",
  binary_path: "/synthetic/bin/codex-acp",
  default_args: [],
  mcp_command: null,
  install_hint: "Install the Codex ACP adapter via npm.",
  install_instructions_url: "https://example.invalid/codex",
  underlying_cli_path: "/Applications/ChatGPT.app/Contents/Resources/codex",
  node_required: false,
  login_hint: "Run `codex login` to authenticate.",
};

/** The runtime is there and signed in; only Luca's bridge to it is missing. */
const adapterMissing = {
  ...baseRuntime,
  availability: "adapter_missing",
  can_auto_install: true,
  auth_status: { status: "logged_in" },
};

/** After the silent setup finishes. */
const readySignedIn = {
  ...baseRuntime,
  availability: "available",
  can_auto_install: false,
  auth_status: { status: "logged_in" },
  signed_in_as: "ChatGPT",
};

const setupRequired: RuntimeTargetOptionV1 = {
  target: { kind: "managed", runtimeId: "codex" },
  label: "Codex",
  readiness: "setup_required",
  reason: "Luca needs a moment to finish setting this up.",
  recommended: true,
};
const ready: RuntimeTargetOptionV1 = {
  ...setupRequired,
  readiness: "ready",
  reason: null,
};

async function reachRuntimeStep(page: Page) {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await page.getByRole("button", { name: "Begin setup" }).click();
  await page.getByTestId("polyphonic-owner-name").fill("Jamie");
  await page.getByTestId("polyphonic-owner-name").press("Enter");
  await expect(
    page.getByRole("heading", { name: "Choose what powers Luca" }),
  ).toBeFocused();
}

test("the adapter installs itself: no Install button, one honest line", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [adapterMissing],
      acpRuntimesCatalogAfterInstall: [readySignedIn],
      installAcpRuntimeDelayMs: 1200,
      operatorForgeRuntimeOptionsSequence: [
        [setupRequired],
        [setupRequired],
        [ready],
      ],
      nativeResidentDiscovery: { runtimes: [] },
    },
    clean,
  );
  await reachRuntimeStep(page);

  // The owner is never asked about the adapter.
  await expect(
    page.getByRole("button", { name: "Install", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("runtime-silent-setup")).toContainText(
    "Setting up Codex",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/01-adapter-installs-itself.png` });

  await expect(page.getByTestId("polyphonic-setup-continue")).toBeEnabled({
    timeout: 15_000,
  });
});

test("someone already signed in is never asked to sign in", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [readySignedIn],
      operatorForgeRuntimeOptionsSequence: [[ready]],
      nativeResidentDiscovery: { runtimes: [] },
    },
    clean,
  );
  await reachRuntimeStep(page);

  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Codex/ })).toBeChecked();
  await expect(page.getByText("Signed in with ChatGPT")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/02-already-signed-in.png` });
});

test("nothing required lives below the fold at the smallest window", async ({
  page,
}) => {
  await page.setViewportSize(SMALLEST_SUPPORTED);
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [
        {
          ...baseRuntime,
          availability: "available",
          can_auto_install: false,
          auth_status: { status: "logged_out" },
        },
      ],
      acpAuthMethods: {
        codex: {
          methods: [
            {
              id: "chatgpt",
              name: "Sign in",
              command: ["codex"],
              args: ["login"],
            },
          ],
        },
      },
      operatorForgeRuntimeOptionsSequence: [
        [{ ...setupRequired, reason: "Sign in to continue." }],
      ],
      nativeResidentDiscovery: { runtimes: [] },
    },
    clean,
  );
  await reachRuntimeStep(page);

  const action = page.getByTestId("polyphonic-runtime-action");
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  if (!box) throw new Error("the required action has no layout box");
  // Fully on screen without scrolling anything.
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(SMALLEST_SUPPORTED.height);
  // And the scroll container is not hiding it.
  const scroller = page.getByTestId("polyphonic-runtime-scroll");
  await expect(scroller).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SHOT_DIR}/03-above-the-fold-800x500.png`,
  });
});

/**
 * The rows below are transcribed verbatim from the live discovery diagnostic
 * on Riley's main Mac
 * (`cargo test --lib -- --ignored --nocapture every_runtime_on_this_machine`
 * and `runtime_options_on_this_machine`) — same paths, same versions, same
 * availability, same auth. The mock bridge is only the rendering path: real
 * discovery needs the installed Dev app, which this package must not touch.
 */
const THIS_MAC_RUNTIMES = [
  {
    ...baseRuntime,
    availability: "available",
    can_auto_install: false,
    underlying_cli_path: "/Applications/ChatGPT.app/Contents/Resources/codex",
    binary_path: "~/Library/Application Support/Buzz/node-tools/bin/codex-acp",
    auth_status: { status: "logged_in" },
    signed_in_as: "ChatGPT",
    auth_checkable: true,
  },
  {
    ...baseRuntime,
    id: "claude",
    label: "Claude Code",
    command: "claude-agent-acp",
    availability: "available",
    can_auto_install: false,
    underlying_cli_path: "/Users/rileycoyote/.local/bin/claude",
    binary_path:
      "~/Library/Application Support/Buzz/node-tools/bin/claude-agent-acp",
    auth_status: { status: "logged_in" },
    auth_checkable: true,
  },
  {
    ...baseRuntime,
    id: "kimi",
    label: "Kimi Code",
    command: "kimi",
    availability: "available",
    can_auto_install: false,
    underlying_cli_path: "/Users/rileycoyote/.local/bin/kimi",
    binary_path: "/Users/rileycoyote/.kimi-code/bin/kimi",
    auth_status: { status: "not_applicable" },
    // Its credential file holds an expired token: Luca must not claim it checked.
    auth_checkable: false,
  },
  {
    ...baseRuntime,
    id: "grok",
    label: "Grok",
    command: "grok",
    availability: "available",
    can_auto_install: false,
    underlying_cli_path: "/Users/rileycoyote/.local/bin/grok",
    binary_path: "/Users/rileycoyote/.grok/bin/grok",
    auth_status: { status: "logged_in" },
    auth_checkable: true,
  },
];

const THIS_MAC_OPTIONS: RuntimeTargetOptionV1[] = [
  {
    target: { kind: "managed", runtimeId: "codex" },
    label: "Codex",
    readiness: "ready",
    reason: null,
    recommended: true,
  },
  {
    target: { kind: "managed", runtimeId: "claude" },
    label: "Claude Code",
    readiness: "ready",
    reason: null,
    recommended: false,
  },
  {
    target: { kind: "managed", runtimeId: "kimi" },
    label: "Kimi Code",
    readiness: "ready",
    reason: null,
    recommended: false,
  },
  {
    target: { kind: "managed", runtimeId: "grok" },
    label: "Grok",
    readiness: "ready",
    reason: null,
    recommended: false,
  },
  {
    target: { kind: "native", runtime: "hermes" },
    label: "Hermes",
    readiness: "ready",
    reason: null,
    recommended: false,
  },
  {
    target: { kind: "native", runtime: "openclaw" },
    label: "OpenClaw",
    readiness: "unavailable",
    reason: "OpenClaw returned an unreadable agent list.",
    recommended: false,
  },
];

test("every runtime on this Mac is on screen without touching the toggle", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: THIS_MAC_RUNTIMES,
      operatorForgeRuntimeOptionsSequence: [THIS_MAC_OPTIONS],
      nativeResidentDiscovery: { runtimes: [] },
    },
    clean,
  );
  await reachRuntimeStep(page);

  for (const name of ["Codex", "Claude Code", "Kimi Code", "Grok", "Hermes"]) {
    await expect(
      page.getByRole("radio", { name: new RegExp(name) }),
    ).toBeVisible();
  }
  // The one runtime that is genuinely not usable stays behind the toggle.
  await expect(page.getByRole("radio", { name: /OpenClaw/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show other options" }),
  ).toBeVisible();
  // Honest about what it could not check.
  await expect(page.getByText("Signed in with ChatGPT")).toBeVisible();
  await expect(
    page.getByText("Luca can’t tell if you’re signed in"),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOT_DIR}/04-this-mac-real-discovery.png` });
});

test("a runtime you have with no bridge is never buried behind the toggle", async ({
  page,
}) => {
  // The real state measured with a throwaway HOME: claude and codex present,
  // no adapter for either.
  const noAdapter = THIS_MAC_RUNTIMES.slice(0, 2).map((runtime) => ({
    ...runtime,
    availability: "adapter_missing",
    can_auto_install: true,
    binary_path: null,
    auth_status: { status: "unknown" },
  }));
  const settingUp: RuntimeTargetOptionV1[] = [
    {
      ...THIS_MAC_OPTIONS[0],
      readiness: "setup_required",
      reason: "Luca needs a moment to finish setting this up.",
    },
    {
      ...THIS_MAC_OPTIONS[1],
      readiness: "setup_required",
      reason: "Luca needs a moment to finish setting this up.",
    },
    THIS_MAC_OPTIONS[5],
  ];
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: noAdapter,
      acpRuntimesCatalogAfterInstall: THIS_MAC_RUNTIMES.slice(0, 2),
      installAcpRuntimeDelayMs: 1500,
      operatorForgeRuntimeOptionsSequence: [settingUp],
      nativeResidentDiscovery: { runtimes: [] },
    },
    clean,
  );
  await reachRuntimeStep(page);

  // Both are on screen straight away — no toggle, no npm sentence.
  await expect(page.getByRole("radio", { name: /Codex/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Claude Code/ })).toBeVisible();
  await expect(page.getByText(/via npm/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Install", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("runtime-silent-setup")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: `${SHOT_DIR}/05-installed-runtime-no-bridge.png`,
  });
});
