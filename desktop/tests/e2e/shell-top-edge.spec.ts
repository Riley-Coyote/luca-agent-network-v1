import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { formatDayHeading } from "../../src/features/messages/lib/dateFormatters";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-29, the timeline's top edge (docs/luca/rail-system/SHELL_BUILD.md),
 * under `shell-frame`, in Chromium and WebKit: in a conversation that
 * scrolls, held at its newest message, the day you're reading stays stuck
 * just inside the card's top, below the lip, never under it; while the
 * companion's badge shows, the reading area starts below the badge, so no
 * message's words are under it, at rest or scrolled, and the stuck day sits
 * below it; the badge comes and goes with the newest message holding its
 * place. With the flag off, the room matches the integration base by hash.
 * Run in both engines from ~/.claude/plans/polyphonic-shell-build/
 * wp29-tools/pw.config.ts; the smoke project runs it in Chromium. Shots land
 * in WP29_SHOTS, measurements in WP29_SHOTS/measures.
 */

const SHOTS = process.env.WP29_SHOTS ?? "test-results/shell-top-edge";
const BASE_URL = process.env.WP29_BASE_URL ?? "http://127.0.0.1:4334";
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const LUCA = TEST_IDENTITIES.bob.pubkey;

type Mode = "dark" | "light";
type Frame = "black" | "liquid";

/** The study's skies behind the clear page (as WP-16's spec draws them), so
 *  Liquid Glass shows what lies behind its card. */
const SKIES = `
:root:root[data-luca-frame-glass].dark {
  background: linear-gradient(180deg, #16223f 0%, #2d3561 38%, #8c5a74 68%, #e19a6b 100%) !important;
}
:root:root[data-luca-frame-glass]:not(.dark) {
  background: linear-gradient(180deg, #8fb3d9 0%, #b9cfe6 40%, #e3dccf 75%, #f0d6b8 100%) !important;
}`;

