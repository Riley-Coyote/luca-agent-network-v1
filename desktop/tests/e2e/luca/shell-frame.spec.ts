import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * The shell's frame, Black, dark (docs/luca/rail-system/SHELL_BUILD.md,
 * WP-01). Measures the frame against SHELL_SPEC.md and proves the flag off
 * draws exactly the base build, by hash.
 *
 * SHELL_SHOTS: where the screenshots and checks.json go (else the test's
 * output folder). SHELL_BASE_URL: the base build to compare the flag-off
 * shots against (default http://127.0.0.1:4300); unreachable, the
 * comparison is reported as not run.
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "serial" });

type Box = { x: number; y: number; w: number; h: number };

function shotsDir(fallback: string) {
  const dir = process.env.SHELL_SHOTS ?? fallback;
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function openApp(
  page: Page,
  {
    frame,
    origin = "",
    size = { width: 1440, height: 900 },
  }: {
    frame: boolean;
    origin?: string;
    size?: { width: number; height: number };
  },
) {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: "dark" });
  await installMockBridge(page);
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
  await page.goto(`${origin}/?e2e=mock`);
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

async function shot(page: Page, dir: string, name: string) {
  await settle(page);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((s) => {
    const element = document.querySelector(s);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

async function radius(page: Page, selector: string) {
  return page.evaluate((s) => {
    const element = document.querySelector(s);
    return element ? getComputedStyle(element).borderTopLeftRadius : null;
  }, selector);
}

/** The cards' edge light, read from the rendered pixels (device pixels):
 *  the brightest grey on the row just above the card (its lit top), and the
 *  median grey of the column or row just outside its left, right and bottom
 *  edges (its rim). On the black floor this light is what draws the card. */
async function edgeLight(page: Page, b: Box) {
  const png = await page.screenshot();
  return page.evaluate(
    async ({ b64, b }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / window.innerWidth;
      const grey = (x: number, y: number) => {
        const d = context.getImageData(x, y, 1, 1).data;
        return (d[0] + d[1] + d[2]) / 3;
      };
      const median = (values: number[]) =>
        values.sort((a, c) => a - c)[Math.floor(values.length / 2)];
      const xs: number[] = [];
      for (let x = (b.x + 40) * scale; x < (b.x + b.w - 40) * scale; x += 7) {
        xs.push(Math.round(x));
      }
      const ys: number[] = [];
      for (let y = (b.y + 60) * scale; y < (b.y + b.h - 60) * scale; y += 7) {
        ys.push(Math.round(y));
      }
      const top = Math.round(b.y * scale) - 1;
      const left = Math.round(b.x * scale) - 1;
      const right = Math.round((b.x + b.w) * scale);
      const bottom = Math.round((b.y + b.h) * scale);
      return {
        top_line: Math.max(...xs.map((x) => grey(x, top))),
        left_rim: median(ys.map((y) => grey(left, y))),
        right_rim: median(ys.map((y) => grey(right, y))),
        bottom_rim: median(xs.map((x) => grey(x, bottom))),
      };
    },
    { b64: png.toString("base64"), b },
  );
}

/** The study draws a lit top of 48 and a rim of 20 (grey, 0 to 255). */
function edgeLit(edge: Awaited<ReturnType<typeof edgeLight>>) {
  return (
    !!edge &&
    edge.top_line >= 40 &&
    edge.left_rim >= 15 &&
    edge.right_rim >= 15 &&
    edge.bottom_rim >= 15
  );
}

/** Closing or opening the rail, every frame: the card's left, back's left
 *  and the name's centre against the card's. */
async function sampleSlide(page: Page, ms: number) {
  return page.evaluate(
    (ms) =>
      new Promise<number[][]>((resolve) => {
        const q = (s: string) => document.querySelector(s) as HTMLElement;
        const samples: number[][] = [];
        const start = performance.now();
        q('[data-testid="shell-lip-toggle"]').click();
        const step = () => {
          const t = performance.now() - start;
          const card = q(
            '[data-testid="conversation-workspace-grid"] [data-luca-card]',
          ).getBoundingClientRect();
          const back = q('[data-testid="global-back"]').getBoundingClientRect();
          const name = q(
            '[data-testid="shell-lip-name"]',
          ).getBoundingClientRect();
          samples.push([
            t,
            card.x,
            back.x,
            name.x + name.width / 2 - (card.x + card.width / 2),
          ]);
          if (t < ms) requestAnimationFrame(step);
          else resolve(samples);
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
}

/** Back rides the study's path: the lip's part over the card and back's
 *  place inside it both glide on the rail's curve, so back runs from 274 to
 *  112 as the card runs from 268 to 44, never stopping on the way. */
function slideFollows(samples: number[][]) {
  const offPath = samples.map(([, card, back]) => {
    const e = (268 - card) / 224;
    return Math.abs(back - (274 - 162 * e));
  });
  return {
    frames: samples.length,
    max_back_off_path: Math.max(...offPath),
    max_name_off_axis: Math.max(...samples.map(([, , , n]) => Math.abs(n))),
  };
}

const RAIL_CARD = '[data-testid="app-sidebar"] [data-sidebar="sidebar"]';
const CONVERSATION_CARD =
  '[data-testid="conversation-workspace-grid"] [data-luca-card]';
const ROUTE_CARD = "[data-buzz-content-surface]";

async function openGeneral(page: Page) {
  await page.getByTestId("channel-general").click();
  await expect(page.locator(CONVERSATION_CARD).first()).toBeVisible();
}

/** Whether a press at (x, y) asks the window to start dragging. */
async function drags(page: Page, x: number, y: number) {
  const before = await page.evaluate(
    () =>
      (window as unknown as { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__?.length ?? 0,
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(100);
  return page.evaluate(
    (from) =>
      (
        (window as unknown as { __BUZZ_E2E_COMMANDS__?: string[] })
          .__BUZZ_E2E_COMMANDS__ ?? []
      )
        .slice(from)
        .includes("plugin:window|start_dragging"),
    before,
  );
}

test("the frame, Black, dark", async ({ page }, info) => {
  // One long walk through the frame, measuring pixels on the way.
  test.setTimeout(120_000);
  const dir = shotsDir(info.outputPath());
  const checks: Record<string, unknown> = {};
  const files: string[] = [];

  await openApp(page, { frame: true });
  // Generous: on a busy machine the first boot can take a while.
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-frame",
    "solid",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("app-top-chrome")).toHaveCount(0);
  await openGeneral(page);
  await page.mouse.move(700, 500);
  files.push(await shot(page, dir, "conversation"));

  // ── measures at 1440 × 900 ────────────────────────────────────────
  const W = 1440;
  const H = 900;
  const lip = await box(page, '[data-testid="shell-lip"]');
  const places = await box(page, '[data-testid="shell-places"]');
  const rail = await box(page, RAIL_CARD);
  const card = await box(page, CONVERSATION_CARD);
  const name = await box(page, '[data-testid="shell-lip-name"]');
  const toggle = await box(page, '[data-testid="shell-lip-toggle"]');
  const back = await box(page, '[data-testid="global-back"]');
  const icons = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="shell-places"] :is(.luca-place, .luca-place-search button, .luca-shell-avatar)',
      ),
    ].map((element) => {
      const r = element.getBoundingClientRect();
      return {
        label: element.getAttribute("aria-label"),
        cx: r.x + r.width / 2,
        y: r.y,
        size: r.width,
      };
    }),
  );
  expect(lip && places && rail && card && name).toBeTruthy();
  if (!lip || !places || !rail || !card || !name || !toggle || !back) return;

  checks.lip_height = { measured: lip.h, expected: 36, ok: lip.h === 36 };
  checks.places_width = {
    measured: places.w,
    expected: 44,
    icon_centres: icons.map((icon) => [icon.label, icon.cx, icon.y]),
    ok:
      places.w === 44 &&
      icons.length >= 8 &&
      icons.every((icon) => icon.cx === 22),
  };
  checks.rail_card = {
    measured: {
      x: rail.x,
      top: rail.y,
      width: rail.w,
      bottom: H - (rail.y + rail.h),
    },
    expected: { x: 44, top: 36, width: 220, bottom: 6 },
    ok:
      rail.x === 44 &&
      rail.y === 36 &&
      rail.w === 220 &&
      H - (rail.y + rail.h) === 6,
  };
  checks.conversation_card = {
    measured: {
      left: card.x,
      top: card.y,
      right: W - (card.x + card.w),
      bottom: H - (card.y + card.h),
    },
    expected: { left: 268, top: 36, right: 6, bottom: 6 },
    ok:
      card.x === 268 &&
      card.y === 36 &&
      W - (card.x + card.w) === 6 &&
      H - (card.y + card.h) === 6,
  };
  checks.card_gap = {
    measured: card.x - (rail.x + rail.w),
    expected: 4,
    ok: card.x - (rail.x + rail.w) === 4,
  };
  const corners = {
    rail: await radius(page, RAIL_CARD),
    conversation: await radius(page, CONVERSATION_CARD),
  };
  checks.corner_radius = {
    measured: corners,
    expected: "10px",
    ok: corners.rail === "10px" && corners.conversation === "10px",
  };
  const nameCentre = name.x + name.w / 2;
  const cardCentre = card.x + card.w / 2;
  checks.name_centred = {
    name_text: await page.getByTestId("shell-lip-name").innerText(),
    name_centre: nameCentre,
    card_centre: cardCentre,
    delta: Math.abs(nameCentre - cardCentre),
    name_box: name,
    ok: Math.abs(nameCentre - cardCentre) <= 0.5,
  };
  const conversationEdge = await edgeLight(page, card);
  checks.edge_light_conversation = {
    ...conversationEdge,
    ok: edgeLit(conversationEdge),
  };
  checks.lip_controls = {
    toggle: { x: toggle.x, y: toggle.y, size: toggle.w },
    back: { x: back.x, y: back.y },
    ok: toggle.x === 78 && toggle.y === 10 && back.x === 274 && back.y === 10,
  };

  // The name is the conversation header's own title source.
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general");
  await expect(page.getByTestId("chat-title")).toBeHidden();

  // ── tab order: the lip, the places, the rail's card ───────────────
  // From the lip's first stop onward, the regions in the order Tab meets them.
  await page.getByTestId("shell-lip-toggle").focus();
  const order: string[] = [];
  for (let step = 0; step < 40; step += 1) {
    order.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return "none";
        if (element.closest('[data-testid="shell-lip"]')) return "lip";
        if (element.closest('[data-testid="shell-places"]')) return "places";
        if (element.closest('[data-testid="app-sidebar"]')) return "rail";
        if (element.closest("[data-buzz-content-surface]")) return "card";
        return element.tagName.toLowerCase();
      }),
    );
    await page.keyboard.press("Tab");
  }
  const regions = order.filter((region, index) => region !== order[index - 1]);
  checks.tab_order = {
    regions,
    ok: regions.slice(0, 4).join(",") === "lip,places,rail,card",
  };

  // ── the drag band is the lip's 36 ──────────────────────────────────
  const emptyLipX = 700;
  const onLip = await drags(page, emptyLipX, 30);
  const onCardTop = await drags(page, emptyLipX, 40);
  checks.drag_band = {
    press_at_y30_drags: onLip,
    press_at_y40_drags: onCardTop,
    ok: onLip && !onCardTop,
  };

  // ── every moved control still works from its new home ────────────
  const capabilities: Record<string, boolean> = {};
  const searchDialog = page.getByTestId("search-results");
  await page.getByTestId("open-search").click();
  await expect(searchDialog).toBeVisible();
  capabilities.search_dialog = true;
  await page.keyboard.press("Escape");
  await expect(searchDialog).toBeHidden();
  await page.keyboard.press("Meta+k");
  await expect(searchDialog).toBeVisible();
  capabilities.search_key = true;
  await page.keyboard.press("Escape");
  await expect(searchDialog).toBeHidden();
  await page.getByTestId("shell-profile-avatar-button").click();
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  capabilities.profile_menu = true;
  files.push(await shot(page, dir, "avatar-menu"));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByTestId("open-new-conversation").click();
  await expect(page).toHaveURL(/\/messages\/new/);
  capabilities.new_conversation = true;
  capabilities.new_conversation_name =
    (await page.getByTestId("shell-lip-name").innerText()) ===
    "New conversation";
  await page.getByTestId("global-back").click();
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general");
  capabilities.back = true;
  checks.capabilities = {
    ...capabilities,
    ok: Object.values(capabilities).every(Boolean),
  };
  await page.mouse.move(700, 500);

  // ── places-hover ──────────────────────────────────────────────────
  await page.getByTestId("open-agents-view").hover();
  await expect(page.getByRole("tooltip")).toContainText("Agents");
  files.push(await shot(page, dir, "places-hover"));
  await page.mouse.move(700, 500);

  // ── right-card ────────────────────────────────────────────────────
  await page
    .getByRole("button", { name: "Open conversation details", exact: true })
    .click();
  const rightCards = page.locator("[data-luca-right-cards] [data-luca-card]");
  await expect(rightCards.first()).toBeVisible();
  await page.waitForTimeout(500);
  files.push(await shot(page, dir, "right-card"));
  const right = await box(page, "[data-luca-right-cards] [data-luca-card]");
  const cardWithRight = await box(page, CONVERSATION_CARD);
  const nameWithRight = await box(page, '[data-testid="shell-lip-name"]');
  checks.right_card =
    right && cardWithRight && nameWithRight
      ? {
          gap: right.x - (cardWithRight.x + cardWithRight.w),
          right: W - (right.x + right.w),
          top: right.y,
          bottom: H - (right.y + right.h),
          name_delta: Math.abs(
            nameWithRight.x +
              nameWithRight.w / 2 -
              (cardWithRight.x + cardWithRight.w / 2),
          ),
          ok:
            right.x - (cardWithRight.x + cardWithRight.w) === 4 &&
            W - (right.x + right.w) === 6 &&
            right.y === 36 &&
            H - (right.y + right.h) === 6,
        }
      : { ok: false };
  if (right) {
    const rightEdge = await edgeLight(page, right);
    checks.edge_light_right_card = { ...rightEdge, ok: edgeLit(rightEdge) };
  }
  await page
    .getByRole("button", { name: "Open conversation details", exact: true })
    .click();
  await page.waitForTimeout(500);

  // ── rail-closed, sampled every frame on the way ───────────────────
  const closing = slideFollows(await sampleSlide(page, 600));
  checks.slide_closing = {
    ...closing,
    ok:
      closing.frames >= 8 &&
      closing.max_back_off_path <= 0.5 &&
      closing.max_name_off_axis <= 0.5,
  };
  await page.waitForTimeout(200);
  await page.mouse.move(700, 500);
  files.push(await shot(page, dir, "rail-closed"));
  const closedRail = await box(page, RAIL_CARD);
  const closedCard = await box(page, CONVERSATION_CARD);
  const closedBack = await box(page, '[data-testid="global-back"]');
  const inert = await page.evaluate(
    () =>
      (document.querySelector('[data-testid="app-sidebar"]') as HTMLElement)
        ?.inert ?? null,
  );
  checks.rail_closed = {
    rail_width: closedRail?.w ?? null,
    card_left: closedCard?.x ?? null,
    back_x: closedBack?.x ?? null,
    rail_inert: inert,
    ok:
      (closedRail?.w ?? 1) === 0 &&
      closedCard?.x === 44 &&
      closedBack?.x === 112 &&
      inert === true,
  };
  if (closedCard) {
    const closedEdge = await edgeLight(page, closedCard);
    checks.edge_light_rail_closed = {
      ...closedEdge,
      // One rim, not two: the closed rail's card draws no edge of its own.
      ok: edgeLit(closedEdge) && (closedEdge?.left_rim ?? 99) <= 26,
    };
  }

  // ── an unread conversation, said on Conversations while closed ───────
  const unreadDot = () =>
    page.evaluate(() => {
      const tile = document.querySelector(
        '[data-testid="shell-place-conversations"]',
      );
      const dot = document.querySelector(
        '[data-testid="shell-place-conversations-unread"]',
      );
      if (!tile) return null;
      const t = tile.getBoundingClientRect();
      const d = dot?.getBoundingClientRect();
      return {
        label: tile.getAttribute("aria-label"),
        dot: d
          ? {
              size: [d.width, d.height],
              inset_top: d.y - t.y,
              inset_right: t.right - d.right,
              colour: dot ? getComputedStyle(dot).backgroundColor : null,
            }
          : null,
      };
    });
  const unreadRows = await page
    .locator('[data-testid="app-sidebar"] [aria-label$=", unread"]')
    .count();
  const dotClosed = await unreadDot();
  files.push(
    await (async () => {
      await settle(page);
      const file = path.join(dir, "unread-dot.png");
      await page.screenshot({
        path: file,
        clip: { x: 0, y: 0, width: 120, height: 340 },
      });
      return file;
    })(),
  );

  // ⌘S opens it again.
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(700);
  const dotOpen = await unreadDot();
  checks.unread_dot = {
    unread_rows: unreadRows,
    rail_closed: dotClosed,
    rail_open: dotOpen,
    ok:
      unreadRows > 0 &&
      dotClosed?.dot?.size.join("x") === "6x6" &&
      dotClosed.dot.inset_top === 4 &&
      dotClosed.dot.inset_right === 4 &&
      dotClosed.label === "Conversations, unread" &&
      dotOpen?.dot === null &&
      dotOpen.label === "Conversations",
  };
  checks.rail_reopened_by_key = {
    width: (await box(page, RAIL_CARD))?.w ?? null,
    ok: (await box(page, RAIL_CARD))?.w === 220,
  };

  // Closed and opened again on the toggle, every frame on the way back.
  await page.getByTestId("shell-lip-toggle").click();
  await page.waitForTimeout(700);
  const opening = slideFollows(await sampleSlide(page, 600));
  checks.slide_opening = {
    ...opening,
    ok:
      opening.frames >= 8 &&
      opening.max_back_off_path <= 0.5 &&
      opening.max_name_off_axis <= 0.5,
  };
  await page.waitForTimeout(200);

  // ── reduced motion: the card is instant ───────────────────────────
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  const transition = await page.evaluate(() => {
    const panel = document.querySelector(
      '[data-testid="app-sidebar"]',
    ) as HTMLElement;
    return getComputedStyle(panel).transitionDuration;
  });
  const reducedFirst = (await sampleSlide(page, 0))[0];
  const widthNextFrame = await page.evaluate(
    () =>
      document
        .querySelector('[data-testid="app-sidebar"] [data-sidebar="sidebar"]')
        ?.getBoundingClientRect().width ?? -1,
  );
  checks.reduced_motion_instant = {
    transition_duration: transition,
    width_one_frame_after_closing: widthNextFrame,
    first_frame: { card: reducedFirst?.[1], back: reducedFirst?.[2] },
    ok:
      transition.split(",").every((part) => Number.parseFloat(part) === 0) &&
      widthNextFrame === 0 &&
      reducedFirst?.[1] === 44 &&
      reducedFirst?.[2] === 112,
  };
  await page.getByTestId("shell-lip-toggle").click();
  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  await page.waitForTimeout(100);

  // ── library and brain fill the one card ───────────────────────────
  await page.getByTestId("open-artifacts-view").click();
  await expect(page.getByTestId("artifact-library-screen")).toBeVisible();
  await page.mouse.move(700, 500);
  await page.waitForTimeout(600);
  files.push(await shot(page, dir, "library"));
  const library = await box(page, ROUTE_CARD);
  const libraryEdge = library ? await edgeLight(page, library) : null;
  checks.library_card = {
    box: library,
    name: await page.getByTestId("shell-lip-name").innerText(),
    nested_card_shadow: await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector(
            '[data-testid="artifact-library-screen"] [data-luca-conversation-surface]',
          ) as Element,
        ).boxShadow,
    ),
    edge_light: libraryEdge,
    ok:
      edgeLit(libraryEdge) &&
      library?.x === 268 &&
      library?.y === 36 &&
      W - (library.x + library.w) === 6 &&
      H - (library.y + library.h) === 6,
  };

  await page.getByTestId("open-brain-setup").click();
  await page.waitForTimeout(800);
  await page.mouse.move(700, 500);
  files.push(await shot(page, dir, "brain"));
  const brain = await box(page, ROUTE_CARD);
  const brainEdge = brain ? await edgeLight(page, brain) : null;
  checks.brain_card = {
    box: brain,
    name: await page.getByTestId("shell-lip-name").innerText(),
    edge_light: brainEdge,
    ok:
      edgeLit(brainEdge) &&
      brain?.x === 268 &&
      brain?.y === 36 &&
      W - (brain.x + brain.w) === 6 &&
      H - (brain.y + brain.h) === 6,
  };

  // Agents and Activity fill the same card.
  for (const [testId, label] of [
    ["open-agents-view", "Agents"],
    ["open-activity-view", "Activity"],
  ] as const) {
    await page.getByTestId(testId).click();
    await expect(page.getByTestId("shell-lip-name")).toHaveText(label);
    await page.waitForTimeout(600);
    const routeCard = await box(page, ROUTE_CARD);
    const routeEdge = routeCard ? await edgeLight(page, routeCard) : null;
    checks[`${label.toLowerCase()}_card`] = {
      box: routeCard,
      edge_light: routeEdge,
      ok:
        edgeLit(routeEdge) &&
        routeCard?.x === 268 &&
        routeCard?.y === 36 &&
        W - (routeCard.x + routeCard.w) === 6 &&
        H - (routeCard.y + routeCard.h) === 6,
    };
  }

  // ── other sizes ───────────────────────────────────────────────────
  const sizes: Record<string, unknown> = {};
  for (const [width, height] of [
    [1280, 720],
    [800, 500],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.getByTestId("shell-place-conversations").click();
    await openGeneral(page);
    await page.waitForTimeout(500);
    await page.mouse.move(width / 2, height / 2);
    if (width === 800) files.push(await shot(page, dir, "min-window"));
    else files.push(await shot(page, dir, "conversation-1280"));
    const r = await box(page, RAIL_CARD);
    const c = await box(page, CONVERSATION_CARD);
    const n = await box(page, '[data-testid="shell-lip-name"]');
    sizes[`${width}x${height}`] = {
      rail: r,
      card: c,
      card_width: c?.w ?? null,
      name_delta: n && c ? Math.abs(n.x + n.w / 2 - (c.x + c.w / 2)) : null,
      ok:
        r?.x === 44 &&
        r?.w === 220 &&
        c?.x === 268 &&
        c?.y === 36 &&
        c !== null &&
        width - (c.x + c.w) === 6 &&
        height - (c.y + c.h) === 6,
    };
  }
  checks.sizes = sizes;

  checks.screenshots = files.map((file) => ({ file, sha256: sha(file) }));
  const hashes = (checks.screenshots as { sha256: string }[]).map(
    (entry) => entry.sha256,
  );
  checks.unique_hashes = new Set(hashes).size === hashes.length;
  writeFileSync(
    path.join(dir, "checks-frame.json"),
    JSON.stringify(checks, null, 2),
  );
  for (const [key, value] of Object.entries(checks)) {
    if (value && typeof value === "object" && "ok" in value) {
      expect.soft((value as { ok: boolean }).ok, key).toBe(true);
    }
  }
  expect(checks.unique_hashes).toBe(true);
});

test("flag off draws the base build exactly", async ({ browser }, info) => {
  const dir = shotsDir(info.outputPath());
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!reachable, `base build not reachable at ${BASE_URL}`);

  const capture = async (origin: string, label: string) => {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    // Both builds start their clocks at the same minute and run on from it,
    // so the times they print agree.
    await context.clock.install({ time: new Date("2026-10-24T18:30:00") });
    const page = await context.newPage();
    await openApp(page, { frame: false, origin });
    // The residents' eyes above the composer live on their own clock; with
    // Reduce Motion they hold still, so two captures can match by hash.
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await openGeneral(page);
    await page.mouse.move(1439, 899);
    const conversation = await shot(page, dir, `flag-off-conversation${label}`);
    await page.getByTestId("open-artifacts-view").click();
    await expect(page.getByTestId("artifact-library-screen")).toBeVisible();
    await page.mouse.move(1439, 899);
    await page.waitForTimeout(600);
    const library = await shot(page, dir, `flag-off-library${label}`);
    await page.getByTestId("open-settings-view").click();
    await expect(
      page.getByRole("heading", { name: "Profile", exact: true }),
    ).toBeVisible();
    await page.mouse.move(1439, 899);
    await page.waitForTimeout(600);
    const settings = await shot(page, dir, `flag-off-settings${label}`);
    await context.close();
    return { conversation, library, settings };
  };

  const ours = await capture(info.project.use.baseURL ?? "", "");
  const base = await capture(BASE_URL, "-base");
  const result: Record<string, unknown> = {};
  for (const key of ["conversation", "library", "settings"] as const) {
    result[key] = {
      ours: sha(ours[key]),
      base: sha(base[key]),
      identical: sha(ours[key]) === sha(base[key]),
    };
  }
  writeFileSync(
    path.join(dir, "checks-flag-off.json"),
    JSON.stringify({ flag_off_identical: result }, null, 2),
  );
  for (const key of ["conversation", "library", "settings"] as const) {
    expect
      .soft((result[key] as { identical: boolean }).identical, key)
      .toBe(true);
  }
});
