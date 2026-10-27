import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { installHuddleStage } from "./shell-huddle-stage";

/**
 * The huddle bar in the frame (docs/luca/rail-system/SHELL_BUILD.md, WP-08e;
 * SHELL_SPEC.md, "The huddle bar", Decided 8). A huddle is staged in the
 * mock (shell-huddle-stage.ts) and started the way the owner starts one, from
 * a person's card, with a fake microphone, so every control is live.
 *
 * SHELL_SHOTS: where the screenshots and checks go (else the test's output
 * folder). SHELL_BASE_URL: the base build for the flag-off comparison
 * (default http://127.0.0.1:4300); unreachable, it is reported as not run.
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";

test.use({
  deviceScaleFactor: 2,
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
  permissions: ["microphone"],
});
test.describe.configure({ mode: "serial" });

type Box = { x: number; y: number; w: number; h: number };

const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const SELF_PUBKEY = "deadbeef".repeat(8);
const RAIL_CARD = '[data-testid="app-sidebar"] [data-sidebar="sidebar"]';
const CONVERSATION_CARD =
  '[data-testid="conversation-workspace-grid"] [data-luca-card]';
const BAND = '[data-testid="shell-huddle-band"]';
// The bar itself, not the popovers that wear its class.
const BAR = ".buzz-huddle-drawer.grid";

// Each spec writes to its own folder under SHELL_SHOTS, so its hash checks
// compare its own shots and no other spec's (WP-28, Decided 6).
const SHELL_SHOTS = process.env.SHELL_SHOTS
  ? path.join(process.env.SHELL_SHOTS, "shell-huddle")
  : undefined;

function shotsDir(fallback: string) {
  const dir = SHELL_SHOTS ?? fallback;
  mkdirSync(dir, { recursive: true });
  return dir;
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

async function openApp(
  page: Page,
  {
    frame,
    origin = "",
    size = { width: 1440, height: 900 },
    scheme = "dark",
  }: {
    frame: boolean;
    origin?: string;
    size?: { width: number; height: number };
    scheme?: "dark" | "light";
  },
) {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme });
  await installHuddleStage(page);
  await installMockBridge(page);
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
  // A busy machine: the first load gets room.
  await page.goto(`${origin}/?e2e=mock`, { timeout: 30_000 });
}

async function openGeneral(page: Page, { frame = true } = {}) {
  if (!frame) {
    await page.getByTestId("channel-general").click({ timeout: 20_000 });
    await expect(page.locator(CONVERSATION_CARD).first()).toBeVisible({
      timeout: 20_000,
    });
    return;
  }
  await page.waitForSelector('[data-testid="app-sidebar"] [data-channel-id]', {
    timeout: 20_000,
  });
  await expect(async () => {
    await page.evaluate((id) => {
      location.hash = `#/channels/${id}`;
    }, GENERAL_CHANNEL_ID);
    await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator(CONVERSATION_CARD).first()).toBeVisible({
    timeout: 20_000,
  });
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

async function box(page: Page, selector: string): Promise<Box | null> {
  return page.evaluate((s) => {
    const element = document.querySelector(s);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
}

/** Bob says hello in #general, and the owner starts a huddle from his card,
 *  the way it is done in the app; the bar shows once the huddle is live. */