const engine = () => {
  const name = test.info().project.name;
  return name === "smoke" ? "chromium" : name;
};

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${engine()}-${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** A shot, its hash, and how many colours it has (one colour proves
 *  nothing). Only small animated canvases (the eyes) are ever masked. */
async function shot(page: Page, name: string, maskEyes = false) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  const mask = [];
  if (maskEyes)
    for (const canvas of await page.locator("canvas").all()) {
      const box = await canvas.boundingBox();
      if (box && box.width < 200 && box.height < 200) mask.push(canvas);
    }
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${engine()}-${name}.png`;
  const png = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    mask,
    path,
  });
  const colours = await page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const g = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    g.drawImage(bmp, 0, 0);
    const data = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < data.length && seen.size < 64; i += 4 * 97)
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  }, png.toString("base64"));
  return {
    colours,
    hash: createHash("sha256").update(readFileSync(path)).digest("hex"),
    masked: mask.length,
    path,
  };
}

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 300_000 });

async function boot(
  page: Page,
  {
    baseURL,
    flag = true,
    frame = "black",
    log = [],
    mode = "dark",
  }: {
    baseURL?: string;
    flag?: boolean;
    frame?: Frame;
    log?: string[];
    mode?: Mode;
  } = {},
) {
  page.on("pageerror", (error) => log.push(`PAGE ERROR ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error")
      log.push(`console ${message.text().slice(0, 300)}`);
  });
  await page.emulateMedia({ colorScheme: mode });
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    {
      key: FEATURE_OVERRIDES_STORAGE_KEY,
      value: JSON.stringify({ "shell-frame": flag }),
    },
  );
  if (mode === "light")
    await page.addInitScript(() => {
      window.localStorage.setItem("buzz-theme", "paper");
      window.localStorage.setItem("buzz-follow-system", "false");
    });
  if (frame === "liquid")
    // Stands in for Tauri and PolyphonicGlass.swift (shell-one-card.spec.ts).
    await page.addInitScript(() => {
      const glass = window as typeof window & {
        __POLYPHONIC_NATIVE_GLASS__?: number;
        isTauri?: boolean;
        webkit?: unknown;
      };
      glass.isTauri = true;
      window.localStorage.setItem("polyphonic-frame", "glass");
      glass.webkit = {
        messageHandlers: { polyphonicGlass: { postMessage: () => {} } },
      };
      glass.__POLYPHONIC_NATIVE_GLASS__ = 1;
    });
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["general"],
        name: "Luca",
        pubkey: LUCA,
        status: "running",
      },
    ],
  } as never);
  await expect(async () => {
    await page.goto(`${baseURL ?? ""}/#/channels/${GENERAL}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 90_000 });
  if (frame === "liquid") {
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.documentElement.getAttribute("data-luca-frame-glass"),
          ),
        { timeout: 20_000 },
      )
      .toBe("liquid");
    await page.addStyleTag({ content: SKIES });
  }
}

/** Enough of today's words that the room scrolls at every size. */
async function fill(page: Page, count: number) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "general",
            }) ?? false,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  await page.evaluate((count) => {
    for (let i = 0; i < count; i++)
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: `Release note line ${i + 1}: what changed, and why it matters to the people reading it.`,
      });
  }, count);
}

/** The companion holding the app (as luca/shell-finish.spec.ts holds it):
 *  its request never settles until Stop. */
async function holdCompanion(page: Page, requestId: string) {
  await page.evaluate(() => {
    const state = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (c: string, a?: unknown, o?: unknown) => Promise<unknown>;
      };
      __wp29Held?: boolean;
    };
    if (state.__wp29Held) return;
    state.__wp29Held = true;
    // This geometry fixture deliberately holds Begin until Stop. Screenshots
    // can take longer than the real 15-second lease on a busy Mac. Extend only
    // that one fixture timer; companion-app-control.spec.ts checks the real
    // timeout separately. Restore setTimeout as soon as it is scheduled.
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = ((handler, delay, ...args) => {
      if (delay === 15_000) {
        window.setTimeout = schedule;
        return schedule(handler, 120_000, ...args);
      }
      return schedule(handler, delay, ...args);
    }) as typeof window.setTimeout;
    const invoke = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      if (command !== "resolve_polyphonic_app_control")
        return invoke(command, args, options);
      const input = args as { action: string; requestId: string };
      if (input.action === "begin") {
        await new Promise<void>(() => {});
        return "running";
      }
      window.setTimeout(() => {
        window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("polyphonic-app-control-ended", {
          requestId: input.requestId,
        });
      }, 50);
      return { complete: "completed", stop: "stopped", failed: "failed" }[
        input.action
      ];
    };
  });
  await page.evaluate(
    ({ agent, channel, id }) => {
      window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.(
        "polyphonic-native-surface-request",
        {
          agentPubkey: agent,
          controlRequestId: id,
          observerChannelId: channel,
          request: {
            channelId: channel,
            requestId: id,
            surface: "appearance",
            type: "polyphonic_surface_request",
          },
        },
      );
    },
    { agent: LUCA, channel: GENERAL, id: requestId },
  );
  await expect(page.getByTestId("app-control-badge")).toContainText(
    "Luca is using Polyphonic",
    { timeout: 20_000 },
  );
}

async function backToRoom(page: Page) {
  await expect(async () => {
    await page.evaluate((target) => {
      window.location.hash = `#/channels/${target}`;
    }, GENERAL);
    await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
      timeout: 3_000,
    });
  }).toPass({ timeout: 40_000 });
}

/** The top edge: the lip, the card, the day stuck at the top (whichever
 *  pill shows there), the badge, any words under the badge, the newest
 *  message. */
