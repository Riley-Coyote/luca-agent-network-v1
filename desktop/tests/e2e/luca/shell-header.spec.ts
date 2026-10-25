import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import {
  installMockBridge,
  openCreateChannelDialog,
} from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * The conversation header dissolved into the lip (docs/luca/rail-system/
 * SHELL_BUILD.md, WP-04). Measures the lip's right-hand actions, the Join
 * button, a person's presence and the ephemeral badge against SHELL_SPEC.md,
 * the card's fixed top padding and its fade, the slot riding the card, and
 * the tab order; and proves the flag off draws the base build, by hash.
 *
 * SHELL_SHOTS: where the screenshots and checks go (else the test's output
 * folder). SHELL_BASE_URL: the base build for the flag-off comparison
 * (default http://127.0.0.1:4300); unreachable, it is reported as not run.
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
/** "design": an open channel the mock identity is not a member of. */
const DESIGN_CHANNEL_ID = "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e";

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

const CONVERSATION_CARD =
  '[data-testid="conversation-workspace-grid"] [data-luca-card]';
const SLOT = '[data-testid="shell-lip-actions"]';
/** The header's update indicator (UpdateIndicator.tsx): its button carries
 *  the pulsing dot, whatever its label says for the update's state. */
const UPDATE_INDICATOR = "button:has(> span.animate-pulse.rounded-full)";

/** Everything standing in the lip's right-hand slot, left to right. */
async function slotItems(page: Page) {
  return page.evaluate((slot) => {
    const element = document.querySelector(slot);
    if (!element) return [];
    return [...element.children].map((child) => {
      const r = child.getBoundingClientRect();
      const style = getComputedStyle(child);
      const svg = child.querySelector("svg");
      const svgStyle = svg ? getComputedStyle(svg) : null;
      return {
        name:
          child.getAttribute("aria-label") ??
          child.getAttribute("data-testid") ??
          child.className,
        testid: child.getAttribute("data-testid"),
        title: child.getAttribute("title"),
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        radius: style.borderTopLeftRadius,
        colour: style.color,
        icon: svgStyle
          ? {
              w: svg?.getBoundingClientRect().width,
              stroke: svgStyle.strokeWidth,
            }
          : null,
      };
    });
  }, SLOT);
}

/** An update downloaded and waiting: the mock's updater finds it when asked
 *  (Settings → Updates → Check for Updates), as sidebar.spec.ts does it. */
async function stageUpdate(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E__?: { mock?: Record<string, unknown> };
    };
    testWindow.__BUZZ_E2E__ = {
      ...(testWindow.__BUZZ_E2E__ ?? {}),
      mock: {
        ...(testWindow.__BUZZ_E2E__?.mock ?? {}),
        restartDelayMs: 500,
        updateAvailable: true,
      },
    };
  });
  await page.getByTestId("open-settings-view").click();
  await page.getByTestId("settings-nav-updates").click();
  // The updater may already have looked on its own; ask only if it hasn't.
  const check = page.getByRole("button", { name: "Check for Updates" });
  if (await check.isVisible()) await check.click();
  await expect(page.getByTestId("settings-panel-updates")).toContainText(
    "Update downloaded. Click to apply.",
  );
  // Settings in the frame has no "Back to app" (WP-05): Escape leaves it.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
}

/** Mock conversations the frame's tests open by route (the shell's rail groups
 *  chats by home, so their old rows aren't there to click). */
const CHANNEL_IDS = {
  "deep-history": "feedf00d-0000-4000-8000-000000000007",
  "bob-tyler": "7eb9f239-9393-50b0-bd76-d85eef0511c7",
  watercooler: "a27e1ee9-76a6-5bdf-a5d5-1d85610dad11",
} as const;

