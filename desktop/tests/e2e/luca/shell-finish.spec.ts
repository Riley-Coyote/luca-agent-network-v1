import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import { installHuddleStage } from "./shell-huddle-stage";

/**
 * The finishing list (docs/luca/rail-system/SHELL_BUILD.md, WP-09a): one
 * measurement or screenshot per decision, under the frame, and the views
 * the package touches compared by hash with the flag off against the base
 * build. Decision 15 (the window's first size) is Rust: its rule has a unit
 * test in src-tauri/src/lib.rs.
 *
 * SHELL_SHOTS: where the screenshots and checks go (else
 * test-results/shell-finish). SHELL_BASE_URL: the base build for the
 * flag-off hashes (default http://127.0.0.1:4300).
 */

const SHOTS = process.env.SHELL_SHOTS ?? "test-results/shell-finish";
const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
const GENERAL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
/** "design": an open channel the mock identity is not a member of. */
const DESIGN_ID = "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e";
/** "watercooler": a forum. */
const FORUM_ID = "a27e1ee9-76a6-5bdf-a5d5-1d85610dad11";
/** "Group DM (3)": an unnamed group chat with bob and charlie. */
const GROUP_ID = "d1ec7000-d000-4000-8000-000000000003";
const SELF = "deadbeef".repeat(8);
const CONNECT_ERROR = "relay unreachable: could not connect to relay";
const SLOT = '[data-testid="shell-lip-actions"]';
const BAR = ".buzz-huddle-drawer.grid";
const CARD = '[data-testid="conversation-workspace-grid"] [data-luca-card]';
const EMPTY_LIP = "No conversation";

type Mock = Parameters<typeof installMockBridge>[1];
type Box = { x: number; y: number; w: number; h: number };

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

function dir() {
  mkdirSync(SHOTS, { recursive: true });
  return SHOTS;
}

function record(name: string, value: unknown) {
  writeFileSync(
    path.join(dir(), `checks-${name}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/** Every warning and error a page logs, kept for the report. */
function watchConsole(page: Page, seen: string[]) {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      seen.push(`${message.type()}: ${message.text().slice(0, 240)}`);
    }
  });
  page.on("pageerror", (error) => seen.push(`pageerror: ${error.message}`));
}

async function openApp(
  page: Page,
  {
    frame = true,
    hash = "",
    huddle = false,
    light = false,
    mock = {},
    origin = "",
    size = { width: 1440, height: 900 },
    before,
  }: {
    frame?: boolean;
    hash?: string;
    huddle?: boolean;
    light?: boolean;
    mock?: Mock;
    origin?: string;
    size?: { width: number; height: number };
    before?: (page: Page) => Promise<void>;
  } = {},
) {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: light ? "light" : "dark" });
  if (before) await before(page);
  if (huddle) await installHuddleStage(page);
  await installMockBridge(page, mock);
  if (light) {
    await page.addInitScript(() => localStorage.setItem("buzz-theme", "paper"));
  }
  await page.addInitScript(
    ({ key, on }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = on;
      overrides["popout-chat-windows"] = true;
      localStorage.setItem(key, JSON.stringify(overrides));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: frame },
  );
  await page.goto(`${origin}/?e2e=mock${hash}`, { timeout: 30_000 });
  await page.waitForSelector('[data-testid="app-sidebar"]', {
    timeout: 30_000,
  });
}

/** Open a conversation by its route, retried past a fresh page's redirect. */
async function openRoute(page: Page, id: string, name: string | RegExp) {
  await expect(async () => {
    await page.evaluate((target) => {
      window.location.hash = `#/channels/${target}`;
    }, id);
    await expect(page.getByTestId("shell-lip-name")).toHaveText(name, {
      timeout: 3_000,
    });
  }).toPass({ timeout: 40_000 });
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

const files: string[] = [];
async function shot(page: Page, name: string, clip?: Box) {
  await settle(page);
  const file = path.join(dir(), `${name}.png`);
  await page.screenshot(
    clip
      ? {
          path: file,
          clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h },
        }
      : { path: file },
  );
  files.push(file);
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

