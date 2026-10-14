import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

const RESIDENT_PUBKEY = "11".repeat(32);
const RESIDENT = {
  agentCommand: "hermes",
  channelNames: ["agents"],
  model: "gpt-5.6-sol",
  name: "Luca",
  pubkey: RESIDENT_PUBKEY,
  status: "running" as const,
};

async function captureFrame(page: Page, testInfo: TestInfo, name: string) {
  await waitForAnimations(page, 120);
  const evidenceDirectory = process.env.LUCA_VISUAL_EVIDENCE_DIR?.trim();
  await page.screenshot({
    fullPage: true,
    path: evidenceDirectory
      ? `${evidenceDirectory}/${name}.png`
      : testInfo.outputPath(`${name}.png`),
  });
}

test("agent library stays truthful and stable while resident data loads", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const state = { value: 0 };
    Object.assign(window, { __AGENTS_LAYOUT_SHIFT__: state });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput: boolean;
          value: number;
        };
        if (!shift.hadRecentInput) state.value += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await installMockBridge(page, {
    agentListDelayMs: 4_000,
    managedAgents: [RESIDENT],
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");

  const loading = page.getByTestId("agents-data-loading");
  await expect(loading).toBeVisible();
  await expect(loading).toContainText("Loading agents…");
  await expect(page.getByText("0 agents", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("No matching agents", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("No residents yet", { exact: true })).toHaveCount(
    0,
  );

  const loadingBox = await page
    .getByTestId("agents-loading-layout")
    .boundingBox();
  expect(loadingBox).not.toBeNull();
  await page.evaluate(() => {
    const state = (
      window as Window & { __AGENTS_LAYOUT_SHIFT__?: { value: number } }
    ).__AGENTS_LAYOUT_SHIFT__;
    if (state) state.value = 0;
  });
  await captureFrame(page, testInfo, "01-agents-loading-immediate");
  await page.waitForTimeout(600);
  await captureFrame(page, testInfo, "02-agents-loading-held");

  const resident = page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`);
  await expect(resident).toBeVisible();
  const readyBox = await page.getByTestId("agents-view").boundingBox();
  expect(readyBox).not.toBeNull();
  expect(
    Math.abs((readyBox?.x ?? 0) - (loadingBox?.x ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((readyBox?.width ?? 0) - (loadingBox?.width ?? 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((readyBox?.height ?? 0) - (loadingBox?.height ?? 0)),
  ).toBeLessThanOrEqual(1);
  await captureFrame(page, testInfo, "03-agents-ready");

  const layoutShift = await page.evaluate(
    () =>
      (window as Window & { __AGENTS_LAYOUT_SHIFT__?: { value: number } })
        .__AGENTS_LAYOUT_SHIFT__?.value ?? 0,
  );
  expect(layoutShift).toBeLessThan(0.02);
});

test("agent library explains a failed read and recovers on request", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgentListErrors: [
      "mock agent registry unavailable",
      "mock agent registry unavailable",
      null,
    ],
    managedAgents: [RESIDENT],
  });
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");

  const unavailable = page.getByTestId("agents-library-unavailable");
  await expect(unavailable).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Couldn’t load your agents" }),
  ).toBeVisible();
  await expect(unavailable).toContainText(
    "Your residents have not been changed",
  );
  await expect(page.getByText("No residents yet", { exact: true })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`),
  ).toBeVisible();
  await expect(unavailable).toHaveCount(0);
});

test("agent search has a persistent label and filters support keyboard navigation", async ({
  page,
}, testInfo) => {
  await installMockBridge(page, { managedAgents: [RESIDENT] });
  await page.goto("/?e2e=mock&notebookDemo=1#/agents");

  const resident = page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`);
  await expect(resident).toBeVisible();
  const search = page.getByRole("textbox", {
    name: "Search agents",
    exact: true,
  });
  await search.fill("Luca");
  await expect(resident).toBeVisible();
  await search.fill("No such resident");
  await expect(
    page.getByText("No matching agents", { exact: true }),
  ).toBeVisible();
  await search.fill("");

  const all = page.getByRole("tab", { name: "All", exact: true });
  const running = page.getByRole("tab", { name: "Running", exact: true });
  const attention = page.getByRole("tab", { name: "Attention", exact: true });
  await all.focus();
  await all.press("ArrowRight");
  await expect(running).toBeFocused();
  await expect(running).toHaveAttribute("aria-selected", "true");
  await expect(all).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("tabpanel", { name: "Running" })).toContainText(
    "Luca",
  );

  await running.press("End");
  await expect(attention).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Attention" })).toContainText(
    "No matching agents",
  );
  await attention.press("ArrowRight");
  await expect(all).toBeFocused();
  await all.press("ArrowLeft");
  await expect(attention).toBeFocused();
  await attention.press("Home");
  await expect(all).toBeFocused();
  await all.press("Tab");
  await expect(resident).toBeFocused();
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("agent-filters-keyboard.png"),
  });
});

for (const width of [800, 1440]) {
  test(`an unavailable agent link preserves the roster and recovers at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await installMockBridge(page, { managedAgents: [RESIDENT] });
    await page.goto(
      `/?e2e=mock&notebookDemo=1#/agents?profile=${"ee".repeat(32)}`,
    );
    const resident = page.getByTestId(`agent-library-row-${RESIDENT_PUBKEY}`);
    await expect(resident).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No residents yet" }),
    ).toHaveCount(0);
    if (width === 1440) {
      await expect(
        page.getByRole("heading", { name: "Choose an agent" }),
      ).toBeVisible();
    } else {
      // Exclude the floor lip and the card's 1px border on each side.
      const paneWidth = await page
        .getByTestId("agents-view")
        .locator(":scope > [data-luca-conversation-surface]")
        .evaluate((element) => element.clientWidth);
      const roster = await page
        .getByRole("complementary", { name: "Agent library", exact: true })
        .boundingBox();
      if (!roster) {
        throw new Error("The agent roster must be visible");
      }
      expect(Math.abs(paneWidth - roster.width)).toBeLessThanOrEqual(1);
    }
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`missing-agent-${width}.png`),
    });
    await resident.click();
    await expect(
      page.getByRole("heading", { name: "Luca", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Message Luca", exact: true }),
    ).toBeVisible();
  });
}
