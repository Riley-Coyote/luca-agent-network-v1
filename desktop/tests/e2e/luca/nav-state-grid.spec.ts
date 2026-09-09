import fs from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";

/**
 * The nav's state grid, captured for review by eye.
 *
 * Every settled state the rail can be in — open, collapsed, peeked; with
 * and without a resident's column; on the home view, a room, a project
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
const ATLAS = { name: "Atlas", pubkey: "a".repeat(64), status: "running" };
const BEX = { name: "Bex", pubkey: "b".repeat(64), status: "running" };

const WIDTHS = [1280, 900] as const;
const TEXT_SCALES = ["1", "0.8", "1.25"] as const;
const ROUTES = ["home", "room", "project", "empty-project"] as const;
const RAILS = ["open", "collapsed", "peek"] as const;
const COLUMNS = ["none", "open"] as const;

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
      await page.goto("/?e2e=mock&projectDemo=1");
      await expect(page.getByTestId("agent-rail-atlas")).toBeVisible();

      const toggle = page
        .getByRole("button", { name: "Toggle Sidebar" })
        .first();
      const column = page.getByTestId("agent-chats-column");
      const chrome = page.getByTestId("app-top-chrome");

      for (const route of ROUTES) {
        for (const columnState of COLUMNS) {
          for (const rail of RAILS) {
            // Reset: rail open, column closed, then the route.
            const state = await page.evaluate(() => ({
              collapsed:
                document
                  .querySelector('[data-testid="app-sidebar"]')
                  ?.closest("[data-state]")
                  ?.getAttribute("data-state") === "collapsed",
              column:
                document.querySelector('[data-testid="agent-chats-column"]') !==
                null,
            }));
            if (state.collapsed) await toggle.click();
            if (state.column)
              await page.getByTestId("agent-rail-atlas").click();
            await expect(column).toHaveCount(0);
            await page.mouse.move(width - 40, 400);
            await goTo(page, route);

            if (columnState === "open") {
              await page.getByTestId("agent-rail-atlas").click();
              await expect(column).toHaveAttribute("data-panel-open", "true");
            }
            if (rail !== "open") await toggle.click();
            if (rail === "peek") {
              const edge =
                columnState === "open"
                  ? page.getByTestId("sidebar-peek-edge")
                  : page.getByRole("button", {
                      name: "Resize or toggle sidebar",
                    });
              await edge.hover();
              await expect(page.getByTestId("agent-rail-atlas")).toBeVisible();
            }
            await settle(page);

            // Every state keeps its leading header clear of the window
            // controls' strip.
            const strip = await chrome.boundingBox();
            const leading = column.first();
            if (columnState === "open" && (await leading.count())) {
              const header = await leading.locator("header").boundingBox();
              expect(header?.y ?? -1).toBeGreaterThanOrEqual(
                (strip?.y ?? 0) + (strip?.height ?? 0) - 1,
              );
            }

            await page.screenshot({
              path: path.join(
                OUT_DIR,
                `${width}w-x${scale}-${route}-column-${columnState}-rail-${rail}.png`,
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

    await page.getByTestId("agent-rail-atlas").click();
    await expect(page.getByTestId("agent-chats-column")).toBeVisible();
    await settle(page);
    await page.screenshot({
      path: path.join(OUT_DIR, `390w-${route}-sheet-column.png`),
    });
    await page.getByRole("button", { name: "Back to agents" }).click();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
});