/** The computed colour of `value` (a CSS colour) on the page's root. */
async function resolveColour(page: Page, value: string, host = "body") {
  return page.evaluate(
    ({ value, host }) => {
      const probe = document.createElement("div");
      probe.style.background = value;
      (document.querySelector(host) ?? document.body).appendChild(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    },
    { value, host },
  );
}

/** The page now takes focus as from the keyboard (`:focus-visible`). */
async function keyboardFocus(page: Page, selector: string) {
  await page.keyboard.press("Shift");
  await page.evaluate((s) => {
    (document.querySelector(s) as HTMLElement | null)?.focus();
  }, selector);
}

const LAYOUT_MENU = `${SLOT} [data-testid="workspace-layout-menu"]`;

// ── 1, 2, 4, 5: the lip ─────────────────────────────────────────────────
test("the lip: Join's fade, Details open, an empty pane, a group's initials", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const seen: string[] = [];
  watchConsole(page, seen);
  const checks: Record<string, unknown> = {};
  await openApp(page);
  const lipClip = { x: 900, y: 0, w: 540, h: 44 };

  // 1 · Join fades on the lip's 120 ms, its border's colour too.
  await openRoute(page, DESIGN_ID, "design");
  await expect(page.getByTestId("shell-lip-join")).toBeVisible();
  const join = await page.evaluate(() => {
    const element = document.querySelector(
      '[data-testid="shell-lip-join"]',
    ) as HTMLElement;
    const style = getComputedStyle(element);
    const lipButton = document.querySelector(
      ".luca-lip .luca-lip-button",
    ) as HTMLElement;
    return {
      properties: style.transitionProperty,
      durations: style.transitionDuration,
      lip_button: getComputedStyle(lipButton).transitionDuration,
    };
  });
  checks.join_fade = {
    ...join,
    ok:
      join.properties
        .split(",")
        .map((p) => p.trim())
        .includes("border-color") &&
      join.durations.split(",").every((d) => d.trim() === "0.12s"),
  };
  await page.mouse.move(1200, 600);
  await shot(page, "01-join", lipClip);

  // 2 · Details open wears the current place's plate.
  await openRoute(page, GENERAL_ID, "general");
  await page.getByTestId("shell-lip-details").click();
  await expect(page.getByTestId("shell-lip-details")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.mouse.move(1200, 600);
  await settle(page);
  const details = await page.evaluate(() => {
    const button = document.querySelector(
      '[data-testid="shell-lip-details"]',
    ) as HTMLElement;
    const mark = document.querySelector(
      '[data-testid="shell-places-marks"] > .luca-mark',
    ) as HTMLElement | null;
    const style = getComputedStyle(button);
    const markStyle = mark ? getComputedStyle(mark) : null;
    const closed = document.querySelector(
      '[data-testid="open-channel-popout"]',
    ) as HTMLElement | null;
    return {
      background: style.backgroundColor,
      shadow: style.boxShadow,
      place_plate: markStyle?.backgroundColor ?? null,
      place_shadow: markStyle?.boxShadow ?? null,
      closed_button_rest: closed
        ? getComputedStyle(closed).backgroundColor
        : null,
    };
  });
  // The hovered closed button, for the difference.
  await page.getByTestId("open-channel-popout").hover();
  await page.waitForTimeout(300);
  const hovered = await page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector(
          '[data-testid="open-channel-popout"]',
        ) as HTMLElement,
      ).backgroundColor,
  );
  checks.details_open = {
    ...details,
    hovered_closed_button: hovered,
    ok:
      details.background === details.place_plate &&
      details.shadow === details.place_shadow &&
      details.background !== hovered,
  };
  await shot(page, "02-details-open-beside-hovered", lipClip);
  await page.getByTestId("shell-lip-details").click();

  // 5 · A group conversation: its members' initials, no presence.
  await openRoute(page, GROUP_ID, /\+/);
  await page.mouse.move(1200, 600);
  const group = await page.evaluate((slot) => {
    const disc = document.querySelector(
      `${slot} [data-testid="shell-lip-group-initials"]`,
    );
    return {
      name: document.querySelector('[data-testid="shell-lip-name"]')
        ?.textContent,
      initials: disc?.textContent ?? null,
      disc: disc
        ? (() => {
            const r = disc.getBoundingClientRect();
            const s = getComputedStyle(disc);
            return { w: r.width, h: r.height, bg: s.backgroundColor };
          })()
        : null,
      presence_avatar: document.querySelectorAll(
        `${slot} [data-testid="chat-header-dm-avatar"]`,
      ).length,
      presence_dot: document.querySelectorAll(
        `${slot} [data-testid="chat-presence-badge"]`,
      ).length,
    };
  }, SLOT);
  checks.group_initials = {
    ...group,
    ok:
      group.initials === "BC" &&
      group.presence_avatar === 0 &&
      group.presence_dot === 0,
  };
  await shot(page, "05-group-initials", lipClip);
  // A one-to-one conversation keeps the person's presence.
  const bobDm = await page.evaluate(() => {
    const row = [...document.querySelectorAll("[data-channel-id]")].find(
      (element) => element.textContent?.trim() === "bob-tyler",
    );
    return row?.getAttribute("data-channel-id") ?? null;
  });
  if (bobDm) {
    await openRoute(page, bobDm, "bob-tyler");
    await page.mouse.move(1200, 600);
    (checks.group_initials as Record<string, unknown>).one_to_one_presence =
      await page.evaluate(
        (slot) =>
          document.querySelectorAll(
            `${slot} [data-testid="chat-header-dm-avatar"]`,
          ).length,
        SLOT,
      );
  }

  // 4 · An empty focused pane: the lip names it; the layout menu works.
  await openRoute(page, GENERAL_ID, "general");
  await page.getByTestId("workspace-layout-menu").click();
  await page.getByTestId("workspace-preset-columns-2").click();
  const pane = page.locator('[data-testid="workspace-pane-slot-2"]');
  await expect(pane).toBeVisible();
  await pane.click({ position: { x: 200, y: 300 } });
  await expect(pane).toHaveAttribute("data-focused", "true");
  await page.mouse.move(1200, 600);
  await settle(page);
  const empty = await page.evaluate((menu) => {
    const headings = [...document.querySelectorAll("h1")];
    const tile = document.querySelector(menu) as HTMLElement | null;
    const r = tile?.getBoundingClientRect();
    const hit = r
      ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      : null;
    const words = document.querySelector(".luca-lip-empty");
    const probe = document.createElement("div");
    probe.style.color = "var(--luca-frame-muted, hsl(var(--mn-ink-muted)))";
    document.body.appendChild(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    return {
      h1s: headings.map((h) => h.textContent),
      lip_colour: words ? getComputedStyle(words).color : null,
      frame_muted: muted,
      lip_weight: words ? getComputedStyle(words).fontWeight : null,
      pane_words: document
        .querySelector('[data-testid="workspace-pane-slot-2"]')
        ?.textContent?.trim(),
      menu_hit: Boolean(tile && hit && tile.contains(hit)),
    };
  }, LAYOUT_MENU);
  await shot(page, "04-empty-pane-named");
  await page.locator(LAYOUT_MENU).click();
  const menuOpened = await page
    .getByRole("menu")
    .isVisible()
    .catch(() => false);
  await shot(page, "04-empty-pane-layout-menu", {
    x: 900,
    y: 0,
    w: 540,
    h: 300,
  });
  await page.keyboard.press("Escape");
  // Back to one pane: the lip names the conversation again, once.
  await page.locator(LAYOUT_MENU).click();
  await page.getByTestId("workspace-preset-single").click();
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
    timeout: 10_000,
  });
  const after = await page.evaluate(
    () => document.querySelector('[data-testid="shell-lip-name"]')?.textContent,
  );
  checks.empty_pane = {
    ...empty,
    menu_opened: menuOpened,
    after_single: after,
    ok:
      empty.h1s.length === 1 &&
      empty.h1s[0] === EMPTY_LIP &&
      empty.lip_colour === empty.frame_muted &&
      empty.lip_weight === "450" &&
      empty.pane_words === "Choose a conversation from the sidebar." &&
      empty.menu_hit &&
      menuOpened &&
      after === "general",
  };
  checks.console = seen;
  record("lip", checks);
  for (const key of [
    "join_fade",
    "details_open",
    "group_initials",
    "empty_pane",
  ]) {
    expect.soft((checks[key] as { ok: boolean }).ok, key).toBe(true);
  }
});

// ── 3, 11: a forum's top, the day divider ───────────────────────────────
test("a forum's first content and a conversation's sit 22 down; no rule under the day", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seen: string[] = [];
  watchConsole(page, seen);
  const checks: Record<string, unknown> = {};
  await openApp(page);
  await openRoute(page, GENERAL_ID, "general");
  await page.mouse.move(1200, 600);
  await expect(
    page.getByTestId("message-timeline-day-divider").first(),
  ).toBeVisible({ timeout: 15_000 });
  await settle(page);
  const conversation = await page.evaluate((card) => {
    const pane = document.querySelector(card)?.getBoundingClientRect();
    const pill = document
      .querySelector('[data-testid="message-timeline-day-divider"] > p')
      ?.getBoundingClientRect();
    const group = document.querySelector(
      '[data-testid="message-timeline-day-group"]',
    );
    const rule = group ? getComputedStyle(group, "::before") : null;
    return {
      pane_top: pane?.top ?? null,
      first_content_from_pane: pane && pill ? pill.top - pane.top : null,
      rule_display: rule?.display ?? null,
      rule_content: rule?.content ?? null,
    };
  }, CARD);
  checks.day_divider = {
    ...conversation,
    ok: conversation.rule_display === "none",
  };
  const pill = await box(
    page,
    '[data-testid="message-timeline-day-divider"] > p',
  );
  if (pill) {
    await shot(page, "11-day-divider", {
      x: pill.x - 420,
      y: pill.y - 20,
      w: pill.w + 840,
      h: pill.h + 60,
    });
  }

  await openRoute(page, FORUM_ID, "watercooler");
  await page.mouse.move(1200, 600);
  await expect(
    page.locator(
      'section[aria-label="Forum posts"] [data-forum-composer-band]',
    ),
  ).toBeVisible({ timeout: 15_000 });
  await settle(page);
  const forum = await page.evaluate((card) => {
    const pane = document.querySelector(card)?.getBoundingClientRect();
    const first = document
      .querySelector("[data-forum-composer-band] > *")
      ?.getBoundingClientRect();
    return {
      first_content_from_pane: pane && first ? first.top - pane.top : null,
    };
  }, CARD);
  checks.forum_top = {
    forum: forum.first_content_from_pane,
    conversation: conversation.first_content_from_pane,
    ok:
      forum.first_content_from_pane !== null &&
      conversation.first_content_from_pane !== null &&
      Math.abs(
        forum.first_content_from_pane - conversation.first_content_from_pane,
      ) <= 0.5,
  };
  await shot(page, "03-forum-top", { x: 260, y: 30, w: 1180, h: 160 });
  checks.console = seen;
  record("content", checks);
  for (const key of ["day_divider", "forum_top"]) {
    expect.soft((checks[key] as { ok: boolean }).ok, key).toBe(true);
  }
});

