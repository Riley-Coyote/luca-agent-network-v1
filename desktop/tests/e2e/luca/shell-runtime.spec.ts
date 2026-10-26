import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { railGlassAtRest } from "../flagOffSettle";

/**
 * A connected app's sessions under the frame (SHELL_SPEC.md, "The rail": the
 * runtime sessions column retires; NAVIGATION.md, "Agents"; SHELL_BUILD.md
 * WP-10, Decided 4, and WP-15). Until WP-10 the column was a card of its own
 * between the rail's and the conversation's (WP-08c, Decided 12); one card
 * and the Connected card in Agents replace it. So the column's checks move to
 * that card: it lies on the one card beside the rail, with no surface of its
 * own; the lip follows what the rail opens; nothing opens the column, at any
 * size; Paper by day, the glass's one shadow, text zoom. The column's own
 * measures (its 22 rem, its 4 to each card, its slide, the rail stepping
 * aside at the smallest window) retire with it. The flag off draws exactly
 * the base build, by hash, column and all.
 *
 * SHELL_SHOTS: where the screenshots and checks.json go (else the test's
 * output folder). SHELL_BASE_URL: the base build (default
 * http://127.0.0.1:4300); unreachable, the comparison is reported as not run.
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
const LIP = 36;
const EDGE = 6;
const PLACES = 44;
const RAIL = 220;
const SLIDE_MS = 460;
const CONNECTED = "claude-code";

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "serial" });

type Box = { x: number; y: number; w: number; h: number };
const checks: Record<string, unknown> = {};
let dir = "";

// Each spec writes to its own folder under SHELL_SHOTS, so its hash checks
// compare its own shots and no other spec's (WP-28, Decided 6).
const SHELL_SHOTS = process.env.SHELL_SHOTS
  ? path.join(process.env.SHELL_SHOTS, "shell-runtime")
  : undefined;

function shotsDir(fallback: string) {
  const out = SHELL_SHOTS ?? fallback;
  mkdirSync(out, { recursive: true });
  return out;
}

async function openApp(
  page: Page,
  {
    frame,
    origin = "",
    route = "#/agents",
    size = { width: 1440, height: 900 },
    reducedMotion = "no-preference",
    colorScheme = "dark",
  }: {
    frame: boolean;
    origin?: string;
    route?: string;
    size?: { width: number; height: number };
    reducedMotion?: "reduce" | "no-preference";
    colorScheme?: "dark" | "light";
  },
) {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme, reducedMotion });
  await installMockBridge(page);
  if (colorScheme === "light") {
    await page.addInitScript(() =>
      window.localStorage.setItem("buzz-theme", "paper"),
    );
  }
  // After the bridge's own seed, so this one decides the frame.
  await page.addInitScript(
    ({ key, on }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = on;
      localStorage.setItem(key, JSON.stringify(overrides));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: frame },
  );
  // Under the frame a connected app is a row of the Agents rail; without it,
  // today's Runtimes rows. The frame boots at the bare /#/ route (no page
  // query, which the hash router glues onto the last value on Back: WP-10);
  // the flag-off path is kept as it was, for the base comparison.
  const ready = !frame
    ? page.locator("[data-runtime-connection-key]").first()
    : // Under 768 the rail is a closed sheet: its rows are not on screen.
      route.startsWith("#/agents") && size.width >= 768
      ? page.getByTestId(`place-row-connected:${CONNECTED}`)
      : page.getByTestId("shell-lip");
  const url = frame ? `${origin}/${route}` : `${origin}/?e2e=mock${route}`;
  // The first load can be slow while the machine is busy: one retry past a
  // blank page.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(url);
    try {
      await expect(ready).toBeVisible({ timeout: 20000 });
      // Without the frame the app lands on its first screen by a redirect
      // that can come after the rail's rows show. A click before it lands
      // gets a second history entry and New conversation's recipient list
      // open; after it, neither. On every build, :4300 included (WP-28, row
      // 8): wait for the first screen, so both builds are shot alike.
      if (!frame)
        await page.waitForFunction(() => location.hash.length > 2, null, {
          timeout: 20000,
        });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

/** Opens the first runtime's sessions: the Agents rail's Connected row
 *  under the frame, the rail's Runtimes row without it. */
