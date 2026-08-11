import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const CHANNEL = "general";
const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const PRESENTATION_EVENT = "luca://managed-presentation";
const CLAUDE = TEST_IDENTITIES.alice.pubkey;
const CODEX = TEST_IDENTITIES.charlie.pubkey;

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: [CHANNEL],
        name: "Claude Code",
        pubkey: CLAUDE,
        status: "running",
      },
      {
        channelNames: [CHANNEL],
        name: "Codex",
        pubkey: CODEX,
        status: "running",
      },
    ],
    searchProfiles: [
      { displayName: "Claude Code", isAgent: true, pubkey: CLAUDE },
      { displayName: "Codex", isAgent: true, pubkey: CODEX },
    ],
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

async function send(page: Page, content: string): Promise<Locator> {
  await page.getByTestId("message-input").fill(content);
  await page.getByTestId("send-message").click();
  const row = page
    .getByTestId("message-row")
    .filter({ hasText: content })
    .last();
  await expect(row).toBeVisible();
  return row;
}

async function lastSendPayload(page: Page) {
  return page.evaluate(() => {
    const entries = (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
      (entry) => entry.command === "send_channel_message",
    );
    return entries.at(-1)?.payload as
      | {
          managedAudience?: {
            mode: string;
            resident_pubkeys?: string[];
          };
          responseSurface?: string;
        }
      | undefined;
  });
}

function managedResponseRows(page: Page): Locator {
  return page.locator("[data-managed-response-ui-key]");
}

async function responseGeometry(row: Locator) {
  return row.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const body = element.querySelector<HTMLElement>(
      ".managed-response-content",
    );
    const style = getComputedStyle(body ?? element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      left: bounds.left,
      lineHeight: Number.parseFloat(style.lineHeight),
      top: bounds.top,
      width: bounds.width,
    };
  });
}

async function findThreadMessageId(page: Page, content: string) {
  return page.evaluate(
    async ({ channelId, expectedContent }) => {
      const response = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "get_thread_replies",
        {
          channelId,
          depthLimit: 64,
          limit: 200,
          rootEventId: "mock-general-alice",
        },
      )) as { events?: Array<{ content: string; id: string }> } | undefined;
      return (
        response?.events?.find((event) => event.content === expectedContent)
          ?.id ?? null
      );
    },
    { channelId: CHANNEL_ID, expectedContent: content },
  );
}

async function emitFrame(
  page: Page,
  input: {
    kind: string;
    residentPubkey: string;
    receiptId: string;
    sequence: number;
    turnId: string;
    finalMessageId?: string;
    publicChunk?: string;
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
        resident_pubkey: input.residentPubkey,
        conversation_id: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
        turn_id: input.turnId,
        dispatch_receipt_id: input.receiptId,
        session_epoch: 7,
        sequence: input.sequence,
        ...(input.publicChunk ? { public_chunk: input.publicChunk } : {}),
        ...(input.finalMessageId
          ? { final_message_id: input.finalMessageId }
          : {}),
      },
    },
  );
}

async function emitSignedFinal(
  page: Page,
  residentPubkey: string,
  receiptId: string,
  content: string,
) {
  await page.evaluate(
    ({ parentEventId, pubkey, text }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: text,
        parentEventId,
        pubkey,
        extraTags: [["broadcast", "1"]],
      });
    },
    { parentEventId: receiptId, pubkey: residentPubkey, text: content },
  );
}

test("group activation streams independently and settles into linear signed turns", async ({
  page,
}) => {
  const ownerRow = await send(page, "Give me one short update each.");
  const receiptId = await ownerRow.getAttribute("data-message-id");
  if (!receiptId) throw new Error("Expected an owner event ID.");

  await expect(managedResponseRows(page)).toHaveCount(0);
  await expect(page.getByTestId("conversation-activity-shelf")).toHaveAttribute(
    "data-active-count",
    "2",
  );
  const payload = await lastSendPayload(page);
  expect(payload?.managedAudience).toEqual({
    mode: "conversation",
    resident_pubkeys: [CLAUDE, CODEX].sort(),
  });
  expect(payload?.responseSurface).toBe("timeline");

  await emitFrame(page, {
    kind: "turn_started",
    receiptId,
    residentPubkey: CLAUDE,
    sequence: 1,
    turnId: "claude-turn",
  });
  await emitFrame(page, {
    kind: "turn_started",
    receiptId,
    residentPubkey: CODEX,
    sequence: 1,
    turnId: "codex-turn",
  });
  await emitFrame(page, {
    kind: "public_chunk",
    publicChunk: "Claude is streaming.",
    receiptId,
    residentPubkey: CLAUDE,
    sequence: 2,
    turnId: "claude-turn",
  });
  await emitFrame(page, {
    kind: "public_chunk",
    publicChunk: "Codex is streaming.",
    receiptId,
    residentPubkey: CODEX,
    sequence: 2,
    turnId: "codex-turn",
  });

  await expect(page.getByText("Claude is streaming.")).toBeVisible();
  await expect(page.getByText("Codex is streaming.")).toBeVisible();
  await expect(managedResponseRows(page)).toHaveCount(2);
  await expect(page.getByTestId("message-input")).toBeEditable();

  await emitSignedFinal(page, CLAUDE, receiptId, "Claude signed final.");
  await expect(page.getByText("Claude signed final.")).toBeVisible();
  await expect(managedResponseRows(page)).toHaveCount(2);
  await emitSignedFinal(page, CODEX, receiptId, "Codex signed final.");
  await expect(page.getByText("Codex signed final.")).toBeVisible();
  await expect(managedResponseRows(page)).toHaveCount(2);

  for (const text of ["Claude signed final.", "Codex signed final."]) {
    const row = page.getByTestId("message-row").filter({ hasText: text });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("quoted-parent")).toHaveCount(0);
  }
  await expect(page.getByText(/handoff needs attention/i)).toHaveCount(0);
  await expect(page.getByText(/skills context budget/i)).toHaveCount(0);
});