// ── 6, 8: the status cards ──────────────────────────────────────────────
async function setRelay(page: Page, state: string, wait = true) {
  if (wait) {
    await page.waitForFunction(
      () =>
        (
          window as Window & {
            __BUZZ_E2E_GET_RELAY_CONNECTION_STATE__?: () => string;
          }
        ).__BUZZ_E2E_GET_RELAY_CONNECTION_STATE__?.() === "connected",
      undefined,
      { timeout: 20_000 },
    );
  }
  await page.evaluate((next) => {
    (
      window as Window & {
        __BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?: (s: string) => void;
      }
    ).__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.(next);
  }, state);
}

test("the status cards: the dismiss buttons' focus, a success card on its plate", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const seen: string[] = [];
  watchConsole(page, seen);
  const checks: Record<string, unknown> = {};
  await openApp(page, {
    mock: { channelsReadError: CONNECT_ERROR, updateAvailable: true },
  });
  await setRelay(page, "disconnected");
  await expect(page.getByTestId("sidebar-relay-unreachable")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("sidebar-update-card")).toBeVisible({
    timeout: 20_000,
  });
  await page.mouse.move(1000, 500);
  const rail = await box(
    page,
    '[data-testid="app-sidebar"] [data-sidebar="sidebar"]',
  );
  const focused: Record<string, unknown> = {};
  for (const id of [
    "sidebar-update-dismiss",
    "sidebar-relay-unreachable-dismiss",
  ]) {
    const selector = `[data-testid="${id}"]`;
    if ((await page.locator(selector).count()) === 0) {
      focused[id] = "absent";
      continue;
    }
    await keyboardFocus(page, selector);
    await settle(page);
    focused[id] = await page.evaluate((s) => {
      const button = document.querySelector(s) as HTMLElement;
      const face = button.querySelector("span") as HTMLElement;
      const style = getComputedStyle(face);
      return {
        focus_visible: button.matches(":focus-visible"),
        outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
        offset: style.outlineOffset,
        face_opacity: style.opacity,
      };
    }, selector);
    if (rail) {
      await shot(page, `06-${id}-focused`, {
        x: rail.x - 8,
        y: rail.y + rail.h - 200,
        w: rail.w + 16,
        h: 208,
      });
    }
  }
  const ring = (value: unknown) =>
    typeof value === "object" &&
    value !== null &&
    (value as { focus_visible: boolean }).focus_visible &&
    (value as { outline: string }).outline.startsWith("1px solid") &&
    (value as { offset: string }).offset === "-1px" &&
    (value as { face_opacity: string }).face_opacity === "1";
  const present = Object.values(focused).filter((v) => v !== "absent");
  checks.dismiss_focus = {
    ...focused,
    ok: present.length === 2 && present.every(ring),
  };

  // 8 · Back: "Connected", the success tone, on the card's own plate.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await setRelay(page, "connected", false);
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E__?: { mock?: { channelsReadError?: string } };
    };
    delete testWindow.__BUZZ_E2E__?.mock?.channelsReadError;
  });
  await expect(page.getByTestId("sidebar-relay-unreachable")).toContainText(
    "Connected",
    { timeout: 15_000 },
  );
  await page.mouse.move(1000, 500);
  await settle(page);
  const plate = await resolveColour(
    page,
    "var(--mn-plate)",
    '[data-testid="app-sidebar"] [data-sidebar="sidebar"]',
  );
  const green = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--status-added)";
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  const success = await page.evaluate(() => {
    const face = document.querySelector(
      '[data-testid="sidebar-relay-unreachable"] > button',
    ) as HTMLElement;
    const icon = face.querySelector(
      ".buzz-sidebar-action-card__success-icon",
    ) as HTMLElement | null;
    const style = getComputedStyle(face);
    return {
      success_tone: face.classList.contains(
        "buzz-sidebar-action-card--success",
      ),
      background: style.backgroundColor,
      border: style.borderTopColor,
      border_width: style.borderTopWidth,
      icon: icon ? getComputedStyle(icon).color : null,
    };
  });
  checks.success_card = {
    ...success,
    plate,
    green,
    ok:
      success.success_tone &&
      success.background === plate &&
      (success.border === "rgba(0, 0, 0, 0)" ||
        success.border_width === "0px") &&
      success.icon === green,
  };
  if (rail) {
    await shot(page, "08-success-card", {
      x: rail.x - 8,
      y: rail.y + rail.h - 140,
      w: rail.w + 16,
      h: 148,
    });
  }
  checks.console = seen;
  record("status", checks);
  for (const key of ["dismiss_focus", "success_card"]) {
    expect.soft((checks[key] as { ok: boolean }).ok, key).toBe(true);
  }
});