async function openRuntime(page: Page) {
  await page.locator("[data-runtime-connection-key]").first().click();
}

/** Picks the connected app in the Agents rail, and waits for its card. */
async function openConnected(page: Page) {
  await page
    .getByTestId(`place-row-connected:${CONNECTED}`)
    .locator("button")
    .first()
    .click();
  await expect(page.getByTestId("connected-app-card")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId("runtime-session-list")).toBeVisible({
    timeout: 20000,
  });
  await page.waitForTimeout(SLIDE_MS + 200);
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await waitForAnimations(page);
}

async function shot(page: Page, name: string) {
  await settle(page);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const near = (a: number | null | undefined, b: number, slack = 0.51) =>
  a != null && Math.abs(a - b) <= slack;

/** The one card, the rail on it, the connected card's surface, the lip's
 *  parts, and whatever is left of the runtime column. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null | undefined) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const paint = (element: Element | null | undefined) => {
      if (!element) return null;
      const s = getComputedStyle(element);
      return {
        background: s.backgroundColor,
        image: s.backgroundImage === "none" ? "none" : "image",
        shadow: s.boxShadow,
        radius: s.borderTopLeftRadius,
      };
    };
    const card = document.querySelector('[data-testid="connected-app-card"]');
    // What the rail opens, as the one card's spec reads it: the surface
    // that is itself the content, or the clear plane holding it, less the
    // plane's point of room.
    const surfaceElement = document.querySelector(
      "[data-luca-frame-row] [data-luca-floor-host] > :is([data-luca-conversation-surface], [data-buzz-content-plane])",
    );
    const surface = surfaceElement?.contains(card ?? null)
      ? surfaceElement
      : null;
    const plane =
      surface?.matches("[data-buzz-content-plane]") ||
      surface?.querySelector("[data-luca-workspace-floor]") != null;
    const surfaceBox = box(surface);
    const content =
      surfaceBox && plane
        ? {
            x: surfaceBox.x + 1,
            y: surfaceBox.y + 1,
            w: surfaceBox.w - 2,
            h: surfaceBox.h - 2,
          }
        : surfaceBox;
    const panel = document.querySelector(
      '[data-frame] > [data-testid="app-sidebar"]',
    );
    const one = document.querySelector("[data-luca-one-card]");
    const rail = document.querySelector(
      '[data-frame] [data-sidebar="sidebar"]',
    );
    const shadows = [
      ...document.querySelectorAll<HTMLElement>("[data-luca-frame-shadow]"),
    ]
      .filter(
        (span) =>
          getComputedStyle(span.parentElement as Element).display !== "none",
      )
      .map((span) => ({ ...box(span), opacity: span.style.opacity }));
    return {
      W: document.documentElement.clientWidth,
      H: document.documentElement.clientHeight,
      one: box(one),
      onePaint: paint(one),
      rail: box(rail),
      railState: document
        .querySelector("[data-frame]")
        ?.getAttribute("data-state"),
      panel: box(panel),
      card: box(card),
      surface: content,
      surfacePaint: paint(surface),
      lip: box(document.querySelector(".luca-lip-card")),
      back: box(document.querySelector('[data-testid="global-back"]')),
      name: box(document.querySelector('[data-testid="shell-lip-name"]')),
      lipName:
        document.querySelector('[data-testid="shell-lip-name"]')?.textContent ??
        null,
      column: {
        card: document.querySelectorAll("[data-luca-runtime-card]").length,
        panel: document.querySelectorAll("#runtime-sessions-panel").length,
        sheet: document.querySelectorAll(
          '[data-testid="runtime-sessions-panel-mobile"]',
        ).length,
      },
      shadows,
      glass: document.documentElement.getAttribute("data-luca-frame-glass"),
      font: getComputedStyle(document.documentElement).fontSize,
    };
  });
}

type Measured = Awaited<ReturnType<typeof measure>>;

/** The one card in its place, from the places' edge to 6 from the right,
 *  top flush with the lip, 6 above the bottom, corners 10. */
const oneInPlace = (m: Measured) =>
  m.one != null &&
  m.one.x === PLACES &&
  m.one.y === LIP &&
  near(m.W - (m.one.x + m.one.w), EDGE) &&
  near(m.H - (m.one.y + m.one.h), EDGE) &&
  m.onePaint?.radius === "10px";

/** The rail's right edge: the hairline (the places' edge with it closed). */
const hairline = (m: Measured) =>
  m.panel ? m.panel.x + m.panel.w : Number.NaN;

/** The connected card lies on the one card from the hairline (`left`),
 *  within it: no surface, grain or shadow of its own. */
const lies = (m: Measured, left: number) =>
  m.surface != null &&
  m.one != null &&
  near(hairline(m), left) &&
  near(m.surface.x, hairline(m), 0.01) &&
  m.surface.x + m.surface.w <= m.one.x + m.one.w &&
  m.surfacePaint?.background === "rgba(0, 0, 0, 0)" &&
  m.surfacePaint?.image === "none" &&
  m.surfacePaint?.shadow === "none";

/** The lip follows what the rail opens: its card part from the hairline,
 *  back at max(hairline + 6, 112), the name on the opened card's axis. */
const lipFollows = (m: Measured) => {
  const s = m.surface as Box;
  const name = m.name as Box;
  const edge = hairline(m);
  return {
    lipOff: Math.round(((m.lip?.x ?? 0) - edge) * 100) / 100,
    backOff:
      Math.round(((m.back?.x ?? 0) - Math.max(edge + 6, 112)) * 100) / 100,
    nameOff: Math.round((name.x + name.w / 2 - (s.x + s.w / 2)) * 100) / 100,
  };
};

const noColumn = (m: Measured) =>
  m.column.card === 0 && m.column.panel === 0 && m.column.sheet === 0;

test.beforeAll(() => {
  dir = shotsDir(test.info().outputDir);
});

test.afterAll(() => {
  writeFileSync(path.join(dir, "checks.json"), JSON.stringify(checks, null, 2));
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 800, height: 500 },
]) {
  test(`connected ${size.width}: its sessions are its card on the one card; no column opens`, async ({
    page,
  }) => {
    await openApp(page, { frame: true, size });
    await openConnected(page);
    const file = await shot(page, `connected-${size.width}`);
    const m = await measure(page);
    const lip = lipFollows(m);
    checks[`connected_${size.width}`] = {
      shot: file,
      one: m.one,
      rail: m.rail,
      railState: m.railState,
      surface: m.surface,
      surfacePaint: m.surfacePaint,
      column: m.column,
      lip,
      lipName: m.lipName,
    };
    expect(noColumn(m), JSON.stringify(m.column)).toBe(true);
    expect(oneInPlace(m), JSON.stringify(m.one)).toBe(true);
    // The rail keeps its place at every size: nothing makes it step aside.
    expect(m.railState).toBe("expanded");
    expect(m.rail).toMatchObject({ x: PLACES, w: RAIL });
    expect(lies(m, PLACES + RAIL), JSON.stringify(m.surface)).toBe(true);
    // At 800 × 500 the card keeps the column's floor of 24 rem and more.
    expect((m.surface as Box).w).toBeGreaterThanOrEqual(24 * 16);
    expect(Math.abs(lip.lipOff)).toBeLessThan(0.5);
    expect(Math.abs(lip.backOff)).toBeLessThan(0.5);
    expect(Math.abs(lip.nameOff)).toBeLessThan(1);
    // The lip names the pick by its row's name.
    expect(m.lipName?.trim()).toBe(
      (
        await page
          .getByTestId("connected-app-card")
          .getByTestId("place-page-head")
          .locator(".luca-place-page-name")
          .innerText()
      ).trim(),
    );
  });
}