async function startHuddle(
  page: Page,
  { dismissHint = true }: { dismissHint?: boolean } = {},
) {
  // The owner and Bob, as once Bob has joined.
  await page.evaluate(
    (who) => {
      if (window.__HUDDLE_STAGE__) {
        window.__HUDDLE_STAGE__.participantsOnJoin = who;
      }
    },
    [SELF_PUBKEY, TEST_IDENTITIES.bob.pubkey],
  );
  const bobRow = page
    .getByTestId("message-row")
    .filter({ hasText: "Bob says hello." })
    .first();
  if ((await bobRow.count()) === 0) {
    await page.evaluate(
      (pubkey) =>
        (
          window as unknown as {
            __BUZZ_E2E_EMIT_MOCK_MESSAGE__: (input: {
              channelName: string;
              content: string;
              pubkey: string;
            }) => unknown;
          }
        ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__({
          channelName: "general",
          content: "Bob says hello.",
          pubkey,
        }),
      TEST_IDENTITIES.bob.pubkey,
    );
  }
  await expect(bobRow).toBeVisible({ timeout: 10_000 });
  await bobRow.getByTestId("message-author").hover();
  const card = page.locator(
    '[data-testid="user-profile-popover"][data-state="open"]',
  );
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card
    .getByTestId(`user-profile-popover-huddle-${TEST_IDENTITIES.bob.pubkey}`)
    .click();
  await expect(page.locator(BAR)).toBeVisible({ timeout: 15_000 });
  if (!dismissHint) return;
  // The headphones hint opens once on the first huddle; it is today's. In
  // the frame it opens once the bar has risen (460 ms), so it gets room.
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (
    await gotIt
      .waitFor({ state: "visible", timeout: 1_500 })
      .then(() => true)
      .catch(() => false)
  ) {
    await gotIt.click({ timeout: 5_000 }).catch(() => undefined);
  }
  await expect(gotIt).toHaveCount(0, { timeout: 5_000 });
  await page.mouse.move(700, 300);
}

async function huddleCalls(page: Page) {
  return page.evaluate(
    () => window.__HUDDLE_STAGE__?.calls.map((c) => c.command) ?? [],
  );
}

/** The band's geometry, the cards' bottoms and the places' foot. */
async function geometry(page: Page) {
  return page.evaluate(
    ({ band, bar, rail, conversation }) => {
      const r = (s: string) => {
        const e = document.querySelector(s);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return {
          left: Math.round(b.left * 100) / 100,
          top: Math.round(b.top * 100) / 100,
          right: Math.round(b.right * 100) / 100,
          bottom: Math.round(b.bottom * 100) / 100,
        };
      };
      return {
        window: { w: window.innerWidth, h: window.innerHeight },
        band: r(band),
        bar: r(bar),
        rail_card: r(rail),
        conversation_card: r(conversation),
        settings: r('[data-testid="open-settings-view"]'),
        avatar: r(".luca-shell-avatar"),
        places: r('[data-testid="shell-places"]'),
        lip_top: r('[data-testid="shell-lip"]')?.top ?? null,
        shell_scroll_top:
          document.querySelector(".buzz-huddle-shell")?.scrollTop ?? null,
      };
    },
    {
      band: BAND,
      bar: BAR,
      rail: RAIL_CARD,
      conversation: CONVERSATION_CARD,
    },
  );
}

/** The floor's colour beside the bar and inside it, from the pixels. */
async function floorUnderBar(page: Page) {
  const png = await page.screenshot();
  return page.evaluate(
    async ({ b64, bar }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / window.innerWidth;
      const element = document.querySelector(bar) as HTMLElement;
      const b = element.getBoundingClientRect();
      const px = (x: number, y: number) =>
        Array.from(
          context.getImageData(
            Math.round(x * scale),
            Math.round(y * scale),
            1,
            1,
          ).data,
        ).slice(0, 3);
      // Inside the bar, in its empty left third (the right end lies under
      // the quick chat's launcher); and the floor just below it.
      return {
        inside_bar: px(b.left + 40, b.top + b.height / 2),
        below_bar: px(b.left + 40, b.bottom + 3),
        bar_background: getComputedStyle(element).backgroundColor,
        button_backgrounds: Array.from(element.querySelectorAll("button"))
          .filter((x) => !x.hasAttribute("data-huddle-leave"))
          .filter((x) => !x.classList.contains("bg-destructive"))
          .map((x) => getComputedStyle(x).backgroundColor),
        button_tiles: Array.from(element.querySelectorAll("button")).map(
          (x) => {
            const r = x.getBoundingClientRect();
            return {
              label: x.getAttribute("aria-label"),
              w: r.width,
              h: r.height,
              radius: getComputedStyle(x).borderTopLeftRadius,
              color: getComputedStyle(x).color,
            };
          },
        ),
      };
    },
    { b64: png.toString("base64"), bar: BAR },
  );
}

/** A frame-by-frame trace of the conversation card's bottom, the rail
 *  card's bottom and the bar's top while `act` runs. */
async function trace(page: Page, act: () => Promise<void>, ms = 1500) {
  await page.evaluate(
    ({ rail, conversation, bar, ms }) => {
      const samples: number[][] = [];
      (window as unknown as { __TRACE__: number[][] }).__TRACE__ = samples;
      const start = performance.now();
      const bottom = (s: string) =>
        document.querySelector(s)?.getBoundingClientRect().bottom ?? -1;
      const top = (s: string) =>
        document.querySelector(s)?.getBoundingClientRect().top ?? -1;
      const step = () => {
        samples.push([
          Math.round(performance.now() - start),
          Math.round(bottom(conversation) * 10) / 10,
          Math.round(bottom(rail) * 10) / 10,
          Math.round(top(bar) * 10) / 10,
        ]);
        // Until `ms` after the card first moves (or 20 s, if it never does).
        const first = samples[0][1];
        const moved = samples.find((x) => Math.abs(x[1] - first) > 0.05);
        const now = performance.now() - start;
        const done = moved ? now - moved[0] > ms : now > 20_000;
        if (done) {
          (window as unknown as { __TRACE_DONE__: boolean }).__TRACE_DONE__ =
            true;
        } else requestAnimationFrame(step);
      };
      (window as unknown as { __TRACE_DONE__: boolean }).__TRACE_DONE__ = false;
      requestAnimationFrame(step);
    },
    { rail: RAIL_CARD, conversation: CONVERSATION_CARD, bar: BAR, ms },
  );
  await act();
  await page.waitForFunction(
    () => (window as unknown as { __TRACE_DONE__: boolean }).__TRACE_DONE__,
    undefined,
    { timeout: 30_000 },
  );
  return page.evaluate(
    () => (window as unknown as { __TRACE__: number[][] }).__TRACE__,
  );
}

function summarise(samples: number[][], from: number, to: number) {
  const card = samples.map((s) => s[1]);
  const between = card.filter(
    (v) => v > Math.min(from, to) + 0.5 && v < Math.max(from, to) - 0.5,
  ).length;
  const moving = samples.filter(
    (s) => s[1] > Math.min(from, to) + 0.5 && s[1] < Math.max(from, to) - 0.5,
  );
  const gaps = samples
    .filter((s) => s[3] > 0)
    .map((s) => Math.round((s[3] - s[1]) * 10) / 10);
  return {
    first: card[0],
    last: card[card.length - 1],
    frames_in_motion: between,
    motion_ms: moving.length ? moving[moving.length - 1][0] - moving[0][0] : 0,
    rail_matches_conversation: samples.every(
      (s) => Math.abs(s[1] - s[2]) < 1.01,
    ),
    bar_gap_while_drawn: {
      min: gaps.length ? Math.min(...gaps) : null,
      max: gaps.length ? Math.max(...gaps) : null,
    },
  };
}

// ── the band, live ───────────────────────────────────────────────────

test("the huddle bar in the frame", async ({ page }, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  const checks: Record<string, unknown> = {};
  const files: string[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 240));
  });

  await openApp(page, { frame: true });
  await openGeneral(page);
  const before = await geometry(page);
  files.push(await shot(page, dir, "no-huddle-1440x900"));

  await startHuddle(page);
  await openGeneral(page);
  await page.mouse.move(700, 300);
  await page.waitForTimeout(700);

  const band: Record<string, unknown> = {};
  const shorten: Record<string, unknown> = {};
  const floor: Record<string, unknown> = {};
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 500 },
  ]) {
    const label = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await page.waitForTimeout(700);
    await settle(page);
    const g = await geometry(page);
    files.push(await shot(page, dir, `huddle-live-${label}`));
    const W = size.width;
    const H = size.height;
    band[label] = {
      band: g.band,
      bar: g.bar,
      expected: { left: 44, right: W - 6, bottom: H - 6, height: 32 },
      ok:
        !!g.band &&
        Math.abs(g.band.left - 44) < 0.6 &&
        Math.abs(g.band.right - (W - 6)) < 0.6 &&
        Math.abs(g.band.bottom - (H - 6)) < 0.6 &&
        Math.abs(g.band.bottom - g.band.top - 32) < 0.6 &&
        g.lip_top === 0 &&
        g.shell_scroll_top === 0,
    };
    shorten[label] = {
      rail_card_bottom: g.rail_card?.bottom,
      conversation_card_bottom: g.conversation_card?.bottom,
      expected_bottom: H - 44,
      gap_to_bar:
        g.bar && g.conversation_card
          ? Math.round((g.bar.top - g.conversation_card.bottom) * 100) / 100
          : null,
      places_foot: { settings: g.settings, avatar: g.avatar },
      ok:
        !!g.rail_card &&
        !!g.conversation_card &&
        Math.abs(g.rail_card.bottom - (H - 44)) < 0.6 &&
        Math.abs(g.conversation_card.bottom - (H - 44)) < 0.6,
    };
    floor[label] = await floorUnderBar(page);
  }
  // The places' foot: where it was before the huddle, at the same size.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(700);
  const live = await geometry(page);
  checks.band_geometry = band;
  checks.cards_shorten = {
    ...shorten,
    before_huddle_1440x900: {
      rail_card_bottom: before.rail_card?.bottom,
      conversation_card_bottom: before.conversation_card?.bottom,
    },
    places_foot_unmoved:
      JSON.stringify([before.settings, before.avatar]) ===
      JSON.stringify([live.settings, live.avatar]),
    places_column: { before: before.places, live: live.places },
  };
  const f = floor["1440x900"] as {
    inside_bar: number[];
    below_bar: number[];
    bar_background: string;
    button_backgrounds: string[];
  };
  checks.controls_on_floor = {
    ...floor,
    bar_paints_nothing: f.bar_background === "rgba(0, 0, 0, 0)",
    resting_buttons_clear: f.button_backgrounds.every(
      (c) => c === "rgba(0, 0, 0, 0)",
    ),
    floor_matches_inside_and_below:
      JSON.stringify(f.inside_bar) === JSON.stringify(f.below_bar),
  };

  // ── Settings: its cards end above the band too ─────────────────────
  await page.getByTestId("open-settings-view").click();
  await expect(
    // The section's title is "Profile & identity" (WP-17, Decided 1), on
    // the page's head; the lip names it too (Decided 2).
    page
      .getByTestId("place-page-head")
      .getByRole("heading", { name: "Profile & identity", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(700, 300);
  await page.waitForTimeout(700);
  const settings = await page.evaluate(() => {
    const b = (s: string) =>
      document.querySelector(s)?.getBoundingClientRect().bottom ?? null;
    return {
      list_bottom: b("[data-luca-settings-list]"),
      panels_bottom: b(
        "[data-luca-settings-card-host] > [data-luca-conversation-surface]",
      ),
    };
  });
  files.push(await shot(page, dir, "huddle-live-settings-1440x900"));
  (checks.cards_shorten as Record<string, unknown>).settings_1440x900 = {
    ...settings,
    expected_bottom: 856,
  };
  await page.keyboard.press("Escape");
  await openGeneral(page);

  // ── the rail closed ────────────────────────────────────────────────
  await page.getByTestId("shell-lip-toggle").click();
  await page.mouse.move(700, 300);
  await page.waitForTimeout(800);
  const closed = await geometry(page);
  files.push(await shot(page, dir, "huddle-rail-closed-1440x900"));
  checks.rail_closed = {
    conversation_card: closed.conversation_card,
    band: closed.band,
    ok:
      !!closed.conversation_card &&
      Math.abs(closed.conversation_card.left - 44) < 1.1 &&
      Math.abs(closed.conversation_card.bottom - 856) < 0.6,
  };
  await page.getByTestId("shell-lip-toggle").click();
  await page.waitForTimeout(800);

  // ── hover: the plate ───────────────────────────────────────────────
  await page.getByRole("button", { name: "Add agent to huddle" }).hover();
  await page.waitForTimeout(400);
  const bandBox = (await box(page, BAND)) as Box;
  const clip = {
    x: bandBox.x,
    y: bandBox.y - 60,
    width: bandBox.w,
    height: bandBox.h + 66,
  };
  await settle(page);
  const hoverShot = path.join(dir, "huddle-bar-hover-crop.png");
  await page.screenshot({ path: hoverShot, clip });
  files.push(hoverShot);
  await page.mouse.move(700, 300);

  writeFileSync(
    path.join(dir, "checks-live.json"),
    JSON.stringify({ checks, files, consoleErrors }, null, 2),
  );
  expect.soft((band["1440x900"] as { ok: boolean }).ok, "band 1440").toBe(true);
  expect.soft((band["800x500"] as { ok: boolean }).ok, "band 800").toBe(true);
  expect
    .soft((shorten["1440x900"] as { ok: boolean }).ok, "cards 1440")
    .toBe(true);
  expect
    .soft((shorten["800x500"] as { ok: boolean }).ok, "cards 800")
    .toBe(true);
  expect
    .soft(
      (checks.cards_shorten as { places_foot_unmoved: boolean })
        .places_foot_unmoved,
      "places foot",
    )
    .toBe(true);
  expect
    .soft((checks.rail_closed as { ok: boolean }).ok, "rail closed")
    .toBe(true);
});

// ── light: Paper, the bar on the recess ──────────────────────────────

test("the huddle bar in Paper", async ({ page }, info) => {
  test.setTimeout(180_000);
  const dir = shotsDir(info.outputPath());
  await page.addInitScript(() => {
    window.localStorage.setItem("buzz-theme", "paper");
  });
  await openApp(page, { frame: true, scheme: "light" });
  await openGeneral(page);
  await startHuddle(page);
  await openGeneral(page);
  await page.mouse.move(700, 300);
  await page.waitForTimeout(800);
  const file = await shot(page, dir, "huddle-live-paper-1440x900");
  const floor = await floorUnderBar(page);
  const g = await geometry(page);
  const ink = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--mn-ink")
      .trim(),
  );
  writeFileSync(
    path.join(dir, "checks-paper.json"),
    JSON.stringify({ paper: { file, floor, geometry: g, ink } }, null, 2),
  );
  // The bar paints nothing: inside it is the recess, darkened only by the
  // cards' own shadow on the floor, a few levels at most.
  const delta = Math.max(
    ...(floor?.inside_bar ?? [255]).map((v, i) =>
      Math.abs(v - (floor?.below_bar?.[i] ?? 0)),
    ),
  );
  expect.soft(delta).toBeLessThanOrEqual(4);
  expect.soft(floor?.bar_background).toBe("rgba(0, 0, 0, 0)");
});

