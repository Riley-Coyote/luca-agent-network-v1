import { expect, test, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

/**
 * Wake-on-send. A resident whose process is not running cannot hear a
 * message. Sending to it starts it, and the reply row says "waking" — the
 * honest word — until the harness's first frame turns it into "thinking".
 */

const CHANNEL = "general";
const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const PRESENTATION_EVENT = "luca://managed-presentation";
const LUCA = TEST_IDENTITIES.alice.pubkey;

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: [CHANNEL],
        name: "Luca",
        pubkey: LUCA,
        status: "stopped",
      },
    ],
    searchProfiles: [{ displayName: "Luca", isAgent: true, pubkey: LUCA }],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText(CHANNEL);
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

async function startCommands(page: Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [])
      .filter((entry) => entry.command === "start_managed_agent")
      .map((entry) => (entry.payload as { pubkey?: string })?.pubkey ?? null),
  );
}

test("sending to a stopped resident starts it and the row says waking, then thinking", async ({
  page,
}) => {
  await page.getByTestId("message-input").fill("are you there?");
  await page.getByTestId("send-message").click();
  const ownerRow = page
    .getByTestId("message-row")
    .filter({ hasText: "are you there?" })
    .last();
  await expect(ownerRow).toBeVisible();
  const receiptId = await ownerRow.getAttribute("data-message-id");
  if (!receiptId) throw new Error("Expected an owner event ID.");

  // The row appears at once and tells the truth: nothing is thinking yet.
  const word = page.getByTestId("resident-activity-word");
  await expect(word).toHaveText("waking");
  // Nothing to stop while starting.
  await expect(page.getByTestId("resident-stop")).toHaveCount(0);
  // The desktop started the resident on the owner's behalf.
  await expect.poll(() => startCommands(page)).toEqual([LUCA]);

  // The harness comes up, replays the send, and its first frame takes over.
  await page.evaluate(
    ({ eventName, frame }) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(eventName, frame);
    },
    {
      eventName: PRESENTATION_EVENT,
      frame: {
        protocol: "luca.managed.presentation.v1",
        kind: "turn_started",
        resident_pubkey: LUCA,
        conversation_id: CHANNEL_ID,
        turn_id: "luca-turn",
        dispatch_receipt_id: receiptId,
        session_epoch: 7,
        sequence: 1,
      },
    },
  );
  await expect(word).toHaveText("thinking");
});

test("a running resident is not started again", async ({ page }) => {
  await page.evaluate(
    (pubkey) =>
      window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("start_managed_agent", {
        pubkey,
      }),
    LUCA,
  );
  await expect
    .poll(() => startCommands(page).then((commands) => commands.length))
    .toBe(1);
  // The Agents screen's Start goes through a mutation that refreshes this
  // query; the direct mock command above does not, so refresh it here.
  await page.evaluate(() =>
    window.__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries({
      queryKey: ["managed-agents"],
    }),
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window.__BUZZ_E2E_QUERY_CLIENT__?.getQueryData([
                "managed-agents",
              ]) as Array<{ status: string }> | undefined
            )?.[0]?.status ?? null,
        ),
      { timeout: 10_000 },
    )
    .toBe("running");
  await page.getByTestId("message-input").fill("still there?");
  await page.getByTestId("send-message").click();
  await expect(page.getByTestId("resident-activity-word")).toHaveText(
    "thinking",
  );
  // Only the explicit start above; the send did not issue another.
  expect(await startCommands(page)).toEqual([LUCA]);
});