async function edge(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { bottom: r.bottom, left: r.left, right: r.right, top: r.top };
    };
    const lip = box(document.querySelector('[data-testid="shell-lip"]'));
    const card = box(document.querySelector("[data-luca-one-card]"));
    const scroller = document.querySelector<HTMLElement>(
      '[data-buzz-conversation-scroll="true"]',
    );
    const line = scroller
      ? scroller.getBoundingClientRect().top +
        scroller.clientTop +
        Number.parseFloat(getComputedStyle(scroller).paddingTop || "0")
      : null;
    // The pills drawn at the top line: the stand-in, or a day's own pill
    // parked there.
    const shown = (el: Element) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number.parseFloat(style.opacity) === 0
        )
          return false;
      }
      return true;
    };
    const candidates = [
      document.querySelector('[data-testid="message-timeline-stuck-day"] > p'),
      ...document.querySelectorAll(
        '[data-testid="message-timeline-day-divider"] > p',
      ),
    ].filter((el): el is Element => Boolean(el) && shown(el as Element));
    const stuck = candidates
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(
        ({ r }) =>
          line !== null &&
          r.height > 0 &&
          r.top >= line - 1.5 &&
          r.top <= line + 1.5,
      )
      .map(({ el, r }) => {
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return {
          box: { bottom: r.bottom, left: r.left, right: r.right, top: r.top },
          hit: hit
            ? `${hit.tagName.toLowerCase()}${hit.getAttribute("data-testid") ? `#${hit.getAttribute("data-testid")}` : ""}.${(hit.getAttribute("class") ?? "").slice(0, 50)}`
            : null,
          onTop: hit ? el.contains(hit) || hit === el : false,
          standIn: Boolean(
            el.closest('[data-testid="message-timeline-stuck-day"]'),
          ),
          text: (el.textContent ?? "").trim(),
        };
      });
    const badge = box(
      document.querySelector('[data-testid="app-control-badge"]'),
    );
    const covered: string[] = [];
    if (badge) {
      const root = document.querySelector(
        '[data-testid="conversation-workspace-grid"]',
      );
      const walker = document.createTreeWalker(
        root ?? document.body,
        NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const parent = node.parentElement;
        if (!text || !parent || !shown(parent)) continue;
        if (parent.closest('[data-testid="app-control-badge"]')) continue;
        // What of the words shows: clipped by every ancestor that clips
        // (a row scrolled out of the list keeps its boxes).
        let clip = {
          bottom: Infinity,
          left: -Infinity,
          right: Infinity,
          top: -Infinity,
        };
        for (let el: Element | null = parent; el; el = el.parentElement) {
          const style = getComputedStyle(el);
          if (style.overflowX === "visible" && style.overflowY === "visible")
            continue;
          const r = el.getBoundingClientRect();
          clip = {
            bottom: Math.min(clip.bottom, r.bottom),
            left: Math.max(clip.left, r.left),
            right: Math.min(clip.right, r.right),
            top: Math.max(clip.top, r.top),
          };
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const raw of range.getClientRects()) {
          const r = {
            bottom: Math.min(raw.bottom, clip.bottom),
            left: Math.max(raw.left, clip.left),
            right: Math.min(raw.right, clip.right),
            top: Math.max(raw.top, clip.top),
          };
          if (
            r.right > r.left &&
            r.bottom > r.top &&
            r.left < badge.right &&
            r.right > badge.left &&
            r.top < badge.bottom &&
            r.bottom > badge.top
          ) {
            covered.push(text.slice(0, 40));
            break;
          }
        }
      }
    }
    const rows = [
      ...document.querySelectorAll(
        '[data-luca-timeline-viewport] [data-testid="message-row"]',
      ),
    ];
    const newest = rows.reduce<Element | null>(
      (last, row) =>
        !last ||
        row.getBoundingClientRect().bottom > last.getBoundingClientRect().bottom
          ? row
          : last,
      null,
    );
    return {
      badge,
      card,
      covered,
      line,
      lip,
      newest: box(newest),
      scroll: scroller
        ? {
            fromBottom: Math.round(
              scroller.scrollHeight -
                scroller.scrollTop -
                scroller.clientHeight,
            ),
            top: Math.round(scroller.scrollTop),
          }
        : null,
      stuck,
    };
  });
}

type Edge = Awaited<ReturnType<typeof edge>>;

/** d1: one day stuck at the top, below the lip and inside the card, and
 *  nothing drawn over it. */
