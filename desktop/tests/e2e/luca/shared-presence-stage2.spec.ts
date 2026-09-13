import { expect, test, type Page } from "@playwright/test";

import type { ActivityTrace } from "../../../src/features/messages/activity/activityTraceTypes";
import type { ManagedTurnContextReceipt } from "../../../src/shared/api/tauriTurnContext";
import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const DM_ID = "f48efb06-0c93-5025-aac9-2e646bb6bfa8";
const ROOM_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const RESIDENT = TEST_IDENTITIES.alice.pubkey;
const RECEIPT_ID = "stage2-dispatch-one";

function terminalTrace(
  conversationId = DM_ID,
  dispatchReceiptId = RECEIPT_ID,
): ActivityTrace {
  const endedAt = Date.now();
  return {
    conversationId,
    residentPubkey: RESIDENT,
    dispatchReceiptId,
    turnId: "stage2-turn-one",
    finalMessageId: null,
    responseSurface: "timeline",
    startedAt: endedAt - 2_000,
    endedAt,
    status: "completed",
    entries: [
      {
        id: "stage2-step",
        sequence: 1,
        kind: "activity",
        status: "done",
        text: "Checking selected context",
        roomText: "Checking context",
      },
    ],
    truncated: false,
  };
}

async function openTrace(page: Page, traces: ActivityTrace[], room = false) {
  await installMockBridge(page, {
    activityTraces: traces,
    managedAgents: [
      {
        name: "Luca",
        pubkey: RESIDENT,
        channelNames: ["alice-tyler", "general"],
        status: "running",
      },
    ],
    searchProfiles: [{ pubkey: RESIDENT, displayName: "Luca", isAgent: true }],
  });
  if (room) {
    await page.goto("/?e2e=mock");
    await page.getByTestId("channel-general").click();
  } else {
    await page.goto(`/?e2e=mock#/channels/${DM_ID}`);
  }
  await expect
    .poll(() =>
      page.evaluate(
        (channelName) =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName }) ??
          false,
        room ? "general" : "alice-tyler",
      ),
    )
    .toBe(true);
}

async function openAddContext(page: Page) {
  await page.getByTestId("message-composer-add").click();
  await page.getByRole("menuitem", { name: "Add context" }).click();
  await expect(page.getByTestId("conversation-context-drawer")).toBeVisible();
}

async function interceptReceipt(
  page: Page,
  fixture: ManagedTurnContextReceipt | "defer",
) {
  await page.evaluate((response) => {
    const host = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args?: unknown) => Promise<unknown>;
      };
      stage2ReceiptCalls: unknown[];
      releaseStage2Receipt?: (value: ManagedTurnContextReceipt) => void;
    };
    const invoke = host.__TAURI_INTERNALS__.invoke;
    host.stage2ReceiptCalls = [];
    host.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === "get_managed_turn_context_receipt") {
        host.stage2ReceiptCalls.push(args);
        if (response === "defer") {
          return new Promise((resolve) => {
            host.releaseStage2Receipt = resolve;
          });
        }
        return response;
      }
      return invoke(command, args);
    };
  }, fixture);
}

async function receiptCalls(page: Page): Promise<unknown[]> {
  return page.evaluate(
    () =>
      (window as unknown as { stage2ReceiptCalls: unknown[] })
        .stage2ReceiptCalls,
  );
}

function deliveredReceipt(): ManagedTurnContextReceipt {
  return {
    availability: "available",
    unavailableReason: null,
    attachment: {
      snapshotRef: "sha256:stage2-attachment",
      revision: 3,
      sourceIds: ["connected-repository-luca"],
    },
    sessionContext: {
      status: "ready",
      deliveredToAcp: true,
      attachedSessionReferenceDelivered: false,
    },
    continuity: {
      status: "ready",
      layerStatuses: ["ready", "empty"],
      deliveredToAcp: true,
    },
  };
}

test("available sources stay separate from the saved attachment while a choice is unsaved", async ({
  page,
}) => {
  await installMockBridge(page, { conversationContextFixture: "multiple" });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-alice-tyler").click();
  await openAddContext(page);

  const sheet = page.getByTestId("conversation-context-drawer");
  const attached = page.getByTestId("conversation-context-attached");
  await expect(attached).toContainText(
    "No working folder or additional sources attached.",
  );
  await expect(
    sheet.getByText("Available here", { exact: true }),
  ).toBeVisible();
  await sheet.getByLabel(/Codex history/).check();
  await expect(attached).not.toContainText("Codex history");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await waitForAnimations(page);
  await openAddContext(page);
  await expect(sheet.getByLabel(/Codex history/)).not.toBeChecked();
  await sheet.getByLabel(/Codex history/).check();
  await sheet.getByRole("button", { name: "Save for this room" }).click();
  await expect(sheet).toBeHidden();
  await page.getByTestId("conversation-context-chip").click();
  await expect(sheet).toBeVisible();
  await expect(attached).toContainText("Codex history");
  await expect(sheet.getByLabel(/Codex history/)).toBeChecked();
  await expect(attached).toContainText(
    "Attaching a source does not confirm its files were read",
  );
});

