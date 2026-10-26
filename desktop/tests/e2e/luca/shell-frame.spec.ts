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

// Each spec writes to its own folder under SHELL_SHOTS, so its hash checks
// compare its own shots and no other spec's (WP-28, Decided 6).
const SHELL_SHOTS = process.env.SHELL_SHOTS
  ? path.join(process.env.SHELL_SHOTS, "shell-frame")
  : undefined;

function shotsDir(fallback: string) {
  const dir = SHELL_SHOTS ?? fallback;
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
 *  place inside it both glide on the rail's curve, so back runs from 270 to
 *  112 as the conversation's edge runs from 264 (the rail's hairline on the
 *  one card, WP-12) to 44, never stopping on the way. */
function slideFollows(samples: number[][]) {
  const offPath = samples.map(([, card, back]) => {
    const e = (264 - card) / 220;
    return Math.abs(back - (270 - 158 * e));
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

/** The mock's #general. Under the frame it is opened by its route: the rail
 *  groups chats by home there (WP-02), and this spec measures the frame, not
 *  the rail. With the flag off, today's row is clicked, as on the base. */
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

async function openGeneral(page: Page, { frame = true } = {}) {
  if (!frame) {
    await page.getByTestId("channel-general").click();
    await expect(page.locator(CONVERSATION_CARD).first()).toBeVisible();
    return;
  }
  await page.waitForSelector('[data-testid="app-sidebar"] [data-channel-id]', {
    timeout: 20_000,
  });
  // Retried, because a fresh page's own first redirect can land after the
  // route is set.
  await expect(async () => {
    await page.evaluate((id) => {
      location.hash = `#/channels/${id}`;
    }, GENERAL_CHANNEL_ID);
    await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
  // Generous: on a busy machine the conversation's screen loads late.
  await expect(page.locator(CONVERSATION_CARD).first()).toBeVisible({
    timeout: 20_000,
  });
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
      // Six places and the avatar (NAVIGATION.md, 2026-10-25): Search;
      // Chats, Agents, Activity, Library; Settings.
      icons.length === 7 &&
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
    expected: { left: 264, top: 36, right: 6, bottom: 6 },
    ok:
      card.x === 264 &&
      card.y === 36 &&
      W - (card.x + card.w) === 6 &&
      H - (card.y + card.h) === 6,
  };
  // One card (WP-12): the conversation begins at the rail's hairline, and
  // the corners are the one card's, beneath both.
  checks.card_gap = {
    measured: card.x - (rail.x + rail.w),
    expected: 0,
    ok: card.x - (rail.x + rail.w) === 0,
  };
  const corners = {
    rail: await radius(page, RAIL_CARD),
    one_card: await radius(page, "[data-luca-one-card]"),
  };
  checks.corner_radius = {
    measured: corners,
    expected: "10px",
    ok: corners.rail === "10px" && corners.one_card === "10px",
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
    // No native lights in a browser: the toggle on the places' axis, its
    // centre at 22, its left at 10 (WP-08g).
    ok: toggle.x === 10 && toggle.y === 10 && back.x === 270 && back.y === 10,
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
  // New conversation left the places for the Chats rail's heading (its +).
  await page.getByTestId("rail-new-conversation").click();
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
  // Close the details card from the lip: while it is open the button reads
  // "Close conversation details" (WP-04b).
  await page.getByTestId("shell-lip-details").click();
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
      // "Conversations" is called Chats wherever it shows (WP-10).
      dotClosed.label === "Chats, unread" &&
      dotOpen?.dot === null &&
      dotOpen.label === "Chats",
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
      library?.x === 264 &&
      library?.y === 36 &&
      W - (library.x + library.w) === 6 &&
      H - (library.y + library.h) === 6,
  };

  // Brain left the places; until WP-13 it keeps working by its route.
  await page.evaluate(() => {
    window.location.hash = "#/brain";
  });
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
      brain?.x === 264 &&
      brain?.y === 36 &&
      W - (brain.x + brain.w) === 6 &&
      H - (brain.y + brain.h) === 6,
  };

  // Agents and Activity fill the same card. The lip names the pick by its
  // row's name (WP-10, Decided 8).
  for (const [testId, label] of [
    ["open-agents-view", "Agents"],
    ["open-activity-view", "Activity"],
  ] as const) {
    await page.getByTestId(testId).click();
    await expect(
      page.locator(`[data-place-rail="${label.toLowerCase()}"]`),
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(600);
    const picked = page.locator(
      '[data-place-rail] [data-active="true"] .luca-rail-row-name',
    );
    // Activity always has Now to pick. This mock has no residents, so
    // Agents' Luca row is the empty placeholder and nothing is picked: the
    // card says the page's own empty words and the lip names the place.
    if (label === "Activity") {
      await expect(picked).toHaveCount(1, { timeout: 20_000 });
    }
    const pickedName =
      (await picked.count()) === 1 ? (await picked.innerText()).trim() : null;
    checks[`${label.toLowerCase()}_lip`] = { picked: pickedName };
    await expect(page.getByTestId("shell-lip-name")).toHaveText(
      pickedName ?? label,
    );
    await page.waitForTimeout(600);
    const routeCard = await box(page, ROUTE_CARD);
    const routeEdge = routeCard ? await edgeLight(page, routeCard) : null;
    checks[`${label.toLowerCase()}_card`] = {
      box: routeCard,
      edge_light: routeEdge,
      ok:
        edgeLit(routeEdge) &&
        routeCard?.x === 264 &&
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
        c?.x === 264 &&
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
  // Two builds captured in turn; a busy machine needs the room.
  test.setTimeout(120_000);
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
    await openGeneral(page, { frame: false });
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

// ── WP-01b · the frame, finished ─────────────────────────────────────

const STUDY_URL =
  process.env.SHELL_STUDY_URL ??
  "http://127.0.0.1:4312/scripts/shell-lab.template.html?experience=shell&mode=dark&frame=solid";

type Region = { x: number; y: number; w: number; h: number };
type Stats = { mean: number; sd: number };

/** The lip's part over the card, against the card it names. */
async function lipOnCard(page: Page) {
  return page.evaluate(() => {
    const name = document.querySelector('[data-testid="shell-lip-name"]');
    const lip = document.querySelector(".luca-lip-card");
    const card =
      document.querySelector(
        '[data-testid="conversation-workspace-grid"] [data-luca-card]',
      ) ?? document.querySelector("[data-buzz-content-surface]");
    if (!name || !lip || !card) return null;
    const n = name.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const nameCx = n.x + n.width / 2;
    const cardCx = c.x + c.width / 2;
    return {
      lip_right: getComputedStyle(lip).right,
      name_cx: nameCx,
      card_cx: cardCx,
      ok: Math.abs(nameCx - cardCx) <= 0.25,
    };
  });
}

/** Grey statistics of regions of the rendered page, in device pixels. */
async function pixelStats(page: Page, regions: Region[]): Promise<Stats[]> {
  const png = await page.screenshot();
  return page.evaluate(
    async ({ b64, regions }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) return [];
      context.drawImage(bitmap, 0, 0);
      return regions.map((r) => {
        const data = context.getImageData(r.x, r.y, r.w, r.h).data;
        let sum = 0;
        let squares = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const grey = (data[i] + data[i + 1] + data[i + 2]) / 3;
          sum += grey;
          squares += grey * grey;
          count += 1;
        }
        const mean = sum / count;
        return {
          mean: Math.round(mean * 100) / 100,
          sd: Math.round(Math.sqrt(squares / count - mean * mean) * 100) / 100,
        };
      });
    },
    { b64: png.toString("base64"), regions },
  );
}

/** The rail card's last 40 points, row by row (two device rows a point):
 *  the grain's brightness (mean) and spread (sd) across the card. */
async function railFoot(page: Page) {
  const rail = await box(page, RAIL_CARD);
  if (!rail) return null;
  const rows: Region[] = [];
  for (let p = 40; p >= 1; p -= 1) {
    rows.push({
      x: Math.round((rail.x + 16) * 2),
      y: Math.round((rail.y + rail.h - p) * 2),
      w: Math.round((rail.w - 32) * 2),
      h: 2,
    });
  }
  const stats = await pixelStats(page, rows);
  const sds = stats.map((s) => s.sd);
  const means = stats.map((s) => s.mean);
  const median = (values: number[]) =>
    [...values].sort((a, c) => a - c)[Math.floor(values.length / 2)];
  // The card's last 10 points carry its rounded corners' falloff only at the
  // far ends, which the 16-point side margins leave out.
  return {
    rows_from_bottom_40_to_1: stats,
    median_sd: median(sds),
    min_sd: Math.min(...sds),
    mean_range: [Math.min(...means), Math.max(...means)],
    median_mean: median(means),
  };
}

/** The grain at a card's outermost device pixels (its left and right
 *  columns, its bottom row) against the grain deep inside it. */
async function cardEdgeGrain(page: Page, selector: string) {
  const b = await box(page, selector);
  if (!b) return null;
  const x0 = Math.round(b.x * 2);
  const x1 = Math.round((b.x + b.w) * 2) - 2;
  const y0 = Math.round((b.y + 60) * 2);
  const h = Math.round((b.h - 160) * 2);
  const [left, right, bottom, deep] = await pixelStats(page, [
    { x: x0, y: y0, w: 2, h },
    { x: x1, y: y0, w: 2, h },
    {
      x: Math.round((b.x + 40) * 2),
      y: Math.round((b.y + b.h) * 2) - 2,
      w: Math.round((b.w - 80) * 2),
      h: 2,
    },
    // The card's own grain a few points in, clear of what it holds.
    { x: x0 + 6, y: y0, w: 6, h },
  ]);
  const border = await page.evaluate(
    (s) =>
      getComputedStyle(document.querySelector(s) as Element).borderTopWidth,
    selector,
  );
  return { border, box: b, left, right, bottom, deep };
}

function grainReachesEdge(edge: Awaited<ReturnType<typeof cardEdgeGrain>>) {
  if (!edge) return false;
  const floor = edge.deep.sd * 0.6;
  return (
    edge.border === "0px" &&
    edge.left.sd >= floor &&
    edge.right.sd >= floor &&
    edge.bottom.sd >= floor
  );
}

/** The release build's identity, swapped for a dev one in the served bundle:
 *  outside Tauri the app always reports a release build, and the DEV chip is
 *  only drawn for a dev one. Nothing else reads this constant. */
async function serveAsDevBuild(page: Page) {
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "{identifier:``,isDev:!1}",
      "{identifier:`e2e.dev`,isDev:!0}",
    );
    await route.fulfill({ response, body });
  });
}

async function avatarMeasures(page: Page, avatarSelector: string) {
  const b = await box(page, avatarSelector);
  if (!b) return null;
  // A point of the disc clear of the initial and the presence badge:
  // 4 points in from its left, on its centre line.
  const [disc] = await pixelStats(page, [
    {
      x: Math.round((b.x + 3.5) * 2),
      y: Math.round((b.y + b.h / 2 - 1) * 2),
      w: 2,
      h: 4,
    },
  ]);
  return { box: b, disc_grey: disc.mean };
}

test("the frame, finished (WP-01b)", async ({ page }, info) => {
  test.setTimeout(180_000);
  const dir = shotsDir(info.outputPath());
  const checks: Record<string, unknown> = {};
  const files: string[] = [];

  await serveAsDevBuild(page);
  await openApp(page, { frame: true });
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-frame",
    "solid",
    { timeout: 20_000 },
  );
  await openGeneral(page);
  await page.mouse.move(700, 500);
  await settle(page);

  // ── avatar ──────────────────────────────────────────────────────────
  const avatar = await page.evaluate(() => {
    const disc = document.querySelector(
      '[data-testid="shell-profile-avatar"]',
    ) as HTMLElement;
    const fallback = document.querySelector(
      '[data-testid="shell-profile-avatar-fallback"]',
    ) as HTMLElement;
    const d = getComputedStyle(disc);
    const f = getComputedStyle(fallback);
    return {
      disc_background: d.backgroundColor,
      disc_shadow: d.boxShadow,
      fallback_background: f.backgroundColor,
      initial: fallback.textContent,
      initial_size: f.fontSize,
      initial_weight: f.fontWeight,
      initial_colour: f.color,
    };
  });
  const appDisc = await avatarMeasures(
    page,
    '[data-testid="shell-profile-avatar"]',
  );
  const avatarBox = await box(
    page,
    '[data-testid="shell-profile-avatar-button"]',
  );
  if (avatarBox) {
    const file = path.join(dir, "avatar.png");
    await page.screenshot({
      path: file,
      clip: { x: 0, y: avatarBox.y - 48, width: 80, height: 80 },
    });
    files.push(file);
  }
  let study: Record<string, unknown> | null = null;
  const studyPage = await page.context().newPage();
  try {
    await studyPage.setViewportSize({ width: 1440, height: 900 });
    await studyPage.goto(STUDY_URL, { timeout: 15_000 });
    await studyPage.locator(".shell-avatar").waitFor({ timeout: 15_000 });
    await settle(studyPage);
    study = {
      ...(await studyPage.evaluate(() => {
        const a = getComputedStyle(
          document.querySelector(".shell-avatar") as Element,
        );
        return {
          disc_background: a.backgroundColor,
          initial_size: a.fontSize,
          initial_weight: a.fontWeight,
          initial_colour: a.color,
        };
      })),
      ...(await avatarMeasures(studyPage, ".shell-avatar")),
    };
    const studyBox = await box(studyPage, ".shell-avatar");
    if (studyBox) {
      const file = path.join(dir, "avatar-study.png");
      await studyPage.screenshot({
        path: file,
        clip: { x: 0, y: studyBox.y - 48, width: 80, height: 80 },
      });
      files.push(file);
    }
  } catch {
    study = null;
  } finally {
    await studyPage.close();
  }
  const studyDiscGrey = (study?.disc_grey as number | undefined) ?? null;
  checks.avatar_disc = {
    app: {
      background: avatar.disc_background,
      fallback_background: avatar.fallback_background,
      shadow: avatar.disc_shadow,
      disc_grey: appDisc?.disc_grey,
    },
    study: study
      ? { background: study.disc_background, disc_grey: studyDiscGrey }
      : "study not reachable",
    ok:
      avatar.fallback_background === "rgba(0, 0, 0, 0)" &&
      avatar.disc_background === "rgba(200, 196, 185, 0.14)" &&
      (studyDiscGrey === null ||
        Math.abs((appDisc?.disc_grey ?? 0) - studyDiscGrey) <= 2),
  };
  checks.avatar_initial = {
    app: {
      text: avatar.initial,
      size: avatar.initial_size,
      weight: avatar.initial_weight,
      colour: avatar.initial_colour,
    },
    study: study
      ? {
          size: study.initial_size,
          weight: study.initial_weight,
          colour: study.initial_colour,
        }
      : "study not reachable",
    ok:
      avatar.initial_size === "12px" &&
      avatar.initial_weight === "550" &&
      (!study ||
        (study.initial_size === avatar.initial_size &&
          study.initial_weight === avatar.initial_weight &&
          study.initial_colour === avatar.initial_colour)),
  };

  // ── avatar-menu, beside the column, nothing covered; the DEV chip ──
  const menuPlacement: Record<string, unknown> = {};
  const devChip: Record<string, unknown> = {};
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 500 },
  ]) {
    await page.setViewportSize(size);
    await page.mouse.move(size.width / 2, size.height / 2);
    await settle(page);
    await page.getByTestId("shell-profile-avatar-button").click();
    const popover = page.getByTestId("profile-popover");
    await expect(popover).toBeVisible();
    await page.waitForTimeout(300);
    await settle(page);
    const menu = await box(page, '[data-testid="profile-popover"]');
    const av = await box(page, '[data-testid="shell-profile-avatar-button"]');
    const settings = await box(page, '[data-testid="open-settings-view"]');
    const label = `${size.width}x${size.height}`;
    files.push(await shot(page, dir, `avatar-menu-${label}`));
    const overlaps = (a: Box | null, b: Box | null) =>
      !!a &&
      !!b &&
      a.x < b.x + b.w &&
      b.x < a.x + a.w &&
      a.y < b.y + b.h &&
      b.y < a.y + a.h;
    if (menu && av) {
      menuPlacement[label] = {
        menu,
        gap_from_column: menu.x - 44,
        menu_bottom: menu.y + menu.h,
        avatar_bottom: av.y + av.h,
        covers_avatar: overlaps(menu, av),
        covers_settings: overlaps(menu, settings),
        ok:
          menu.x - 44 === 8 &&
          Math.abs(menu.y + menu.h - (av.y + av.h)) <= 0.5 &&
          !overlaps(menu, av) &&
          !overlaps(menu, settings),
      };
    }
    if (size.width === 1440) {
      const chip = await box(page, '[data-testid="sidebar-dev-build-chip"]');
      const name = await page.evaluate(() => {
        const p = document.querySelector(
          '[data-testid="profile-popover"] p',
        ) as HTMLElement | null;
        if (!p) return null;
        const r = p.getBoundingClientRect();
        return { text: p.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
      });
      Object.assign(devChip, {
        chip,
        name,
        in_menu:
          (await popover.getByTestId("sidebar-dev-build-chip").count()) === 1,
        ok:
          !!chip &&
          !!name &&
          !!menu &&
          chip.x >= name.x + name.w &&
          Math.abs(chip.y + chip.h / 2 - (name.y + name.h / 2)) <= 2 &&
          chip.y - menu.y < 40,
      });
      if (menu) {
        const file = path.join(dir, "dev-chip.png");
        await page.screenshot({
          path: file,
          clip: { x: menu.x - 8, y: menu.y - 8, width: 300, height: 80 },
        });
        files.push(file);
      }
    }
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
  }
  checks.menu_placement = {
    ...menuPlacement,
    ok: Object.values(menuPlacement).every(
      (entry) => (entry as { ok: boolean }).ok,
    ),
  };
  checks.dev_chip = devChip;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.mouse.move(700, 500);
  await settle(page);

  // ── rail-foot ─────────────────────────────────────────────────────
  const foot = await railFoot(page);
  files.push(await shot(page, dir, "conversation-finished"));
  const rail = await box(page, RAIL_CARD);
  if (rail) {
    const file = path.join(dir, "rail-foot.png");
    await page.screenshot({
      path: file,
      clip: { x: rail.x - 4, y: rail.y + rail.h - 80, width: 228, height: 84 },
    });
    files.push(file);
  }
  checks.rail_foot_seam = {
    ...foot,
    ok:
      !!foot &&
      foot.min_sd >= foot.median_sd * 0.6 &&
      foot.mean_range[1] - foot.mean_range[0] <= 1.5,
  };

  // ── card-edge: the conversation card and the route cards ─────────
  const edges: Record<string, unknown> = {};
  edges.rail = await cardEdgeGrain(page, RAIL_CARD);
  edges.conversation = await cardEdgeGrain(page, CONVERSATION_CARD);
  const card = await box(page, CONVERSATION_CARD);
  if (card) {
    const file = path.join(dir, "card-edge.png");
    await page.screenshot({
      path: file,
      clip: { x: card.x - 30, y: card.y + card.h - 70, width: 60, height: 76 },
    });
    files.push(file);
  }
  // ── top veil: its copy of the grain registers with the card's ──────
  // The card's grain is laid from its content box, where the veil starts;
  // across the veil's fade (the 16 points under the header) the grain keeps
  // the card's spread instead of two offset copies averaging out.
  const veilRegistration = await page.evaluate((selector) => {
    const card = document.querySelector(selector) as HTMLElement;
    const veil = document.querySelector(
      ".luca-conversation-veil-top",
    ) as HTMLElement;
    const c = card.getBoundingClientRect();
    const v = veil.getBoundingClientRect();
    const cs = getComputedStyle(card);
    return {
      origin: cs.backgroundOrigin,
      content_left: c.x + Number.parseFloat(cs.paddingLeft),
      content_top: c.y + Number.parseFloat(cs.paddingTop),
      veil_left: v.x,
      veil_top: v.y,
      veil_bottom: v.y + v.height,
    };
  }, CONVERSATION_CARD);
  const fadeRows = card
    ? await pixelStats(
        page,
        Array.from({ length: 16 }, (_, i) => ({
          x: Math.round((card.x + 32) * 2),
          y: Math.round((veilRegistration.veil_bottom - 16 + i) * 2),
          w: 960,
          h: 2,
        })),
      )
    : [];
  const fadeSd = fadeRows.map((row) => row.sd);
  // Measured against the card's own grain deep inside it, not a fixed
  // number: the grain went finer and two steps quieter on 2026-10-25
  // (Riley: "a finer, more subtle texture", then "one step quieter still";
  // conversation-shell.css, --mn-card-finish), so its spread is about a
  // third of what this was first set to. Across the fade it keeps the
  // card's spread (two offset copies would average out below it), and the
  // card has grain at all (a flat fill measures 0).
  const cardGrainSd =
    (edges.conversation as { deep: Stats } | null)?.deep.sd ?? 0;
  checks.top_veil_registration = {
    ...veilRegistration,
    fade_min_sd: Math.min(...fadeSd),
    fade_mean_sd: fadeSd.reduce((a, b) => a + b, 0) / (fadeSd.length || 1),
    card_grain_sd: cardGrainSd,
    ok:
      veilRegistration.content_left === veilRegistration.veil_left &&
      veilRegistration.content_top === veilRegistration.veil_top &&
      fadeSd.length === 16 &&
      cardGrainSd >= 0.4 &&
      Math.min(...fadeSd) >= cardGrainSd * 0.8,
  };

  const lipNames: Record<string, unknown> = {
    general: await lipOnCard(page),
  };
  // The places, then Brain by its route (it left the column; until WP-13
  // it keeps working there) and New conversation by its key (its + is on
  // the Chats rail, which isn't showing from Brain).
  const routes: [string, string][] = [
    ["open-artifacts-view", "library"],
    ["open-agents-view", "agents"],
    ["open-activity-view", "activity"],
    ["route:#/brain", "brain"],
    ["key:Meta+n", "new_conversation"],
  ];
  let newConversation: Record<string, unknown> = {};
  for (const [testId, label] of routes) {
    if (testId.startsWith("route:")) {
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, testId.slice(6));
    } else if (testId.startsWith("key:")) {
      await page.keyboard.press(testId.slice(4));
    } else {
      await page.getByTestId(testId).click();
    }
    await page.mouse.move(700, 500);
    await page.waitForTimeout(700);
    await settle(page);
    edges[label] = await cardEdgeGrain(page, ROUTE_CARD);
    lipNames[label] = await lipOnCard(page);
    if (label === "new_conversation") {
      await expect(page.getByTestId("new-message-body")).toBeVisible();
      const body = await box(page, '[data-testid="new-message-body"]');
      const background = await page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector(
              '[data-testid="new-message-body"]',
            ) as Element,
          ).backgroundColor,
      );
      files.push(await shot(page, dir, "new-conversation"));
      if (body) {
        // An open stretch of the body, right of the suggestions.
        const [open] = await pixelStats(page, [
          {
            x: Math.round((body.x + body.w - 260) * 2),
            y: Math.round((body.y + body.h / 2) * 2),
            w: 400,
            h: 200,
          },
        ]);
        // Its header paints no band and draws no line of its own: the
        // card's grain runs under it as under the body.
        const header = await page.evaluate(() => {
          const element = document.querySelector(
            '[data-testid="new-message-header"]',
          ) as HTMLElement;
          const cs = getComputedStyle(element);
          const r = element.getBoundingClientRect();
          return {
            background: cs.backgroundColor,
            backdrop: cs.backdropFilter,
            border_bottom: cs.borderBottomColor,
            bottom: r.y + r.height,
          };
        });
        // Read beside the reading column, over the same stretch as the open
        // body: "To:" and its recipient list sit on the column now (WP-19,
        // Decided 4), so the list's own edge lies under the header's foot
        // there, and is not the header's.
        const [band, line] = await pixelStats(page, [
          {
            x: Math.round((body.x + body.w - 260) * 2),
            y: Math.round((header.bottom - 8) * 2),
            w: 400,
            h: 14,
          },
          {
            x: Math.round((body.x + body.w - 260) * 2),
            y: Math.round((header.bottom - 1) * 2),
            w: 400,
            h: 2,
          },
        ]);
        newConversation = {
          background,
          open_body: open,
          header: { ...header, band, line },
          // The grain's spread, against the open body's (the grain went
          // two steps quieter on 2026-10-25; see top_veil_registration):
          // the body has grain, and the header's band keeps it.
          ok:
            background === "rgba(0, 0, 0, 0)" &&
            open.sd >= 0.4 &&
            header.background === "rgba(0, 0, 0, 0)" &&
            header.backdrop === "none" &&
            header.border_bottom === "rgba(0, 0, 0, 0)" &&
            Math.abs(band.mean - open.mean) <= 0.5 &&
            Math.abs(line.mean - open.mean) <= 0.5 &&
            band.sd >= open.sd * 0.8,
        };
      }
    }
  }
  const railEdge = edges.rail as Awaited<ReturnType<typeof cardEdgeGrain>>;
  checks.card_edge_grain = {
    ...edges,
    ok:
      !!railEdge &&
      Object.entries(edges)
        .filter(([key]) => key !== "rail")
        .every(([, value]) =>
          grainReachesEdge(value as Awaited<ReturnType<typeof cardEdgeGrain>>),
        ) &&
      // Against the rail's: the conversation's outer column carries the
      // grain as the one card's left edge, under the rail, does. (The rail's
      // own right column is the hairline between them on the one card,
      // WP-12, so it is not the grain's measure any more.)
      Math.abs(
        ((edges.conversation as { left: Stats }).left?.sd ?? 0) -
          railEdge.left.sd,
      ) <= 1,
  };
  checks.new_conversation_surface = newConversation;
  checks.lip_name_on_card = {
    ...lipNames,
    ok: Object.values(lipNames).every(
      (entry) =>
        !!entry &&
        (entry as { ok: boolean; lip_right: string }).ok &&
        (entry as { lip_right: string }).lip_right === "6px",
    ),
  };

  // ── Conversations opens the closed rail in a conversation ─────────
  const reopens: Record<string, unknown> = {};
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 500 },
  ]) {
    const label = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await page.waitForTimeout(600);
    // Open the rail if the window left it closed, open #general from it,
    // then close it with the toggle.
    if ((await box(page, RAIL_CARD))?.w !== 220) {
      await page.getByTestId("shell-lip-toggle").click();
      await page.waitForTimeout(700);
    }
    await openGeneral(page);
    await page.getByTestId("shell-lip-toggle").click();
    await page.mouse.move(size.width / 2, size.height / 2);
    await page.waitForTimeout(700);
    await settle(page);
    const closedWidth = (await box(page, RAIL_CARD))?.w ?? null;
    files.push(
      await shot(page, dir, `conversations-reopens-rail-before-${label}`),
    );
    const url = page.url();
    // The rail card's width a frame at a time while it opens: the motion.
    const widths = await page.evaluate(
      () =>
        new Promise<number[]>((resolve) => {
          const card = '[data-testid="app-sidebar"] [data-sidebar="sidebar"]';
          const samples: number[] = [];
          const start = performance.now();
          (
            document.querySelector(
              '[data-testid="shell-place-conversations"]',
            ) as HTMLElement
          ).click();
          const step = () => {
            const element = document.querySelector(card);
            samples.push(element ? element.getBoundingClientRect().width : -1);
            if (performance.now() - start < 700) requestAnimationFrame(step);
            else resolve(samples);
          };
          requestAnimationFrame(step);
        }),
    );
    await page.mouse.move(size.width / 2, size.height / 2);
    await settle(page);
    files.push(
      await shot(page, dir, `conversations-reopens-rail-after-${label}`),
    );
    const openWidth = (await box(page, RAIL_CARD))?.w ?? null;
    const between = widths.filter((w) => w > 1 && w < 219).length;
    // The motion is the toggle's own: the card's width transition.
    const transition = await page.evaluate((selector) => {
      const style = getComputedStyle(
        document.querySelector(selector) as Element,
      );
      return `${style.transitionProperty} ${style.transitionDuration} ${style.transitionTimingFunction}`;
    }, '[data-testid="app-sidebar"]');
    reopens[label] = {
      closed_width: closedWidth,
      open_width: openWidth,
      frames_in_motion: between,
      transition,
      stayed_in_conversation: page.url() === url,
      lip_name: await page.getByTestId("shell-lip-name").innerText(),
      ok:
        closedWidth === 0 &&
        openWidth === 220 &&
        // At least one frame caught between closed and open (on a loaded
        // machine the frames are few), on the rail's 460 ms curve.
        between >= 1 &&
        transition.includes("0.46s") &&
        transition.includes("cubic-bezier(0.32, 0.72, 0, 1)") &&
        page.url() === url,
    };
  }
  // From any other place it still goes to the last conversation, and with
  // the rail open it does what it did before.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("open-artifacts-view").click();
  // The lip names Library's first pick (WP-10, Decided 7 and 8), as
  // "section / row", since "All" alone is ambiguous (WP-19, Decided 5).
  await expect(page.getByTestId("shell-lip-name")).toHaveText("Made / All");
  await page.getByTestId("shell-place-conversations").click();
  await expect(page.locator(CONVERSATION_CARD).first()).toBeVisible();
  const fromLibrary = await page.getByTestId("shell-lip-name").innerText();
  reopens.from_library = {
    lip_name: fromLibrary,
    ok: fromLibrary === "general",
  };
  checks.conversations_opens_rail = {
    ...reopens,
    ok: Object.values(reopens).every((entry) => (entry as { ok: boolean }).ok),
  };

  // ── before: the same measures on a build of the frame as WP-01 left
  // it (SHELL_BEFORE_URL), for the record ────────────────────────────
  const beforeUrl = process.env.SHELL_BEFORE_URL;
  const reachable = beforeUrl
    ? await fetch(beforeUrl)
        .then((response) => response.ok)
        .catch(() => false)
    : false;
  if (beforeUrl && reachable) {
    const basePage = await page.context().newPage();
    try {
      await openApp(basePage, { frame: true, origin: beforeUrl });
      await expect(basePage.locator("html")).toHaveAttribute(
        "data-luca-frame",
        "solid",
        { timeout: 20_000 },
      );
      await openGeneral(basePage);
      await basePage.mouse.move(700, 500);
      await basePage.waitForTimeout(600);
      await settle(basePage);
      const baseFoot = await railFoot(basePage);
      const baseEdge = await cardEdgeGrain(basePage, CONVERSATION_CARD);
      await basePage.getByTestId("open-new-conversation").click();
      await expect(basePage.getByTestId("new-message-body")).toBeVisible();
      await basePage.mouse.move(700, 500);
      await settle(basePage);
      const body = await box(basePage, '[data-testid="new-message-body"]');
      const [baseBody] = body
        ? await pixelStats(basePage, [
            {
              x: Math.round((body.x + body.w - 260) * 2),
              y: Math.round((body.y + body.h / 2) * 2),
              w: 400,
              h: 200,
            },
          ])
        : [null];
      checks.before = {
        url: beforeUrl,
        rail_foot: baseFoot && {
          median_sd: baseFoot.median_sd,
          min_sd: baseFoot.min_sd,
          mean_range: baseFoot.mean_range,
        },
        conversation_edge: baseEdge,
        new_conversation_body: baseBody,
      };
    } finally {
      await basePage.close();
    }
  }

  const hashes = files.map((file) => sha(file));
  checks.screenshots = files.map((file, index) => ({
    file,
    sha256: hashes[index],
  }));
  checks.unique_hashes = new Set(hashes).size === hashes.length;
  writeFileSync(
    path.join(dir, "checks-finished.json"),
    JSON.stringify(checks, null, 2),
  );
  for (const [key, value] of Object.entries(checks)) {
    if (value && typeof value === "object" && "ok" in value) {
      expect.soft((value as { ok: boolean }).ok, key).toBe(true);
    }
  }
  expect(checks.unique_hashes).toBe(true);
});
