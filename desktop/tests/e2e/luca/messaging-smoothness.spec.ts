import { expect, test } from "@playwright/test";

import {
  bootMiniChat,
  bootSmoothness,
  deliverReply,
  everyKindReply,
  MINI_RESIDENT,
  openRoom,
  rowKeyNearTop,
  type SmoothFrame,
  sendFromComposer,
  sendFromMiniChat,
  smoothnessReply,
  startFrames,
  stopCodeBlock,
  stopFrames,
  stopMarkupShown,
  watchCodeBlock,
  watchMarkupShown,
  wheelConversation,
} from "../../helpers/messagingSmoothness";

/*
 * How messaging holds still and keeps up, read from every painted frame of the
 * real conversation on the mock bridge with the new look on. Every check is a
 * count or a position, never a duration, so a busy machine cannot pass or fail
 * it. (WP-59; the measurements behind these live in the package report.)
 */

test.use({ viewport: { width: 1372, height: 835 } });
test.setTimeout(120_000);

/** One line of reply text, in px. */
const LINE_PX = 26;

function longestRunAway(frames: SmoothFrame[]): number {
  let run = 0;
  let longest = 0;
  for (const frame of frames) {
    run = frame.dist > LINE_PX ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

test("a reply growing while you are at the end keeps the end in view", async ({
  page,
}) => {
  await bootSmoothness(page);
  const receipt = await sendFromComposer(page, "Write the walkthrough.");
  await startFrames(page);
  await deliverReply(page, receipt, smoothnessReply(2));
  await page.waitForTimeout(1500);
  const frames = await stopFrames(page);
  expect(frames.length).toBeGreaterThan(30);
  expect(longestRunAway(frames)).toBeLessThan(3);
  expect(frames.at(-1)?.dist ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    2,
  );
});

test("while you read further up, a reply arriving below moves nothing you see", async ({
  page,
}) => {
  await bootSmoothness(page, { history: 120 });
  const receipt = await sendFromComposer(page, "Answer while I read.");
  await page.waitForTimeout(500);
  await wheelConversation(page, -200, 6, 60);
  await page.waitForTimeout(1200);
  const anchor = await rowKeyNearTop(page);
  expect(anchor).not.toBeNull();
  await startFrames(page, anchor);
  await deliverReply(page, receipt, smoothnessReply(2));
  await page.waitForTimeout(1500);
  const frames = await stopFrames(page);
  const tops = frames.map((frame) => frame.anchorTop);
  expect(tops.every((top) => top !== null)).toBe(true);
  const first = tops[0] as number;
  const moved = tops.filter((top) => Math.abs((top as number) - first) > 1);
  expect(moved).toEqual([]);
  await expect(page.getByTestId("message-scroll-to-latest")).toBeVisible();
});

test("jumping to the newest while a reply grows lands at the end and follows it", async ({
  page,
}) => {
  await bootSmoothness(page, { history: 120 });
  const receipt = await sendFromComposer(page, "Answer while I come back.");
  await page.waitForTimeout(500);
  await wheelConversation(page, -200, 6, 60);
  await page.waitForTimeout(1200);
  const reply = deliverReply(page, receipt, smoothnessReply(3));
  await page.waitForTimeout(1500);
  await page.getByTestId("message-scroll-to-latest").click();
  await page.waitForTimeout(400);
  await startFrames(page);
  await reply;
  await page.waitForTimeout(1500);
  const frames = await stopFrames(page);
  expect(longestRunAway(frames)).toBeLessThan(3);
  expect(frames.at(-1)?.dist ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    2,
  );
  await expect(page.getByTestId("message-scroll-to-latest")).toHaveCount(0);
});

test("a long conversation opens at its end and does not move after it draws", async ({
  page,
}) => {
  await bootSmoothness(page, { history: 500, openGeneral: false });
  await page.waitForTimeout(800);
  await startFrames(page);
  await openRoom(page, "general");
  await page.waitForTimeout(2500);
  const frames = await stopFrames(page);
  const first = frames.findIndex((frame) =>
    frame.ids.some((id) => id.startsWith("smooth")),
  );
  expect(first).toBeGreaterThanOrEqual(0);
  expect(frames[first]?.dist ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    2,
  );
  const after = frames.slice(first);
  const corrections = after.filter(
    (frame, index) =>
      index > 0 &&
      (Math.abs(frame.top - (after[index - 1] as SmoothFrame).top) > 1 ||
        Math.abs(frame.dist - (after[index - 1] as SmoothFrame).dist) > 1),
  );
  expect(corrections).toEqual([]);
});

test("scrolling up through history shows no empty stretch and nothing moves on its own", async ({
  page,
}) => {
  await bootSmoothness(page, { history: 500 });
  await page.waitForTimeout(1500);
  await startFrames(page);
  for (let burst = 0; burst < 4; burst += 1) {
    await wheelConversation(page, -90, 20, 45);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  const frames = await stopFrames(page);
  const empty = frames.filter((frame) => frame.rows === 0 || frame.gap > 150);
  expect(empty).toEqual([]);
  const drifted = frames.filter((frame, index) => {
    if (index === 0 || frame.sinceWheel < 200) return false;
    const before = (frames[index - 1] as SmoothFrame).keys;
    return Object.entries(frame.keys).some(
      ([key, top]) =>
        before[key] !== undefined &&
        Math.abs(top - (before[key] as number)) > 1,
    );
  });
  expect(drifted).toEqual([]);
  // The view really travelled into older history: messages from before the
  // first loaded page came into view (the scroll offset itself jumps when a
  // page is added above, so it is not a measure of travel).
  const oldestSeen = (frame: SmoothFrame) =>
    Math.min(
      ...frame.ids
        .filter((id) => id.startsWith("smooth"))
        .map((id) => Number(id.slice(6, 10))),
    );
  expect(
    oldestSeen(frames[0] as SmoothFrame) -
      oldestSeen(frames.at(-1) as SmoothFrame),
  ).toBeGreaterThan(40);
});

test("typing in the message box changes no message row", async ({ page }) => {
  await bootSmoothness(page, { history: 500 });
  await page.waitForTimeout(1500);
  await page.getByTestId("message-input").click();
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="message-timeline"]');
    const counts = { nodes: 0, text: 0 };
    Object.assign(window, { __rowChanges: counts });
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          counts.nodes += record.addedNodes.length + record.removedNodes.length;
        } else counts.text += 1;
      }
    }).observe(scroller as Node, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  });
  await page.keyboard.type("one letter at a time", { delay: 40 });
  for (let line = 0; line < 5; line += 1) {
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type(`line ${line}`, { delay: 30 });
  }
  for (let i = 0; i < 30; i += 1) await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
  const changes = await page.evaluate(
    () =>
      (window as unknown as { __rowChanges: { nodes: number; text: number } })
        .__rowChanges,
  );
  expect(changes).toEqual({ nodes: 0, text: 0 });
});

