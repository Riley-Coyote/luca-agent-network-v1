import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

// The channel composer floats over its conversation scroller. Its surrounding
// overlay stays transparent so content and the scrollbar remain visible and
// interactive while the composer itself remains usable.

const CHANNEL = "general";

async function waitForMockLiveSubscription(
  page: import("@playwright/test").Page,
  channelName: string,
) {
  await expect
    .poll(() =>
      page.evaluate(
        (ch) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: ch,
          }) ?? false,
        channelName,
      ),
    )
    .toBe(true);
}

async function emit(
  page: import("@playwright/test").Page,
  content: string,
  parentEventId: string | null = null,
) {
  const event = await page.evaluate(
    (payload) =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: payload.channel,
        content: payload.content,
        parentEventId: payload.parentEventId,
      }),
    { channel: CHANNEL, content, parentEventId },
  );
  if (!event) throw new Error("mock message emitter is not installed");
  return event as { id: string };
}

async function expectTransparentNonblockingChannelOverlay(
  page: import("@playwright/test").Page,
) {
  const overlay = page.getByTestId("channel-composer-overlay");
  const scroller = page.locator('[data-buzz-conversation-scroll="true"]');
  const geometry = await overlay.evaluate((element) => {
    const overlayRect = element.getBoundingClientRect();
    const shelf = element.querySelector<HTMLElement>(
      '[data-testid="conversation-activity-shelf"]',
    );
    const composer = element.querySelector<HTMLElement>(
      '[data-testid="message-composer"]',
    );
    if (!shelf || !composer) throw new Error("Missing composer surfaces");

    const x = overlayRect.right - 4;
    const y = overlayRect.top + 8;
    const hit = document.elementFromPoint(x, y);
    return {
      background: getComputedStyle(element).backgroundColor,
      beforeContent: getComputedStyle(element, "::before").content,
      afterContent: getComputedStyle(element, "::after").content,
      hitInsideOverlay: hit instanceof Element && element.contains(hit),
      overlayPointerEvents: getComputedStyle(element).pointerEvents,
      shelfBackground: getComputedStyle(shelf).backgroundColor,
      shelfPointerEvents: getComputedStyle(shelf).pointerEvents,
      composerPointerEvents: getComputedStyle(composer).pointerEvents,
      wheelPoint: { x, y },
    };
  });

  expect(geometry).toMatchObject({
    background: "rgba(0, 0, 0, 0)",
    beforeContent: "none",
    afterContent: "none",
    hitInsideOverlay: false,
    overlayPointerEvents: "none",
    shelfBackground: "rgba(0, 0, 0, 0)",
    shelfPointerEvents: "none",
    composerPointerEvents: "auto",
  });

  const beforeWheel = await scroller.evaluate((element) => element.scrollTop);
  await page.mouse.move(geometry.wheelPoint.x, geometry.wheelPoint.y);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeLessThan(beforeWheel);
}

test.describe("composer overlay behavior", () => {
  test("channel timeline and scrollbar remain visible and interactive", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto("/");
    await page.getByTestId(`channel-${CHANNEL}`).click();
    await expect(page.getByTestId("message-timeline")).toBeVisible();
    await waitForMockLiveSubscription(page, CHANNEL);

    for (let i = 0; i < 20; i++) {
      await emit(
        page,
        `Channel filler ${i} — enough text to occupy vertical space so the conversation scrolls and rows pass behind the composer overlay.`,
      );
    }
    await page.waitForTimeout(400);

    // Scroll the conversation up so trailing rows sit behind the overlay.
    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>(
        '[data-buzz-conversation-scroll="true"]',
      );
      if (!scroller) throw new Error("Missing conversation scroll container");
      scroller.scrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight - 220,
      );
    });
    await page.waitForTimeout(300);
    await waitForAnimations(page);

    await page.screenshot({
      path: "test-results/channel-overflow/channel-composer.png",
      clip: { x: 300, y: 720 - 280, width: 980, height: 280 },
    });

    await expectTransparentNonblockingChannelOverlay(page);
  });
});