// ── 9, 10: Settings ─────────────────────────────────────────────────────
test("Settings: the theme tiles' focus, a moved accent, the sliding mark", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const seen: string[] = [];
  watchConsole(page, seen);
  const checks: Record<string, unknown> = {};
  await openApp(page);
  await page.getByTestId("open-settings-view").click();
  await expect(page.getByTestId("settings-section-list")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("settings-nav-appearance").click();
  await expect(page.getByTestId("settings-theme")).toBeVisible({
    timeout: 20_000,
  });
  await page.mouse.move(1300, 800);
  await settle(page);

  // 10 · The mark: on the current row, then sliding to the next.
  const markOn = (selector: string) =>
    page.evaluate((s) => {
      const mark = document.querySelector(
        '[data-testid="shell-settings-marks"] > .luca-mark',
      ) as HTMLElement | null;
      const row = document.querySelector(s);
      if (!mark || !row) return null;
      const m = mark.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return {
        visible: getComputedStyle(mark).visibility === "visible",
        mark: {
          y: +m.top.toFixed(2),
          h: +m.height.toFixed(2),
          x: +m.left.toFixed(2),
          w: +m.width.toFixed(2),
        },
        row: {
          y: +r.top.toFixed(2),
          h: +r.height.toFixed(2),
          x: +r.left.toFixed(2),
          w: +r.width.toFixed(2),
        },
        background: getComputedStyle(mark).backgroundColor,
        row_background: getComputedStyle(row).backgroundColor,
      };
    }, selector);
  // At rest on the current row first (it slid there from Profile).
  await expect
    .poll(
      async () => {
        const at = await markOn('[data-testid="settings-nav-appearance"]');
        return at
          ? Math.abs(at.mark.y - at.row.y) + Math.abs(at.mark.h - at.row.h)
          : null;
      },
      { timeout: 5_000 },
    )
    .toBeLessThan(0.5);
  const start = await markOn('[data-testid="settings-nav-appearance"]');
  const trace = await page.evaluate(async () => {
    const mark = document.querySelector(
      '[data-testid="shell-settings-marks"] > .luca-mark',
    ) as HTMLElement;
    const target = document.querySelector(
      '[data-testid="settings-nav-shortcuts"]',
    ) as HTMLElement;
    const frames: { t: number; y: number; h: number }[] = [];
    const t0 = performance.now();
    target.click();
    await new Promise<void>((resolve) => {
      const step = () => {
        const r = mark.getBoundingClientRect();
        frames.push({
          t: Math.round(performance.now() - t0),
          y: +r.top.toFixed(2),
          h: +r.height.toFixed(2),
        });
        if (performance.now() - t0 < 700) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return frames;
  });
  await page.mouse.move(1300, 800);
  const end = await markOn('[data-testid="settings-nav-shortcuts"]');
  const ys = trace.map((f) => f.y);
  const between = ys.filter(
    (y) =>
      start &&
      end &&
      y > Math.min(start.row.y, end.row.y) + 0.5 &&
      y < Math.max(start.row.y, end.row.y) - 0.5,
  );
  checks.settings_mark = {
    start,
    end,
    two_frames: trace.slice(1, 4),
    frames_between: between.length,
    stretched: Math.max(...trace.map((f) => f.h)),
    ok:
      start !== null &&
      end !== null &&
      start.visible &&
      Math.abs(start.mark.y - start.row.y) <= 0.5 &&
      Math.abs(end.mark.y - end.row.y) <= 0.5 &&
      Math.abs(end.mark.h - end.row.h) <= 0.5 &&
      between.length >= 2 &&
      end.row_background === "rgba(0, 0, 0, 0)",
  };
  const list = await box(page, '[data-testid="settings-section-list"]');
  if (list) {
    await shot(page, "10-settings-mark", {
      x: list.x,
      y: list.y,
      w: list.w,
      h: Math.min(list.h, 360),
    });
  }

  // 9 · The theme tiles, under keyboard focus.
  await page.getByTestId("settings-nav-appearance").click();
  await expect(page.getByTestId("settings-theme")).toBeVisible();
  const tile = page
    .locator(
      '[data-testid="settings-theme"] :is([data-testid^="theme-option-"], [data-testid^="theme-pair-"])',
    )
    .nth(1);
  const tileId = await tile.getAttribute("data-testid");
  await keyboardFocus(page, `[data-testid="${tileId}"]`);
  await settle(page);
  const focus = await page.evaluate((id) => {
    const button = document.querySelector(
      `[data-testid="${id}"]`,
    ) as HTMLElement;
    const preview = button.firstElementChild as HTMLElement;
    const style = getComputedStyle(preview);
    return {
      tile: id,
      focus_visible: button.matches(":focus-visible"),
      outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
      offset: style.outlineOffset,
    };
  }, tileId);
  const tileBox = await tile.boundingBox();
  if (tileBox) {
    await shot(page, "09-theme-tile-focus", {
      x: tileBox.x - 20,
      y: tileBox.y - 20,
      w: tileBox.width * 2 + 60,
      h: tileBox.height + 40,
    });
  }

  // A moved Obsidian owner with a coloured accent: the successor's own.
  const moved = await browser.newPage();
  watchConsole(moved, seen);
  await openApp(moved, {
    before: async (p) => {
      await p.addInitScript(() => {
        if (sessionStorage.getItem("seeded")) return;
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("buzz-theme", "obsidian");
        localStorage.setItem("buzz-accent-color", "#3b82f6");
      });
    },
  });
  await moved.waitForTimeout(1500);
  const accent = await moved.evaluate(() => ({
    theme: localStorage.getItem("buzz-theme"),
    accent: localStorage.getItem("buzz-accent-color"),
    move: localStorage.getItem("polyphonic-glass-theme-moved"),
    primary: getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim(),
  }));
  await moved.close();
  checks.theme_focus = {
    ...focus,
    accent_after_move: accent,
    ok:
      focus.focus_visible &&
      focus.outline.startsWith("1px solid") &&
      focus.offset === "7px" &&
      accent.theme === "vitesse-black" &&
      accent.accent === "neutral" &&
      (accent.move ?? "").includes("#3b82f6"),
  };
  checks.console = seen;
  record("settings", checks);
  for (const key of ["settings_mark", "theme_focus"]) {
    expect.soft((checks[key] as { ok: boolean }).ok, key).toBe(true);
  }
});

// ── 12: the right card's tabs by day ────────────────────────────────────
test("by day the right card's chosen tab stands up", async ({ page }) => {
  test.setTimeout(90_000);
  const seen: string[] = [];
  watchConsole(page, seen);
  const checks: Record<string, unknown> = {};
  await openApp(page, { light: true });
  await openRoute(page, GENERAL_ID, "general");
  await page.getByTestId("shell-lip-details").click();
  const tab = page.getByTestId("drawer-context-conversation");
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await page.mouse.move(700, 500);
  await settle(page);
  const surface = await resolveColour(page, "hsl(var(--mn-surface))");
  const chosen = await page.evaluate(() => {
    const tab = document.querySelector(
      '[data-testid="drawer-context-conversation"]',
    ) as HTMLElement;
    const track = tab.parentElement as HTMLElement;
    const style = getComputedStyle(tab);
    return {
      selected: tab.getAttribute("aria-selected"),
      background: style.backgroundColor,
      shadow: style.boxShadow,
      track: getComputedStyle(track).backgroundColor,
    };
  });
  const shadows = chosen.shadow
    .split(/,(?![^()]*\))/)
    .filter(
      (s) => !/0px 0px 0px 0px|^\s*rgba\(0, 0, 0, 0\) 0px 0px 0px 0px/.test(s),
    );
  checks.day_tabs = {
    ...chosen,
    surface,
    visible_shadows: shadows.length,
    ok:
      chosen.selected === "true" &&
      chosen.background === surface &&
      shadows.length >= 2,
  };
  const nav = await box(page, '[data-testid="conversation-drawer-navigation"]');
  if (nav) {
    await shot(page, "12-day-tabs", {
      x: nav.x - 8,
      y: nav.y - 8,
      w: nav.w + 16,
      h: nav.h + 16,
    });
  }
  checks.console = seen;
  record("tabs", checks);
  expect.soft((checks.day_tabs as { ok: boolean }).ok, "day_tabs").toBe(true);
});

// ── 13: the companion ───────────────────────────────────────────────────
const LUCA = TEST_IDENTITIES.bob.pubkey;

/** A held request the app has already let go (its 15-second timeout), held
 *  again under a new id (the app answers each request id once), so what
 *  follows measures a live one. */
async function holdAgainIfGone(page: Page) {
  if ((await page.getByTestId("app-control-badge").count()) === 0) {
    await holdCompanion(page, randomUUID());
  }
}

async function holdCompanion(
  page: Page,
  requestId = "daaa5f62-adfa-46c0-83b0-6812b643a2e5",
) {
  await page.evaluate(() => {
    const state = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (c: string, a?: unknown, o?: unknown) => Promise<unknown>;
      };
      __FULLSCREEN__?: boolean;
    };
    const invoke = state.__TAURI_INTERNALS__.invoke;
    state.__TAURI_INTERNALS__.invoke = async (command, args, options) => {
      if (command === "plugin:window|is_fullscreen") {
        return state.__FULLSCREEN__ ?? false;
      }
      if (command !== "resolve_polyphonic_app_control")
        return invoke(command, args, options);
      const input = args as { action: string; requestId: string };
      if (input.action === "begin") {
        await new Promise<void>(() => {});
        return "running";
      }
      // As the Rust side does (surface_control.rs, `request`): once the
      // request is settled, it tells the window the control has ended.
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
          observerChannelId: channel,
          controlRequestId: id,
          request: {
            type: "polyphonic_surface_request",
            requestId: id,
            channelId: channel,
            surface: "appearance",
          },
        },
      );
    },
    {
      agent: LUCA,
      channel: GENERAL_ID,
      id: requestId,
    },
  );
  await expect(page.getByTestId("app-control-badge")).toContainText(
    "Luca is using Polyphonic",
    { timeout: 20_000 },
  );
}

