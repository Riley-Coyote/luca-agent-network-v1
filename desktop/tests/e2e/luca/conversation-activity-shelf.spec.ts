import { expect, test, type Page } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";

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
 *  · Stop on the row, revealed by hover or focus, as a text button;
 *  · Stop all only when there is an "all", and only at the group's bottom edge;
 *  · the identity glyph beside a name, never the orb.
 */

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const PRESENTATION_EVENT = "luca://managed-presentation";
const SHOTS = "/Volumes/LaCie/Luca-Development/wp/strip1";
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
  await page.screenshot({ path: `${SHOTS}/state-idle.png`, fullPage: false });
});

test("one resident working: one row, one mark, no Stop all", async ({
  page,
}) => {
  await openConversation(page, 1);
  await startManagedTurns(page, 1);
  await expect.poll(() => liveMarkCount(page)).toBe(1);
  // The mark is drawn at the ROW's size, not the shelf's 32.
  const mark = page.locator("[data-sandpile-activity]").first();
  await expect(mark).toHaveCSS("width", "21px");
  await expect(page.getByTestId("resident-activity-word")).toHaveCount(1);
  await expect(page.getByTestId("resident-elapsed")).toHaveCount(1);
  await expect(page.getByTestId("stop-all-working-residents")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/state-one.png` });
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
  await page.screenshot({ path: `${SHOTS}/state-three.png` });
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
  await page.screenshot({ path: `${SHOTS}/state-unposted.png` });
});

test("Stop lives on the row, is revealed, and focus brightens its own border", async ({
  page,
}) => {
  await openConversation(page, 1);
  await startManagedTurns(page, 1);
  const stop = page.getByTestId("resident-stop");
  await expect(stop).toHaveCount(1);
  // It is a text button, not a checkbox and not a square.
  await expect(stop).toHaveJSProperty("tagName", "BUTTON");
  await expect(stop).toHaveText("Stop");
  await expect(stop).toHaveCount(1);

  // The object transitions its border over 150ms, so a reading taken the
  // instant the state changes is a reading of the transition, not the state.
  const border = async () => {
    await page.waitForTimeout(300);
    return stop.evaluate((element) => getComputedStyle(element).borderTopColor);
  };
  const reveal = stop.locator("xpath=..");

  // REST: the object is there, holding its slot, at zero opacity — so
  // revealing it never moves a word.
  await expect(reveal).toHaveCSS("opacity", "0");
  const rest = await border();

  // HOVER the row reveals it; hover the object itself lifts its border.
  await page.getByTestId("message-row").last().hover();
  await expect(reveal).toHaveCSS("opacity", "1");
  await stop.hover();
  const hover = await border();

  // FOCUS: keyboard, because that is the interaction `:focus-visible` is for
  // — and the treatment is this element's OWN border brightening in place.
  await page.keyboard.press("Tab");
  await stop.focus();
  await expect(reveal).toHaveCSS("opacity", "1");
  const focus = await border();
  const outline = await stop.evaluate(
    (element) => getComputedStyle(element).outlineStyle,
  );
  await page.screenshot({ path: `${SHOTS}/stop-focus.png` });

  // DISABLED: the state the object enters while a stop is in flight. The
  // attribute is set here rather than waited for, because what is under test
  // is the treatment, not the mock runtime's cancellation timing — the row's
  // own "Stopping" wording is asserted by the unit tests.
  await stop.evaluate((element) => {
    element.blur();
    (element as HTMLButtonElement).disabled = true;
  });
  await page.mouse.move(0, 0);
  const disabled = await border();
  await page.screenshot({ path: `${SHOTS}/stop-disabled.png` });

  // eslint-disable-next-line no-console
  console.log(
    `stop_states ${JSON.stringify({ rest, hover, focus, outline, disabled })}`,
  );
  expect(hover).not.toBe(rest);
  expect(focus).not.toBe(hover);
  expect(focus).not.toBe(rest);
  // No second ring anywhere: the border IS the indicator.
  expect(outline).toBe("none");
  expect(disabled).not.toBe(rest);
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
  await page.screenshot({ path: `${SHOTS}/stop-all.png` });
});

test("a resident row carries the identity glyph, never the orb", async ({
  page,
}) => {
  await openConversation(page, 3);
  await startManagedTurns(page, 3);
  await expect.poll(() => liveMarkCount(page)).toBe(3);
  // No WebGL orb anywhere in a conversation row.
  await expect(page.locator("[data-testid='message-row'] mote-3d")).toHaveCount(
    0,
  );
  await page.screenshot({ path: `${SHOTS}/glyphs-in-rows.png` });
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
      ...document.querySelectorAll("[data-testid='stop-all-working-residents']"),
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