test("the exact terminal turn fetches context only on disclosure and describes bridge delivery", async ({
  page,
}, info) => {
  await openTrace(page, [terminalTrace()]);
  await interceptReceipt(page, deliveredReceipt());
  const trace = page.locator(`[data-activity-trace="${RECEIPT_ID}"]`);
  await expect(trace).toBeVisible();
  expect(await receiptCalls(page)).toEqual([]);
  await trace.locator("[data-activity-trace-summary]").click();
  const receipt = trace.getByTestId("turn-context-receipt");
  await expect(receipt).toBeVisible();
  expect(await receiptCalls(page)).toEqual([]);
  await receipt.locator("summary").first().click();
  await expect
    .poll(() => receiptCalls(page))
    .toEqual([
      {
        input: {
          conversationId: DM_ID,
          residentPubkey: RESIDENT,
          dispatchReceiptId: RECEIPT_ID,
        },
      },
    ]);
  await expect(receipt).toContainText(
    "Source selection · revision 3 · 1 source",
  );
  await expect(receipt).toContainText("Working context delivered.");
  await expect(receipt).toContainText("Continuity packet delivered · ready.");
  await expect(receipt).toContainText(
    "Delivery does not confirm which files were read or which material the model used.",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("turn-context-wide.png") });

  await page.setViewportSize({ width: 640, height: 860 });
  await page.keyboard.press("ControlOrMeta+Equal");
  await page.keyboard.press("ControlOrMeta+Equal");
  await expect(receipt).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await waitForAnimations(page);
  await page.screenshot({
    path: info.outputPath("turn-context-narrow-zoom.png"),
  });
});

test("a delayed private receipt cannot appear after switching conversations", async ({
  page,
}) => {
  await openTrace(page, [terminalTrace()]);
  await interceptReceipt(page, "defer");
  const trace = page.locator(`[data-activity-trace="${RECEIPT_ID}"]`);
  await trace.locator("[data-activity-trace-summary]").click();
  await trace
    .getByTestId("turn-context-receipt")
    .locator("summary")
    .first()
    .click();
  await expect.poll(() => receiptCalls(page)).toHaveLength(1);
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("turn-context-receipt")).toHaveCount(0);
  await page.evaluate((response) => {
    (
      window as unknown as {
        releaseStage2Receipt: (value: ManagedTurnContextReceipt) => void;
      }
    ).releaseStage2Receipt(response);
  }, deliveredReceipt());
  await expect(page.getByTestId("turn-context-receipt")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "sha256:stage2-attachment",
  );
});

test("a shared room never fetches a private receipt and an older DM receipt says unavailable", async ({
  page,
}) => {
  const legacyReceiptId = "stage2-dm-legacy";
  await openTrace(
    page,
    [terminalTrace(ROOM_ID), terminalTrace(DM_ID, legacyReceiptId)],
    true,
  );
  await interceptReceipt(page, {
    availability: "unavailable",
    unavailableReason: "not_delivered",
    attachment: null,
    sessionContext: null,
    continuity: null,
  });
  const roomTrace = page.locator(`[data-activity-trace="${RECEIPT_ID}"]`);
  await roomTrace.locator("[data-activity-trace-summary]").click();
  await expect(roomTrace.getByTestId("turn-context-receipt")).toHaveCount(0);
  expect(await receiptCalls(page)).toEqual([]);

  await page.goto(`/?e2e=mock#/channels/${DM_ID}`);
  await interceptReceipt(page, {
    availability: "unavailable",
    unavailableReason: "not_delivered",
    attachment: null,
    sessionContext: null,
    continuity: null,
  });
  const privateTrace = page.locator(
    `[data-activity-trace="${legacyReceiptId}"]`,
  );
  await privateTrace.locator("[data-activity-trace-summary]").click();
  await privateTrace
    .getByTestId("turn-context-receipt")
    .locator("summary")
    .first()
    .click();
  await expect(privateTrace.getByTestId("turn-context-receipt")).toContainText(
    "Missing or legacy records cannot confirm what was delivered.",
  );
  await expect.poll(() => receiptCalls(page)).toHaveLength(1);
});