// ── motion ───────────────────────────────────────────────────────────

test("the band rises and falls on the rail's motion", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  await openApp(page, { frame: true });
  await openGeneral(page);

  // Rise: from the press on Huddle until the bar has settled.
  const rise = await trace(page, () => startHuddle(page), 2500);
  await openGeneral(page);
  await page.mouse.move(700, 300);
  await page.waitForTimeout(700);
  // Mid-rise picture: the next fall, caught halfway.
  const transition = await page.evaluate(() => {
    const s = getComputedStyle(
      document.querySelector(".buzz-huddle-shell") as Element,
    );
    return `${s.transitionProperty} ${s.transitionDuration} ${s.transitionTimingFunction}`;
  });
  const fall = await trace(
    page,
    () => page.getByRole("button", { name: "Leave huddle" }).click(),
    1200,
  );
  await page.waitForTimeout(300);
  const barGone = (await page.locator(BAR).count()) === 0;

  // A frame partway, for the eye: the band's next rise, held 90 ms in
  // (the transition paused where it is, then let go).
  await page.evaluate(() => {
    const hold = () => {
      const rise = document
        .getAnimations()
        .find(
          (a) =>
            (a as CSSTransition).transitionProperty === "--luca-huddle-band",
        );
      if (!rise) {
        requestAnimationFrame(hold);
        return;
      }
      rise.pause();
      rise.currentTime = 90;
      (window as unknown as { __HELD__: Animation }).__HELD__ = rise;
    };
    requestAnimationFrame(hold);
  });
  await startHuddle(page);
  await page.waitForFunction(
    () => (window as unknown as { __HELD__?: Animation }).__HELD__,
  );
  await page.mouse.move(700, 300);
  await settle(page);
  const midFile = path.join(dir, "huddle-motion-midway-1440x900.png");
  await page.screenshot({ path: midFile });
  const midway = await page.evaluate(
    ({ conversation, bar }) => ({
      card_bottom: document.querySelector(conversation)?.getBoundingClientRect()
        .bottom,
      bar_top: document.querySelector(bar)?.getBoundingClientRect().top,
    }),
    { conversation: CONVERSATION_CARD, bar: BAR },
  );
  await page.evaluate(() =>
    (window as unknown as { __HELD__: Animation }).__HELD__.play(),
  );
  await page.waitForTimeout(600);
  await openGeneral(page);
  await page.mouse.move(700, 300);
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Leave huddle" }).click();
  await expect(page.locator(BAR)).toHaveCount(0);

  // Reduce Motion: instant.
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await startHuddle(page);
  await openGeneral(page);
  await page.mouse.move(700, 300);
  await page.waitForTimeout(700);
  const reduced = await trace(
    page,
    () => page.getByRole("button", { name: "Leave huddle" }).click(),
    800,
  );

  const motion = {
    transition,
    rise: summarise(rise, 856, 894),
    fall: summarise(fall, 856, 894),
    bar_gone_after_fall: barGone,
    reduced_motion: summarise(reduced, 856, 894),
    rise_samples: rise.filter((_s, i) => i % 3 === 0).slice(0, 60),
    fall_samples: fall.filter((_s, i) => i % 2 === 0).slice(0, 50),
    midway_shot: midFile,
    midway,
  };
  writeFileSync(
    path.join(dir, "checks-motion.json"),
    JSON.stringify({ motion }, null, 2),
  );
  // A busy machine draws few frames; at least one must land mid-way, with
  // the bar 6 under the cards on every one.
  expect.soft(motion.rise.frames_in_motion).toBeGreaterThan(0);
  expect.soft(motion.fall.frames_in_motion).toBeGreaterThan(0);
  for (const gap of [motion.rise, motion.fall].flatMap((m) => [
    m.bar_gap_while_drawn.min,
    m.bar_gap_while_drawn.max,
  ])) {
    expect.soft(Math.abs((gap ?? 0) - 6)).toBeLessThanOrEqual(0.15);
  }
  expect.soft(motion.reduced_motion.frames_in_motion).toBe(0);
});

