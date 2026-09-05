import { expect, test } from "@playwright/test";

import type { NativeResidentDiscoveryOutcome } from "../../../src/shared/api/types";
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

test("Luca wears one mark everywhere: the door's, the header's, the row's", async ({
  page,
}) => {
  await arriveInLucaDm(page);
  await expect(page.getByText(GREETING)).toHaveCount(1, { timeout: 5000 });
  // Every resident mark for Luca resolves to the fixed Luca seed.
  const seeds = await page.evaluate(() =>
    [...document.querySelectorAll("canvas[data-seed]")].map((el) =>
      el.getAttribute("data-seed"),
    ),
  );
  expect(seeds.length).toBeGreaterThan(0);
  expect(new Set(seeds).size).toBe(1);
  expect(seeds[0]).toBe(
    "9dee6768a16dc99a2f399672eabffe3d1c2d30cd9daaeda8ae0c36074751b9f2",
  );
});