function expectStuck(each: Edge, below?: number) {
  if (!each.lip || !each.card) throw new Error("no lip or card");
  expect(each.stuck).toHaveLength(1);
  const [pill] = each.stuck;
  expect(pill.text.length).toBeGreaterThan(0);
  expect(pill.onTop).toBe(true);
  expect(pill.box.top).toBeGreaterThanOrEqual(each.lip.bottom);
  expect(pill.box.top).toBeGreaterThanOrEqual(each.card.top);
  if (below !== undefined) expect(pill.box.top).toBeGreaterThanOrEqual(below);
}

async function scrollUp(page: Page, by = 260) {
  const viewport = await page
    .locator("[data-luca-timeline-viewport]")
    .boundingBox();
  if (!viewport) throw new Error("no timeline");
  await page.mouse.move(
    viewport.x + viewport.width * 0.5,
    viewport.y + viewport.height * 0.45,
  );
  await page.mouse.wheel(0, -by);
  await page.waitForTimeout(900);
}

async function scrollToEnd(page: Page) {
  const viewport = await page
    .locator("[data-luca-timeline-viewport]")
    .boundingBox();
  if (!viewport) throw new Error("no timeline");
  await page.mouse.move(
    viewport.x + viewport.width * 0.5,
    viewport.y + viewport.height * 0.45,
  );
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(900);
}

/** The top edge in a conversation that scrolls, held at its newest message:
 *  at rest, scrolled, and with the companion's badge coming and going. */
async function topEdgeCase(
  page: Page,
  {
    frame,
    height,
    mode,
    width,
  }: { frame: Frame; height: number; mode: Mode; width: number },
) {
  const tag = `${frame === "liquid" ? "liquid-" : ""}${width}-${mode}`;
  const log: string[] = [];
  await page.setViewportSize({ width, height });
  await boot(page, { frame, log, mode });
  await fill(page, 24);
  await page.mouse.move(width - 10, 10);
  await page.waitForTimeout(1800);
  // d1, held at the newest message, then scrolled.
  const held = await edge(page);
  await shot(page, `held-${tag}`);
  await scrollUp(page);
  const scrolled = await edge(page);
  await shot(page, `scrolled-${tag}`);
  await scrollToEnd(page);
  const before = await edge(page);
  // d2, the companion holding the app.
  await holdCompanion(page, crypto.randomUUID());
  await backToRoom(page);
  await page.mouse.move(width - 10, height - 10);
  await page.waitForTimeout(1500);
  const badged = await edge(page);
  await shot(page, `badge-${tag}`);
  await scrollUp(page);
  const badgedScrolled = await edge(page);
  await shot(page, `badge-scrolled-${tag}`);
  await scrollToEnd(page);
  const badgedEnd = await edge(page);
  await page.getByRole("button", { name: "Stop app navigation" }).click();
  await expect(page.getByTestId("app-control-badge")).toHaveCount(0, {
    timeout: 10_000,
  });
  await page.waitForTimeout(900);
  const after = await edge(page);
  measure(`edge-${tag}`, {
    after,
    badged,
    badgedEnd,
    badgedScrolled,
    before,
    held,
    log,
    scrolled,
  });
  for (const each of [held, scrolled, before, after]) expectStuck(each);
  for (const each of [badged, badgedScrolled, badgedEnd]) {
    if (!each.badge) throw new Error("no badge");
    expect(each.covered).toEqual([]);
    expectStuck(each, each.badge.bottom);
  }
  // Held at the newest message: the badge comes and goes, it stays.
  for (const each of [held, before, badged, badgedEnd, after])
    expect(each.scroll?.fromBottom ?? 99).toBeLessThanOrEqual(2);
  expect(
    Math.abs((after.newest?.bottom ?? 0) - (badgedEnd.newest?.bottom ?? 1)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((before.newest?.bottom ?? 0) - (badged.newest?.bottom ?? 1)),
  ).toBeLessThanOrEqual(1);
  expect(log).toEqual([]);
}

for (const [width, height] of [
  [1440, 900],
  [800, 500],
] as const) {
  for (const mode of ["dark", "light"] as Mode[])
    test(`the top edge at ${width} ${mode}`, async ({ page }) =>
      topEdgeCase(page, { frame: "black", height, mode, width }));
  test(`the top edge under Liquid Glass at ${width}`, async ({ page }) =>
    topEdgeCase(page, { frame: "liquid", height, mode: "dark", width }));
}

// ── a room across older days ────────────────────────────────────────────
/** Five days of words: today and the four before, 25 each, tagged by day. */
async function fillDays(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "general",
            }) ?? false,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  const days: Record<string, number> = {};
  const messages: { content: string; createdAt: number }[] = [];
  for (let back = 4; back >= 0; back--) {
    const day = new Date();
    day.setDate(day.getDate() - back);
    day.setHours(back === 0 ? Math.min(day.getHours(), 9) : 10, 0, 0, 0);
    const at = Math.floor(day.getTime() / 1000);
    days[`d${back}`] = at;
    for (let i = 0; i < 25; i++)
      messages.push({
        content: `[d${back}] Note ${i + 1} from that day: what changed, and why it matters.`,
        createdAt: at + i * 60,
      });
  }
  await page.evaluate((messages) => {
    for (const message of messages)
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: message.content,
        createdAt: message.createdAt,
      } as never);
  }, messages);
  return Object.fromEntries(
    Object.entries(days).map(([key, at]) => [key, formatDayHeading(at)]),
  );
}

