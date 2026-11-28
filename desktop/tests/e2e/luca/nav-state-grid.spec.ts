import fs from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { chooseRailAgents } from "../../helpers/railAgents";

/**
 * The nav's state grid, captured for review by eye.
 *
 * Every settled state the rail can be in — open, collapsed, peeked; with
 * a resident's sessions folded and unfolded under it (since 6dbb49a64 they
 * unfold in the rail; the resident's chats column is gone); on the home
 * view, a room, a project
 * room and an empty project; at three widths and three text scales —
 * lands as a PNG under desktop/nav-grid/, named by its coordinates.
 * The repo has no baseline-diffing screenshot tests, and macOS-versus-CI
 * font rendering makes committed baselines fragile, so this is an
 * instrument, not a gate: it asserts only that every state renders with
 * the rail's headers where they belong, and leaves the judgement to the
 * person opening the folder.
 *
 * Run it:
 *   pnpm build:e2e && npx playwright test tests/e2e/luca/nav-state-grid.spec.ts
 *   then open desktop/nav-grid/.
 */

// Outside test-results on purpose: Playwright empties that folder at the start
// of every run, and a grid is for keeping until someone has looked at it.
const OUT_DIR = "nav-grid";
// Atlas is in a room, so its unfolded sessions hold a real session row.
const ATLAS = {
  name: "Atlas",
  pubkey: "a".repeat(64),
  status: "running",
  channelNames: ["engineering"],
};
const BEX = { name: "Bex", pubkey: "b".repeat(64), status: "running" };

const WIDTHS = [1280, 900] as const;
const TEXT_SCALES = ["1", "0.8", "1.25"] as const;
const ROUTES = ["home", "room", "project", "empty-project"] as const;
const RAILS = ["open", "collapsed", "peek"] as const;
const SESSIONS = ["folded", "unfolded"] as const;

type Route = (typeof ROUTES)[number];

async function goTo(page: Page, route: Route, phone = false) {
  switch (route) {
    case "home":
      await page.getByRole("button", { name: "Inbox", exact: true }).click();
      return;
    case "room":
      await page.getByTestId("channel-watercooler").click();
      await expect(page.getByTestId("chat-title")).toHaveText("watercooler");
      return;
    case "project":
      await page.getByTestId("project-row-luca").click();
      // The desktop shows the room navigator; the phone goes straight to the
      // remembered room and wears the project as a back row.
      await expect(
        phone
          ? page.locator(".luca-project-mobile-back")
          : page.getByTestId("project-room-navigator"),
      ).toBeVisible();
      return;
    case "empty-project":
      await page.getByTestId("project-row-field-unit").click();
      return;
  }
}

async function settle(page: Page) {
  await waitForAnimations(page);
  await page.waitForTimeout(120);
}

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

for (const width of WIDTHS) {
  for (const scale of width === 1280 ? TEXT_SCALES : (["1"] as const)) {
    test(`desktop ${width}px at text scale ${scale}: every rail × column × route state`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript((textScale) => {
        window.localStorage.setItem("buzz:text-scale", textScale);
      }, scale);
      await installMockBridge(page, { managedAgents: [ATLAS, BEX] });
      await chooseRailAgents(page);
      await page.goto("/?e2e=mock&projectDemo=1");
      await expect(page.getByTestId("agent-rail-atlas")).toBeVisible();

      const toggle = page
        .getByRole("button", { name: "Toggle Sidebar" })
        .first();
      const atlas = page.getByTestId("agent-rail-atlas");
      const sessions = page.getByRole("group", { name: "Sessions with Atlas" });
      const sidebar = page.getByTestId("app-sidebar");
      const chrome = page.getByTestId("app-top-chrome");

      for (const route of ROUTES) {
        for (const sessionState of SESSIONS) {
          for (const rail of RAILS) {
            // Reset: rail open, Atlas folded, then the route.
            const collapsed = await page.evaluate(
              () =>
                document
                  .querySelector('[data-testid="app-sidebar"]')
                  ?.closest("[data-state]")
                  ?.getAttribute("data-state") === "collapsed",
            );
            if (collapsed) await toggle.click();
            if ((await atlas.getAttribute("aria-expanded")) === "true")
              await atlas.click();
            await expect(sessions).toHaveCount(0);
            await page.mouse.move(width - 40, 400);
            await goTo(page, route);

            if (sessionState === "unfolded") {
              await atlas.click();
              await expect(atlas).toHaveAttribute("aria-expanded", "true");
              await expect(
                sessions.getByRole("button", { name: /^engineering/ }),
              ).toBeVisible();
            }
            if (rail !== "open") await toggle.click();
            if (rail === "peek") {
              await page
                .getByRole("button", { name: "Resize or toggle sidebar" })
                .hover();
              await expect(atlas).toBeVisible();
            }
            await settle(page);

            // Wherever the rail shows, unfolded sessions sit inside it, below
            // the window controls' strip, without widening it.
            if (sessionState === "unfolded" && rail !== "collapsed") {
              const strip = await chrome.boundingBox();
              const railBox = await sidebar.boundingBox();
              const list = await sessions.boundingBox();
              if (!strip || !railBox || !list)
                throw new Error("Missing the strip, the rail or the sessions");
              expect(list.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1);
              expect(list.x).toBeGreaterThanOrEqual(railBox.x - 1);
              expect(list.x + list.width).toBeLessThanOrEqual(
                railBox.x + railBox.width + 1,
              );
            }

            await page.screenshot({
              path: path.join(
                OUT_DIR,
                `${width}w-x${scale}-${route}-sessions-${sessionState}-rail-${rail}.png`,
              ),
            });
            await page.mouse.move(width - 40, 400);
          }
        }
      }
    });
  }
}

test("phone 390px: the sheet with and without a resident's column, on every route", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMockBridge(page, { managedAgents: [ATLAS, BEX] });
  await chooseRailAgents(page);
  await page.goto("/?e2e=mock&projectDemo=1");

  const sheet = page.getByRole("dialog", { name: "Sidebar", exact: true });
  const open = () =>
    page.getByRole("button", { name: "Toggle Sidebar" }).click();
  for (const route of ROUTES) {
    await open();
    await expect(sheet).toBeVisible();
    await goTo(page, route, true);
    // Rows and projects close the sheet themselves; the top nav (Inbox) does
    // not — a pre-existing mobile behaviour, not this grid's subject.
    if (await sheet.isVisible()) await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await settle(page);
    await page.screenshot({
      path: path.join(OUT_DIR, `390w-${route}-closed.png`),
    });

    await open();
    await expect(sheet).toBeVisible();
    await settle(page);
    await page.screenshot({
      path: path.join(OUT_DIR, `390w-${route}-sheet.png`),
    });

    // Since 6dbb49a64 a resident's sessions unfold in the sheet itself.
    const atlas = page.getByTestId("agent-rail-atlas");
    const sessions = page.getByRole("group", { name: "Sessions with Atlas" });
    await atlas.click();
    await expect(
      sessions.getByRole("button", { name: /^engineering/ }),
    ).toBeVisible();
    await settle(page);
    const sheetBox = await sheet.boundingBox();
    const listBox = await sessions.boundingBox();
    if (!sheetBox || !listBox) throw new Error("Missing the sheet or sessions");
    expect(listBox.x + listBox.width).toBeLessThanOrEqual(
      sheetBox.x + sheetBox.width + 1,
    );
    await page.screenshot({
      path: path.join(OUT_DIR, `390w-${route}-sheet-sessions.png`),
    });
    await atlas.click();
    await expect(sessions).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
});
