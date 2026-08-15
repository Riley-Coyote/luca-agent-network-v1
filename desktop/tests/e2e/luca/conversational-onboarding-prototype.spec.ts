import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

const prototypeUrl = (
  scenario = "mixed",
  state?: string,
  hold = false,
): string => {
  const params = new URLSearchParams({
    e2e: "mock",
    polyphonicOnboardingPreview: "prototype",
    prototypeScenario: scenario,
  });
  if (state) params.set("prototypeState", state);
  if (hold) params.set("prototypeHold", "1");
  return `/?${params.toString()}`;
};

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

type Rect = { height: number; width: number; x: number; y: number };

async function rect(locator: Locator): Promise<Rect> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected a rendered rectangle");
  return box;
}

function expectRectNear(actual: Rect, expected: Rect, tolerance = 1): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(
    tolerance,
  );
  expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(
    tolerance,
  );
}

async function expectPageContained(page: Page): Promise<void> {
  const containment = await page.evaluate(() => ({
    bodyHeight: document.body.scrollHeight,
    bodyWidth: document.body.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    documentWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
  expect(containment.bodyWidth).toBeLessThanOrEqual(containment.viewportWidth);
  expect(containment.documentWidth).toBeLessThanOrEqual(
    containment.viewportWidth,
  );
  expect(containment.bodyHeight).toBeLessThanOrEqual(
    containment.viewportHeight,
  );
  expect(containment.documentHeight).toBeLessThanOrEqual(
    containment.viewportHeight,
  );
}

async function expectBottomClearance(
  scrollOwner: Locator,
  lastItem: Locator,
  footer: Locator,
): Promise<void> {
  await scrollOwner.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(lastItem).toBeVisible();
  const [lastBox, footerBox] = await Promise.all([
    rect(lastItem),
    rect(footer),
  ]);
  expect(footerBox.y - (lastBox.y + lastBox.height)).toBeGreaterThanOrEqual(24);
}

test("runtime-ready journey reaches Luca without invoking production commands", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(prototypeUrl("agents-found"));
  await expect(page.getByText("Polyphonic", { exact: true })).toBeVisible();
  await expect(page.getByTestId("prototype-header")).toContainText(
    "Polyphonic",
  );
  await expect(
    page.getByTestId("prototype-header").getByTestId("luca-glyph"),
  ).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "Bring your agents together." }),
  ).toBeVisible();
  await expect(page.getByText(/Step \d/)).toHaveCount(0);
  await expect(
    page.getByTestId("conversational-onboarding-preview"),
  ).toHaveAttribute("data-appearance", /light|dark/);

  const setupSurface = page.getByTestId("prototype-home-surface");
  const welcomeBox = await setupSurface.boundingBox();
  const welcomeHeaderBox = await page
    .getByTestId("prototype-header")
    .boundingBox();
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose what powers Luca" }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(3);
  await expect(page.getByRole("radio", { name: /Codex/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Claude Code/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Grok/ })).toBeVisible();
  await expect(page.getByText("Recommended", { exact: false })).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Choose another runtime" }),
  ).toBeVisible();
  const runtimeBox = await setupSurface.boundingBox();
  const runtimeHeaderBox = await page
    .getByTestId("prototype-header")
    .boundingBox();
  expect(runtimeBox?.x).toBeCloseTo(welcomeBox?.x ?? 0, 0);
  expect(runtimeBox?.width).toBeCloseTo(welcomeBox?.width ?? 0, 0);
  expect(runtimeHeaderBox?.x).toBeCloseTo(welcomeHeaderBox?.x ?? 0, 0);
  expect(runtimeHeaderBox?.y).toBeCloseTo(welcomeHeaderBox?.y ?? 0, 0);

  await page.getByRole("button", { name: "Choose another runtime" }).click();
  await expect(page.getByRole("radio")).toHaveCount(6);
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
  await expect(
    page
      .getByTestId("conversational-onboarding-conversation")
      .getByText("Luca", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId("luca-glyph").first()).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Luca" }),
  ).toBeFocused();

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
  await expect(page.getByRole("radio")).toHaveCount(6);
  await expect(
    page.getByRole("button", { name: "Choose another runtime" }),
  ).toHaveCount(0);

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
  await page.goto(prototypeUrl("mixed", "preparing", true));
  await expect(
    page.getByTestId("conversational-onboarding-preparing"),
  ).toBeVisible();
  await page.waitForTimeout(350);
  await expect(page.locator(".animate-spin")).toHaveCount(0);
});