test("New conversation opens no column under the frame", async ({ page }) => {
  await openApp(page, { frame: true, route: "#/messages/new" });
  await page.waitForTimeout(SLIDE_MS + 200);
  const m = await measure(page);
  const runtimeRows = await page
    .locator("[data-runtime-connection-key]")
    .count();
  checks.new_conversation = { column: m.column, runtimeRows };
  expect(noColumn(m)).toBe(true);
  // Runtimes' rows are not on the Chats rail: Connected is in Agents.
  expect(runtimeRows).toBe(0);
});

test("connected light: Paper, the card lies on the one card", async ({
  page,
}) => {
  await openApp(page, { frame: true, colorScheme: "light" });
  await openConnected(page);
  const file = await shot(page, "connected-light");
  const m = await measure(page);
  checks.connected_light = {
    shot: file,
    onePaint: m.onePaint,
    surfacePaint: m.surfacePaint,
  };
  expect(oneInPlace(m)).toBe(true);
  expect(lies(m, PLACES + RAIL)).toBe(true);
  // The one card is Paper's, drawn once beneath.
  expect(m.onePaint?.background).not.toBe("rgba(0, 0, 0, 0)");
});

test("rail closed: the card folds the rail away and the connected card meets the places", async ({
  page,
}) => {
  await openApp(page, { frame: true });
  await openConnected(page);
  const before = await measure(page);
  await page.getByTestId("shell-lip-toggle").click();
  await page.waitForTimeout(SLIDE_MS + 300);
  const file = await shot(page, "connected-rail-closed");
  const m = await measure(page);
  const lip = lipFollows(m);
  checks.rail_closed = {
    shot: file,
    one_before: before.one,
    one_after: m.one,
    surface: m.surface,
    lip,
  };
  expect(m.railState).toBe("collapsed");
  // The card's corner never moves.
  expect(m.one).toEqual(before.one);
  expect(lies(m, PLACES)).toBe(true);
  expect(Math.abs(lip.backOff)).toBeLessThan(0.5);
  expect(Math.abs(lip.nameOff)).toBeLessThan(1);
});

