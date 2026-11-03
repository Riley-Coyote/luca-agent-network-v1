import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

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

test("a send during a live turn shows the held notice; signed final clears it", async ({
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

  // Observer completion alone can precede durable publication, so the hold
  // remains until the signed final that actually releases the native queue.
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
        kind: "completed",
        sequence: 2,
      },
    },
  );
  await expect(notice).toBeVisible();

  await page.evaluate(
    ({ dispatchReceiptId, pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: "first turn finished",
        parentEventId: dispatchReceiptId,
        pubkey,
        extraTags: [
          ["luca-managed-dispatch", dispatchReceiptId],
          ["broadcast", "1"],
        ],
      });
    },
    { dispatchReceiptId: receiptId, pubkey: LUCA },
  );
  await expect(notice).toHaveCount(0);
});

test("late confirmation enables interrupt and never targets the queued follow-up", async ({
  page,
}) => {
  await page.getByTestId("message-input").fill("earlier reply");
  await page.getByTestId("send-message").click();
  const first = await page
    .getByTestId("message-row")
    .filter({ hasText: "earlier reply" })
    .last()
    .getAttribute("data-message-id");
  await page.getByTestId("message-input").fill("queued follow-up");
  await page.getByTestId("send-message").click();
  const second = await page
    .getByTestId("message-row")
    .filter({ hasText: "queued follow-up" })
    .last()
    .getAttribute("data-message-id");
  const interrupt = page.getByTestId("held-delivery-interrupt");
  await expect(interrupt).toBeVisible();
  await expect(interrupt).toBeDisabled();
  for (const [receipt, epoch] of [
    [first, 10],
    [second, 11],
  ] as const) {
    await page.evaluate(
      ({ receipt, epoch, resident, channel }) =>
        window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://managed-presentation", {
          protocol: "luca.managed.presentation.v1",
          resident_pubkey: resident,
          conversation_id: channel,
          turn_id: `exact-${epoch}`,
          dispatch_receipt_id: receipt,
          session_epoch: epoch,
          kind: "turn_started",
          sequence: 1,
          phase: "thinking",
        }),
      { receipt, epoch, resident: LUCA, channel: CHANNEL_ID },
    );
  }
  await expect(interrupt).toBeEnabled();
  await expect(interrupt).toHaveText("Stop earlier reply");
  await interrupt.click();
  const cancels = await page.evaluate(() =>
    window.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
      (call) => call.command === "cancel_managed_turn",
    ),
  );
  expect(cancels).toHaveLength(1);
  expect(cancels?.[0].payload).toMatchObject({
    dispatchReceiptId: first,
    sessionEpoch: 10,
    residentPubkey: LUCA,
  });
  expect(cancels?.[0].payload).not.toMatchObject({ dispatchReceiptId: second });
});

for (const mode of ["dark", "light"] as const) {
  test(`${mode}: queued notice uses the approved plate and keyboard control`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      ({ key, mode }) => {
        localStorage.setItem(key, JSON.stringify({ "shell-frame": true }));
        localStorage.setItem(
          "buzz-theme",
          mode === "dark" ? "vitesse-black" : "paper",
        );
        localStorage.setItem("buzz-follow-system", "false");
      },
      { key: FEATURE_OVERRIDES_STORAGE_KEY, mode },
    );
    await page.goto(`/#/channels/${CHANNEL_ID}`);
    await page.getByTestId("message-input").fill("A short earlier request");
    await page.getByTestId("send-message").click();
    const receipt = await page
      .getByTestId("message-row")
      .filter({ hasText: "A short earlier request" })
      .last()
      .getAttribute("data-message-id");
    await page.evaluate(
      ({ receipt, resident, channel }) =>
        window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://managed-presentation", {
          protocol: "luca.managed.presentation.v1",
          resident_pubkey: resident,
          conversation_id: channel,
          turn_id: "visual-notice",
          dispatch_receipt_id: receipt,
          session_epoch: 20,
          kind: "turn_started",
          sequence: 1,
          phase: "thinking",
        }),
      { receipt, resident: LUCA, channel: CHANNEL_ID },
    );
    await page
      .getByTestId("message-input")
      .fill("One clarification while you work");
    await page.getByTestId("send-message").click();
    const notice = page.getByTestId("held-delivery-notice");
    const interrupt = page.getByTestId("held-delivery-interrupt");
    await expect(notice).toBeVisible();
    await interrupt.focus();
    await expect(interrupt).toBeFocused();
    await expect(notice.locator(".luca-temporary-notice")).toHaveCSS(
      "border-top-width",
      "0px",
    );
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await notice.screenshot({
        path: info.outputPath(`queued-${mode}-${width}.png`),
        animations: "disabled",
      });
      expect(
        await notice.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
  });
}