test("a streamed response settles in place when its signed final arrives", async ({
  page,
}) => {
  const claudeMessage = page.locator('[data-message-id="mock-general-alice"]');
  await claudeMessage.hover();
  await claudeMessage.getByRole("button", { name: "Reply" }).click();
  const ownerRow = await send(page, "Settle this response without a jump.");
  const receiptId = await ownerRow.getAttribute("data-message-id");
  if (!receiptId) throw new Error("Expected an owner event ID.");

  await emitFrame(page, {
    kind: "turn_started",
    receiptId,
    residentPubkey: CLAUDE,
    sequence: 1,
    turnId: "settled-turn",
  });
  await emitFrame(page, {
    kind: "public_chunk",
    publicChunk: "One continuous response.",
    receiptId,
    residentPubkey: CLAUDE,
    sequence: 2,
    turnId: "settled-turn",
  });
  const response = managedResponseRows(page).filter({
    hasText: "One continuous response.",
  });
  await expect(response).toBeVisible();
  await response.evaluate((element) => {
    element.setAttribute("data-stable-node-probe", "settled-turn");
  });
  const streamedGeometry = await responseGeometry(response);

  await emitSignedFinal(page, CLAUDE, receiptId, "One continuous response.");
  const finalResponse = managedResponseRows(page).filter({
    hasText: "One continuous response.",
  });
  await expect(finalResponse).toBeVisible();
  await expect(
    page.locator('[data-stable-node-probe="settled-turn"]'),
  ).toHaveCount(1);
  await expect(finalResponse).toHaveAttribute("data-signed-message-id", /.+/);
  const signedGeometry = await responseGeometry(finalResponse);

  for (const key of [
    "fontSize",
    "left",
    "lineHeight",
    "top",
    "width",
  ] as const) {
    expect(
      Math.abs(streamedGeometry[key] - signedGeometry[key]),
      `${key} should remain stable through signing`,
    ).toBeLessThanOrEqual(1);
  }
});