test("the companion's badge keeps its place and the stuck day pill steps aside; its halo goes square in full screen", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const seen: string[] = [];
  watchConsole(page, seen);
  const checks: Record<string, unknown> = {};
  await openApp(page, {
    mock: {
      managedAgents: [
        {
          pubkey: LUCA,
          name: "Luca",
          status: "running",
          channelNames: ["general"],
        },
      ],
    } as Mock,
  });
  await holdCompanion(page);
  // The surface request opens Settings; the conversation, with its day pill.
  await openRoute(page, GENERAL_ID, "general");
  await expect(
    page.getByTestId("message-timeline-day-divider").first(),
  ).toBeVisible({ timeout: 15_000 });
  await page.mouse.move(1200, 700);
  await settle(page);
  // The badge at its place; the stuck pill under it steps aside; no
  // message's words beneath the badge.
  const measure = () =>
    page.evaluate(() => {
      const badgeEl = document.querySelector(
        '[data-testid="app-control-badge"]',
      );
      const badge = badgeEl?.getBoundingClientRect();
      const section = document.querySelector(
        '[data-testid="message-timeline-day-divider"]',
      ) as HTMLElement | null;
      const pill = section?.firstElementChild as HTMLElement | null;
      const covered: string[] = [];
      if (badge) {
        const card = document.querySelector(
          '[data-testid="conversation-workspace-grid"]',
        );
        const walker = document.createTreeWalker(
          card ?? document.body,
          NodeFilter.SHOW_TEXT,
        );
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim();
          const parent = node.parentElement;
          if (!text || !parent) continue;
          if (parent.closest('[data-testid="message-timeline-day-divider"]'))
            continue;
          // Only words that show: no hidden or fully transparent ancestor
          // (a message's hover toolbar waits at opacity 0).
          let shown = true;
          for (let el: Element | null = parent; el; el = el.parentElement) {
            const style = getComputedStyle(el);
            if (
              style.visibility === "hidden" ||
              style.display === "none" ||
              Number.parseFloat(style.opacity) === 0
            ) {
              shown = false;
              break;
            }
          }
          if (!shown) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            if (
              r.width > 0 &&
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
      return {
        badge: badge
          ? {
              top: badge.top,
              bottom: badge.bottom,
              left: badge.left,
              right: badge.right,
            }
          : null,
        pill: pill
          ? {
              top: pill.getBoundingClientRect().top,
              aside: section?.hasAttribute("data-companion-aside") ?? false,
              opacity: getComputedStyle(pill).opacity,
            }
          : null,
        words_under_badge: covered,
      };
    });
  await page.waitForTimeout(800);
  const at1440 = await measure();
  await shot(page, "13-companion-badge-1440", {
    x: 268,
    y: 0,
    w: 1172,
    h: 220,
  });
  await page.setViewportSize({ width: 800, height: 500 });
  await holdAgainIfGone(page);
  await page.waitForTimeout(1200);
  await settle(page);
  const at800 = await measure();
  await shot(page, "13-companion-badge-800x500");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(800);
  const placed = (m: Awaited<ReturnType<typeof measure>>) =>
    m.badge?.top === 42 &&
    m.pill?.aside === true &&
    m.pill.opacity === "0" &&
    m.words_under_badge.length === 0;
  checks.companion_badge = {
    "1440x900": at1440,
    "800x500": at800,
    ok: placed(at1440) && placed(at800),
  };

  // Full screen under Black: the halo's corner is the window's, square.
  const radius = () =>
    page.evaluate(() => {
      const halo = document.querySelector(
        '[data-testid="app-control-halo"]',
      ) as HTMLElement | null;
      return halo
        ? {
            radius: getComputedStyle(halo).borderTopLeftRadius,
            fullscreen: halo.hasAttribute("data-fullscreen"),
            frame: document.documentElement.getAttribute("data-luca-frame"),
          }
        : null;
    });
  // The app lets a held request go after 15 seconds (CompanionAppControl.tsx,
  // its timeout); on a busy machine the steps above can take longer, so each
  // step from here is measured on a request held afresh when it has gone.
  await holdAgainIfGone(page);
  const windowed = await radius();
  await page.evaluate(() => {
    (window as unknown as { __FULLSCREEN__: boolean }).__FULLSCREEN__ = true;
    window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("tauri://resize", {
      width: 1440,
      height: 900,
    });
  });
  await expect
    .poll(async () => (await radius())?.radius, { timeout: 5_000 })
    .toBe("0px");
  const full = await radius();
  await shot(page, "13-companion-halo-full-screen-corner", {
    x: 0,
    y: 0,
    w: 120,
    h: 120,
  });
  // The badge goes: the pill comes back.
  await page.evaluate(() => {
    (window as unknown as { __FULLSCREEN__: boolean }).__FULLSCREEN__ = false;
  });
  await holdAgainIfGone(page);
  await page.getByRole("button", { name: "Stop app navigation" }).click();
  await expect(page.getByTestId("app-control-badge")).toHaveCount(0, {
    timeout: 10_000,
  });
  await page.waitForTimeout(400);
  // The pill fades back in: let its fade finish before reading it.
  await settle(page);
  const back = await page.evaluate(() => {
    const section = document.querySelector(
      '[data-testid="message-timeline-day-divider"]',
    );
    const pill = section?.firstElementChild;
    return {
      aside: section?.hasAttribute("data-companion-aside") ?? null,
      opacity: pill ? getComputedStyle(pill).opacity : null,
    };
  });
  (checks.companion_badge as Record<string, unknown>).after_badge_goes = back;
  (checks.companion_badge as { ok: boolean }).ok =
    (checks.companion_badge as { ok: boolean }).ok &&
    back.aside === false &&
    back.opacity === "1";
  await shot(page, "13-companion-gone-pill-back", {
    x: 268,
    y: 0,
    w: 1172,
    h: 160,
  });
  checks.companion_halo = {
    windowed,
    full_screen: full,
    ok: windowed?.radius === "13px" && full?.radius === "0px",
  };
  checks.console = seen;
  record("companion", checks);
  for (const key of ["companion_badge", "companion_halo"]) {
    expect.soft((checks[key] as { ok: boolean }).ok, key).toBe(true);
  }
});

// ── 14: the huddle bar ──────────────────────────────────────────────────
async function startHuddle(page: Page) {
  await page.evaluate(
    (who) => {
      if (window.__HUDDLE_STAGE__) {
        window.__HUDDLE_STAGE__.participantsOnJoin = who;
      }
    },
    [SELF, TEST_IDENTITIES.bob.pubkey],
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
}

/** A voice model still downloading: the bar's status words show. */
async function modelDownloading(page: Page) {
  await page.addInitScript(() => {
    const host = window as unknown as Record<string, unknown>;
    const timer = setInterval(() => {
      const internals = host.__TAURI_INTERNALS__ as
        | { invoke?: (c: string, a?: unknown, o?: unknown) => unknown }
        | undefined;
      if (!internals?.invoke || (internals as Record<string, unknown>).__wp09a)
        return;
      const invoke = internals.invoke;
      const wrapped = async (c: string, a?: unknown, o?: unknown) =>
        c === "get_model_status"
          ? { stt: "ready", tts: { downloading: { progress_percent: 42 } } }
          : invoke(c, a, o);
      try {
        Object.defineProperty(internals, "invoke", {
          configurable: true,
          get: () => wrapped,
          set: () => {},
        });
        (internals as Record<string, unknown>).__wp09a = 1;
      } catch {
        // The stage's own wrapper is in place; try again on the next tick.
        return;
      }
      clearInterval(timer);
    }, 5);
  });
}

const material = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const element = document.querySelector(s) as HTMLElement | null;
    if (!element) return null;
    const style = getComputedStyle(element);
    // One notation for every colour: its pixel, as a canvas paints it.
    const pixel = (colour: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) return colour;
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].join(",");
    };
    const border = pixel(style.borderTopColor);
    return {
      background: style.backgroundColor,
      border: `${style.borderTopWidth} ${border}`,
      shadow: style.boxShadow,
      radius: style.borderTopLeftRadius,
      color: style.color,
    };
  }, selector);

