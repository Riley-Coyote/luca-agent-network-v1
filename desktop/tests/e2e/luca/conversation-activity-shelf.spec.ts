import { expect, test, type Locator, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { waitForAnimations } from "../../helpers/animations";

/**
 * WP-STRIP1 · THE WORK HAPPENS IN THE THREAD.
 *
 * This file used to assert the activity shelf: a second surface above the
 * composer that painted the same working state the conversation rows already
 * painted, which is where the duplicate mark came from. Direction C retires
 * it. What is asserted now is the design that replaced it:
 *
 *  · one row per working resident, in the thread, where their reply will land;
 *  · EXACTLY ONE MARK PER WORKING RESIDENT anywhere in the document;
 *  · Stop on the row, always visible, as a plain text button;
 *  · Stop all only when there is an "all", and only at the group's bottom edge;
 *  · the same sphere character beside every resident turn, becoming the
 *    existing sandpile while that resident works.
 */

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const PRESENTATION_EVENT = "luca://managed-presentation";
const SHOTS = "test-results/activity";

async function capture(page: Page, name: string) {
  await waitForAnimations(page);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function colorChannels(element: Locator, property: string) {
  return element.evaluate((node, name) => {
    // Resolve either the browser's rgb() or Tailwind's oklab() serialization.
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Color measurement needs a 2D context.");
    context.fillStyle = getComputedStyle(node).getPropertyValue(name);
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  }, property);
}
const RESIDENTS = [
  { name: "Claude Code", pubkey: TEST_IDENTITIES.alice.pubkey },
  { name: "Codex", pubkey: TEST_IDENTITIES.charlie.pubkey },
  { name: "Luca", pubkey: TEST_IDENTITIES.bob.pubkey },
] as const;

async function openConversation(page: Page, residentCount: number) {
  await installMockBridge(page, {
    managedAgents: RESIDENTS.slice(0, residentCount).map((resident) => ({
      channelNames: ["general"],
      name: resident.name,
      pubkey: resident.pubkey,
      status: "running" as const,
    })),
  });
  await page.goto("/?e2e=mock");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
}

/**
 * Put every resident in the room into a live managed turn — the real path,
 * the one that carries a cancellable dispatch receipt, so Stop is genuinely
 * available rather than merely drawn. Observer-only activity has nothing the
 * runtime can cancel, and a row that offers Stop without one is a lie.
 */
async function startManagedTurns(page: Page, residentCount: number) {
  const content = "Start one independent response each.";
  await page.getByTestId("message-input").fill(content);
  await page.getByTestId("send-message").click();
  const ownerRow = page
    .getByTestId("message-row")
    .filter({ hasText: content })
    .last();
  await expect(ownerRow).toBeVisible();
  const receiptId = await ownerRow.getAttribute("data-message-id");
  if (!receiptId) throw new Error("Expected an owner event ID.");
  for (const [index, resident] of RESIDENTS.slice(0, residentCount).entries()) {
    await page.evaluate(
      ({ eventName, frame }) => {
        window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(eventName, frame);
      },
      {
        eventName: PRESENTATION_EVENT,
        frame: {
          protocol: "luca.managed.presentation.v1",
          kind: "turn_started",
          resident_pubkey: resident.pubkey,
          conversation_id: CHANNEL_ID,
          turn_id: `strip1-turn-${index}`,
          dispatch_receipt_id: receiptId,
          session_epoch: 7,
          sequence: 1,
        },
      },
    );
    // The second frame is not decoration: a turn is only cancellable once the
    // runtime has claimed a session epoch, so Stop is honestly unavailable
    // until it arrives. Emitting only `turn_started` would prove a Stop that
    // the real app does not offer yet.
    await page.evaluate(
      ({ eventName, frame }) => {
        window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(eventName, frame);
      },
      {
        eventName: PRESENTATION_EVENT,
        frame: {
          protocol: "luca.managed.presentation.v1",
          kind: "phase",
          phase: "working",
          resident_pubkey: resident.pubkey,
          conversation_id: CHANNEL_ID,
          turn_id: `strip1-turn-${index}`,
          dispatch_receipt_id: receiptId,
          session_epoch: 7,
          sequence: 2,
        },
      },
    );
  }
}

/** The one number the brief asks for, counted in the DOM. */
function liveMarkCount(page: Page) {
  return page.locator("[data-sandpile-activity]").count();
}

test("idle: nothing is running and no working mark exists", async ({
  page,
}) => {
  await openConversation(page, 1);
  await expect(page.getByTestId("conversation-activity-shelf")).toHaveAttribute(
    "data-active-count",
    "0",
  );
  expect(await liveMarkCount(page)).toBe(0);
  await expect(page.getByTestId("resident-stop")).toHaveCount(0);
  await expect(page.getByTestId("stop-all-working-residents")).toHaveCount(0);
  await capture(page, "state-idle");
});

test("one resident working: one row, one mark, no Stop all", async ({
  page,
}) => {
  await openConversation(page, 1);
  await startManagedTurns(page, 1);
  await expect.poll(() => liveMarkCount(page)).toBe(1);
  // The sandpile now has enough presence to match the sphere beside text.
  const mark = page.locator("[data-sandpile-activity]").first();
  await expect(mark).toHaveCSS("width", "40px");
  await expect(page.getByTestId("chat-agent-mark").last()).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("resident-header-mote")).toHaveCount(0);
  await expect(page.getByTestId("resident-activity-word")).toHaveCount(1);
  await expect(page.getByTestId("resident-elapsed")).toHaveCount(1);
  await expect(page.getByTestId("stop-all-working-residents")).toHaveCount(0);
  await capture(page, "state-one");
});

test("three residents working: exactly three marks, counted in the DOM", async ({
  page,
}) => {
  await openConversation(page, 3);
  await startManagedTurns(page, 3);
  await expect.poll(() => liveMarkCount(page)).toBe(3);
  // The shelf is not painting any of them: it reports no live agent at all.
  await expect(page.getByTestId("conversation-activity-shelf")).toHaveAttribute(
    "data-active-count",
    "0",
  );
  await expect(page.getByTestId("conversation-activity-slots")).toBeEmpty();
  await expect(page.getByTestId("resident-elapsed")).toHaveCount(3);
  await capture(page, "state-three");
});

test("the unposted case: a pending row at the tail, in the row's own geometry", async ({
  page,
}) => {
  await openConversation(page, 1);
  await startManagedTurns(page, 1);
  await expect.poll(() => liveMarkCount(page)).toBe(1);
  const rows = page.getByTestId("message-row");
  const last = rows.last();
  // The row is a real message row: same geometry, mark gutter open, body slot
  // present and empty. That is what lets the answer fill in place.
  await expect(last.locator("[data-message-mark]")).toHaveCount(1);
  await expect(last.locator("[data-sandpile-activity]")).toHaveCount(1);
  await capture(page, "state-unposted");
});

test("Stop is visible at rest, hover changes only ink, and focus uses one border", async ({
  page,
}) => {
  await openConversation(page, 1);
  await startManagedTurns(page, 1);
  const stop = page.getByTestId("resident-stop");
  await expect(stop).toHaveCount(1);
  await expect(stop).toBeVisible();
  await expect(stop).toHaveText("Stop");
  await page.mouse.move(0, 0);
  const wrapper = stop.locator("xpath=..");
  await expect(wrapper).toHaveCSS("opacity", "1");
  await expect
    .poll(() => colorChannels(stop, "color"))
    .toEqual([255, 255, 255, 115]);
  await expect(stop).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const restBorder = await stop.evaluate(
    (element) => getComputedStyle(element).borderTopColor,
  );

  await stop.hover();
  await expect
    .poll(() => colorChannels(stop, "color"))
    .toEqual([255, 255, 255, 199]);
  await expect(stop).toHaveCSS("border-top-color", restBorder);
  await expect(stop).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

  await page.keyboard.press("Tab");
  await stop.focus();
  await expect
    .poll(() => colorChannels(stop, "border-top-color"))
    .toEqual([255, 255, 255, 128]);
  await expect(stop).toHaveCSS("outline-style", "none");
  await capture(page, "stop-focus");
});

test("Stop all appears only when more than one resident is working", async ({
  page,
}) => {
  await openConversation(page, 1);
  await startManagedTurns(page, 1);
  await expect.poll(() => liveMarkCount(page)).toBe(1);
  await expect(page.getByTestId("stop-all-working-residents")).toHaveCount(0);
  await openConversation(page, 3);
  await startManagedTurns(page, 3);
  await expect.poll(() => liveMarkCount(page)).toBe(3);
  await expect(page.getByTestId("stop-all-working-residents")).toHaveCount(1);
  await capture(page, "stop-all");
});

test("resting resident rows keep live spheres while working rows show sandpiles", async ({
  page,
}) => {
  await openConversation(page, 3);
  await startManagedTurns(page, 3);
  await expect.poll(() => liveMarkCount(page)).toBe(3);
  // Two prior resident messages are visible beside the three working rows.
  await expect(page.locator("[data-testid='message-row'] mote-3d")).toHaveCount(
    2,
  );
  await capture(page, "live-spheres-in-rows");
});

test("no monospace chrome in the working surface", async ({ page }) => {
  await openConversation(page, 3);
  await startManagedTurns(page, 3);
  await expect.poll(() => liveMarkCount(page)).toBe(3);
  const offenders = await page.evaluate(() => {
    const found: string[] = [];
    const rows = [
      ...document.querySelectorAll("[data-testid='message-row']"),
    ].filter((row) => row.querySelector("[data-sandpile-activity]"));
    const surface = [
      ...rows,
      ...document.querySelectorAll(
        "[data-testid='stop-all-working-residents']",
      ),
    ];
    for (const root of surface) {
      for (const node of [root, ...root.querySelectorAll("*")]) {
        const element = node as HTMLElement;
        if (!element.textContent?.trim()) continue;
        // The row's timestamp is the message row's own pre-existing chrome,
        // shared by every row in the app and inherited from the global
        // `time { font-family: var(--font-mono) }` rule in `theme.css`.
        // Converting it only inside a working row would put two fonts on the
        // same element in one thread. It is reported to WP-BASE1, which owns
        // the app-wide mono sweep, rather than half-fixed here.
        if (element.closest("[data-message-time]")) continue;
        if (/mono/i.test(getComputedStyle(element).fontFamily)) {
          found.push(
            `${element.tagName}[${element.dataset.testid ?? element.className}]`,
          );
        }
      }
    }
    return [...new Set(found)];
  });
  // eslint-disable-next-line no-console
  console.log(`no_font_mono_in_surface ${JSON.stringify(offenders)}`);
  expect(offenders).toEqual([]);
});
