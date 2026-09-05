import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const CLAUDE = TEST_IDENTITIES.alice.pubkey;
const PRESENTATION_EVENT = "luca://managed-presentation";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["general"],
        name: "Claude Code",
        pubkey: CLAUDE,
        status: "running",
      },
    ],
    searchProfiles: [
      { displayName: "Claude Code", isAgent: true, pubkey: CLAUDE },
    ],
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

async function send(page: Page, content: string): Promise<string> {
  await page.getByTestId("message-input").fill(content);
  await page.getByTestId("send-message").click();
  const row = page
    .getByTestId("message-row")
    .filter({ hasText: content })
    .last();
  await expect(row).toBeVisible();
  const messageId = await row.getAttribute("data-message-id");
  if (!messageId) throw new Error("Expected an owner event ID.");
  return messageId;
}

async function emitFrame(
  page: Page,
  input: {
    kind: string;
    publicChunk?: string;
    receiptId: string;
    sequence: number;
    turnId: string;
  },
) {
  await page.evaluate(
    ({ eventName, frame }) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(eventName, frame);
    },
    {
      eventName: PRESENTATION_EVENT,
      frame: {
        protocol: "luca.managed.presentation.v1",
        kind: input.kind,
        resident_pubkey: CLAUDE,
        conversation_id: CHANNEL_ID,
        turn_id: input.turnId,
        dispatch_receipt_id: input.receiptId,
        session_epoch: 7,
        sequence: input.sequence,
        ...(input.publicChunk ? { public_chunk: input.publicChunk } : {}),
      },
    },
  );
}

async function emitSignedFinal(
  page: Page,
  receiptId: string,
  content: string,
  id: string,
) {
  await page.evaluate(
    ({ eventId, parentEventId, pubkey, text }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: text,
        id: eventId,
        parentEventId,
        pubkey,
        extraTags: [
          ["broadcast", "1"],
          ["luca-managed-dispatch", parentEventId],
        ],
      });
    },
    { eventId: id, parentEventId: receiptId, pubkey: CLAUDE, text: content },
  );
}

function managedRow(page: Page): Locator {
  return page.locator("[data-managed-response-ui-key]").last();
}

test("a mounted streamed row never folds when its signed final settles", async ({
  page,
}) => {
  const receiptId = await send(page, "Write a long geometry check.");
  const longStream = Array.from(
    { length: 20 },
    (_, index) => `Stream line ${index + 1} keeps one stable response surface.`,
  ).join("\n");

  await emitFrame(page, {
    kind: "turn_started",
    receiptId,
    sequence: 1,
    turnId: "long-geometry-turn",
  });
  await emitFrame(page, {
    kind: "public_chunk",
    publicChunk: longStream,
    receiptId,
    sequence: 2,
    turnId: "long-geometry-turn",
  });
  await emitFrame(page, {
    kind: "completed",
    receiptId,
    sequence: 3,
    turnId: "long-geometry-turn",
  });

  const response = managedRow(page);
  await expect(response).toContainText("Stream line 20");
  await expect(response.getByTestId("message-body-expand")).toHaveCount(0);
  await response.evaluate((element) => {
    element.setAttribute("data-stable-long-row", "true");
  });
  const streamedHeight = await response.evaluate(
    (element) => element.getBoundingClientRect().height,
  );

  await emitSignedFinal(
    page,
    receiptId,
    longStream,
    "managed-long-signed-final",
  );
  await expect(response).toHaveAttribute(
    "data-signed-message-id",
    "managed-long-signed-final",
  );
  await expect(page.locator('[data-stable-long-row="true"]')).toHaveCount(1);
  await expect(response.getByTestId("message-body-expand")).toHaveCount(0);
  const signedHeight = await response.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(Math.abs(streamedHeight - signedHeight)).toBeLessThanOrEqual(1);

  const durableBody = Array.from(
    { length: 20 },
    (_, index) => `Durable line ${index + 1} uses normal history behavior.`,
  ).join("\n");
  await page.evaluate(
    ({ content, pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content,
        id: "ordinary-durable-long-message",
        pubkey,
      });
    },
    { content: durableBody, pubkey: CLAUDE },
  );
  const durableRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Durable line 1" });
  await expect(durableRow.getByTestId("message-body-expand")).toBeVisible();
  await expect(
    durableRow.getByRole("button", { name: "Show more" }),
  ).toBeVisible();
});

test("managed growth follows at presentation cadence and retires on scroll-away", async ({
  page,
}) => {
  const receiptId = await send(
    page,
    "Stream enough lines to test tail follow.",
  );
  await emitFrame(page, {
    kind: "turn_started",
    receiptId,
    sequence: 1,
    turnId: "tail-follow-turn",
  });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    performance.clearMarks("luca:message-composer-commit");
  });
  for (let sequence = 2; sequence <= 201; sequence += 1) {
    await emitFrame(page, {
      kind: "public_chunk",
      publicChunk: "x\n",
      receiptId,
      sequence,
      turnId: "tail-follow-turn",
    });
  }

  const timeline = page.getByTestId("message-timeline");
  await expect
    .poll(async () =>
      Number(
        (await timeline.getAttribute("data-managed-tail-follow-count")) ?? 0,
      ),
    )
    .toBeGreaterThan(1);
  await page.waitForTimeout(1_500);
  await expect
    .poll(() =>
      managedRow(page).evaluate(
        (element) => element.textContent?.match(/x/g)?.length ?? 0,
      ),
    )
    .toBeGreaterThanOrEqual(200);
  const composerCommits = await page.evaluate(
    () => performance.getEntriesByName("luca:message-composer-commit").length,
  );
  expect(composerCommits).toBeLessThanOrEqual(3);
  const followedAtTail = Number(
    (await timeline.getAttribute("data-managed-tail-follow-count")) ?? 0,
  );
  // Preserve the established 120-chunk cadence budget (42 follows) while
  // exercising the longer 200-chunk stream used by the composer-render gate.
  expect(followedAtTail).toBeLessThanOrEqual(70);

  const followedScrollTop = await timeline.evaluate(
    (element) => element.scrollTop,
  );
  await timeline.hover();
  await page.mouse.wheel(0, -Math.max(1_000, followedScrollTop));
  await expect
    .poll(() => timeline.evaluate((element) => element.scrollTop))
    .toBeLessThan(Math.max(0, followedScrollTop - 72));
  await page.waitForTimeout(80);
  const countAfterScrollAway = Number(
    (await timeline.getAttribute("data-managed-tail-follow-count")) ?? 0,
  );
  for (let sequence = 202; sequence <= 321; sequence += 1) {
    await emitFrame(page, {
      kind: "public_chunk",
      publicChunk: "y\n",
      receiptId,
      sequence,
      turnId: "tail-follow-turn",
    });
  }
  await page.waitForTimeout(1_500);

  expect(
    Number(
      (await timeline.getAttribute("data-managed-tail-follow-count")) ?? 0,
    ),
  ).toBe(countAfterScrollAway);
  expect(await timeline.evaluate((element) => element.scrollTop)).toBeLessThan(
    2,
  );
});