const tooltip = (page: Page) =>
  page.evaluate(() => {
    const tip = [
      ...document.querySelectorAll("[data-radix-popper-content-wrapper] > *"),
    ].find((element) => (element as HTMLElement).offsetHeight > 4) as
      | HTMLElement
      | undefined;
    if (!tip) return null;
    const style = getComputedStyle(tip);
    return {
      background: style.backgroundColor,
      color: style.color,
      radius: style.borderTopLeftRadius,
      shadow: style.boxShadow,
      height: tip.getBoundingClientRect().height,
    };
  });

test("the huddle bar: the frame's popovers, its badge, its words, its axis, Quick Chat", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const seen: string[] = [];
  watchConsole(page, seen);
  const checks: Record<string, unknown> = {};
  const materials: Record<string, unknown> = {};
  for (const light of [false, true]) {
    const p = light ? await page.context().newPage() : page;
    if (light) watchConsole(p, seen);
    const tone = light ? "day" : "night";
    await modelDownloading(p);
    await openApp(p, { huddle: true, light });
    await openRoute(p, GENERAL_ID, "general");
    await startHuddle(p);
    const hint = p.locator(".buzz-huddle-headphones-hint");
    await expect(hint).toBeVisible({ timeout: 10_000 });
    await p.waitForTimeout(500);
    const hintMaterial = await material(p, ".buzz-huddle-headphones-hint");
    await shot(p, `14-${tone}-hint`);
    await p.getByRole("button", { name: "Got it" }).click();
    await p.locator(`${BAR} button[aria-label="Audio settings"]`).click();
    await p.waitForTimeout(500);
    const audio = await material(
      p,
      ".buzz-huddle-popover:not(.buzz-huddle-headphones-hint)",
    );
    await shot(p, `14-${tone}-audio-popover`);
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
    await p.getByTestId("workspace-layout-menu").click();
    await p.waitForTimeout(400);
    const menu = await material(p, '[role="menu"]');
    await p.keyboard.press("Escape");
    await p.mouse.move(700, 400);
    await p.waitForTimeout(400);
    await p.getByTestId("open-settings-view").hover();
    await expect.poll(() => tooltip(p), { timeout: 5_000 }).not.toBeNull();
    await settle(p);
    const placeTip = await tooltip(p);
    await p.mouse.move(700, 400);
    await p.waitForTimeout(600);
    await p.locator(`${BAR} button[aria-label="Mute microphone"]`).hover();
    await expect.poll(() => tooltip(p), { timeout: 5_000 }).not.toBeNull();
    await settle(p);
    const huddleTip = await tooltip(p);
    await shot(p, `14-${tone}-tooltip`);
    await p.mouse.move(700, 400);
    const same = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    materials[tone] = {
      hint: hintMaterial,
      audio,
      frame_menu: menu,
      huddle_tooltip: huddleTip,
      place_tooltip: placeTip,
      ok:
        same(hintMaterial, menu) &&
        same(audio, menu) &&
        same(huddleTip, placeTip),
    };
    if (light) await p.close();
  }

  // The count, as the places' badge.
  const badge = await page.evaluate((bar) => {
    const count = document.querySelector(
      `${bar} button > span.rounded-full`,
    ) as HTMLElement | null;
    if (!count) return null;
    const style = getComputedStyle(count);
    return {
      text: count.textContent,
      size: style.fontSize,
      weight: style.fontWeight,
      numeric: style.fontVariantNumeric,
    };
  }, BAR);

  // With a right card open, the controls on the conversation card's axis.
  await page.getByTestId("shell-lip-details").click();
  await page.mouse.move(700, 400);
  await page.waitForTimeout(900);
  await settle(page);
  const axis = await page.evaluate(
    ({ bar, card }) => {
      const mid = document
        .querySelector(`${bar} > .justify-self-center`)
        ?.getBoundingClientRect();
      const c = document.querySelector(card)?.getBoundingClientRect();
      const name = document
        .querySelector('[data-testid="shell-lip-name"]')
        ?.getBoundingClientRect();
      return {
        controls_axis: mid ? +(mid.left + mid.width / 2).toFixed(2) : null,
        card_axis: c ? +(c.left + c.width / 2).toFixed(2) : null,
        name_axis: name ? +(name.left + name.width / 2).toFixed(2) : null,
      };
    },
    { bar: BAR, card: CARD },
  );
  await shot(page, "14-axis-with-right-card");
  await page.getByTestId("shell-lip-details").click();
  await page.waitForTimeout(700);
  const axisClosed = await page.evaluate(
    ({ bar, card }) => {
      const mid = document
        .querySelector(`${bar} > .justify-self-center`)
        ?.getBoundingClientRect();
      const c = document.querySelector(card)?.getBoundingClientRect();
      return {
        controls_axis: mid ? +(mid.left + mid.width / 2).toFixed(2) : null,
        card_axis: c ? +(c.left + c.width / 2).toFixed(2) : null,
      };
    },
    { bar: BAR, card: CARD },
  );

  // Quick Chat open beside a live huddle, and the words at 800 × 500.
  const quick = async (label: string) => {
    await page.locator("[data-quickchat] button.qc-launcher").click();
    await expect(page.locator(".qc-panel")).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(400);
    const measured = await page.evaluate((bar) => {
      const panel = document
        .querySelector(".qc-panel")
        ?.getBoundingClientRect();
      const leave = document
        .querySelector(`${bar} button[data-huddle-leave]`)
        ?.getBoundingClientRect();
      const band = document
        .querySelector('[data-testid="shell-huddle-band"]')
        ?.getBoundingClientRect();
      const overlap = (a?: DOMRect, b?: DOMRect) =>
        a && b
          ? a.left < b.right &&
            a.right > b.left &&
            a.top < b.bottom &&
            a.bottom > b.top
          : null;
      return {
        panel_bottom: panel?.bottom ?? null,
        band_top: band?.top ?? null,
        covers_leave: overlap(panel, leave),
        covers_band: overlap(panel, band),
      };
    }, BAR);
    await shot(page, `14-quick-chat-${label}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    if (
      await page
        .locator(".qc-panel")
        .isVisible()
        .catch(() => false)
    ) {
      await page
        .locator("[data-quickchat] button.qc-launcher")
        .click({ force: true })
        .catch(() => undefined);
    }
    return measured;
  };
  const quick1440 = await quick("1440");
  const words: Record<string, unknown> = {};
  await page.setViewportSize({ width: 800, height: 500 });
  await page.waitForTimeout(900);
  const readWords = () =>
    page.evaluate((bar) => {
      const spans = [
        ...document.querySelectorAll(`${bar} output span`),
      ] as HTMLElement[];
      return spans.map((span) => ({
        text: span.textContent,
        size: getComputedStyle(span).fontSize,
        scroll: span.scrollWidth,
        client: span.clientWidth,
        squeezed: span.scrollWidth > span.clientWidth,
      }));
    }, BAR);
  words.rail_open = await readWords();
  await shot(page, "14-huddle-800x500-rail-open");
  await page.getByTestId("shell-lip-toggle").click();
  await page.waitForTimeout(800);
  words.rail_closed = await readWords();
  await shot(page, "14-huddle-800x500-rail-closed");
  await page.getByTestId("shell-lip-toggle").click();
  await page.waitForTimeout(800);
  const quick800 = await quick("800x500");
  const allWords = [
    ...(words.rail_open as { squeezed: boolean }[]),
    ...(words.rail_closed as { squeezed: boolean }[]),
  ];

  checks.huddle = {
    materials,
    badge,
    axis_with_right_card: axis,
    axis_without: axisClosed,
    words_800x500: words,
    quick_chat: { "1440x900": quick1440, "800x500": quick800 },
    ok:
      (materials.night as { ok: boolean }).ok &&
      (materials.day as { ok: boolean }).ok &&
      badge?.size === "10px" &&
      axis.controls_axis !== null &&
      axis.card_axis !== null &&
      Math.abs(axis.controls_axis - axis.card_axis) <= 1 &&
      axisClosed.controls_axis !== null &&
      axisClosed.card_axis !== null &&
      Math.abs(axisClosed.controls_axis - axisClosed.card_axis) <= 1 &&
      allWords.length >= 2 &&
      allWords.every((w) => !w.squeezed) &&
      quick1440.covers_leave === false &&
      quick800.covers_leave === false,
  };
  checks.console = seen;
  record("huddle", checks);
  expect.soft((checks.huddle as { ok: boolean }).ok, "huddle").toBe(true);
});

// ── 13b: a project room's own header ────────────────────────────────────
/** #general and #random as the rooms of one project, "Tidepool". */
async function seedProject(page: Page) {
  await page.evaluate(async (general) => {
    const random = [...document.querySelectorAll("[data-channel-id]")]
      .map((row) => row.getAttribute("data-channel-id"))
      .find((id) => id && id !== general);
    const community = (
      JSON.parse(window.localStorage.getItem("buzz-communities") ?? "[]") as {
        pubkey: string;
        relayUrl: string;
      }[]
    )[0];
    if (!community || !random) throw new Error("Expected the mock community.");
    const scope = (value: string) =>
      encodeURIComponent(value.trim().toLowerCase());
    window.localStorage.setItem(
      `luca-room-projects.v1:${scope(community.pubkey)}:${scope(community.relayUrl)}`,
      JSON.stringify({
        version: 1,
        projects: [{ id: "tidepool", label: "Tidepool" }],
        assignments: { [general]: "tidepool", [random]: "tidepool" },
      }),
    );
    window.dispatchEvent(new Event("luca:room-projects-changed"));
    await (
      window as unknown as {
        __BUZZ_E2E_QUERY_CLIENT__?: { invalidateQueries: () => Promise<void> };
      }
    ).__BUZZ_E2E_QUERY_CLIENT__?.invalidateQueries();
  }, GENERAL_ID);
}

test("a project room's own header gives way to the lip and the rail's rooms", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const seen: string[] = [];
  const checks: Record<string, unknown> = {};
  const look = async (origin: string, placement: "rail" | "column") => {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    watchConsole(page, seen);
    await openApp(page, {
      origin,
      before: async (p) => {
        await p.addInitScript((value) => {
          localStorage.setItem("luca.project-rooms-placement.v1", value);
        }, placement);
      },
    });
    await page.waitForSelector(
      '[data-testid="app-sidebar"] [data-channel-id]',
      {
        timeout: 20_000,
      },
    );
    await seedProject(page);
    // The lip names a project room's project first (WP-09b, Decided 3):
    // "Tidepool / general"; the base build names the room alone.
    await openRoute(page, GENERAL_ID, /general$/);
    await page.mouse.move(1200, 700);
    await page.waitForTimeout(1200);
    await settle(page);
    const state = await page.evaluate((card) => {
      const pane = document.querySelector(card)?.getBoundingClientRect();
      const pill = document
        .querySelector('[data-testid="message-timeline-day-divider"] > p')
        ?.getBoundingClientRect();
      return {
        picker: document.querySelectorAll(
          '[data-testid="project-room-picker-trigger"]',
        ).length,
        card_header: document.querySelectorAll(
          `${card} [data-testid="chat-header"]`,
        ).length,
        lip_name: document.querySelector('[data-testid="shell-lip-name"]')
          ?.textContent,
        first_content_from_pane: pane && pill ? pill.top - pane.top : null,
      };
    }, CARD);
    const name = `13b-project-room-${origin ? "before" : "after"}-${placement}`;
    await shot(page, name, { x: 260, y: 0, w: 1180, h: 220 });
    await context.close();
    return state;
  };
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  const before = reachable ? await look(BASE_URL, "rail") : "base unreachable";
  const after = await look("", "rail");
  const column = await look("", "column");
  checks.project_room_header = {
    before_base_build: before,
    after_rooms_in_rail: after,
    rooms_in_a_column: column,
    ok:
      after.picker === 0 &&
      after.card_header === 0 &&
      after.lip_name === "Tidepool/general" &&
      after.first_content_from_pane === 23 &&
      column.picker === 1,
  };
  checks.console = seen;
  record("project-room", checks);
  expect
    .soft((checks.project_room_header as { ok: boolean }).ok, "project_room")
    .toBe(true);
});

// ── review fixes: Details open on glass and by day; Quick Chat's motion ─
/** The page is the app's own window on a Liquid Glass frame
 *  (PolyphonicGlass.swift stood in for). */
async function fakeGlass(page: Page) {
  await page.addInitScript(() => {
    const glass = window as typeof window & {
      __POLYPHONIC_NATIVE_GLASS__?: number;
      isTauri?: boolean;
      webkit?: unknown;
    };
    glass.isTauri = true;
    glass.webkit = {
      messageHandlers: { polyphonicGlass: { postMessage: () => {} } },
    };
    glass.__POLYPHONIC_NATIVE_GLASS__ = 1;
    localStorage.setItem("polyphonic-frame", "glass");
  });
}

const detailsOpen = (page: Page) =>
  page.evaluate(() => {
    const button = document.querySelector(
      '[data-testid="shell-lip-details"]',
    ) as HTMLElement;
    const mark = document.querySelector(
      '[data-testid="shell-places-marks"] > .luca-mark',
    ) as HTMLElement | null;
    const layer = mark?.parentElement ?? null;
    const style = getComputedStyle(button);
    const svg = button.querySelector("svg");
    const probe = document.createElement("div");
    probe.style.color = "var(--luca-frame-ink, hsl(var(--mn-ink)))";
    document.body.appendChild(probe);
    const ink = getComputedStyle(probe).color;
    probe.remove();
    const markStyle = mark ? getComputedStyle(mark) : null;
    return {
      glass: document.documentElement.getAttribute("data-luca-frame-glass"),
      expanded: button.getAttribute("aria-expanded"),
      background: style.backgroundColor,
      grain: style.backgroundImage !== "none",
      shadow: style.boxShadow,
      icon: svg ? getComputedStyle(svg).color : style.color,
      frame_ink: ink,
      place_material: layer?.getAttribute("data-mark-material") ?? null,
      place_background: markStyle?.backgroundColor ?? null,
      place_grain: markStyle ? markStyle.backgroundImage !== "none" : null,
      place_shadow: markStyle
        ? markStyle.boxShadow.replace(/rgba\([^)]*\)/g, "c")
        : null,
      shadow_shape: style.boxShadow.replace(/rgba\([^)]*\)/g, "c"),
    };
  });

test("review fixes: Details open on glass and by day, Quick Chat rides the band", async ({
  browser,
}) => {
  test.setTimeout(200_000);
  const seen: string[] = [];
  const checks: Record<string, unknown> = {};
  /** The lip's right end: the open Details beside the layout menu. */
  const lipClipOf = async (page: Page) => {
    const details = await box(page, '[data-testid="shell-lip-details"]');
    return details
      ? { x: details.x - 110, y: 0, w: 150, h: 44 }
      : { x: 1240, y: 0, w: 200, h: 44 };
  };

  // 2 · On glass, at night and by day: the places' glass mark.
  const glass: Record<string, unknown> = {};
  for (const light of [false, true]) {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    watchConsole(page, seen);
    await openApp(page, { light, before: fakeGlass });
    await openRoute(page, GENERAL_ID, "general");
    await page.getByTestId("shell-lip-details").click();
    await page.mouse.move(700, 500);
    await page.waitForTimeout(600);
    await settle(page);
    const measured = await detailsOpen(page);
    await shot(
      page,
      `f2-glass-${light ? "day" : "night"}-details-open`,
      await lipClipOf(page),
    );
    glass[light ? "day" : "night"] = {
      ...measured,
      ok:
        measured.glass !== null &&
        measured.place_material === "card" &&
        measured.background === measured.place_background &&
        measured.grain === measured.place_grain &&
        measured.shadow_shape === measured.place_shadow &&
        measured.icon === measured.frame_ink,
    };
    await context.close();
  }
  checks.fix_2 = {
    ...glass,
    ok:
      (glass.night as { ok: boolean }).ok && (glass.day as { ok: boolean }).ok,
  };

  // 5 · By day on Black: the open Details icon in the full ink.
  {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    watchConsole(page, seen);
    await openApp(page, { light: true });
    await openRoute(page, GENERAL_ID, "general");
    await page.getByTestId("shell-lip-details").click();
    await page.mouse.move(700, 500);
    await settle(page);
    const day = await detailsOpen(page);
    await shot(page, "f5-black-day-details-open", await lipClipOf(page));
    checks.fix_5 = {
      icon: day.icon,
      frame_ink: day.frame_ink,
      background: day.background,
      ok: day.glass === null && day.icon === day.frame_ink,
    };
    await context.close();
  }

  // 6 · Quick Chat open as a huddle starts: it rides the band's motion.
  for (const reduce of [false, true]) {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1440, height: 900 },
      reducedMotion: reduce ? "reduce" : "no-preference",
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    watchConsole(page, seen);
    await openApp(page, { huddle: true });
    await openRoute(page, GENERAL_ID, "general");
    await page.locator("[data-quickchat] button.qc-launcher").click();
    await expect(page.locator(".qc-panel")).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(400);
    const transition = await page.evaluate(() => {
      const panel = document.querySelector(".qc-panel") as HTMLElement;
      const style = getComputedStyle(panel);
      return {
        property: style.transitionProperty,
        duration: style.transitionDuration,
      };
    });
    await page.evaluate(() => {
      const record = window as unknown as { __QC__: number[] };
      record.__QC__ = [];
      const t0 = performance.now();
      const step = () => {
        const panel = document.querySelector(".qc-panel");
        if (panel) {
          record.__QC__.push(
            Math.round(
              window.innerHeight - panel.getBoundingClientRect().bottom,
            ),
          );
        }
        if (performance.now() - t0 < 6000) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await startHuddle(page);
    await page.waitForTimeout(1200);
    const bottoms = await page.evaluate(
      () => (window as unknown as { __QC__: number[] }).__QC__,
    );
    const distinct = [...new Set(bottoms)];
    const between = distinct.filter((b) => b > 20.5 && b < 57.5);
    await shot(page, `f6-quick-chat-${reduce ? "reduced" : "motion"}`);
    checks[reduce ? "fix_6_reduce_motion" : "fix_6"] = {
      transition,
      bottoms_seen: distinct,
      frames_between_20_and_58: between.length,
      ok: reduce
        ? transition.duration.split(",").every((d) => d.trim() === "0s") &&
          distinct.includes(58)
        : transition.property.includes("bottom") &&
          between.length >= 2 &&
          distinct.includes(58),
    };
    await context.close();
  }
  checks.console = seen;
  record("fixes", checks);
  for (const key of ["fix_2", "fix_5", "fix_6", "fix_6_reduce_motion"]) {
    expect.soft((checks[key] as { ok: boolean }).ok, key).toBe(true);
  }
});

// ── flag off: the base build's pixels ───────────────────────────────────
test("flag off draws the base build exactly", async ({ browser }) => {
  test.setTimeout(240_000);
  const checks: Record<string, unknown> = {};
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  if (!reachable) {
    record("flag-off", { ok: "not run", reason: `${BASE_URL} unreachable` });
    test.skip(true, "base build unreachable");
    return;
  }
  const views: {
    name: string;
    hash?: string;
    act?: (page: Page) => Promise<void>;
    light?: boolean;
  }[] = [
    { name: "general", hash: `#/channels/${GENERAL_ID}` },
    { name: "forum", hash: `#/channels/${FORUM_ID}` },
    { name: "group", hash: `#/channels/${GROUP_ID}` },
    { name: "design-join", hash: `#/channels/${DESIGN_ID}` },
    {
      name: "settings-appearance",
      act: async (page) => {
        await page.getByTestId("open-settings-view").click();
        await page.getByTestId("settings-nav-appearance").click({
          timeout: 20_000,
        });
        await expect(page.getByTestId("settings-theme")).toBeVisible({
          timeout: 20_000,
        });
      },
    },
    { name: "general-day", hash: `#/channels/${GENERAL_ID}`, light: true },
    {
      name: "project-room",
      act: async (page) => {
        await page.waitForSelector(
          '[data-testid="app-sidebar"] [data-channel-id]',
          { timeout: 20_000 },
        );
        await seedProject(page);
        await page.evaluate((id) => {
          window.location.hash = `#/channels/${id}`;
        }, GENERAL_ID);
        // The rail's selection pill pours into the project's row: let it
        // come to rest.
        await page.waitForTimeout(4000);
      },
    },
  ];
  const results: Record<string, unknown> = {};
  for (const view of views) {
    const hashes: string[] = [];
    for (const origin of ["", BASE_URL]) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await openApp(page, {
        frame: false,
        origin,
        light: view.light,
        hash: view.hash ?? "",
      });
      await page.waitForTimeout(2500);
      if (view.act) await view.act(page);
      await page.mouse.move(1439, 899);
      await page.waitForTimeout(1200);
      await settle(page);
      const file = path.join(
        dir(),
        `flag-off-${view.name}-${origin ? "base" : "build"}.png`,
      );
      // The residents' living eyes (small WebGL canvases) never draw the
      // same frame twice: masked in both builds. The page-wide canvases
      // stay in the comparison.
      await page.evaluate(() => {
        for (const canvas of document.querySelectorAll("canvas")) {
          const r = canvas.getBoundingClientRect();
          if (r.width > 0 && r.width < 200 && r.height < 200) {
            canvas.setAttribute("data-wp09a-living", "");
          }
        }
      });
      await page.screenshot({
        path: file,
        animations: "disabled",
        mask: [page.locator("[data-wp09a-living]")],
      });
      hashes.push(sha(file));
      await context.close();
    }
    results[view.name] = {
      build: hashes[0],
      base: hashes[1],
      identical: hashes[0] === hashes[1],
    };
  }
  checks.flag_off_identical = {
    views: results,
    ok: Object.values(results).every(
      (r) => (r as { identical: boolean }).identical,
    ),
  };
  record("flag-off", checks);
  expect
    .soft((checks.flag_off_identical as { ok: boolean }).ok, "flag_off")
    .toBe(true);
});

test.afterAll(() => {
  const hashes = files.map((file) => sha(file));
  record("hashes", {
    files: files.length,
    unique: new Set(hashes).size === hashes.length,
  });
});