/** One stop: the first message read below the top line (its day tag), the
 *  pill(s) shown at the top, and any pill shown above the card's top. */
async function stop(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(
      '[data-buzz-conversation-scroll="true"]',
    );
    const card = document
      .querySelector("[data-luca-one-card]")
      ?.getBoundingClientRect();
    const lip = document
      .querySelector('[data-testid="shell-lip"]')
      ?.getBoundingClientRect();
    if (!scroller || !card || !lip) return null;
    const box = scroller.getBoundingClientRect();
    const line =
      box.top +
      scroller.clientTop +
      Number.parseFloat(getComputedStyle(scroller).paddingTop || "0");
    const shown = (el: Element) => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number.parseFloat(style.opacity) === 0
        )
          return false;
      }
      return true;
    };
    let first: { top: number; text: string } | null = null;
    for (const row of scroller.querySelectorAll<HTMLElement>(
      "[data-message-id]",
    )) {
      const r = row.getBoundingClientRect();
      if (r.height === 0 || r.bottom <= line + 1 || r.top >= box.bottom)
        continue;
      if (!first || r.top < first.top)
        first = { text: row.textContent ?? "", top: r.top };
    }
    const tag = first?.text.match(/\[(d\d)\]/)?.[1] ?? "d0";
    // What of a pill shows: clipped by every ancestor that clips (a row's
    // pill scrolled out keeps its box; the stand-in pushed up is cut at the
    // card's top).
    const visible = (el: Element) => {
      const raw = el.getBoundingClientRect();
      let top = raw.top;
      let bottom = raw.bottom;
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === "visible" && style.overflowY === "visible")
          continue;
        const r = node.getBoundingClientRect();
        top = Math.max(top, r.top);
        bottom = Math.min(bottom, r.bottom);
      }
      return { bottom, raw, top };
    };
    const pills = [
      document.querySelector('[data-testid="message-timeline-stuck-day"] > p'),
      ...scroller.querySelectorAll(
        '[data-testid="message-timeline-day-divider"] > p',
      ),
    ]
      .filter((el): el is Element => Boolean(el) && shown(el as Element))
      .map((el) => ({ el, ...visible(el) }))
      .filter((p) => p.bottom - p.top > 0.5)
      .map((p) => ({
        bottom: p.bottom,
        rawTop: p.raw.top,
        text: (p.el.textContent ?? "").trim(),
        top: p.top,
      }));
    // The stuck one: the lowest pill standing at or above the line.
    const atLine = pills
      .filter((p) => p.rawTop <= line + 1.5)
      .sort((a, b) => b.rawTop - a.rawTop);
    const stuck = atLine.slice(0, 1);
    const overlapping = pills.some((a, i) =>
      pills.some(
        (b, j) => j > i && a.top < b.bottom - 1 && b.top < a.bottom - 1,
      ),
    );
    return {
      cardTop: card.top,
      firstText: first?.text.slice(0, 40) ?? null,
      fromBottom: Math.round(
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
      ),
      lipBottom: lip.bottom,
      overlapping,
      stuck: stuck.map((p) => p.text),
      tag,
      top: Math.round(scroller.scrollTop),
      underLip: pills.filter((p) => p.top < card.top - 0.5).map((p) => p.text),
    };
  });
}