test("text zoom: back, forward and the name keep to the connected card", async ({
  page,
}) => {
  await openApp(page, { frame: true });
  await openConnected(page);
  const steps: Record<string, unknown>[] = [];
  const read = async (label: string) => {
    const m = await measure(page);
    steps.push({
      label,
      font: m.font,
      surfaceX: m.surface?.x,
      ...lipFollows(m),
    });
  };
  await read("100%");
  await page.keyboard.press("Meta+Equal");
  await page.waitForTimeout(SLIDE_MS + 300);
  await read("110%");
  await shot(page, "zoom-110-connected");
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("Meta+Equal");
  await page.waitForTimeout(SLIDE_MS + 300);
  await read("150%");
  await shot(page, "zoom-150-connected");
  await page.keyboard.press("Meta+0");
  await page.waitForTimeout(SLIDE_MS + 300);
  await read("Meta+0");
  checks.text_zoom = { steps };
  for (const step of steps) {
    expect(Math.abs(step.lipOff as number)).toBeLessThan(0.5);
    expect(Math.abs(step.backOff as number)).toBeLessThan(0.5);
    expect(Math.abs(step.nameOff as number)).toBeLessThan(1);
  }
  expect(steps.map((step) => step.font)).toEqual([
    "16px",
    "17.6px",
    "24px",
    "16px",
  ]);
});