async function openChannel(page: Page, name: keyof typeof CHANNEL_IDS) {
  await expect(async () => {
    await page.evaluate((id) => {
      window.location.hash = `#/channels/${id}`;
    }, CHANNEL_IDS[name]);
    await expect(page.getByTestId("shell-lip-name")).toHaveText(name, {
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
}

/** The mock's #general, opened by its route: under the frame the rail groups
 *  chats by home (WP-02). Retried past a fresh page's own first redirect. */
const GENERAL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

async function openGeneral(page: Page) {
  await page.waitForSelector('[data-testid="app-sidebar"] [data-channel-id]', {
    timeout: 20_000,
  });
  await expect(async () => {
    await page.evaluate((id) => {
      window.location.hash = `#/channels/${id}`;
    }, GENERAL_ID);
    await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator(CONVERSATION_CARD).first()).toBeVisible({
    timeout: 20_000,
  });
}

async function openDesign(page: Page) {
  await page.evaluate((id) => {
    window.location.hash = `#/channels/${id}`;
  }, DESIGN_CHANNEL_ID);
  await expect(page.getByTestId("shell-lip-name")).toHaveText("design");
}

/** Closing the rail, every frame: the card's right edge against the last
 *  action's, and the slot's own right against the lip's part over the card. */
async function sampleSlotDuringSlide(page: Page, ms: number) {
  return page.evaluate(
    ({ ms, slot }) =>
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
          const last = q(slot).lastElementChild?.getBoundingClientRect();
          const lipCard = q(".luca-lip-card").getBoundingClientRect();
          samples.push([
            t,
            card.x,
            card.right,
            last ? card.right - last.right : -1,
            lipCard.x - card.x,
          ]);
          if (t < ms) requestAnimationFrame(step);
          else resolve(samples);
        };
        requestAnimationFrame(step);
      }),
    { ms, slot: SLOT },
  );
}

/** The fade under the card's top edge, read from the rendered pixels: the
 *  grey of a column where a message's text runs under the edge, at each
 *  point of the 22, against the card's own grey beside it. */
async function veilRamp(page: Page, card: Box) {
  const png = await page.screenshot();
  return page.evaluate(
    async ({ b64, card }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      const scale = bitmap.width / window.innerWidth;
      const rowMax = (y: number) => {
        const top = Math.round((card.y + y) * scale);
        const left = Math.round((card.x + 40) * scale);
        const width = Math.round((card.w - 80) * scale);
        const d = context.getImageData(left, top, width, 1).data;
        let max = 0;
        for (let i = 0; i < d.length; i += 4) {
          max = Math.max(max, (d[i] + d[i + 1] + d[i + 2]) / 3);
        }
        return Math.round(max);
      };
      return {
        brightest_at: Object.fromEntries(
          [1, 4, 8, 12, 16, 20, 24, 30, 40].map((y) => [y, rowMax(y)]),
        ),
      };
    },
    { b64: png.toString("base64"), card },
  );
}

test("the conversation header in the lip", async ({ page }, info) => {
  test.setTimeout(360_000);
  const dir = shotsDir(info.outputPath());
  const checks: Record<string, unknown> = {};
  const files: string[] = [];
  const W = 1440;

  await openApp(page, { frame: true });
  await expect(page.locator("html")).toHaveAttribute(
    "data-luca-frame",
    "solid",
    { timeout: 20_000 },
  );
  // An update is waiting, so the header would show its indicator.
  await stageUpdate(page);
  await openGeneral(page);
  await page.mouse.move(700, 500);
  files.push(await shot(page, dir, "channel"));

  // ── the actions in the lip ────────────────────────────────────────
  const card = await box(page, CONVERSATION_CARD);
  const items = await slotItems(page);
  const toggleColour = await page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector('[data-testid="shell-lip-toggle"]') as Element,
      ).color,
  );
  const last = items[items.length - 1];
  const names = items.map((item) => item.name);
  checks.actions_in_lip = {
    items,
    card_right: card ? card.x + card.w : null,
    right_inset: card && last ? card.x + card.w - (last.x + last.w) : null,
    in_card_header: await page.locator('[data-testid="chat-header"]').count(),
    ok:
      !!card &&
      !!last &&
      card.x + card.w - (last.x + last.w) === 8 &&
      names.join("|") ===
        "Choose conversation layout|Open as window|Open conversation details" &&
      items.every(
        (item) =>
          item.w === 24 &&
          item.h === 24 &&
          item.y === 10 &&
          item.radius === "7px" &&
          item.colour === toggleColour &&
          item.icon?.w === 15 &&
          item.icon.stroke === "1.7px" &&
          !!item.title,
      ) &&
      (await page.locator('[data-testid="chat-header"]').count()) === 0,
  };

  // Hover plate and focus ring on a lip action.
  const details = page.getByTestId("shell-lip-details");
  await details.hover();
  await page.waitForTimeout(200);
  const hover = await details.evaluate((el) => getComputedStyle(el).background);
  await page.mouse.move(700, 500);
  await details.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const focus = await details.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      focused: document.activeElement === el,
      outline: `${style.outlineStyle} ${style.outlineWidth}`,
    };
  });
  checks.actions_states = {
    hover_background: hover,
    focus,
    ok:
      hover.includes("rgba") &&
      focus.focused &&
      focus.outline.startsWith("solid 1px"),
  };
  (checks.actions_in_lip as { ok: boolean }).ok &&= (
    checks.actions_states as { ok: boolean }
  ).ok;

  // ── the update indicator is not drawn ─────────────────────────────
  // The update is waiting (the rail's own update card says so), yet no
  // indicator is drawn anywhere.
  const indicators = await page.locator(UPDATE_INDICATOR).count();
  checks.update_indicator_hidden = {
    count: indicators,
    ok: indicators === 0,
  };

  // ── the reading area's top padding is fixed at 22 ────────────────
  const padding = await page.evaluate(() => {
    const viewport = document.querySelector("[data-luca-timeline-viewport]");
    const list =
      viewport?.querySelector<HTMLElement>("[data-buzz-conversation-scroll]") ??
      viewport?.querySelector<HTMLElement>(".overflow-y-auto") ??
      null;
    const content = viewport?.querySelector<HTMLElement>(
      ".flex.w-full.flex-col.gap-2",
    );
    const variable = getComputedStyle(
      (viewport as HTMLElement) ?? document.body,
    )
      .getPropertyValue("--buzz-channel-content-top-padding")
      .trim();
    return {
      variable,
      list_padding_top: list ? getComputedStyle(list).paddingTop : null,
      content_padding_top: content
        ? getComputedStyle(content).paddingTop
        : null,
    };
  });
  checks.top_padding = {
    ...padding,
    ok:
      padding.variable === "22px" &&
      (padding.list_padding_top === "22px" ||
        padding.content_padding_top === "22px"),
  };

  // ── the fade under the card's top edge ────────────────────────────
  const veil = await page.evaluate(() => {
    const element = document.querySelector(".luca-shell-veil-top");
    const cardElement = document.querySelector(
      '[data-testid="conversation-workspace-grid"] [data-luca-card]',
    );
    if (!element || !cardElement) return null;
    const r = element.getBoundingClientRect();
    const c = cardElement.getBoundingClientRect();
    const style = getComputedStyle(element);
    // Measured from the card's padding box: its edge (a border of 1) is the
    // card's own and stays drawn above the fade.
    const edge = (cardElement as HTMLElement).clientTop;
    return {
      card_border: edge,
      top_from_card: r.y - c.y - edge,
      height: r.height,
      width_vs_card: r.width - (cardElement as HTMLElement).clientWidth,
      mask: style.maskImage || style.webkitMaskImage,
      background: style.backgroundColor,
    };
  });

  // ── tab order: the lip's left cluster, its actions, then the places ─
  await page.getByTestId("shell-lip-toggle").focus();
  const order: string[] = [];
  for (let step = 0; step < 8; step += 1) {
    order.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return "none";
        const where = element.closest('[data-testid="shell-lip-actions"]')
          ? "lip-actions"
          : element.closest('[data-testid="shell-lip"]')
            ? "lip"
            : element.closest('[data-testid="shell-places"]')
              ? "places"
              : "other";
        return `${where}:${element.getAttribute("aria-label") ?? element.tagName}`;
      }),
    );
    await page.keyboard.press("Tab");
  }
  const regions = order
    .map((entry) => entry.split(":")[0])
    .filter((region, index, all) => region !== all[index - 1]);
  checks.tab_order = {
    order,
    regions,
    ok: regions.slice(0, 3).join(",") === "lip,lip-actions,places",
  };

  // ── scrolled: messages fading under the card's top edge ───────────
  // A conversation long enough to scroll.
  await openChannel(page, "deep-history");
  await page.waitForTimeout(1200);
  const scrolledBy = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(
      '[data-luca-timeline-viewport] [data-buzz-conversation-scroll="true"], [data-luca-timeline-viewport] .overflow-y-auto',
    );
    if (!scroller) return null;
    // Put a line of text across the card's top edge.
    // Scroll up a screen, then put a line of message text across the
    // card's top edge, its top 6 above it.
    scroller.scrollTop = Math.max(0, scroller.scrollTop - 400);
    const top = scroller.getBoundingClientRect().top;
    const texts = [...scroller.querySelectorAll<HTMLElement>("p")].filter(
      (text) =>
        text.textContent?.trim() &&
        text.getBoundingClientRect().top - top > 80 &&
        !text.closest('[data-testid="message-timeline-day-divider"]'),
    );
    const target = texts[0];
    if (target) {
      scroller.scrollTop += target.getBoundingClientRect().top - top + 6;
    }
    return scroller.scrollTop;
  });
  await page.mouse.move(700, 500);
  await page.waitForTimeout(300);
  files.push(await shot(page, dir, "scrolled"));
  const ramp = card ? await veilRamp(page, card) : null;
  // The day's labels near the top edge (information: a label held by its
  // day parks at 22, below the fade; one leaving with its day fades out).
  const dayPill = await page.evaluate(() => {
    const cardElement = document.querySelector(
      '[data-testid="conversation-workspace-grid"] [data-luca-card]',
    );
    const pills = [
      ...document.querySelectorAll(
        '[data-testid="message-timeline-day-divider"] > p',
      ),
    ];
    if (!cardElement) return null;
    const top = cardElement.getBoundingClientRect().top;
    const parked = pills
      .map((pill) => pill.getBoundingClientRect().top - top)
      .filter((offset) => offset >= 0 && offset < 60);
    return { parked_offsets: parked };
  });
  const rampValues = ramp ? Object.values(ramp.brightest_at) : [];
  checks.veil_fade = {
    veil,
    scrolled_to: scrolledBy,
    ramp,
    day_pill: dayPill,
    ok:
      !!veil &&
      // The veil starts at the card's content box, a point inside its edge,
      // where the card's grain is laid too, so the two register (WP-01b).
      veil.top_from_card <= 1 &&
      veil.height === 22 &&
      Math.abs(veil.width_vs_card) <= 2 &&
      /linear-gradient/.test(veil.mask) &&
      rampValues.length > 0 &&
      // A line of text across the edge: darkest at the edge, brightening
      // through the fade (the line's own height decides how deep it runs,
      // so only its first rows are compared).
      (ramp?.brightest_at[1] ?? 255) < (ramp?.brightest_at[4] ?? 0) &&
      (ramp?.brightest_at[4] ?? 255) < (ramp?.brightest_at[8] ?? 0),
  };

  // ── details-open: the right card, opened from the lip ────────────
  await openGeneral(page);
  await page.getByTestId("shell-lip-details").click();
  const rightCards = page.locator("[data-luca-right-cards] [data-luca-card]");
  await expect(rightCards.first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.mouse.move(700, 500);
  files.push(await shot(page, dir, "details-open"));
  const cardWithRight = await box(page, CONVERSATION_CARD);
  const itemsWithRight = await slotItems(page);
  const lastWithRight = itemsWithRight[itemsWithRight.length - 1];
  checks.details_open = {
    right_card: await box(page, "[data-luca-right-cards] [data-luca-card]"),
    right_inset:
      cardWithRight && lastWithRight
        ? cardWithRight.x +
          cardWithRight.w -
          (lastWithRight.x + lastWithRight.w)
        : null,
    ok:
      !!cardWithRight &&
      !!lastWithRight &&
      cardWithRight.x +
        cardWithRight.w -
        (lastWithRight.x + lastWithRight.w) ===
        8,
  };
  await page.getByTestId("shell-lip-details").click();
  await expect(rightCards).toHaveCount(0);
  await page.waitForTimeout(500);

  // ── rail-closed: the slot follows the card, every frame ───────────
  const samples = await sampleSlotDuringSlide(page, 600);
  await page.waitForTimeout(200);
  await page.mouse.move(700, 500);
  files.push(await shot(page, dir, "rail-closed"));
  const closedCard = await box(page, CONVERSATION_CARD);
  const closedItems = await slotItems(page);
  const closedLast = closedItems[closedItems.length - 1];
  // Still pressable with the rail closed: open the details and close them.
  await page.getByTestId("shell-lip-details").click();
  const clickableClosed = await rightCards
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  await page.getByTestId("shell-lip-details").click();
  await expect(rightCards).toHaveCount(0);
  await page.waitForTimeout(500);
  // Opening again, every frame.
  const opening = await sampleSlotDuringSlide(page, 600);
  await page.waitForTimeout(200);
  const insets = [...samples, ...opening].map(([, , , inset]) => inset);
  checks.slot_follows_card = {
    frames: { closing: samples.length, opening: opening.length },
    card_left_range: [
      Math.min(...samples.map(([, x]) => x)),
      Math.max(...samples.map(([, x]) => x)),
    ],
    right_inset_range: [Math.min(...insets), Math.max(...insets)],
    lip_part_vs_card_left_max: Math.max(
      ...[...samples, ...opening].map(([, , , , d]) => Math.abs(d)),
    ),
    closed: {
      card_left: closedCard?.x ?? null,
      right_inset:
        closedCard && closedLast
          ? closedCard.x + closedCard.w - (closedLast.x + closedLast.w)
          : null,
    },
    clickable_rail_closed: clickableClosed,
    ok:
      // Frames sampled across the close and the open (fewer on a busy
      // machine; every one must hold the 8).
      samples.length + opening.length >= 8 &&
      insets.every((inset) => inset === 8) &&
      closedCard?.x === 44 &&
      clickableClosed,
  };

  // ── dm: a person's presence, just before the actions ─────────────
  // bob-tyler: a person (alice is a resident, whose DM shows no presence).
  await openChannel(page, "bob-tyler");
  await page.mouse.move(700, 500);
  await page.waitForTimeout(400);
  files.push(await shot(page, dir, "dm"));
  const dmItems = await slotItems(page);
  const avatar = await box(
    page,
    `${SLOT} [data-testid="chat-header-dm-avatar"]`,
  );
  const presence = await page
    .locator(`${SLOT} [data-testid="chat-presence-badge"]`)
    .getAttribute("aria-label")
    .catch(() => null);

  // ── ephemeral: the badge, just before the actions ─────────────────
  const ephemeralName = `ephemeral-${Date.now()}`;
  await openCreateChannelDialog(page);
  await page.getByTestId("create-channel-name").fill(ephemeralName);
  await page.getByRole("button", { name: "Channel duration: Ongoing" }).click();
  await page
    .getByLabel("Ephemeral - auto-archives after 7 days of inactivity")
    .click();
  await page.getByTestId("create-channel-submit").click();
  await expect(page.getByTestId("shell-lip-name")).toContainText(ephemeralName);
  await page.mouse.move(700, 500);
  await page.waitForTimeout(400);
  files.push(await shot(page, dir, "ephemeral"));
  const ephemeralItems = await slotItems(page);
  const badge = await page.evaluate((slot) => {
    const element = document.querySelector(
      `${slot} [data-testid="chat-ephemeral-badge"]`,
    );
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return {
      label: element.getAttribute("aria-label"),
      w: r.width,
      y: r.y + r.height / 2,
    };
  }, SLOT);
  checks.presence_and_badge = {
    dm: {
      items: dmItems.map((item) => [item.name, item.x, item.w]),
      avatar,
      presence,
    },
    ephemeral: {
      items: ephemeralItems.map((item) => [item.name, item.x, item.w]),
      badge,
    },
    ok:
      !!avatar &&
      avatar.w === 22 &&
      avatar.y + avatar.h / 2 === 22 &&
      dmItems[0]?.name === "luca-lip-presence" &&
      dmItems[1]?.name === "Choose conversation layout" &&
      !!presence &&
      !!badge &&
      badge.w === 15 &&
      badge.y === 22 &&
      ephemeralItems[0]?.name === "luca-lip-glyph" &&
      ephemeralItems[1]?.name === "Choose conversation layout",
  };

  // ── not-joined: Join takes the actions' place ─────────────────────
  await openDesign(page);
  await page.mouse.move(700, 500);
  await page.waitForTimeout(400);
  files.push(await shot(page, dir, "not-joined"));
  const joinItems = await slotItems(page);
  const joinCard = await box(page, CONVERSATION_CARD);
  const join = joinItems[joinItems.length - 1];
  const joinFont = await page
    .getByTestId("shell-lip-join")
    .evaluate((el) => getComputedStyle(el.querySelector("span") ?? el).fontSize)
    .catch(() => null);
  checks.join_in_lip = {
    items: joinItems.map((item) => [item.name, item.x, item.w, item.h]),
    join_font: joinFont,
    right_inset:
      joinCard && join ? joinCard.x + joinCard.w - (join.x + join.w) : null,
    ok:
      joinItems.length === 1 &&
      join?.testid === "shell-lip-join" &&
      join.h === 24 &&
      join.y === 10 &&
      joinFont === "13px" &&
      !!joinCard &&
      joinCard.x + joinCard.w - (join.x + join.w) === 8,
  };
  // Join works from the lip; the actions return in its place.
  await page.getByTestId("shell-lip-join").click();
  await expect(page.getByTestId("shell-lip-details")).toBeVisible();
  (checks.join_in_lip as Record<string, unknown>).joined_then_actions = true;

  // ── the forum keeps its own header; a project room keeps its picker ─
  await openChannel(page, "watercooler");
  await page.mouse.move(700, 500);
  await page.waitForTimeout(500);
  files.push(await shot(page, dir, "forum"));
  const forum = {
    in_card_header: await page.locator('[data-testid="chat-header"]').count(),
    lip_slot_items: (await slotItems(page)).length,
    update_indicator: await page.locator(UPDATE_INDICATOR).count(),
  };
  checks.room_picker_modes = {
    forum,
    project_room:
      "Not exercised here: the mock has no project room. In code, under the flag a project room keeps its room picker in a header of its own in the card (WP-02's room setting has not landed), with its actions in the lip and its measured top padding.",
    ok:
      forum.in_card_header === 1 &&
      forum.lip_slot_items === 0 &&
      forum.update_indicator === 0,
  };

  // ── the smallest window ───────────────────────────────────────────
  const small: Record<string, unknown> = {};
  await page.setViewportSize({ width: 800, height: 500 });
  await openGeneral(page);
  await page.waitForTimeout(500);
  await page.mouse.move(400, 300);
  files.push(await shot(page, dir, "channel-800"));
  const smallCard = await box(page, CONVERSATION_CARD);
  const smallItems = await slotItems(page);
  const smallName = await box(page, '[data-testid="shell-lip-name"]');
  const smallLast = smallItems[smallItems.length - 1];
  small.channel = {
    card: smallCard,
    right_inset:
      smallCard && smallLast
        ? smallCard.x + smallCard.w - (smallLast.x + smallLast.w)
        : null,
    name_right: smallName ? smallName.x + smallName.w : null,
    first_action_left: smallItems[0]?.x ?? null,
    ok:
      !!smallCard &&
      !!smallLast &&
      smallCard.x + smallCard.w - (smallLast.x + smallLast.w) === 8 &&
      !!smallName &&
      smallName.x + smallName.w <= (smallItems[0]?.x ?? 0),
  };
  // At this size the details take the conversation's card (the app's
  // single-panel view, as today). The lip is the frame, not the card: the
  // conversation's actions stay in it, Details showing it is open
  // (WP-04b), and the card's own close still returns the conversation.
  await page.getByTestId("shell-lip-details").click();
  await expect(
    page.getByRole("heading", { name: "Conversation", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page.mouse.move(400, 300);
  files.push(await shot(page, dir, "details-open-800"));
  const singlePanelSlot = await slotItems(page);
  const detailsExpanded = await page
    .getByTestId("shell-lip-details")
    .getAttribute("aria-expanded");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shell-lip-details")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  small.details_open = {
    slot_while_open: singlePanelSlot.length,
    details_expanded_while_open: detailsExpanded,
    actions_back_after_close: true,
    ok: singlePanelSlot.length === 3 && detailsExpanded === "true",
  };
  checks.smallest_window = small;
  void W;

  checks.screenshots = files.map((file) => ({ file, sha256: sha(file) }));
  const hashes = (checks.screenshots as { sha256: string }[]).map(
    (entry) => entry.sha256,
  );
  checks.unique_hashes = new Set(hashes).size === hashes.length;
  writeFileSync(
    path.join(dir, "checks-header.json"),
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
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!reachable, `base build not reachable at ${BASE_URL}`);

  const capture = async (origin: string, label: string) => {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    try {
      return await captureIn(context, origin, label);
    } finally {
      await context.close();
    }
  };
  const captureIn = async (
    context: BrowserContext,
    origin: string,
    label: string,
  ) => {
    await context.clock.install({ time: new Date("2026-10-24T18:30:00") });
    const page = await context.newPage();
    await openApp(page, { frame: false, origin });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    const shots: Record<string, string> = {};
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await page.mouse.move(1439, 899);
    shots.conversation = await shot(page, dir, `flag-off-channel${label}`);
    await page.getByTestId("channel-bob-tyler").click();
    await expect(page.getByTestId("chat-title")).toHaveText("bob-tyler");
    await page.mouse.move(1439, 899);
    await page.waitForTimeout(400);
    shots.dm = await shot(page, dir, `flag-off-dm${label}`);
    await page.evaluate((id) => {
      window.location.hash = `#/channels/${id}`;
    }, DESIGN_CHANNEL_ID);
    await expect(page.getByTestId("chat-title")).toHaveText("design");
    await page.mouse.move(1439, 899);
    await page.waitForTimeout(400);
    shots.not_joined = await shot(page, dir, `flag-off-not-joined${label}`);
    return shots;
  };

  // A plain static server under a busy machine can drop a request (a lazy
  // chunk then fails to load); a capture that stalls is taken again.
  const steady = async (origin: string, label: string) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await capture(origin, label);
      } catch (error) {
        if (attempt >= 3) throw error;
      }
    }
  };
  const ours = await steady(info.project.use.baseURL ?? "", "");
  const base = await steady(BASE_URL, "-base");
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(ours)) {
    result[key] = {
      ours: sha(ours[key]),
      base: sha(base[key]),
      identical: sha(ours[key]) === sha(base[key]),
    };
  }
  writeFileSync(
    path.join(dir, "checks-header-flag-off.json"),
    JSON.stringify({ flag_off_identical: result }, null, 2),
  );
  for (const key of Object.keys(result)) {
    expect
      .soft((result[key] as { identical: boolean }).identical, key)
      .toBe(true);
  }
});

test("the control: flag off, the header still draws its update", async ({
  page,
}, info) => {
  const dir = shotsDir(info.outputPath());
  await openApp(page, { frame: false });
  await stageUpdate(page);
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  const indicator = page.locator(
    `[data-testid="chat-header"] ${UPDATE_INDICATOR}`,
  );
  await expect(indicator).toBeVisible();
  writeFileSync(
    path.join(dir, "checks-header-update-control.json"),
    JSON.stringify(
      { flag_off_update_indicator: await indicator.count() },
      null,
      2,
    ),
  );
});
