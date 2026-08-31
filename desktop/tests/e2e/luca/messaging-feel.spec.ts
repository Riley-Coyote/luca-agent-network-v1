import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

/**
 * The messaging feel gates (docs/luca/audits/MESSAGING_FEEL_AUDIT_2026-08-26.md).
 *
 * Three moments make a chat app feel alive: your own message appears the
 * instant you press Enter, a reply visibly ARRIVES, and the seconds right
 * after a send are never silent. Each gate here measures the real built
 * bundle through the mock bridge; regressions in the send pipeline, the
 * arrival wiring, or the activity tiers fail loudly.
 */

const ALICE = TEST_IDENTITIES.alice.pubkey;

test("own message paints instantly and the composer clears", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "alice-tyler",
          }) ?? false,
      ),
    )
    .toBe(true);

  await page.evaluate(() => {
    const marker = "feel-gate-own-message";
    (window as { __feel?: { ms?: number } }).__feel = {};
    let t0 = 0;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter" && t0 === 0) {
          t0 = performance.now();
        }
      },
      true,
    );
    const observer = new MutationObserver(() => {
      const row = [
        ...document.querySelectorAll('[data-testid="message-row"]'),
      ].find((candidate) => (candidate.textContent ?? "").includes(marker));
      if (row && t0 > 0) {
        (window as { __feel?: { ms?: number } }).__feel = {
          ms: Math.round(performance.now() - t0),
        };
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  const input = page.getByTestId("message-input");
  await input.click();
  await input.pressSequentially("feel-gate-own-message");
  await page.keyboard.press("Enter");

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as { __feel?: { ms?: number } }).__feel?.ms ?? null,
      ),
    )
    .not.toBeNull();
  const ms = await page.evaluate(
    () => (window as { __feel?: { ms?: number } }).__feel?.ms ?? Infinity,
  );
  // Measured ~44ms on the built bundle; 150 is a real margin, not a squeeze.
  expect(ms).toBeLessThan(150);
  await expect(input).toHaveText("");
});

test("a rejected send stays in place and retries without duplicating", async ({
  page,
}) => {
  await installMockBridge(page, {
    sendChannelMessageErrors: ["relay rejected event: temporary failure"],
    sendMessageDelayMs: 200,
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "alice-tyler",
          }) ?? false,
      ),
    )
    .toBe(true);

  const input = page.getByTestId("message-input");
  await input.fill("feel-gate-retry-in-place");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Sending" })).toBeDisabled();

  const row = page
    .getByTestId("message-row")
    .filter({ hasText: "feel-gate-retry-in-place" });
  const failedStatus = page.getByTestId("message-send-failed");
  await expect(row).toHaveCount(1);
  await expect(failedStatus).toHaveText(/Not sent.*Retry/);
  await expect(input).toHaveText("");
  await row.evaluate((element) => {
    element.setAttribute("data-retry-instance", "stable");
  });

  await failedStatus
    .getByRole("button", { name: "Retry sending message" })
    .click();
  await expect(page.getByRole("button", { name: "Sending" })).toBeDisabled();
  await expect(failedStatus).toHaveCount(0);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-retry-instance", "stable");
  await expect(row).not.toHaveAttribute("data-message-id", /optimistic/);
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
            (entry) => entry.command === "send_channel_message",
          ).length,
      ),
    )
    .toBe(2);
});

test("a fresh reply arrives animated; old history stays still", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "alice-tyler",
          }) ?? false,
      ),
    )
    .toBe(true);

  await page.evaluate((alicePubkey) => {
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "alice-tyler",
      content: "feel-gate-fresh-reply",
      pubkey: alicePubkey,
    });
  }, ALICE);
  const freshRow = page
    .getByTestId("message-row")
    .filter({ hasText: "feel-gate-fresh-reply" });
  await expect(freshRow).toHaveCount(1);
  // The arriving half of the timeline grammar: a fresh incoming message
  // rises into place without blurring readable text.
  expect(
    await freshRow.evaluate((row) => getComputedStyle(row).animationName),
  ).toBe("motion-enter-conversation");
  expect(
    await freshRow.evaluate((row) => getComputedStyle(row).animationDuration),
  ).toBe("0.18s");

  await page.evaluate((alicePubkey) => {
    window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "alice-tyler",
      content: "feel-gate-old-history",
      pubkey: alicePubkey,
      createdAt: Math.floor(Date.now() / 1000) - 3_600,
    });
  }, ALICE);
  const oldRow = page
    .getByTestId("message-row")
    .filter({ hasText: "feel-gate-old-history" });
  await expect(oldRow).toHaveCount(1);
  // The age gate is what keeps history, scroll-back and channel switches
  // perfectly still.
  expect(
    await oldRow.evaluate((row) => getComputedStyle(row).animationName),
  ).toBe("none");
});

test("the shelf's first word arrives fast after a managed send", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["general"],
        name: "Luca",
        pubkey: ALICE,
        status: "stopped",
      },
    ],
    searchProfiles: [{ displayName: "Luca", isAgent: true, pubkey: ALICE }],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
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

  // A plain send derives the conversation-wide audience and seeds the
  // presentation — no explicit mention required (wake-on-send.spec is the
  // precedent fixture).
  await page
    .getByTestId("message-input")
    .fill("the first word should not wait");
  const before = Date.now();
  await page.getByTestId("send-message").click();

  // The wait tier used to hold the shelf label empty for 3s; the phase
  // word now answers "did it hear me?" almost immediately.
  const label = page.locator(".luca-activity-item__label");
  await expect(label.first()).toBeVisible({ timeout: 3_000 });
  expect(Date.now() - before).toBeLessThan(2_500);
  await expect(label.first()).toHaveText(/Waking|Thinking/);
});
