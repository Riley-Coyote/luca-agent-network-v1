import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * The pop-out chat window (Track A M1).
 *
 * Playwright cannot open a second native window, but it CAN boot the pop-out
 * shell as its own page: the bundle picks its root from `?window=popout`, so
 * everything above the window server — the shell, the providers, the
 * conversation, the composer — is exactly what the native window runs.
 *
 * What is NOT covered here, and only a live installed app can answer: window
 * creation, the reveal handshake, geometry restore, the pin actually floating
 * over other apps, and what happens when the main window closes.
 */

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const POPOUT_URL = `/?e2e=mock&window=popout&channel=${GENERAL_CHANNEL_ID}#/channels/${GENERAL_CHANNEL_ID}`;
const POPOUT_WINDOWS_FEATURE_ID = "popout-chat-windows";

test.describe("the pop-out shell", () => {
  // The window's own opening size.
  test.use({ viewport: { width: 380, height: 560 } });

  test("is one conversation and nothing else", async ({ page }) => {
    await installMockBridge(page);
    await page.goto(POPOUT_URL);

    await expect(page.getByTestId("popout-shell")).toBeVisible();
    // No second place to go: the rail and the sidebar are the main window's.
    await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
    await expect(page.getByTestId("community-rail")).toHaveCount(0);

    const strip = page.getByTestId("popout-drag-strip");
    await expect(strip).toBeVisible();
    await expect(page.getByTestId("popout-title")).toHaveText("general");

    // The strip stands where a title bar would, clear of the traffic lights.
    const stripBox = await strip.boundingBox();
    expect(stripBox?.y).toBe(0);
    expect(stripBox?.width).toBe(380);
    expect(stripBox?.height).toBe(40);

    // Both conversation veils are present at pop-out dimensions — the edges of
    // a 380px window occlude exactly as they do in the main one.
    const veilTop = page.locator(".luca-conversation-veil-top");
    const veilBottom = page.locator(".luca-conversation-veil-bottom");
    await expect(veilTop).toHaveCount(1);
    await expect(veilBottom).toHaveCount(1);
    expect((await veilTop.boundingBox())?.width).toBe(380);
    expect((await veilBottom.boundingBox())?.width).toBe(380);
  });

  test("sends into the channel from its own composer", async ({ page }) => {
    await installMockBridge(page);
    await page.goto(POPOUT_URL);
    await expect(page.getByTestId("popout-shell")).toBeVisible();

    // Messages are dropped without a live subscription; the pop-out opens its
    // own, so wait for it rather than assuming the main window's.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "general",
            }) ?? false,
        ),
      )
      .toBe(true);

    const input = page.getByTestId("message-input");
    await input.click();
    await input.pressSequentially("sent from the pop-out");
    await page.keyboard.press("Enter");

    await expect(
      page
        .getByTestId("message-row")
        .filter({ hasText: "sent from the pop-out" }),
    ).toHaveCount(1);
    await expect(input).toHaveText("");
  });

  test("keeps the hover actions off the words until they are wanted", async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.goto(POPOUT_URL);
    await expect(page.getByTestId("popout-shell")).toBeVisible();

    const row = page
      .getByTestId("message-row")
      .filter({ has: page.locator("[data-message-action-bar]") })
      .last();
    await expect(row).toBeVisible();
    const pill = row.locator("[data-message-action-bar] > *");
    await expect(pill).toHaveCount(1);

    // The reveal is a `sm:` utility, so below 640px the main window simply
    // parks this pill open — a concession to touch widths that have no
    // pointer. A pop-out is 380px with a mouse, so `popout.css` runs the
    // reveal at every width and the pill stays off the text at rest.
    await expect(pill).toHaveCSS("opacity", "0");
    await expect(pill).toHaveCSS("pointer-events", "none");

    await row.hover();
    await expect(pill).toHaveCSS("opacity", "1");
    await expect(pill).toHaveCSS("pointer-events", "auto");
  });

  test("keeps the pin off until it is asked for", async ({ page }) => {
    await installMockBridge(page);
    await page.goto(POPOUT_URL);

    const pin = page.getByTestId("popout-pin");
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await pin.click();
    await expect(pin).toHaveAttribute("aria-pressed", "true");
  });
});

test("the conversation header asks the native side for a pop-out", async ({
  page,
}) => {
  await installMockBridge(page);
  // `popout-chat-windows` is deliberately absent from preview-features.json,
  // so the shared seed does not switch it on. Opt in the way a user would.
  await page.addInitScript(
    ({ key, id }) => {
      let overrides: Record<string, boolean> = {};
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) overrides = JSON.parse(raw) as Record<string, boolean>;
      } catch {
        overrides = {};
      }
      overrides[id] = true;
      window.localStorage.setItem(key, JSON.stringify(overrides));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, id: POPOUT_WINDOWS_FEATURE_ID },
  );

  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();

  const affordance = page.getByTestId("open-channel-popout");
  await expect(affordance).toBeVisible();
  await affordance.click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
            "get_e2e_popout_window_requests",
          ) ?? [],
      ),
    )
    .toEqual([{ channelId: GENERAL_CHANNEL_ID, title: "general" }]);
});

test("the affordance stays hidden while the preview feature is off", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();

  await expect(page.getByTestId("chat-header")).toBeVisible();
  await expect(page.getByTestId("open-channel-popout")).toHaveCount(0);
});