test("setup geometry, task origins, and scroll ownership stay stable", async ({
  page,
}) => {
  const viewports = [
    { height: 900, width: 1440 },
    { height: 768, width: 1024 },
    { height: 500, width: 800 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const frames: Array<{
      footer: Rect;
      header: Rect;
      origin: Rect;
      primaryRight?: number;
      primaryY?: number;
      state: string;
      surface: Rect;
    }> = [];
    for (const state of [
      "welcome",
      "runtime",
      "agents-summary",
      "agents-select",
      "preparing",
    ]) {
      await page.goto(prototypeUrl("mixed", state, state === "preparing"));
      const surface = await rect(page.getByTestId("prototype-home-surface"));
      const header = await rect(page.getByTestId("prototype-header"));
      const footer = await rect(page.getByTestId("prototype-footer"));
      const origin = await rect(page.getByTestId("prototype-step-origin"));
      const primary = page.getByTestId("prototype-primary-action");
      const primaryBox = (await primary.count()) ? await rect(primary) : null;
      frames.push({
        footer,
        header,
        origin,
        primaryRight: primaryBox ? primaryBox.x + primaryBox.width : undefined,
        primaryY: primaryBox?.y,
        state,
        surface,
      });
      await expectPageContained(page);
    }

    const runtime = frames.find((frame) => frame.state === "runtime");
    const welcome = frames.find((frame) => frame.state === "welcome");
    if (!(runtime && welcome)) throw new Error("Missing geometry fixtures");
    for (const frame of frames) {
      expectRectNear(frame.surface, runtime.surface);
      expectRectNear(frame.header, runtime.header);
      expectRectNear(frame.footer, runtime.footer);
      if (frame.state !== "welcome") {
        expect(Math.abs(frame.origin.x - runtime.origin.x)).toBeLessThanOrEqual(
          4,
        );
        expect(Math.abs(frame.origin.y - runtime.origin.y)).toBeLessThanOrEqual(
          4,
        );
      }
      if (frame.primaryRight !== undefined) {
        expect(
          Math.abs(frame.primaryRight - (runtime.primaryRight ?? 0)),
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs((frame.primaryY ?? 0) - (runtime.primaryY ?? 0)),
        ).toBeLessThanOrEqual(1);
      }
    }
    expect(welcome.origin.y - runtime.origin.y).toBeCloseTo(24, 0);
  }

  await page.setViewportSize({ height: 500, width: 800 });
  await page.goto(prototypeUrl("none-ready", "runtime"));
  const runtimeScroll = page.getByTestId("prototype-runtime-scroll");
  await expect(runtimeScroll).toHaveJSProperty(
    "scrollHeight",
    await runtimeScroll.evaluate((element) => element.scrollHeight),
  );
  expect(
    await runtimeScroll.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  await expectBottomClearance(
    runtimeScroll,
    page.getByTestId("runtime-recovery"),
    page.getByTestId("prototype-footer"),
  );

  await page.goto(prototypeUrl("mixed", "agents-select"));
  await expectBottomClearance(
    page.getByTestId("prototype-agent-inventory"),
    page.getByTestId("prototype-agent-openclaw-flux"),
    page.getByTestId("prototype-footer"),
  );
  for (const row of await page
    .locator('[data-testid^="prototype-agent-"]')
    .all()) {
    const rowBox = await rect(row);
    expect(rowBox.height).toBeGreaterThanOrEqual(44);
  }
});

test("the persistent surface opens into home and greets once", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 800, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(prototypeUrl("mixed", "runtime"));
    const setupBox = await page
      .getByTestId("prototype-home-surface")
      .boundingBox();
    expect((setupBox?.x ?? 0) + (setupBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width,
    );
    expect((setupBox?.y ?? 0) + (setupBox?.height ?? 0)).toBeLessThanOrEqual(
      viewport.height,
    );
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  }

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(prototypeUrl("mixed", "preparing"));
  const setupBox = await page
    .getByTestId("prototype-home-surface")
    .boundingBox();
  await expect(
    page.getByTestId("conversational-onboarding-conversation"),
  ).toBeVisible();
  await expect(page.getByTestId("prototype-home-surface")).toHaveAttribute(
    "data-phase",
    "conversation",
  );
  const homeBox = await page
    .getByTestId("prototype-home-surface")
    .boundingBox();
  expect(homeBox?.width).toBeGreaterThan(setupBox?.width ?? Number.MAX_VALUE);
  await expect(page.getByText(/Hi, Riley — I’m Luca/)).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Message Luca" }),
  ).toBeFocused();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(prototypeUrl("mixed", "preparing"));
  await expect(
    page.getByTestId("conversational-onboarding-conversation"),
  ).toBeVisible();
  await expect(page.getByText(/Hi, Riley — I’m Luca/)).toHaveCount(1);

  await page.goto(prototypeUrl("mixed", "opening", true));
  await expect(
    page.getByTestId("conversational-onboarding-conversation"),
  ).toBeVisible();
  await expect(page.getByText(/Hi, Riley — I’m Luca/)).toHaveCount(0);
});
