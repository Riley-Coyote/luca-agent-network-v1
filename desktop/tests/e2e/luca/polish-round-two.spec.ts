import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

const OWNER = "deadbeef".repeat(8);
const ALICE = TEST_IDENTITIES.alice.pubkey;
const preferenceKey = `luca.conversation-appearance.v2:${OWNER}`;

async function openConversation(page: Page, names = false) {
  await page.addInitScript(
    ({ key, names }) => {
      localStorage.setItem(
        key,
        JSON.stringify({ version: 2, agentNamesInMessages: names }),
      );
    },
    { key: preferenceKey, names },
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Alice",
        pubkey: ALICE,
        status: "running",
        agentCommand: "codex",
        channelNames: ["alice-tyler"],
      },
    ],
    searchProfiles: [{ displayName: "Alice", isAgent: true, pubkey: ALICE }],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await expect(page).toHaveURL(
    /#\/channels\/f48efb06-0c93-5025-aac9-2e646bb6bfa8$/,
  );
  // A changed URL can precede the lazy route's first committed conversation.
  await expect(page.getByTestId("conversation-workspace")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("message-input")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "alice-tyler",
          }),
        ),
      ),
    )
    .toBe(true);
  await page.evaluate(
    (pubkey) =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "alice-tyler",
        pubkey,
        content: "A quiet reply for the polish check.",
      }),
    ALICE,
  );
  await expect(
    page.getByText("A quiet reply for the polish check.", { exact: true }),
  ).toBeVisible();
}

test("outside dismissal preserves the slash and lets the clicked control act", async ({
  page,
}) => {
  await openConversation(page);
  const input = page.getByTestId("message-input");
  const palette = page.getByTestId("composer-capability-palette");
  await input.fill("/");
  await expect(palette.getByLabel("Search skills and tools")).toBeFocused();
  await input.click();
  await expect(palette).toBeHidden();
  await expect(input).toBeFocused();
  await expect(input).toHaveText("/");
  await input.press("End");
  await expect(palette).toBeHidden();
  await input.press("Meta+A");
  await input.press("Backspace");
  await expect(input).toHaveText("");
  await page.keyboard.press("/");
  await expect(palette).toBeVisible();
  await page.getByRole("button", { name: "Open conversation details" }).click();
  await expect(palette).toBeHidden();
  await expect(page.getByTestId("resident-drawer")).toBeVisible();
  await expect(input).not.toBeFocused();
  await expect(input).toHaveText("/");
});

