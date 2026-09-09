import { expect, test } from "@playwright/test";

import { installMockBridge } from "../../helpers/bridge";

/**
 * The resident's companion (`<mote-3d>`) borrows a WebGL stage from a
 * document-wide pool instead of creating a renderer on every mount. These
 * cases pin the behaviour that makes that safe: the companion arrives after
 * the thread, the same stage comes back on the next open, a moved element
 * hands its stage back and borrows again, and reduced motion parks the loop.
 */

type MoteInternals = {
  _live: boolean;
  _raf: number;
  _stage: unknown;
};

const ATLAS = { name: "Atlas", pubkey: "a".repeat(64), status: "running" };
const BEX = { name: "Bex", pubkey: "b".repeat(64), status: "running" };

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, { managedAgents: [ATLAS, BEX] });
  await page.goto("/?e2e=mock&projectDemo=1");
});

test("the companion arrives after the thread and keeps its stage across opens", async ({
  page,
}) => {
  const mote = page.getByTestId("resident-header-mote");
  const canvasTag = () =>
    mote.evaluate((el) => el.querySelector("canvas")?.dataset.tag ?? null);

  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  await expect(mote).toHaveAttribute("data-ready", "");
  await expect
    .poll(() => mote.evaluate((el) => getComputedStyle(el).opacity))
    .toBe("1");
  await mote.evaluate((el) => {
    const canvas = el.querySelector("canvas");
    if (canvas) canvas.dataset.tag = "first";
  });

  // Leave for a room and come back: the pooled canvas returns.
  await page.getByTestId("channel-watercooler").click();
  await expect(mote).toHaveCount(0);
  await page
    .getByTestId("agent-chats-column")
    .locator('[data-testid^="agent-column-chat-"]')
    .first()
    .click();
  await expect(mote).toHaveAttribute("data-ready", "");
  expect(await canvasTag()).toBe("first");

  // Another resident's thread borrows the same stage once the first is back.
  await page.getByTestId("agent-rail-bex").click();
  await page.getByTestId("agent-column-new-chat").click();
  await expect(mote).toHaveAttribute("data-ready", "");
  expect(await canvasTag()).toBe("first");
});

test("a moved companion re-borrows its stage, and reduced motion parks it", async ({
  page,
}) => {
  const mote = page.getByTestId("resident-header-mote");
  await page.getByTestId("agent-rail-atlas").click();
  await page.getByTestId("agent-column-new-chat").click();
  await expect(mote).toHaveAttribute("data-ready", "");

  // Disconnect and reconnect the same node, as a DOM move (or StrictMode)
  // does: the stage is handed back on the way out and borrowed again.
  const moved = await mote.evaluate((el) => {
    const internals = el as unknown as MoteInternals;
    const parent = el.parentElement;
    if (!parent) throw new Error("companion has no parent");
    parent.removeChild(el);
    const released = internals._stage === null && !internals._live;
    parent.appendChild(el);
    return {
      released,
      reacquired: internals._stage !== null && internals._live,
      canvas: Boolean(el.querySelector("canvas")),
    };
  });
  expect(moved).toEqual({ released: true, reacquired: true, canvas: true });
  await expect
    .poll(() => mote.evaluate((el) => (el as unknown as MoteInternals)._raf))
    .not.toBe(0);

  // Reduced motion: one settled frame, then the loop parks. Lifting it resumes.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => mote.evaluate((el) => (el as unknown as MoteInternals)._raf))
    .toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(() => mote.evaluate((el) => (el as unknown as MoteInternals)._raf))
    .not.toBe(0);
});