// ── every control once, with the frame and without ───────────────────

async function useEveryControl(page: Page, dir: string, label: string) {
  const out: Record<string, unknown> = {};
  const bar = page.locator(BAR);
  const button = (name: string | RegExp) =>
    bar.getByRole("button", { name, exact: typeof name === "string" });

  // Microphone: mute and unmute.
  await button("Mute microphone").click();
  out.mute = {
    pressed: await button("Unmute microphone").getAttribute("aria-pressed"),
  };
  await button("Unmute microphone").click();
  (out.mute as Record<string, unknown>).unmuted =
    (await button("Mute microphone").getAttribute("aria-pressed")) === "false";

  // Audio settings: the input mode menu.
  await button("Audio settings").click();
  const pushToTalk = page.getByRole("button", { name: /Push to Talk/ });
  out.audio_settings_open = await pushToTalk.isVisible();
  await pushToTalk.click();
  await page.waitForTimeout(200);
  out.push_to_talk_set = (await huddleCalls(page)).includes(
    "set_voice_input_mode",
  );
  await page.keyboard.press("Escape");

  // Agent speech: mute and back.
  await button("Mute agent speech").click();
  await expect(button("Unmute agent speech")).toBeVisible();
  await button("Unmute agent speech").click();
  await expect(button("Mute agent speech")).toBeVisible();
  out.agent_speech = true;

  // Speaker settings: the device list.
  await button("Speaker settings").click();
  out.speaker_settings_open = await page
    .getByText("MacBook Pro Speakers")
    .first()
    .isVisible();
  await page.keyboard.press("Escape");

  // The thread: enabled only once the huddle's start event is found, today.
  out.thread_button_enabled = await button("View huddle thread").isEnabled();
  if (out.thread_button_enabled) await button("View huddle thread").click();

  // Participants.
  await button(/Show huddle participants/).click();
  out.participants_open = await page
    .getByRole("heading", { name: "Participants" })
    .isVisible();
  await page.keyboard.press("Escape");

  // A reaction.
  await button("Emoji reactions").click();
  const picker = page.locator('[data-slot="popover-content"], [role="dialog"]');
  out.emoji_picker_open = (await picker.count()) > 0;
  await page.keyboard.press("Escape");

  // The transcript, on and off.
  await button("Start transcript").click();
  await expect(button("Stop transcript")).toBeVisible();
  await button("Stop transcript").click();
  await expect(button("Start transcript")).toBeVisible();
  out.transcript = true;

  // Add an agent: its dialog.
  await button("Add agent to huddle").click();
  const dialog = page.getByRole("dialog");
  out.add_agent_dialog = await dialog
    .first()
    .isVisible()
    .catch(() => false);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.mouse.move(700, 300);
  await settle(page);
  const file = path.join(dir, `huddle-controls-used-${label}.png`);
  await page.screenshot({ path: file });
  out.shot = file;

  // Leave.
  await button("Leave huddle").click();
  await expect(bar).toHaveCount(0, { timeout: 5_000 });
  out.left = true;
  out.calls = await huddleCalls(page);
  return out;
}

test("every control works as today", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const dir = shotsDir(info.outputPath());
  const run = async (frame: boolean) => {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    await openApp(page, { frame });
    await openGeneral(page, { frame });
    await startHuddle(page);
    const result = await useEveryControl(
      page,
      dir,
      frame ? "frame" : "flag-off",
    );
    await context.close();
    return result;
  };
  const frame = await run(true);
  const flagOff = await run(false);
  const strip = (o: Record<string, unknown>) => {
    const { shot: _shot, ...rest } = o;
    return rest;
  };
  const same = JSON.stringify(strip(frame)) === JSON.stringify(strip(flagOff));
  writeFileSync(
    path.join(dir, "checks-controls.json"),
    JSON.stringify(
      { controls_work: { frame, flag_off: flagOff, same } },
      null,
      2,
    ),
  );
  expect.soft(same, "same as flag off").toBe(true);
});

// ── flag off: the base, by hash ──────────────────────────────────────

async function captureFlagOff(
  browser: Browser,
  origin: string,
  dir: string,
  label: string,
) {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    permissions: ["microphone"],
  });
  await context.clock.install({ time: new Date("2026-10-24T18:30:00") });
  const page = await context.newPage();
  await openApp(page, { frame: false, origin });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await openGeneral(page, { frame: false });
  await page.mouse.move(1439, 899);
  await page.waitForTimeout(600);
  const plain = await shot(page, dir, `flag-off-no-huddle${label}`);
  await startHuddle(page);
  await page.getByTestId("channel-general").click();
  await page.mouse.move(1439, 899);
  await page.waitForTimeout(900);
  const huddle = await shot(page, dir, `flag-off-huddle${label}`);
  await context.close();
  return { plain, huddle };
}

test("flag off draws the base build exactly", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!reachable, `base build not reachable at ${BASE_URL}`);
  const ours = await captureFlagOff(
    browser,
    info.project.use.baseURL ?? "",
    dir,
    "",
  );
  const base = await captureFlagOff(browser, BASE_URL, dir, "-base");
  const result: Record<string, unknown> = {};
  for (const key of ["plain", "huddle"] as const) {
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
  for (const key of ["plain", "huddle"] as const) {
    expect
      .soft((result[key] as { identical: boolean }).identical, key)
      .toBe(true);
  }
});

// ── the review's fixes ───────────────────────────────────────────────

/** Colours at CSS points, from the page's own pixels, and the contrast of a
 *  solid CSS colour (an element's word) on one of them. */
