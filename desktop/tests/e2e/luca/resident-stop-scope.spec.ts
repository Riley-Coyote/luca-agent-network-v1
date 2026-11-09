import { expect, test, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

const RESIDENT = TEST_IDENTITIES.alice.pubkey;
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

async function startTurn(page: Page, text: string) {
  await page.getByTestId("message-input").fill(text);
  await page.getByTestId("send-message").click();
  const row = page.getByTestId("message-row").filter({ hasText: text }).last();
  await expect(row).toBeVisible();
  const receipt = await row.getAttribute("data-message-id");
  const channel = new URL(page.url()).hash
    .split("/channels/")[1]
    ?.split("?")[0];
  if (!receipt || !channel) throw new Error("The exact turn is missing.");
  await page.evaluate(
    ({ channel, receipt, resident }) => {
      const frame = {
        protocol: "luca.managed.presentation.v1",
        resident_pubkey: resident,
        conversation_id: channel,
        turn_id: `stop-scope-${receipt}`,
        dispatch_receipt_id: receipt,
        session_epoch: 7,
      };
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://managed-presentation", {
        ...frame,
        kind: "turn_started",
        sequence: 1,
      });
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("luca://managed-presentation", {
        ...frame,
        kind: "phase",
        phase: "working",
        sequence: 2,
      });
    },
    { channel, receipt, resident: RESIDENT },
  );
  await expect(
    page.getByRole("button", { name: "Stop Luca", exact: true }).last(),
  ).toBeVisible();
  return { channel, receipt };
}

for (const destination of [
  "another conversation",
  "a return to the earlier conversation",
  "replacement work in the same conversation",
] as const) {
  test(`late Stop failure cannot affect ${destination}`, async ({ page }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          name: "Luca",
          pubkey: RESIDENT,
          status: "running",
          channelNames: ["general", "random"],
        },
      ],
    });
    await page.goto(`/?e2e=mock#/channels/${GENERAL}`);
    const first = await startTurn(page, "A turn in the first conversation");
    await page.evaluate(() => {
      const host = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
        __STOP_SCOPE_TEST__?: {
          calls: Record<string, unknown>[];
          fail?: () => void;
        };
      };
      const state: NonNullable<typeof host.__STOP_SCOPE_TEST__> = { calls: [] };
      host.__STOP_SCOPE_TEST__ = state;
      const original = host.__TAURI_INTERNALS__.invoke.bind(
        host.__TAURI_INTERNALS__,
      );
      host.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === "list_cancellable_managed_turns") return [];
        if (command !== "cancel_managed_turn") return original(command, args);
        state.calls.push(args ?? {});
        return new Promise((_, reject) => {
          state.fail = () => reject(new Error("Only the old Stop failed."));
        });
      };
    });
    await page.getByRole("button", { name: "Stop Luca", exact: true }).click();
    await page.waitForFunction(() =>
      Boolean(
        (window as unknown as { __STOP_SCOPE_TEST__?: { fail?: unknown } })
          .__STOP_SCOPE_TEST__?.fail,
      ),
    );
    if (destination === "replacement work in the same conversation") {
      await startTurn(page, "Replacement work after an agent restart");
    } else {
      await page.getByTestId("channel-random").click();
      await startTurn(page, "A separate turn in another conversation");
    }
    if (destination === "a return to the earlier conversation") {
      await page.getByTestId("channel-general").click();
      await expect(page.getByTestId("message-input")).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "Stop Luca", exact: true }).last(),
    ).toBeVisible();
    const calls = await page.evaluate(async () => {
      const state = (
        window as unknown as {
          __STOP_SCOPE_TEST__?: { calls: unknown[]; fail?: () => void };
        }
      ).__STOP_SCOPE_TEST__;
      state?.fail?.();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      return state?.calls;
    });
    expect(calls).toEqual([
      {
        conversationId: first.channel,
        dispatchReceiptId: first.receipt,
        residentPubkey: RESIDENT,
        sessionEpoch: 7,
      },
    ]);
    await expect(
      page.getByRole("button", { name: "Stop Luca", exact: true }).last(),
    ).toBeEnabled();
    await expect(
      page.getByText("One resident could not be stopped.", { exact: true }),
    ).toHaveCount(0);
  });
}