for (const [width, height] of [
  [1440, 900],
  [800, 500],
] as const) {
  test(`the stuck day across older days at ${width}`, async ({ page }) => {
    const log: string[] = [];
    await page.setViewportSize({ width, height });
    await boot(page, { log });
    const labels = await fillDays(page);
    await page.waitForTimeout(1800);
    const viewport = await page
      .locator("[data-luca-timeline-viewport]")
      .boundingBox();
    if (!viewport) throw new Error("no timeline");
    await page.mouse.move(
      viewport.x + viewport.width / 2,
      viewport.y + viewport.height * 0.5,
    );
    const step = Math.round(viewport.height * 0.6);
    const stops: NonNullable<Awaited<ReturnType<typeof stop>>>[] = [];
    const read = async () => {
      const each = await stop(page);
      if (!each) throw new Error("no room");
      stops.push(each);
      return each;
    };
    await read();
    // Back from the newest message to the top, then forward again.
    for (let i = 0; i < 80; i++) {
      await page.mouse.wheel(0, -step);
      await page.waitForTimeout(350);
      const each = await read();
      if (i === 6) await shot(page, `days-back-${width}`);
      if (each.top <= 1) {
        // Reaching the current page's top is not the end of history. Wait for
        // the asynchronous prepend (which preserves the visible row), or for
        // the oldest seeded day, before deciding that the backward pass ended.
        await expect
          .poll(
            async () => {
              const settled = await stop(page);
              return Boolean(
                settled && (settled.top > 1 || settled.tag === "d4"),
              );
            },
            { timeout: 10_000 },
          )
          .toBe(true);
        if ((await read()).top <= 1) break;
      }
    }
    await shot(page, `days-top-${width}`);
    for (let i = 0; i < 80; i++) {
      await page.mouse.wheel(0, step);
      await page.waitForTimeout(350);
      const each = await read();
      if (each.fromBottom <= 1) break;
    }
    measure(`days-${width}`, { labels, log, stops });
    const days = new Set(stops.map((each) => each.tag));
    expect(days.size).toBeGreaterThanOrEqual(4);
    expect(stops[stops.length - 1].fromBottom).toBeLessThanOrEqual(1);
    for (const each of stops) {
      // The day of the first message in view, stuck once, nothing under
      // the lip, no pill on another.
      expect(each.stuck, JSON.stringify(each)).toEqual([labels[each.tag]]);
      expect(each.underLip, JSON.stringify(each)).toEqual([]);
      expect(each.overlapping, JSON.stringify(each)).toBe(false);
    }
    expect(log).toEqual([]);
  });
}

// ── flag off: the room as the integration base draws it ─────────────────
test("flag off matches the base", async ({ page }) => {
  const out: Record<string, unknown> = {};
  const at = async (origin: string | undefined, width: number) => {
    await page.setViewportSize({ width, height: width === 800 ? 500 : 900 });
    await boot(page, { baseURL: origin, flag: false });
    await expect(
      page.getByTestId("message-timeline-day-divider").first(),
    ).toBeVisible({
      timeout: 20_000,
    });
    await page.mouse.move(width - 10, 10);
    await page.waitForTimeout(1500);
  };
  for (const width of [1440, 800]) {
    await at(BASE_URL, width);
    const base = await shot(page, `flagoff-room-${width}-base`, true);
    await at(undefined, width);
    const mine = await shot(page, `flagoff-room-${width}`, true);
    out[`room-${width}`] = { base, mine };
  }
  measure("flag-off", out);
  for (const width of [1440, 800]) {
    const each = out[`room-${width}`] as {
      base: { hash: string; colours: number };
      mine: { hash: string; colours: number };
    };
    expect(each.mine.colours).toBeGreaterThan(8);
    expect(each.mine.hash).toBe(each.base.hash);
  }
});