test("switching conversations never shows the other one's messages under the new name", async ({
  page,
}) => {
  await bootSmoothness(page, { history: 120 });
  await page.waitForTimeout(1000);
  await startFrames(page);
  for (const name of ["random", "general", "random", "general"]) {
    await openRoom(page, name);
    await page.waitForTimeout(800);
  }
  const frames = await stopFrames(page);
  const wrong = frames.filter(
    (frame) =>
      /random/.test(frame.header) &&
      frame.ids.some((id) => id.startsWith("smooth")),
  );
  expect(frames.some((frame) => /random/.test(frame.header))).toBe(true);
  expect(wrong).toEqual([]);
  expect(frames.at(-1)?.dist ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    2,
  );
});

test("a reply holding every kind of formatting never shows its markup while it is written", async ({
  page,
}) => {
  await bootSmoothness(page);
  const receipt = await sendFromComposer(page, "Write every kind.");
  await watchMarkupShown(page, "conversation");
  await deliverReply(page, receipt, everyKindReply(3));
  await page.waitForTimeout(1500);
  expect(await stopMarkupShown(page)).toEqual([]);
});

test("an open code block is a code block from its first line, and closing it moves no line", async ({
  page,
}) => {
  await bootSmoothness(page);
  const receipt = await sendFromComposer(page, "Write the code.");
  await watchCodeBlock(page, "const calibrated1");
  await deliverReply(page, receipt, everyKindReply(1));
  await page.waitForTimeout(1500);
  const watch = await stopCodeBlock(page);
  expect(watch.firstSeenInBlock).toBe(true);
  expect(watch.colouredWhileOpen).toBe(0);
  expect(watch.swaps.length).toBeGreaterThan(0);
  for (const swap of watch.swaps) {
    expect(swap.lines).toBeGreaterThan(0);
    expect(swap.maxDy).toBeLessThanOrEqual(1);
  }
});

test("in the mini chat a reply never shows its markup while it is written", async ({
  page,
}) => {
  await bootMiniChat(page);
  const { channelId, receiptId } = await sendFromMiniChat(
    page,
    "Write every kind in the mini chat.",
  );
  await watchMarkupShown(page, "mini");
  await deliverReply(page, receiptId, everyKindReply(2), {
    channelId,
    resident: MINI_RESIDENT,
  });
  await page.waitForTimeout(1500);
  expect(await stopMarkupShown(page)).toEqual([]);
});