test("by day on the glass: one shadow on the floor, the one card's", async ({
  page,
}) => {
  await openApp(page, { frame: true, colorScheme: "light" });
  // The frosted glass, which the mock can draw once it is told it is the app.
  await page.addInitScript(() => {
    window.localStorage.setItem("polyphonic-frame", "glass");
    (window as unknown as { isTauri: boolean }).isTauri = true;
  });
  await page.reload();
  await expect(
    page.getByTestId(`place-row-connected:${CONNECTED}`),
  ).toBeVisible({ timeout: 20000 });
  await openConnected(page);
  const file = await shot(page, "day-glass-connected");
  const m = await measure(page);
  checks.day_card_list = {
    shot: file,
    glass: m.glass,
    shadows: m.shadows,
    one: m.one,
    surfacePaint: m.surfacePaint,
  };
  expect(m.glass).toBe("frosted");
  expect(m.shadows).toHaveLength(1);
  const one = m.one as Box;
  expect(near(m.shadows[0].x, one.x, 0.01)).toBe(true);
  expect(near(m.shadows[0].w, one.w, 0.01)).toBe(true);
  expect(m.surfacePaint?.shadow).toBe("none");
});

test("narrow: under 768 the connected card still opens, and no sheet of the column", async ({
  page,
}) => {
  await openApp(page, { frame: true, size: { width: 700, height: 600 } });
  // Under 768 the rail is a sheet; the pick still lands in the address.
  await page.goto(`/#/agents?connected=${CONNECTED}`);
  await expect(page.getByTestId("connected-app-card")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId("runtime-session-list")).toBeVisible({
    timeout: 20000,
  });
  await page.waitForTimeout(SLIDE_MS + 200);
  const file = await shot(page, "narrow-connected");
  const m = await measure(page);
  checks.narrow = { shot: file, column: m.column, surface: m.surface };
  expect(noColumn(m)).toBe(true);
  expect((m.surface as Box).w).toBeGreaterThan(0);
});

test("flag off: the column draws exactly the base build", async ({
  browser,
}) => {
  let reachable = true;
  try {
    const response = await fetch(BASE_URL);
    reachable = response.ok;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    checks.flag_off_identical = {
      ran: false,
      reason: `${BASE_URL} unreachable`,
    };
    test.skip(true, "base build unreachable");
    return;
  }
  const pairs: Record<string, { ours: string; base: string; same: boolean }> =
    {};
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 500 },
  ]) {
    for (const [label, origin] of [
      ["ours", ""],
      ["base", BASE_URL],
    ] as const) {
      const context = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        deviceScaleFactor: 2,
      });
      // Both builds' clocks start at the same instant (WP-21, 3), so a time
      // printed on the page can't differ by a minute between the two shots.
      await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
      const page = await context.newPage();
      await openApp(page, { frame: false, origin, route: "", size });
      await openRuntime(page);
      await expect(page.getByTestId("runtime-sessions-panel")).toBeVisible();
      await page.mouse.move(size.width - 2, size.height - 2);
      await railGlassAtRest(page);
      await shot(page, `flag-off-open-${size.width}-${label}`);
      await page.getByRole("button", { name: /^Close .* sessions$/ }).click();
      await expect(page.getByTestId("runtime-sessions-panel")).toHaveCount(0);
      await page.mouse.move(size.width - 2, size.height - 2);
      await railGlassAtRest(page);
      await shot(page, `flag-off-closed-${size.width}-${label}`);
      await context.close();
    }
    for (const state of ["open", "closed"]) {
      const ours = path.join(dir, `flag-off-${state}-${size.width}-ours.png`);
      const base = path.join(dir, `flag-off-${state}-${size.width}-base.png`);
      pairs[`${state}-${size.width}`] = {
        ours: sha(ours),
        base: sha(base),
        same: sha(ours) === sha(base),
      };
    }
  }
  const same = Object.values(pairs).every((pair) => pair.same);
  checks.flag_off_identical = { ran: true, pairs, ok: same };
  expect(same).toBe(true);
});