async function contrastOn(
  page: Page,
  probes: { name: string; selector: string; at: [number, number] }[],
) {
  const png = await page.screenshot();
  return page.evaluate(
    async ({ b64, probes }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext(
        "2d",
      ) as OffscreenCanvasRenderingContext2D;
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / window.innerWidth;
      const px = (x: number, y: number) =>
        Array.from(
          context.getImageData(
            Math.round(x * scale),
            Math.round(y * scale),
            1,
            1,
          ).data,
        ).slice(0, 3);
      const solid = (css: string, over: number[]) => {
        const c = new OffscreenCanvas(1, 1).getContext(
          "2d",
        ) as OffscreenCanvasRenderingContext2D;
        c.fillStyle = css;
        c.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = Array.from(c.getImageData(0, 0, 1, 1).data);
        const k = a / 255;
        return [r, g, b].map((v, i) => Math.round(v * k + over[i] * (1 - k)));
      };
      const lum = (rgb: number[]) => {
        const f = (v: number) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
      };
      const ratio = (a: number[], b: number[]) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
      };
      return probes.map(({ name, selector, at }) => {
        const element = document.querySelector(selector);
        if (!element) return { name, missing: true };
        const r = element.getBoundingClientRect();
        const ground = px(r.left + at[0], r.top + at[1]);
        const word = solid(getComputedStyle(element).color, ground);
        return { name, word, ground, contrast: ratio(word, ground) };
      });
    },
    { b64: png.toString("base64"), probes },
  );
}

/** The hint's placement (its popper wrapper, without its own entrance) and
 *  the speaker pair's top, every frame from the bar's first frame. */
