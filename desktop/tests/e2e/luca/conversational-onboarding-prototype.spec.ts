import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const prototypeUrl = (scenario = "mixed", state?: string): string => {
  const params = new URLSearchParams({
    e2e: "mock",
    polyphonicOnboardingPreview: "prototype",
    prototypeScenario: scenario,
  });
  if (state) params.set("prototypeState", state);
  return `/?${params.toString()}`;
};

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("runtime-ready journey reaches Luca without invoking production commands", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(prototypeUrl("agents-found"));

  await expect(
    page.getByRole("heading", { name: "Bring your agents together." }),
  ).toBeVisible();
  await expect(page.getByText(/Step \d/)).toHaveCount(0);
  await expect(
    page.getByTestId("conversational-onboarding-preview"),
  ).toHaveAttribute("data-appearance", /light|dark/);

  await page.getByRole("button", { name: "Begin" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose what powers Luca" }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(6);
  await expect(page.getByRole("radio", { name: /Codex/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("agents-summary")).toContainText(
    "We found 8 agents on this Mac",
  );
  await page.getByRole("button", { name: "Choose agents" }).click();
  await expect(page.getByTestId("agents-select")).toContainText("0 selected");
  await page.getByTestId("prototype-agent-hermes-default").click();
  await page.getByRole("button", { name: "Import 1 and continue" }).click();

  await expect(
    page.getByTestId("conversational-onboarding-conversation"),
  ).toContainText(
    "Hi, Riley — I’m Luca. I’m ready. What would you like help with first?",
  );

  const commands = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __BUZZ_E2E_COMMANDS__?: string[];
        }
      ).__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(
    commands.filter((command) =>
      /install|login|provision|create_managed|import|send_message/i.test(
        command,
      ),
    ),
  ).toEqual([]);
});

test("runtime recovery is truthful and blocks entry until readiness", async ({
  page,
}) => {
  await page.goto(prototypeUrl("none-ready", "runtime"));
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();

  await page.getByTestId("runtime-choice-hermes").click();
  await page.getByRole("button", { name: "Open setup guide" }).click();
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByTestId("runtime-choice-hermes")).toContainText(
    "Ready",
  );
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

  await page.goto(prototypeUrl("install", "runtime"));
  await expect(page.getByRole("button", { name: "Install" })).toBeVisible();
  await page.getByRole("button", { name: "Install" }).click();
  await expect(page.getByTestId("runtime-choice-kimi")).toContainText("Ready");

  await page.goto(prototypeUrl("setup-failure", "runtime"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText("Luca could not verify the setup."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("native-only and incomplete-discovery fixtures remain usable", async ({
  page,
}) => {
  for (const scenario of ["hermes-only", "openclaw-only"]) {
    await page.goto(prototypeUrl(scenario, "runtime"));
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(
      page.getByTestId("conversational-onboarding-conversation"),
    ).toBeVisible();
  }

  for (const scenario of ["agents-none", "agents-delayed", "agents-failed"]) {
    await page.goto(prototypeUrl(scenario, "runtime"));
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("agents-summary")).toHaveCount(0);
    await expect(
      page.getByTestId("conversational-onboarding-conversation"),
    ).toBeVisible();
  }
});

test("appearance, keyboard radio behavior, reduced motion, and compact layout are stable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await page.goto(prototypeUrl("mixed"));
  await page.getByRole("button", { name: "Light" }).click();
  await expect(
    page.getByTestId("conversational-onboarding-preview"),
  ).toHaveAttribute("data-appearance", "light");
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(
    page.getByTestId("conversational-onboarding-preview"),
  ).toHaveAttribute("data-appearance", "dark");

  await page.goto(prototypeUrl("mixed", "runtime"));
  const codex = page.getByRole("radio", { name: /Codex/ });
  await codex.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /Claude Code/ })).toBeChecked();

  await page.goto(prototypeUrl("mixed", "agents-select"));
  const inventory = page.getByTestId("prototype-agent-inventory");
  const footerButton = page.getByRole("button", { name: "Continue" });
  await expect(inventory).toBeVisible();
  await expect(footerButton).toBeVisible();
  const [inventoryBox, buttonBox] = await Promise.all([
    inventory.boundingBox(),
    footerButton.boundingBox(),
  ]);
  if (!(inventoryBox && buttonBox)) {
    throw new Error("Expected the inventory and footer action to be visible");
  }
  expect(inventoryBox.y + inventoryBox.height).toBeLessThanOrEqual(buttonBox.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(prototypeUrl("mixed", "preparing"));
  await expect(
    page.getByTestId("conversational-onboarding-preparing"),
  ).toBeVisible();
  await expect(page.locator(".animate-spin")).toHaveCount(0);
});
