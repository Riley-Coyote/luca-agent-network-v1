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
const DEEP_HISTORY_CHANNEL_ID = "feedf00d-0000-4000-8000-000000000007";
const MANAGED_PRESENTATION_EVENT = "luca://managed-presentation";

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
  // The approved acknowledgement contract is <=100ms from Enter to the
  // optimistic owner row joining the transcript.
  expect(ms).toBeLessThanOrEqual(100);
  await expect(input).toHaveText("");

  const ownRow = page
    .getByTestId("message-row")
    .filter({ hasText: "feel-gate-own-message" });
  await expect
    .poll(() =>
      ownRow.evaluate((row) => {
        const timeline = row.closest('[data-testid="message-timeline"]');
        const composer = document.querySelector<HTMLElement>(
          '[data-testid="channel-composer-overlay"]',
        );
        if (!(timeline instanceof HTMLElement) || !composer) return false;
        const rowRect = row.getBoundingClientRect();
        const timelineRect = timeline.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        return (
          rowRect.bottom > timelineRect.top &&
          rowRect.top < Math.min(timelineRect.bottom, composerRect.top)
        );
      }),
    )
    .toBe(true);
});

test("an own send stays visible at the end of a long virtualized transcript", async ({
  page,
}) => {
  await installMockBridge(page, { deepHistoryMessageCount: 600 });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-deep-history").click();
  await expect(page.getByTestId("chat-title")).toHaveText("deep-history");

  const input = page.getByTestId("message-input");
  await input.fill("feel-gate-long-transcript-send");
  await page.keyboard.press("Enter");

  const ownRow = page
    .getByTestId("message-row")
    .filter({ hasText: "feel-gate-long-transcript-send" });
  await expect(ownRow).toHaveCount(1);
  await expect
    .poll(() =>
      ownRow.evaluate((row) => {
        const timeline = row.closest('[data-testid="message-timeline"]');
        const composer = document.querySelector<HTMLElement>(
          '[data-testid="channel-composer-overlay"]',
        );
        if (!(timeline instanceof HTMLElement) || !composer) return false;
        const rowRect = row.getBoundingClientRect();
        const timelineRect = timeline.getBoundingClientRect();
        const composerRect = composer.getBoundingClientRect();
        return (
          rowRect.bottom > timelineRect.top &&
          rowRect.top < Math.min(timelineRect.bottom, composerRect.top)
        );
      }),
    )
    .toBe(true);
});

test("an own send returns a scrolled-up virtualized transcript to its physical floor", async ({
  page,
}) => {
  await installMockBridge(page, { deepHistoryMessageCount: 600 });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-deep-history").click();
  await expect(page.getByTestId("chat-title")).toHaveText("deep-history");

  const timeline = page.getByTestId("message-timeline");
  await expect(timeline.locator("[data-message-id]").first()).toBeVisible();
  await timeline.evaluate((element) => {
    element.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: -900 }),
    );
    element.scrollTop = Math.max(
      0,
      element.scrollHeight - element.clientHeight - 900,
    );
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page.getByTestId("message-scroll-to-latest")).toBeVisible();

  const input = page.getByTestId("message-input");
  await input.fill("feel-gate-scrolled-up-own-send");
  await page.keyboard.press("Enter");

  const ownRow = page
    .getByTestId("message-row")
    .filter({ hasText: "feel-gate-scrolled-up-own-send" });
  await expect(ownRow).toBeVisible();
  await expect
    .poll(() =>
      timeline.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(page.getByTestId("message-scroll-to-latest")).toHaveCount(0);
});

test("a queued own send remains visible while the current resident row is writing", async ({
  page,
}) => {
  await installMockBridge(page, {
    deepHistoryMessageCount: 600,
    managedAgents: [
      {
        channelNames: ["deep-history"],
        name: "Luca",
        pubkey: ALICE,
        status: "running",
      },
    ],
    searchProfiles: [{ displayName: "Luca", isAgent: true, pubkey: ALICE }],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-deep-history").click();
  await expect(page.getByTestId("chat-title")).toHaveText("deep-history");

  const input = page.getByTestId("message-input");
  await input.fill("feel-gate-active-turn-first-send");
  await page.keyboard.press("Enter");
  const firstRow = page
    .getByTestId("message-row")
    .filter({ hasText: "feel-gate-active-turn-first-send" });
  await expect(firstRow).toBeVisible();
  const receiptId = await firstRow.getAttribute("data-message-id");
  if (!receiptId) throw new Error("Expected an owner event ID.");

  await page.evaluate(
    ({ eventName, frame }) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(eventName, frame);
    },
    {
      eventName: MANAGED_PRESENTATION_EVENT,
      frame: {
        protocol: "luca.managed.presentation.v1",
        kind: "turn_started",
        resident_pubkey: ALICE,
        conversation_id: DEEP_HISTORY_CHANNEL_ID,
        turn_id: "feel-gate-active-turn",
        dispatch_receipt_id: receiptId,
        session_epoch: 1,
        sequence: 1,
        phase: "writing",
      },
    },
  );
  // WP-STRIP1 · the wait is a row in the thread now, not a word above the
  // composer, so the signal to look for is the working row itself.
  await expect(page.getByTestId("resident-activity-word").first()).toBeVisible();

  const timeline = page.getByTestId("message-timeline");
  await timeline.evaluate((element) => {
    element.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: -900 }),
    );
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page.getByTestId("message-scroll-to-latest")).toBeVisible();

  await input.fill("feel-gate-active-turn-queued-send");
  await page.keyboard.press("Enter");
  const queuedRow = page
    .getByTestId("message-row")
    .filter({ hasText: "feel-gate-active-turn-queued-send" });
  await expect(queuedRow).toBeVisible();
  await expect
    .poll(() =>
      timeline.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(page.getByTestId("message-scroll-to-latest")).toHaveCount(0);
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

  // The wait tier used to hold the shelf label empty for 3s; the phase word
  // answers "did it hear me?" almost immediately. WP-STRIP1 moved that word
  // out of the shelf and onto the row where the reply will land — the timing
  // guarantee is the same one, measured where the owner is actually looking.
  const label = page.getByTestId("resident-activity-word");
  await expect(label.first()).toBeVisible({ timeout: 3_000 });
  expect(Date.now() - before).toBeLessThan(2_500);
  await expect(label.first()).toHaveText(/waking|thinking/);
});
