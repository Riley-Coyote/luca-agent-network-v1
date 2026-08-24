import { expect, test, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const PRESENTATION_EVENT = "luca://managed-presentation";
const CLAUDE = TEST_IDENTITIES.alice.pubkey;
const CODEX = TEST_IDENTITIES.charlie.pubkey;

async function openConversation(page: Page) {
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["general"],
        name: "Claude Code",
        pubkey: CLAUDE,
        status: "running",
      },
      {
        channelNames: ["general"],
        name: "Codex",
        pubkey: CODEX,
        status: "running",
      },
    ],
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

async function send(page: Page, content: string) {
  await page.getByTestId("message-input").fill(content);
  await page.getByTestId("send-message").click();
  const row = page
    .getByTestId("message-row")
    .filter({ hasText: content })
    .last();
  await expect(row).toBeVisible();
  const receiptId = await row.getAttribute("data-message-id");
  if (!receiptId) throw new Error("Expected an owner event ID.");
  return receiptId;
}

async function emitFrame(
  page: Page,
  input: {
    failure?: "runtime" | "publication" | "unavailable";
    kind: "turn_started" | "public_chunk" | "failed" | "phase";
    phase?: "finalizing";
    publicChunk?: string;
    receiptId: string;
    residentPubkey: string;
    sequence: number;
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
        conversation_id: CHANNEL_ID,
        turn_id: `operational-${input.residentPubkey.slice(0, 8)}`,
        dispatch_receipt_id: input.receiptId,
        session_epoch: 7,
        sequence: input.sequence,
        ...(input.failure ? { failure: input.failure } : {}),
        ...(input.phase ? { phase: input.phase } : {}),
        ...(input.publicChunk ? { public_chunk: input.publicChunk } : {}),
      },
    },
  );
}

test("typed failures preserve sibling text and retry only the exact resident", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await openConversation(page);
  const receiptId = await send(page, "Give me two independent updates.");

  for (const [residentPubkey, text] of [
    [CLAUDE, "Claude partial survives."],
    [CODEX, "Codex partial survives."],
  ] as const) {
    await emitFrame(page, {
      kind: "turn_started",
      receiptId,
      residentPubkey,
      sequence: 1,
    });
    await emitFrame(page, {
      kind: "public_chunk",
      publicChunk: text,
      receiptId,
      residentPubkey,
      sequence: 2,
    });
  }
  await expect(page.getByText("Claude partial survives.")).toBeVisible();
  await expect(page.getByText("Codex partial survives.")).toBeVisible();
  await emitFrame(page, {
    failure: "runtime",
    kind: "failed",
    receiptId,
    residentPubkey: CLAUDE,
    sequence: 3,
  });
  await emitFrame(page, {
    failure: "publication",
    kind: "failed",
    receiptId,
    residentPubkey: CODEX,
    sequence: 3,
  });

  await expect(page.getByText("Claude partial survives.")).toBeVisible();
  await expect(page.getByText("Codex partial survives.")).toBeVisible();
  const claudeResponse = page
    .locator("[data-managed-response-ui-key]")
    .filter({ hasText: "Claude partial survives." });
  const codexResponse = page
    .locator("[data-managed-response-ui-key]")
    .filter({ hasText: "Codex partial survives." });
  // The status line states the outcome; the Retry control below states the
  // action. It used to say both, which put the word "Retry" on a paragraph
  // nobody can press.
  await expect(
    claudeResponse.getByTestId("managed-response-status"),
  ).toHaveText("Resident stopped unexpectedly");
  await expect(codexResponse.getByTestId("managed-response-status")).toHaveText(
    "Response couldn’t be published",
  );

  await page.getByRole("button", { name: "Retry Claude Code" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sends = (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
          (entry) => entry.command === "send_channel_message",
        );
        return sends.at(-1)?.payload;
      }),
    )
    .toMatchObject({
      managedAudience: { mode: "directed", resident_pubkeys: [CLAUDE] },
    });
  expect(consoleErrors).toEqual([]);
});