test("Escape and the close control restore the composer without deleting the draft", async ({
  page,
}) => {
  await openConversation(page);
  const input = page.getByTestId("message-input");
  const palette = page.getByTestId("composer-capability-palette");
  await input.fill("/");
  await expect(palette.getByLabel("Search skills and tools")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(input).toBeFocused();
  await expect(input).toHaveText("/");
  await input.press("Meta+A");
  await input.press("Backspace");
  await expect(input).toHaveText("");
  await page.keyboard.press("/");
  await palette.getByRole("button", { name: "Close skills and tools" }).click();
  await expect(palette).toBeHidden();
  await expect(input).toBeFocused();
});

for (const names of [false, true]) {
  test(`agent names ${names ? "on reveal a secondary runtime" : "off leave a quiet reply"}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openConversation(page, names);
    const row = page
      .getByTestId("message-row")
      .filter({ hasText: "A quiet reply for the polish check." });
    await expect(row.locator("[data-message-mark]")).toHaveCount(0);
    const author = row.getByTestId("message-author");
    expect(
      await author.evaluate((element) => Boolean(element.closest(".sr-only"))),
    ).toBe(!names);
    const runtime = row.getByTestId("message-runtime");
    if (names) {
      await expect(runtime).toHaveAttribute(
        "aria-label",
        "Current runtime: Codex",
      );
      await page.mouse.move(5, 5);
      await expect(runtime).toHaveCSS("opacity", "0");
      // Measure hover after the message's own arrival motion has settled.
      await waitForAnimations(page);
      const before = await row.boundingBox();
      await row.hover();
      await expect(runtime).toHaveCSS("opacity", "0.65");
      expect(await row.boundingBox()).toEqual(before);
      await page.mouse.move(5, 5);
      await row.getByRole("button", { name: "Alice", exact: true }).focus();
      await expect(runtime).toHaveCSS("opacity", "0.65");
    } else {
      await expect(runtime).toHaveCount(0);
      await expect(row).toHaveAttribute("aria-label", /Alice/);
    }
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`names-${names ? "on" : "off"}.png`),
    });
  });
}

test("the name preference responds to changes from another window", async ({
  page,
}) => {
  await openConversation(page);
  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "A quiet reply for the polish check." });
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ version: 2, agentNamesInMessages: true }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, preferenceKey);
  await expect(row.getByTestId("message-runtime")).toBeVisible();
});

test("Settings exposes the default-off name choice and updates the conversation", async ({
  page,
}) => {
  await openConversation(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByTestId("settings-nav-appearance").click();
  const toggle = page.getByTestId("agent-names-in-messages-toggle");
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "Back to app", exact: true }).click();
  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "A quiet reply for the polish check." });
  await expect(row.getByTestId("message-runtime")).toHaveCount(1);
  expect(
    await row
      .getByTestId("message-author")
      .evaluate((el) => Boolean(el.closest(".sr-only"))),
  ).toBe(false);
});

for (const viewport of [
  { width: 800, height: 500 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]) {
  test(`dark conversation remains clear at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      localStorage.setItem("buzz-theme", "graphite");
      localStorage.setItem("buzz-follow-system", "false");
    });
    await openConversation(page, viewport.width === 1024);
    await expect(page.getByTestId("message-input")).toBeInViewport();
    const row = page
      .getByTestId("message-row")
      .filter({ hasText: "A quiet reply for the polish check." });
    await expect(row).toBeInViewport();
    await row.hover();
    await waitForAnimations(page);
    await page.screenshot({
      path: testInfo.outputPath(`dark-${viewport.width}.png`),
    });
  });
}

test("drawer width moves through intermediate frames and survives rapid reversal", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page);
  const button = page.getByRole("button", {
    name: "Open conversation details",
  });
  await button.click();
  const frame = page.locator("[data-luca-inspector][data-panel-open]");
  await expect(frame).toHaveAttribute("data-panel-open", "true");
  await waitForAnimations(page);
  const openWidth = await frame.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  expect(openWidth).toBeGreaterThan(200);
  const widths = await page.evaluate(async () => {
    const element = document.querySelector<HTMLElement>(
      "[data-luca-inspector][data-panel-open]",
    );
    element
      ?.querySelector<HTMLButtonElement>('button[aria-label="Close panel"]')
      ?.click();
    const values: number[] = [];
    const start = performance.now();
    while (performance.now() - start < 330) {
      await new Promise(requestAnimationFrame);
      values.push(element?.getBoundingClientRect().width ?? 0);
    }
    return values;
  });
  expect(
    widths.filter((width) => width > 2 && width < openWidth - 2).length,
  ).toBeGreaterThan(2);
  await expect(frame).toHaveCount(0);
  await button.click();
  await expect(frame).toHaveAttribute("data-panel-open", "true");
  await page.waitForTimeout(70);
  await frame
    .getByRole("button", { name: "Close panel", exact: true })
    .click({ force: true });
  await button.click();
  await expect(frame).toHaveAttribute("data-panel-open", "true");
  await waitForAnimations(page);
  await expect(page.getByTestId("resident-drawer")).toBeVisible();
  await expect(page.getByTestId("message-input")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("drawer-open.png") });
  await page.keyboard.press("Escape");
  await expect(frame).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("reduced motion and compact drawers remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openConversation(page);
  await page.getByRole("button", { name: "Open conversation details" }).click();
  const drawer = page.getByTestId("resident-drawer");
  await expect(drawer).toBeVisible();
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId("message-input")).toBeVisible();
});
