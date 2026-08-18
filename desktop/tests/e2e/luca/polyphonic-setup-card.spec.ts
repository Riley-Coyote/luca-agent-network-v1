import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

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

const CARD = '[data-testid="polyphonic-setup-assistant"]';

async function beginSetup(page: import("@playwright/test").Page) {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: { runtimes: [] },
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await page.getByRole("button", { name: "Begin setup" }).click();
  await expect(page.getByTestId("polyphonic-owner-name")).toBeVisible();
}

test("the threshold names the application and the name field never seeds a key label", async ({
  page,
}) => {
  await installMockBridge(
    page,
    {
      acpRuntimesCatalog: [READY_CODEX_RUNTIME],
      nativeResidentDiscovery: { runtimes: [] },
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/?e2e=mock&machineOnboarding=1");
  await expect(page.getByRole("heading", { name: "Polyphonic" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Luca" })).toHaveCount(0);
  await page.getByRole("button", { name: "Begin setup" }).click();
  // The mock identity's display name is a shortened npub; the field must not
  // ask a new owner to delete their own key.
  await expect(page.getByTestId("polyphonic-owner-name")).toHaveValue("");
});

test("the setup card is sized by its chapter and tweens between heights", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await beginSetup(page);
  const height = () =>
    page.locator(CARD).evaluate((el) => el.getBoundingClientRect().height);
  const welcome = await height();
  await page.getByTestId("polyphonic-owner-name").fill("Riley");

  // Sample the card while it moves from the welcome chapter to the runtime
  // chapter. A snap would show only the two end values.
  const samples = await page.evaluate(async (selector) => {
    const card = document.querySelector(selector) as HTMLElement;
    const next = document.querySelector(
      '[data-testid="polyphonic-setup-continue"]',
    ) as HTMLElement;
    const out: number[] = [];
    next.click();
    for (let i = 0; i < 16; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      out.push(Math.round(card.getBoundingClientRect().height));
    }
    return out;
  }, CARD);
  await expect(page.getByRole("radio", { name: /Codex/ })).toBeVisible();
  const runtime = await height();

  expect(runtime).toBeGreaterThan(welcome + 40);
  const between = samples.filter((h) => h > welcome + 4 && h < runtime - 4);
  expect(between.length).toBeGreaterThan(1);
  // Monotonic: no dip toward the floor before the query resolves.
  for (let i = 1; i < samples.length; i += 1) {
    expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 1);
  }
  // Released back to auto so later content growth is measured, not fought.
  await expect
    .poll(() =>
      page.locator(CARD).evaluate((el) => (el as HTMLElement).style.height),
    )
    .toBe("");
});