async function traceHint(page: Page, ms = 1600) {
  await page.evaluate((ms) => {
    const samples: (number | null)[][] = [];
    const w = window as unknown as {
      __HINT__: (number | null)[][];
      __HINT_DONE__: boolean;
    };
    w.__HINT__ = samples;
    w.__HINT_DONE__ = false;
    let start = 0;
    const step = () => {
      const bar = document.querySelector(".buzz-huddle-drawer.grid");
      if (bar && !start) start = performance.now();
      if (start) {
        const hint = document.querySelector(
          '[aria-label="Headphones recommended"]',
        );
        const wrapper = hint?.parentElement?.getBoundingClientRect();
        const pair = bar
          ?.querySelector('[aria-label="Speaker settings"]')
          ?.parentElement?.getBoundingClientRect();
        const controls = Array.from(bar?.querySelectorAll("button") ?? []).map(
          (b) => b.getBoundingClientRect(),
        );
        // Does the hint cover any control?
        const covers =
          wrapper && hint
            ? controls.some(
                (c) =>
                  c.left < wrapper.right &&
                  c.right > wrapper.left &&
                  c.top < wrapper.bottom &&
                  c.bottom > wrapper.top,
              )
            : false;
        samples.push([
          Math.round(performance.now() - start),
          wrapper ? Math.round(wrapper.bottom * 10) / 10 : null,
          pair ? Math.round(pair.top * 10) / 10 : null,
          covers ? 1 : 0,
        ]);
        if (performance.now() - start > ms) {
          w.__HINT_DONE__ = true;
          return;
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, ms);
}

test("the first huddle's hint waits for the bar to rise", async ({
  browser,
}, info) => {
  test.setTimeout(420_000);
  const dir = shotsDir(info.outputPath());
  const runs: Record<string, unknown>[] = [];
  const files: string[] = [];
  for (let run = 1; run <= 10; run += 1) {
    const paper = run === 10;
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    if (paper) {
      await page.addInitScript(() =>
        window.localStorage.setItem("buzz-theme", "paper"),
      );
    }
    await openApp(page, { frame: true, scheme: paper ? "light" : "dark" });
    await openGeneral(page);
    await traceHint(page);
    await startHuddle(page, { dismissHint: false });
    if (run === 1 || paper) {
      // Where the reviewers saw it misplaced: 0.9 s after the start.
      await page.waitForTimeout(500);
      const file = path.join(
        dir,
        `fix-hint-${paper ? "paper" : "dark"}-0.9s-1440x900.png`,
      );
      await page.screenshot({
        path: file,
        clip: { x: 260, y: 640, width: 1180, height: 260 },
      });
      files.push(file);
    }
    await page.waitForFunction(
      () => (window as unknown as { __HINT_DONE__: boolean }).__HINT_DONE__,
      undefined,
      { timeout: 20_000 },
    );
    const samples = await page.evaluate(
      () => (window as unknown as { __HINT__: (number | null)[][] }).__HINT__,
    );
    const shown = samples.filter((s) => s[1] !== null);
    const offsets = shown.map(
      (s) => Math.round(((s[2] as number) - (s[1] as number)) * 10) / 10,
    );
    runs.push({
      run,
      palette: paper ? "paper" : "dark",
      first_shown_ms: shown[0]?.[0] ?? null,
      frames_shown: shown.length,
      frames_covering_controls: shown.filter((s) => s[3] === 1).length,
      gap_to_controls: {
        min: offsets.length ? Math.min(...offsets) : null,
        max: offsets.length ? Math.max(...offsets) : null,
      },
      at_500ms: samples.find((s) => (s[0] as number) >= 500) ?? null,
    });
    await context.close();
  }
  writeFileSync(
    path.join(dir, "checks-fix-hint.json"),
    JSON.stringify({ hint: runs, files }, null, 2),
  );
  for (const r of runs) {
    expect
      .soft(r.frames_shown as number, `run ${r.run} shown`)
      .toBeGreaterThan(0);
    expect.soft(r.frames_covering_controls, `run ${r.run} covers`).toBe(0);
    const g = r.gap_to_controls as { min: number; max: number };
    expect
      .soft(Math.abs(g.min - 10), `run ${r.run} min`)
      .toBeLessThanOrEqual(0.6);
    expect
      .soft(Math.abs(g.max - 10), `run ${r.run} max`)
      .toBeLessThanOrEqual(0.6);
  }
});

test("the bar's controls: the lip's buttons, the page's warning tone, the pairs' plates", async ({
  browser,
}, info) => {
  test.setTimeout(300_000);
  const dir = shotsDir(info.outputPath());
  const out: Record<string, unknown> = {};
  for (const palette of ["dark", "paper"] as const) {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    if (palette === "paper") {
      await page.addInitScript(() =>
        window.localStorage.setItem("buzz-theme", "paper"),
      );
    }
    await openApp(page, {
      frame: true,
      scheme: palette === "paper" ? "light" : "dark",
    });
    await openGeneral(page);
    await startHuddle(page);
    await openGeneral(page);
    await page.mouse.move(700, 300);
    await page.waitForTimeout(700);
    const result: Record<string, unknown> = {};
    const bandBox = (await box(page, BAND)) as Box;
    const crop = (name: string) => {
      const file = path.join(dir, `fix-${palette}-${name}.png`);
      return settle(page)
        .then(() =>
          page.screenshot({
            path: file,
            clip: {
              x: bandBox.x + 200,
              y: bandBox.y - 8,
              width: 760,
              height: bandBox.h + 14,
            },
          }),
        )
        .then(() => file);
    };

    // The sizes, against the lip's own button and Join.
    if (palette === "dark") {
      result.sizes = await page.evaluate(() => {
        const bar = document.querySelector(".buzz-huddle-drawer.grid");
        const band = document
          .querySelector('[data-testid="shell-huddle-band"]')
          ?.getBoundingClientRect();
        const m = (e: Element | null | undefined) => {
          if (!e) return null;
          const r = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          const svg = e.querySelector("svg");
          return {
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
            top_in_band: band ? Math.round((r.top - band.top) * 10) / 10 : null,
            radius: s.borderTopLeftRadius,
            padding: s.padding,
            gap: s.columnGap,
            icon: svg
              ? `${svg.getBoundingClientRect().width}x${svg.getBoundingClientRect().height} @${getComputedStyle(svg).strokeWidth}`
              : null,
          };
        };
        const named = (n: string) =>
          bar?.querySelector(`button[aria-label="${n}"]`);
        const groups = Array.from(
          bar?.querySelectorAll(".justify-self-center > div") ?? [],
        );
        return {
          lip_button: m(document.querySelector(".luca-lip-button")),
          mute_microphone: m(named("Mute microphone")),
          audio_settings: m(named("Audio settings")),
          view_thread: m(named("View huddle thread")),
          emoji: m(named("Emoji reactions")),
          leave: m(bar?.querySelector("[data-huddle-leave]")),
          mic_pair: m(named("Audio settings")?.parentElement),
          group_gaps: groups.map((g) => getComputedStyle(g).columnGap),
          between_groups: getComputedStyle(
            bar?.querySelector(".justify-self-center") as Element,
          ).columnGap,
        };
      });
    }

    // Leave and the muted states: the page's warning tone.
    await page.getByRole("button", { name: "Mute microphone" }).click();
    await page.getByRole("button", { name: "Mute agent speech" }).click();
    await page.mouse.move(700, 300);
    await page.waitForTimeout(300);
    const leave = "[data-huddle-leave]";
    const micPair =
      '.buzz-huddle-drawer.grid div:has(> [aria-label="Audio settings"])';
    result.warning = {
      destructive: await page.evaluate(() => ({
        page: getComputedStyle(document.documentElement)
          .getPropertyValue("--destructive")
          .trim(),
        bar: getComputedStyle(
          document.querySelector(".buzz-huddle-drawer.grid") as Element,
        )
          .getPropertyValue("--destructive")
          .trim(),
      })),
      at_rest: await contrastOn(page, [
        { name: "leave_word", selector: leave, at: [3, 12] },
        {
          name: "muted_mic_icon",
          selector: '[aria-label="Unmute microphone"]',
          at: [2, 12],
        },
        {
          name: "muted_speech_icon",
          selector: '[aria-label="Unmute agent speech"]',
          at: [2, 12],
        },
      ]),
      pair_styles: await page.evaluate((s) => {
        const pair = document.querySelector(s);
        if (!pair) return null;
        return {
          pair_background: getComputedStyle(pair).backgroundColor,
          pair_radius: getComputedStyle(pair).borderRadius,
          halves: Array.from(pair.querySelectorAll(":scope > button")).map(
            (b) => getComputedStyle(b).backgroundColor,
          ),
        };
      }, micPair),
    };
    (result as Record<string, unknown>).muted_shot = await crop(
      "muted-mic-and-speech",
    );
    await page.locator(leave).hover();
    await page.waitForTimeout(250);
    (result.warning as Record<string, unknown>).hover = await contrastOn(page, [
      { name: "leave_word_hovered", selector: leave, at: [3, 12] },
    ]);
    (result as Record<string, unknown>).leave_hover_shot =
      await crop("leave-hover");

    // The transcript's error words, in the warning tone.
    await page.evaluate(() => {
      if (window.__HUDDLE_STAGE__) {
        window.__HUDDLE_STAGE__.failing = ["set_huddle_transcription_enabled"];
      }
    });
    await page.getByRole("button", { name: "Start transcript" }).click();
    const error = page.getByText(/Transcript failed/);
    await expect(error).toBeVisible();
    await page.mouse.move(700, 300);
    await page.waitForTimeout(250);
    (result.warning as Record<string, unknown>).transcript_error =
      await contrastOn(page, [
        {
          name: "transcript_error_words",
          selector: ".buzz-huddle-drawer.grid span.text-destructive",
          at: [2, 3],
        },
      ]);
    await page.evaluate(() => {
      if (window.__HUDDLE_STAGE__) window.__HUDDLE_STAGE__.failing = [];
    });
    await page.getByRole("button", { name: "Unmute microphone" }).click();
    await page.getByRole("button", { name: "Unmute agent speech" }).click();

    // The pairs: hovered on each half, and focused.
    const pairStyle = () =>
      page.evaluate((s) => {
        const pair = document.querySelector(s) as Element;
        const st = getComputedStyle(pair);
        return {
          pair_background: st.backgroundColor,
          pair_radius: st.borderRadius,
          pair_outline: `${st.outlineStyle} ${st.outlineWidth}`,
          halves: Array.from(pair.querySelectorAll(":scope > button")).map(
            (b) => ({
              label: b.getAttribute("aria-label"),
              background: getComputedStyle(b).backgroundColor,
              color: getComputedStyle(b).color,
              outline: getComputedStyle(b).outlineStyle,
            }),
          ),
        };
      }, micPair);
    await page.getByRole("button", { name: "Mute microphone" }).hover();
    await page.waitForTimeout(250);
    result.pair_hover_main = await pairStyle();
    result.pair_hover_main_shot = await crop("hover-mute-microphone");
    await page.getByRole("button", { name: "Audio settings" }).hover();
    await page.waitForTimeout(250);
    result.pair_hover_chevron = await pairStyle();
    result.pair_hover_chevron_shot = await crop("hover-audio-settings");
    await page.mouse.move(700, 300);
    await page.getByRole("button", { name: "Mute microphone" }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(250);
    result.pair_focus = await pairStyle();
    result.pair_focus_shot = await crop("focus-mute-microphone");
    await page.mouse.move(700, 300);
    out[palette] = result;
    await context.close();
  }
  writeFileSync(
    path.join(dir, "checks-fix-controls.json"),
    JSON.stringify(out, null, 2),
  );
  for (const palette of ["dark", "paper"]) {
    const r = out[palette] as {
      warning: {
        at_rest: { name: string; contrast: number }[];
        hover: { contrast: number }[];
        transcript_error: { contrast: number }[];
      };
      pair_hover_main: {
        pair_background: string;
        halves: { background: string }[];
      };
    };
    const rest = Object.fromEntries(
      r.warning.at_rest.map((x) => [x.name, x.contrast]),
    );
    expect
      .soft(rest.leave_word, `${palette} leave`)
      .toBeGreaterThanOrEqual(4.5);
    expect
      .soft(rest.muted_mic_icon, `${palette} mic`)
      .toBeGreaterThanOrEqual(3);
    expect
      .soft(rest.muted_speech_icon, `${palette} speech`)
      .toBeGreaterThanOrEqual(3);
    expect
      .soft(r.warning.hover[0].contrast, `${palette} leave hover`)
      .toBeGreaterThanOrEqual(4.5);
    expect
      .soft(r.warning.transcript_error[0].contrast, `${palette} error`)
      .toBeGreaterThanOrEqual(4.5);
    expect.soft(r.pair_hover_main.pair_background).not.toBe("rgba(0, 0, 0, 0)");
    for (const half of r.pair_hover_main.halves) {
      expect.soft(half.background).toBe("rgba(0, 0, 0, 0)");
    }
  }
});

test("the quick chat launcher rides the band", async ({ page }, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  const LAUNCHER = '[data-testid="quickchat-launcher"]';
  const out: Record<string, unknown> = {};
  await openApp(page, { frame: true });
  await openGeneral(page);
  const measure = () =>
    page.evaluate(
      ({ launcher, card }) => {
        const l = document.querySelector(launcher)?.getBoundingClientRect();
        const c = document.querySelector(card)?.getBoundingClientRect();
        return {
          launcher: l
            ? { left: l.left, top: l.top, right: l.right, bottom: l.bottom }
            : null,
          card_bottom: c?.bottom ?? null,
          card_right: c?.right ?? null,
          inside_corner:
            l && c
              ? {
                  bottom: Math.round((c.bottom - l.bottom) * 100) / 100,
                  right: Math.round((c.right - l.right) * 100) / 100,
                }
              : null,
        };
      },
      { launcher: LAUNCHER, card: CONVERSATION_CARD },
    );
  out.before_huddle_1440x900 = await measure();
  // Rise, traced: the launcher's bottom against the card's, every frame.
  await page.evaluate(
    ({ launcher, card }) => {
      const samples: number[][] = [];
      const w = window as unknown as {
        __QC__: number[][];
        __QC_DONE__: boolean;
      };
      w.__QC__ = samples;
      w.__QC_DONE__ = false;
      const start = performance.now();
      const step = () => {
        const l = document.querySelector(launcher)?.getBoundingClientRect();
        const c = document.querySelector(card)?.getBoundingClientRect();
        if (l && c) {
          samples.push([
            Math.round(performance.now() - start),
            Math.round(c.bottom * 10) / 10,
            Math.round(l.bottom * 10) / 10,
          ]);
        }
        const first = samples[0]?.[1];
        const moved = samples.find((s) => Math.abs(s[1] - first) > 0.05);
        if (moved && performance.now() - start - moved[0] > 1200) {
          w.__QC_DONE__ = true;
          return;
        }
        if (performance.now() - start > 20_000) {
          w.__QC_DONE__ = true;
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    { launcher: LAUNCHER, card: CONVERSATION_CARD },
  );
  await startHuddle(page);
  await page.waitForFunction(
    () => (window as unknown as { __QC_DONE__: boolean }).__QC_DONE__,
    undefined,
    { timeout: 30_000 },
  );
  const rise = await page.evaluate(
    () => (window as unknown as { __QC__: number[][] }).__QC__,
  );
  const moving = rise.filter((s) => s[1] > 856.5 && s[1] < 893.5);
  const gaps = rise.map((s) => Math.round((s[1] - s[2]) * 10) / 10);
  out.rise = {
    frames_in_motion: moving.length,
    gap_to_card_bottom: { min: Math.min(...gaps), max: Math.max(...gaps) },
    samples: rise.filter((_s, i) => i % 3 === 0).slice(0, 40),
  };
  await openGeneral(page);
  await page.mouse.move(700, 300);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 500 },
  ]) {
    const label = `${size.width}x${size.height}`;
    await page.setViewportSize(size);
    await page.waitForTimeout(800);
    out[`live_${label}`] = await measure();
    const file = path.join(dir, `fix-quickchat-launcher-live-${label}.png`);
    await settle(page);
    await page.screenshot({
      path: file,
      clip: {
        x: size.width - 300,
        y: size.height - 200,
        width: 300,
        height: 200,
      },
    });
    out[`live_${label}_shot`] = file;
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(800);
  // The open panel keeps its 20.
  await page.locator(LAUNCHER).click();
  const panel = page.getByTestId("quickchat-panel");
  await expect(panel).toBeVisible();
  await page.waitForTimeout(300);
  const p = (await box(page, '[data-testid="quickchat-panel"]')) as Box;
  out.panel_open = {
    bottom_gap: Math.round((900 - (p.y + p.h)) * 100) / 100,
    right_gap: Math.round((1440 - (p.x + p.w)) * 100) / 100,
  };
  await page.keyboard.press("Escape");
  if (await panel.isVisible()) {
    await page.getByRole("button", { name: "Minimize Quick Chat" }).click({
      timeout: 5_000,
    });
  }
  await expect(page.locator(LAUNCHER)).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(300);
  // Leave: it falls back to its 20.
  await page.getByRole("button", { name: "Leave huddle" }).click();
  await page.waitForTimeout(900);
  out.after_leave_1440x900 = await measure();
  // Reduce Motion: no in-between frames.
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  const t = await page.evaluate(
    (launcher) =>
      getComputedStyle(document.querySelector(launcher) as Element)
        .transitionProperty,
    LAUNCHER,
  );
  out.reduced_motion_transition = t;
  writeFileSync(
    path.join(dir, "checks-fix-quickchat.json"),
    JSON.stringify(out, null, 2),
  );
  for (const key of [
    "live_1440x900",
    "live_800x500",
    "before_huddle_1440x900",
    "after_leave_1440x900",
  ]) {
    const m = out[key] as { inside_corner: { bottom: number; right: number } };
    expect
      .soft(Math.abs(m.inside_corner.bottom - 14), key)
      .toBeLessThanOrEqual(0.6);
  }
  const g = (out.rise as { gap_to_card_bottom: { min: number; max: number } })
    .gap_to_card_bottom;
  expect.soft(Math.abs(g.min - 14)).toBeLessThanOrEqual(0.6);
  expect.soft(Math.abs(g.max - 14)).toBeLessThanOrEqual(0.6);
  expect.soft(String(out.reduced_motion_transition)).not.toContain("bottom");
});

test("what opens from the bar wears the page's materials", async ({
  browser,
}, info) => {
  test.setTimeout(300_000);
  const dir = shotsDir(info.outputPath());
  const out: Record<string, unknown> = {};
  const tooltip = (page: Page) =>
    page.evaluate(() => {
      const content = Array.from(
        document.querySelectorAll(
          "[data-radix-popper-content-wrapper] > [data-side]",
        ),
      ).find((e) => (e as HTMLElement).innerText.trim().length > 0);
      if (!content) return null;
      const s = getComputedStyle(content);
      const r = content.getBoundingClientRect();
      return {
        text: (content as HTMLElement).innerText.trim(),
        background: s.backgroundColor,
        color: s.color,
        height: Math.round(r.height * 10) / 10,
        box_shadow: s.boxShadow,
        border: `${s.borderTopWidth} ${s.borderTopStyle}`,
      };
    });
  for (const palette of ["dark", "paper"] as const) {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    if (palette === "paper") {
      await page.addInitScript(() =>
        window.localStorage.setItem("buzz-theme", "paper"),
      );
    }
    await openApp(page, {
      frame: true,
      scheme: palette === "paper" ? "light" : "dark",
    });
    await openGeneral(page);
    const result: Record<string, unknown> = {};
    // The frame's own tooltip, beside: the Settings place.
    await page.getByTestId("open-settings-view").hover();
    await page.waitForTimeout(900);
    result.places_tooltip = await tooltip(page);
    await page.mouse.move(700, 300);
    await page.waitForTimeout(400);

    // The first huddle's hint, in the page's popover.
    await startHuddle(page, { dismissHint: false });
    const hint = page.locator('[aria-label="Headphones recommended"]');
    await expect(hint).toBeVisible({ timeout: 3_000 });
    await page.waitForTimeout(400);
    result.hint = await contrastOn(page, [
      {
        name: "hint_title",
        selector: '[aria-label="Headphones recommended"] p.font-medium',
        at: [-6, 6],
      },
      {
        name: "hint_body",
        selector: '[aria-label="Headphones recommended"] p.text-ink-muted',
        at: [-6, 6],
      },
    ]);
    const hb = (await box(
      page,
      '[aria-label="Headphones recommended"]',
    )) as Box;
    const hintFile = path.join(dir, `fix-${palette}-first-huddle-hint.png`);
    await settle(page);
    await page.screenshot({
      path: hintFile,
      clip: {
        x: hb.x - 20,
        y: hb.y - 20,
        width: hb.w + 40,
        height: 900 - hb.y + 20,
      },
    });
    result.hint_shot = hintFile;
    await page.getByRole("button", { name: "Got it" }).click();
    await openGeneral(page);
    await page.mouse.move(700, 300);
    await page.waitForTimeout(500);

    // A bar control's tooltip.
    await page.getByRole("button", { name: "Add agent to huddle" }).hover();
    await page.waitForTimeout(900);
    result.bar_tooltip = await tooltip(page);
    const tipFile = path.join(dir, `fix-${palette}-bar-tooltip.png`);
    const bandBox = (await box(page, BAND)) as Box;
    await page.screenshot({
      path: tipFile,
      clip: {
        x: bandBox.x + 300,
        y: bandBox.y - 60,
        width: 600,
        height: bandBox.h + 66,
      },
    });
    result.bar_tooltip_shot = tipFile;
    await page.mouse.move(700, 300);
    await page.waitForTimeout(400);

    // The audio settings popover.
    await page.getByRole("button", { name: "Audio settings" }).click();
    const pop = "[data-radix-popper-content-wrapper] .buzz-huddle-popover";
    await expect(page.locator(pop)).toBeVisible();
    await page.waitForTimeout(300);
    result.audio_settings = {
      surface: await page.evaluate(
        (s) =>
          getComputedStyle(document.querySelector(s) as Element)
            .backgroundColor,
        pop,
      ),
      contrast: await contrastOn(page, [
        {
          name: "input_mode_label",
          selector: `${pop} span.text-xs.font-medium`,
          at: [-6, 6],
        },
        { name: "push_to_talk_shortcut", selector: `${pop} kbd`, at: [-14, 6] },
        {
          name: "volume_percent",
          selector: `${pop} span.text-muted-foreground`,
          at: [-30, 6],
        },
      ]),
    };
    const pb = (await box(page, pop)) as Box;
    const popFile = path.join(dir, `fix-${palette}-audio-settings-open.png`);
    await page.screenshot({
      path: popFile,
      clip: {
        x: pb.x - 20,
        y: pb.y - 20,
        width: pb.w + 40,
        height: 900 - pb.y + 20,
      },
    });
    result.audio_settings_shot = popFile;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // The participants.
    await page
      .getByRole("button", { name: /Show huddle participants/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Participants" }),
    ).toBeVisible();
    await page.waitForTimeout(300);
    const pp = "[data-radix-popper-content-wrapper] .buzz-huddle-popover";
    result.participants = await contrastOn(page, [
      { name: "count", selector: `${pp} h2 + span`, at: [-8, 6] },
      { name: "in_huddle", selector: `${pp} li .text-ink-faint`, at: [-50, 6] },
    ]);
    const ppb = (await box(page, pp)) as Box;
    const partFile = path.join(dir, `fix-${palette}-participants-open.png`);
    await page.screenshot({
      path: partFile,
      clip: {
        x: ppb.x - 20,
        y: ppb.y - 20,
        width: ppb.w + 40,
        height: 900 - ppb.y + 20,
      },
    });
    result.participants_shot = partFile;
    await page.keyboard.press("Escape");
    // The app's own popover surface, for comparison: the avatar's menu.
    out[palette] = result;
    await context.close();
  }
  writeFileSync(
    path.join(dir, "checks-fix-surfaces.json"),
    JSON.stringify(out, null, 2),
  );
  for (const palette of ["dark", "paper"]) {
    const r = out[palette] as Record<string, unknown>;
    const places = r.places_tooltip as {
      background: string;
      height: number;
      box_shadow: string;
    };
    const bar = r.bar_tooltip as {
      background: string;
      height: number;
      box_shadow: string;
    };
    expect
      .soft(bar.background, `${palette} tooltip fill`)
      .toBe(places.background);
    expect.soft(bar.height, `${palette} tooltip height`).toBe(places.height);
    expect.soft(bar.box_shadow, `${palette} tooltip shadow`).toBe("none");
    const all = [
      ...(r.hint as { name: string; contrast: number }[]),
      ...(
        r.audio_settings as { contrast: { name: string; contrast: number }[] }
      ).contrast,
      ...(r.participants as { name: string; contrast: number }[]),
    ];
    for (const c of all) {
      expect
        .soft(c.contrast, `${palette} ${c.name}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("with a huddle live a connected app's card ends where the cards do", async ({
  page,
}) => {
  // The runtime sessions column retired (SHELL_SPEC.md, "The rail"): a
  // connected app's sessions are its card, in Chats under Apps since WP-34,
  // on the one card (WP-12). With a huddle live it ends where the rail does,
  // 6 above the band, as the column's card did.
  test.setTimeout(120_000);
  await openApp(page, { frame: true });
  await openGeneral(page);
  await startHuddle(page);
  await page.evaluate(() => {
    window.location.hash = "#/apps/claude";
  });
  await expect(page.getByTestId("connected-app-card")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(900);
  const bottoms = await page.evaluate(() => ({
    one: document.querySelector("[data-luca-one-card]")?.getBoundingClientRect()
      .bottom,
    connected: document
      .querySelector('[data-testid="connected-app-card"]')
      ?.closest("[data-luca-floor-host]")
      ?.getBoundingClientRect().bottom,
    rail: document
      .querySelector('[data-frame] > [data-testid="app-sidebar"]')
      ?.getBoundingClientRect().bottom,
    band: document.querySelector(".luca-huddle-band")?.getBoundingClientRect()
      .top,
    column: document.querySelectorAll("[data-luca-runtime-card]").length,
  }));
  expect(bottoms.column).toBe(0);
  expect(Math.round(bottoms.one ?? 0)).toBe(Math.round(bottoms.rail ?? -1));
  // It lies on the one card (its host keeps the plane's point of room).
  expect(bottoms.connected ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    bottoms.one ?? 0,
  );
  expect(bottoms.connected ?? 0).toBeGreaterThan((bottoms.one ?? 0) - 2);
  expect(Math.round((bottoms.band ?? 0) - (bottoms.one ?? 0))).toBe(6);
});