test("restart hydration is body-free, deduplicated, compact, and accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await openConversation(page);
  const receiptId = await send(page, "Keep this restart-safe.");
  await emitFrame(page, {
    kind: "turn_started",
    receiptId,
    residentPubkey: CLAUDE,
    sequence: 1,
  });
  await emitFrame(page, {
    kind: "public_chunk",
    publicChunk: "Visible partial stays visible.",
    receiptId,
    residentPubkey: CLAUDE,
    sequence: 2,
  });
  await expect(page.getByText("Visible partial stays visible.")).toBeVisible();
  await page.evaluate((id) => {
    window.__BUZZ_E2E_SET_OPERATIONAL_STATUSES__?.([
      { dispatchReceiptId: id, status: "interrupted_after_restart" },
      { dispatchReceiptId: id, status: "interrupted_after_restart" },
    ]);
  }, receiptId);
  await page.getByTestId("channel-random").click();
  await page.getByTestId("channel-general").click();

  await page
    .getByRole("button", {
      name: "2 residents working. View all resident activity.",
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry Claude Code" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry Codex" })).toBeVisible();
  await expect(page.getByText("Visible partial stays visible.")).toHaveCount(1);
  await expect(page.getByTestId("managed-interrupted-status")).toHaveCount(1);
  await expect(page.getByTestId("managed-interrupted-status")).toHaveText(
    "Previous resident response interrupted after restart",
  );
  await page.getByRole("button", { name: "Retry Claude Code" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sends = (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).filter(
          (entry) => entry.command === "send_channel_message",
        );
        return sends.at(-1)?.payload;
      }),
    )
    .toMatchObject({
      managedAudience: { mode: "directed", resident_pubkeys: [CLAUDE] },
    });
  await expect(
    page.getByRole("button", { name: "Retry Claude Code" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry Codex" })).toBeVisible();
  await expect(page.getByTestId("message-input")).toBeEditable();
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
});

test("attachment and permission failures stay sanitized while text remains available", async ({
  page,
}) => {
  await openConversation(page);
  await page.evaluate(
    ({ conversationId, residentPubkey }) => {
      window.__BUZZ_E2E_SET_MANAGED_PERMISSIONS__?.([
        {
          pendingId: "safe-permission",
          request: {
            protocol: "luca.managed.permission.v1",
            resident_pubkey: residentPubkey,
            conversation_id: conversationId,
            session_epoch: 7,
            turn_id: "permission-turn",
            acp_request_id: "acp-safe",
            title: "Allow this local action?",
            options: [
              { option_id: "allow", name: "Allow", kind: "allow_once" },
              { option_id: "reject", name: "Reject", kind: "reject_once" },
            ],
          },
        },
      ]);
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("managed-permission-pending", {});
    },
    { conversationId: CHANNEL_ID, residentPubkey: CLAUDE },
  );
  await expect(page.getByTestId("managed-permission-card")).toBeVisible();
  await page.evaluate(() => {
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("managed-permission-resolved", {
      pendingId: "safe-permission",
      outcome: "session_replaced",
    });
  });
  await expect(
    page.getByText("Permission request closed when the resident restarted"),
  ).toBeVisible();

  await page.evaluate(() => {
    window.__BUZZ_E2E_SET_UPLOAD_ERROR__?.(
      "credential=do-not-render /Users/owner/private/file.pdf",
    );
  });
  await page.getByTestId("message-composer-add").click();
  await page.getByRole("menuitem", { name: "Attach files" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Attachment couldn’t be uploaded");
  await expect(alert).not.toContainText("credential=do-not-render");
  await expect(page.getByTestId("message-input")).toBeEditable();
  await page.getByTestId("message-input").fill("Ordinary text still sends.");
  await page.getByTestId("send-message").click();
  await expect(page.getByText("Ordinary text still sends.")).toBeVisible();
});