test("ordinary Reply is directed while Reply in thread remains explicit", async ({
  page,
}) => {
  const claudeMessage = page.locator('[data-message-id="mock-general-alice"]');
  await claudeMessage.hover();
  await claudeMessage.getByRole("button", { name: "Reply" }).click();
  await expect(page.getByTestId("reply-target")).toBeVisible();
  await expect(page.getByTestId("message-thread-panel")).toHaveCount(0);

  const ownerRow = await send(page, "Only Claude should receive this turn.");
  const receiptId = await ownerRow.getAttribute("data-message-id");
  if (!receiptId) throw new Error("Expected a directed event ID.");
  await expect(ownerRow.getByTestId("quoted-parent")).toHaveCount(1);
  const payload = await lastSendPayload(page);
  expect(payload?.managedAudience).toEqual({
    mode: "directed",
    resident_pubkeys: [CLAUDE],
  });
  expect(payload?.responseSurface).toBe("timeline");
  await expect(managedResponseRows(page)).toHaveCount(0);
  await expect(page.getByTestId("conversation-activity-shelf")).toHaveAttribute(
    "data-active-count",
    "1",
  );

  await emitSignedFinal(page, CLAUDE, receiptId, "Claude alone replied.");
  const finalRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Claude alone replied." });
  await expect(finalRow).toBeVisible();
  await expect(finalRow.getByTestId("quoted-parent")).toHaveCount(0);

  await claudeMessage.hover();
  await claudeMessage.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Reply in thread…" }).click();
  await expect(page.getByTestId("focused-thread-bar")).toBeVisible();
  await expect(page).toHaveURL(/thread=/);

  const threadOwnerContent = "This belongs only in the thread.";
  await page.getByTestId("message-input").fill(threadOwnerContent);
  await page.getByTestId("send-message").click();
  let threadReceiptId: string | null = null;
  await expect
    .poll(async () => {
      threadReceiptId = await findThreadMessageId(page, threadOwnerContent);
      return threadReceiptId;
    })
    .not.toBeNull();
  if (!threadReceiptId) throw new Error("Expected a thread event ID.");
  await expect
    .poll(async () => (await lastSendPayload(page))?.responseSurface)
    .toBe("thread");
  await emitFrame(page, {
    kind: "turn_started",
    receiptId: threadReceiptId,
    residentPubkey: CLAUDE,
    sequence: 1,
    turnId: "thread-turn",
  });
  await emitFrame(page, {
    kind: "public_chunk",
    publicChunk: "A real thread response.",
    receiptId: threadReceiptId,
    residentPubkey: CLAUDE,
    sequence: 2,
    turnId: "thread-turn",
  });
  const threadFinalId = "mock-thread-final";
  await page.evaluate(
    ({ claude, finalId, parentEventId }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: "A real thread response.",
        id: finalId,
        parentEventId,
        pubkey: claude,
      });
    },
    {
      claude: CLAUDE,
      finalId: threadFinalId,
      parentEventId: threadReceiptId,
    },
  );
  await emitFrame(page, {
    finalMessageId: threadFinalId,
    kind: "completed",
    receiptId: threadReceiptId,
    residentPubkey: CLAUDE,
    sequence: 3,
    turnId: "thread-turn",
  });
  const newMessageAffordance = page
    .getByRole("button", { name: /new messages?/i })
    .last();
  if (await newMessageAffordance.isVisible()) {
    await newMessageAffordance.click();
  }
  await expect(page.getByText("A real thread response.")).toBeVisible();
  await page
    .getByRole("button", { name: "Show all messages" })
    .click({ force: true });
  await expect(page.getByTestId("focused-thread-bar")).toHaveCount(0);
  await expect(page).not.toHaveURL(/thread=/);
  await expect(page.getByText("A real thread response.")).toHaveCount(0);
});

test("agent mentions activate exactly the named resident subset", async ({
  page,
}) => {
  const input = page.getByTestId("message-input");
  await input.fill("Please compare @Cla");
  await page
    .getByTestId("mention-autocomplete")
    .getByText("Claude Code")
    .click();
  await input.pressSequentially("and @Cod");
  await page.getByTestId("mention-autocomplete").getByText("Codex").click();
  await input.pressSequentially("only.");
  await page.getByTestId("send-message").click();

  const payload = await lastSendPayload(page);
  expect(payload?.managedAudience).toEqual({
    mode: "directed",
    resident_pubkeys: [CLAUDE, CODEX].sort(),
  });
  await expect(managedResponseRows(page)).toHaveCount(0);
  await expect(page.getByTestId("conversation-activity-shelf")).toHaveAttribute(
    "data-active-count",
    "2",
  );
});

test("cancellation preserves visible partial text without affecting another resident", async ({
  page,
}) => {
  const ownerRow = await send(page, "Start two independent responses.");
  const receiptId = await ownerRow.getAttribute("data-message-id");
  if (!receiptId) throw new Error("Expected an owner event ID.");
  for (const [residentPubkey, turnId] of [
    [CLAUDE, "claude-cancel"],
    [CODEX, "codex-continues"],
  ] as const) {
    await emitFrame(page, {
      kind: "turn_started",
      receiptId,
      residentPubkey,
      sequence: 1,
      turnId,
    });
    await emitFrame(page, {
      kind: "public_chunk",
      publicChunk:
        residentPubkey === CLAUDE ? "Discard this partial." : "Keep this text.",
      receiptId,
      residentPubkey,
      sequence: 2,
      turnId,
    });
  }
  await expect(page.getByText("Discard this partial.")).toBeVisible();
  await expect(page.getByText("Keep this text.")).toBeVisible();

  await page.getByRole("button", { name: "Stop Claude Code" }).click();
  const cancelPayload = await page.evaluate(() => {
    const entries = (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
      (entry) => entry.command === "cancel_managed_turn",
    );
    return entries.at(-1)?.payload;
  });
  expect(cancelPayload).toEqual({
    conversationId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
    dispatchReceiptId: receiptId,
    residentPubkey: CLAUDE,
    sessionEpoch: 7,
  });

  await emitFrame(page, {
    kind: "cancelled",
    receiptId,
    residentPubkey: CLAUDE,
    sequence: 3,
    turnId: "claude-cancel",
  });
  await expect(
    page.getByText("Stopped · Response may be incomplete", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Discard this partial.")).toBeVisible();
  await expect(page.getByText("Keep this text.")).toBeVisible();
});
