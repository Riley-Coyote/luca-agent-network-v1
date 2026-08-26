import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

/**
 * Queued sends. Residents run in queue mode: a message sent while a turn is
 * in flight is delivered when the turn finishes — never a silent cancel.
 * The held-delivery notice narrates that hold and carries the one explicit
 * interrupt. These gates pin the notice's lifecycle.
 */

const LUCA = TEST_IDENTITIES.alice.pubkey;
const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const PRESENTATION_EVENT = "luca://managed-presentation";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["general"],
        name: "Luca",
        pubkey: LUCA,
        status: "running",
      },
    ],
    searchProfiles: [{ displayName: "Luca", isAgent: true, pubkey: LUCA }],
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
});

test("a send during a live turn shows the held notice; turn end clears it", async ({
  page,
}) => {
  // First send starts a turn (seeded presentation).
  await page.getByTestId("message-input").fill("first message starts a turn");
  await page.getByTestId("send-message").click();
  const firstRow = page
    .getByTestId("message-row")
    .filter({ hasText: "first message starts a turn" })
    .last();
  await expect(firstRow).toBeVisible();
  const receiptId = await firstRow.getAttribute("data-message-id");

  // No notice for the first send — nothing was live when it went out.
  await expect(page.getByTestId("held-delivery-notice")).toHaveCount(0);

  // The runtime confirms the turn.
  await page.evaluate(
    ({ eventName, payload }) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(eventName, payload);
    },
    {
      eventName: PRESENTATION_EVENT,
      payload: {
        protocol: "luca.managed.presentation.v1",
        resident_pubkey: LUCA,
        conversation_id: CHANNEL_ID,
        turn_id: "queued-send-turn",
        dispatch_receipt_id: receiptId,
        session_epoch: 1,
        kind: "turn_started",
        sequence: 1,
        phase: "thinking",
      },
    },
  );

  // Second send while the turn is live → the held notice appears, with the
  // interrupt enabled (the turn is confirmed and cancellable).
  await page.getByTestId("message-input").fill("second message queues");
  await page.getByTestId("send-message").click();
  const notice = page.getByTestId("held-delivery-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("queued");
  await expect(page.getByTestId("held-delivery-interrupt")).toBeEnabled();

  // The turn finishes (cancelled here — any terminal works) → notice clears.
  await page.evaluate(
    ({ eventName, payload }) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(eventName, payload);
    },
    {
      eventName: PRESENTATION_EVENT,
      payload: {
        protocol: "luca.managed.presentation.v1",
        resident_pubkey: LUCA,
        conversation_id: CHANNEL_ID,
        turn_id: "queued-send-turn",
        dispatch_receipt_id: receiptId,
        session_epoch: 1,
        kind: "cancelled",
        sequence: 2,
      },
    },
  );
  await expect(notice).toHaveCount(0);
});
