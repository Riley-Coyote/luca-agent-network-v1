import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * The header, finished (docs/luca/rail-system/SHELL_BUILD.md, WP-04b): the
 * lip's icons at its own 15, its buttons fading over 120 ms, Conversation
 * details showing it is open, Join's focus ring, the presence avatar's
 * fallback, forums in the lip, an empty focused pane, the toggle's words in
 * Settings and an unnamed group chat named by its members. One screenshot
 * per decision at 1440 × 900, the lip again at 800 × 500, and the flag off
 * compared by hash against the base build.
 *
 * SHELL_SHOTS: where the screenshots and checks go (else the test's output
 * folder). SHELL_BASE_URL: the base build for the flag-off comparison
 * (default http://127.0.0.1:4300); unreachable, it is reported as not run.
 */

const BASE_URL = process.env.SHELL_BASE_URL ?? "http://127.0.0.1:4300";
const GENERAL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
/** "design": an open channel the mock identity is not a member of. */
const DESIGN_ID = "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e";
const BOB_DM_ID = "7eb9f239-9393-50b0-bd76-d85eef0511c7";
/** "watercooler": a forum. */
const FORUM_ID = "a27e1ee9-76a6-5bdf-a5d5-1d85610dad11";
/** "Group DM (3)": an unnamed group chat with bob and charlie. */
const GROUP_ID = "d1ec7000-d000-4000-8000-000000000003";

const SLOT = '[data-testid="shell-lip-actions"]';
/** Run from desktop/, as every spec is. */
const SPEC_PATH = path.resolve("../docs/luca/rail-system/SHELL_SPEC.md");
const PANE = (slot: string) => `[data-testid="workspace-pane-${slot}"]`;

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "default" });

function shotsDir(fallback: string) {
  const dir = process.env.SHELL_SHOTS ?? fallback;
  mkdirSync(dir, { recursive: true });
  return dir;
}

const checks: Record<string, unknown> = {};
function saveChecks(dir: string) {
  checks.console = {
    ...((checks.console as Record<string, string[]> | undefined) ?? {}),
    ...consoleSeen,
  };
  writeFileSync(
    path.join(dir, "checks-04b.json"),
    JSON.stringify(checks, null, 2),
  );
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
      overrides["popout-chat-windows"] = true;
      localStorage.setItem(key, JSON.stringify(overrides));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, on: frame },
  );
  await page.goto(`${origin}/?e2e=mock`);
  await page.waitForSelector('[data-testid="app-sidebar"] [data-channel-id]', {
    timeout: 20_000,
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
  }).toPass({ timeout: 30_000 });
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

async function shot(
  page: Page,
  dir: string,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await settle(page);
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, clip });
  return file;
}

/** Every console warning and error a page logs, for the report. */
const consoleSeen: Record<string, string[]> = {};
function watchConsole(page: Page, key: string) {
  const seen: string[] = [];
  consoleSeen[key] = seen;
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      seen.push(`${message.type()}: ${message.text().slice(0, 300)}`);
    }
  });
  page.on("pageerror", (error) => seen.push(`pageerror: ${error.message}`));
}

const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/** Every button in the lip: its words, its icon's size and its fade. */
async function lipButtons(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".luca-lip button")).map((button) => {
      const svg = button.querySelector("svg");
      const box = svg?.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        label: button.getAttribute("aria-label"),
        icon: box ? { w: box.width, h: box.height } : null,
        stroke: svg ? getComputedStyle(svg).strokeWidth : null,
        transition_property: style.transitionProperty,
        transition_duration: style.transitionDuration,
      };
    }),
  );
}

test("the header, finished, at 1440 × 900", async ({ page }, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  watchConsole(page, "flag_on_1440");
  await openApp(page, { frame: true });
  await openRoute(page, GENERAL_ID, "general");
  await expect(page.locator(`${SLOT} > *`)).toHaveCount(3, {
    timeout: 20_000,
  });
  await page.mouse.move(1200, 600);
  const lipClip = { x: 0, y: 0, width: 1440, height: 44 };

  // 1 · The lip's icons at its own 15, every one of them.
  const buttons = await lipButtons(page);
  checks.icon_size_spec = {
    spec_amended: readFileSync(SPEC_PATH, "utf8").includes(
      "the lip's own size, 15",
    ),
    spec_still_says_13: readFileSync(SPEC_PATH, "utf8").includes(
      "13-point icons",
    ),
    buttons: buttons.map((b) => ({ label: b.label, icon: b.icon })),
  };
  for (const b of buttons) {
    expect(b.icon?.w, b.label ?? "").toBeCloseTo(15, 1);
    expect(b.icon?.h, b.label ?? "").toBeCloseTo(15, 1);
  }
  expect(buttons.length).toBe(6);
  await shot(page, dir, "01-icons-15-lip", lipClip);

  // 2 · Every button fades over 120 ms (color, background-color).
  const fades = buttons.map((b) => ({
    label: b.label,
    property: b.transition_property,
    duration: b.transition_duration,
  }));
  for (const fade of fades) {
    expect(fade.property, fade.label ?? "").toBe("color, background-color");
    expect(fade.duration, fade.label ?? "").toBe("0.12s, 0.12s");
  }
  // The hover itself, sampled frame by frame: the running transitions'
  // durations, and when the plate arrives.
  const details = page.getByTestId("shell-lip-details");
  const detailsBox = await details.boundingBox();
  if (!detailsBox) throw new Error("no details button");
  const sampling = page.evaluate(
    () =>
      new Promise<{
        durations: number[];
        samples: [number, string][];
      }>((resolve) => {
        const button = document.querySelector(
          '[data-testid="shell-lip-details"]',
        ) as HTMLElement;
        const samples: [number, string][] = [];
        const durations = new Set<number>();
        let start = -1;
        const step = (now: number) => {
          const background = getComputedStyle(button).backgroundColor;
          for (const animation of button.getAnimations()) {
            const duration = animation.effect?.getTiming().duration;
            if (typeof duration === "number") durations.add(duration);
          }
          if (start < 0 && background !== "rgba(0, 0, 0, 0)") start = now;
          if (start >= 0) samples.push([Math.round(now - start), background]);
          if (start >= 0 && now - start > 260) {
            resolve({ durations: [...durations], samples });
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  await page.mouse.move(
    detailsBox.x + detailsBox.width / 2,
    detailsBox.y + detailsBox.height / 2,
  );
  const hover = await sampling;
  const final = hover.samples[hover.samples.length - 1]?.[1];
  const arrived = hover.samples.find(([, value]) => value === final)?.[0];
  checks.button_fade = {
    buttons: fades,
    hover_running_transition_ms: hover.durations,
    hover_plate_settled_after_ms: arrived,
    hover_samples: hover.samples.slice(0, 12),
  };
  expect(hover.durations).toContain(120);
  await page.waitForTimeout(200);
  await shot(page, dir, "02-fade-details-hovered", lipClip);

  // 3 · Details shows when it's open.
  const closedState = await details.evaluate((element) => ({
    expanded: element.getAttribute("aria-expanded"),
    label: element.getAttribute("aria-label"),
    title: element.getAttribute("title"),
  }));
  await details.click();
  await page.mouse.move(1200, 600);
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(300);
  const openState = await details.evaluate((element) => {
    const style = getComputedStyle(element);
    const toggle = getComputedStyle(
      document.querySelector('[data-testid="shell-lip-toggle"]') as Element,
    );
    return {
      expanded: element.getAttribute("aria-expanded"),
      label: element.getAttribute("aria-label"),
      title: element.getAttribute("title"),
      background: style.backgroundColor,
      color: style.color,
      resting_tile_color: toggle.color,
      hovered: element.matches(":hover"),
    };
  });
  const cardOpen = await page
    .locator(
      '[data-testid="conversation-context-panel"], [data-luca-right-card]',
    )
    .count();
  await shot(page, dir, "03-details-open");
  await details.click();
  await expect(details).toHaveAttribute("aria-expanded", "false");
  checks.details_state = {
    closed: closedState,
    open: openState,
    right_cards_while_open: cardOpen,
  };
  expect(openState.label).toBe("Close conversation details");
  expect(openState.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(openState.color).not.toBe(openState.resting_tile_color);
  expect(closedState.expanded).toBe("false");

  // 5 · The presence avatar's fallback: the frame's avatar material.
  await openRoute(page, BOB_DM_ID, "bob-tyler");
  await page.mouse.move(1200, 600);
  const fallback = page.getByTestId("chat-header-dm-avatar-fallback");
  await expect(fallback).toBeVisible();
  const material = await fallback.evaluate((element) => {
    const style = getComputedStyle(element);
    const root = getComputedStyle(element.parentElement as Element);
    const ink = getComputedStyle(document.documentElement)
      .getPropertyValue("--mn-ink")
      .trim();
    const probe = document.createElement("span");
    probe.style.color = `hsl(${ink})`;
    document.body.append(probe);
    const inkColour = getComputedStyle(probe).color;
    probe.style.color = `hsl(${ink} / 0.14)`;
    const disc = getComputedStyle(probe).color;
    probe.remove();
    const box = element.getBoundingClientRect();
    return {
      text: element.textContent,
      background: style.backgroundColor,
      expected_disc: disc,
      color: style.color,
      expected_ink: inkColour,
      font_size: style.fontSize,
      font_weight: style.fontWeight,
      avatar_backdrop: root.backgroundColor,
      avatar_shadow: root.boxShadow,
      box: { w: box.width, h: box.height },
    };
  });
  checks.presence_fallback = material;
  expect(material.background).toBe(material.expected_disc);
  expect(material.color).toBe(material.expected_ink);
  expect(material.font_size).toBe("12px");
  expect(material.font_weight).toBe("550");
  const avatarBox = await page
    .getByTestId("chat-header-dm-avatar")
    .boundingBox();
  await shot(page, dir, "05-presence-fallback-lip", lipClip);
  if (avatarBox) {
    await shot(page, dir, "05-presence-fallback-zoom", {
      x: avatarBox.x - 60,
      y: 0,
      width: 220,
      height: 44,
    });
  }

  // 4 · Join's focus ring: the lip's ring, outside its fill.
  await openRoute(page, DESIGN_ID, "design");
  const join = page.getByTestId("shell-lip-join");
  await expect(join).toBeVisible();
  let joinFocused = false;
  for (let i = 0; i < 40 && !joinFocused; i += 1) {
    await page.keyboard.press("Tab");
    joinFocused = await join.evaluate(
      (element) => document.activeElement === element,
    );
  }
  expect(joinFocused).toBe(true);
  const ring = await join.evaluate((element) => {
    const style = getComputedStyle(element);
    const toggle = document.querySelector(
      '[data-testid="shell-lip-toggle"]',
    ) as HTMLElement;
    const lipRing = getComputedStyle(toggle);
    return {
      focus_visible: element.matches(":focus-visible"),
      outline_width: style.outlineWidth,
      outline_style: style.outlineStyle,
      outline_color: style.outlineColor,
      outline_offset: style.outlineOffset,
      box_shadow: style.boxShadow,
      fill: style.backgroundColor,
      lip_toggle_outline_color_rule: lipRing.outlineColor,
    };
  });
  checks.join_focus = ring;
  expect(ring.focus_visible).toBe(true);
  expect(ring.outline_width).toBe("1px");
  expect(ring.outline_style).toBe("solid");
  expect(Number.parseFloat(ring.outline_offset)).toBeGreaterThan(0);
  expect(ring.box_shadow).toBe("none");
  const joinBox = await join.boundingBox();
  if (joinBox) {
    await shot(page, dir, "04-join-focus-zoom", {
      x: joinBox.x - 40,
      y: 0,
      width: joinBox.width + 80,
      height: 44,
    });
  }
  await shot(page, dir, "04-join-focus-lip", lipClip);
  await page.mouse.click(1200, 600);

  // 6 · Forums lose their band: actions in the lip, the fixed 22 and the fade.
  await openRoute(page, FORUM_ID, "watercooler");
  await page.mouse.move(1200, 600);
  await expect(page.getByTestId("shell-card-top-veil")).toBeAttached();
  // The post list replaces its loading state once the posts arrive: measure
  // the list itself, not the placeholder before it.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const list = document.querySelector(
            'section[aria-label="Forum posts"] > *',
          );
          return list ? getComputedStyle(list).paddingTop : null;
        }),
      { timeout: 15_000 },
    )
    .toBe("22px");
  const forum = await page.evaluate((slot) => {
    const card = document
      .querySelector(
        '[data-testid="conversation-workspace-grid"] [data-luca-card]',
      )
      ?.getBoundingClientRect();
    const list = document
      .querySelector('section[aria-label="Forum posts"] > *')
      ?.getBoundingClientRect();
    const composer = document
      .querySelector('section[aria-label="Forum posts"] button')
      ?.getBoundingClientRect();
    const veil = document
      .querySelector('[data-testid="shell-card-top-veil"] .luca-shell-veil-top')
      ?.getBoundingClientRect();
    return {
      chat_header: document.querySelectorAll('[data-testid="chat-header"]')
        .length,
      lip_actions: Array.from(document.querySelector(slot)?.children ?? []).map(
        (child) => child.getAttribute("aria-label"),
      ),
      list_padding_top: list
        ? getComputedStyle(
            document.querySelector(
              'section[aria-label="Forum posts"] > *',
            ) as Element,
          ).paddingTop
        : null,
      card_top: card?.top ?? null,
      list_top: list?.top ?? null,
      composer_top: composer?.top ?? null,
      veil: veil ? { top: veil.top, h: veil.height } : null,
    };
  }, SLOT);
  checks.forum = forum;
  expect(forum.chat_header).toBe(0);
  expect(forum.lip_actions).toContain("Open conversation details");
  expect(forum.list_padding_top).toBe("22px");
  expect(forum.veil?.h).toBe(22);
  await shot(page, dir, "06-forum-in-the-lip");

  // 9 · An unnamed group chat named by its members, as the rail names it.
  await openRoute(page, GROUP_ID, /\+/);
  await page.mouse.move(1200, 600);
  const group = await page.evaluate((id) => {
    const lip = document.querySelector('[data-testid="shell-lip-name"]');
    const row = document.querySelector(
      `[data-testid="app-sidebar"] [data-channel-id="${id}"]`,
    ) as HTMLElement | null;
    const titles = Array.from(document.querySelectorAll("[title]"))
      .map((element) => element.getAttribute("title") ?? "")
      .filter((title) => /bob, charlie|charlie, bob/.test(title));
    const labels = Array.from(document.querySelectorAll("[aria-label]"))
      .map((element) => element.getAttribute("aria-label") ?? "")
      .filter((label) => /bob, charlie|charlie, bob/.test(label));
    return {
      lip: lip?.textContent ?? null,
      lip_tooltip: lip?.getAttribute("title") ?? null,
      rail: row?.innerText.trim() ?? null,
      comma_form_in_titles: titles,
      comma_form_in_labels: labels,
      document_title: document.title,
    };
  }, GROUP_ID);
  // The window a pop-out opens is titled by the name the conversation hands
  // it: caught at the bridge.
  const popoutTitle = await page.evaluate(async () => {
    const button = document.querySelector(
      '[data-testid="open-channel-popout"]',
    ) as HTMLElement | null;
    if (!button) return null;
    const testWindow = window as Window & {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
      };
    };
    const internals = testWindow.__TAURI_INTERNALS__;
    if (!internals) return null;
    const original = internals.invoke;
    let seen: unknown = null;
    internals.invoke = (cmd, args) => {
      if (cmd === "open_channel_popout") seen = args;
      return original.call(internals, cmd, args);
    };
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    internals.invoke = original;
    return seen;
  });
  checks.group_name = { ...group, popout_window_args: popoutTitle };
  expect(group.lip).toBe(group.rail);
  expect(group.lip).not.toContain(",");
  expect(group.comma_form_in_titles).toEqual([]);
  await shot(page, dir, "09-group-named-by-members");

  // 7 · An empty focused pane: the lip names nothing and holds no actions.
  await openRoute(page, GENERAL_ID, "general");
  await page.getByTestId("workspace-layout-menu").click();
  await page.getByTestId("workspace-preset-columns-2").click();
  await expect(page.locator(PANE("slot-2"))).toBeVisible();
  await page.locator(PANE("slot-2")).click({ position: { x: 200, y: 300 } });
  await expect(page.locator(PANE("slot-2"))).toHaveAttribute(
    "data-focused",
    "true",
  );
  await page.mouse.move(1200, 600);
  await settle(page);
  const empty = await page.evaluate(
    (slot) => ({
      focused_pane: document
        .querySelector(
          '[data-testid="conversation-workspace-grid"] > [data-focused="true"]',
        )
        ?.getAttribute("data-testid"),
      lip_name: document.querySelector('[data-testid="shell-lip-name"]')
        ?.textContent,
      lip_actions: document.querySelector(slot)?.children.length ?? -1,
      layout_menu_in_lip: document.querySelectorAll(
        `${slot} [data-testid="workspace-layout-menu"]`,
      ).length,
      details_in_lip: document.querySelectorAll(
        `${slot} [data-testid="shell-lip-details"]`,
      ).length,
      popout_in_lip: document.querySelectorAll(
        `${slot} [data-testid="open-channel-popout"]`,
      ).length,
      // The menu's tile, 8 from the empty pane's own right edge.
      menu_from_pane_right: (() => {
        const menu = document.querySelector(
          `${slot} [data-testid="workspace-layout-menu"]`,
        );
        const pane = document.querySelector(
          '[data-testid="conversation-workspace-grid"] > [data-focused="true"]',
        );
        const card = document.querySelector(
          "[data-buzz-content-surface], [data-buzz-content-plane]",
        );
        if (!menu || !pane || !card) return null;
        const paneRight = Math.min(
          pane.getBoundingClientRect().right,
          card.getBoundingClientRect().right -
            Number.parseFloat(getComputedStyle(card).paddingRight || "0"),
        );
        return paneRight - menu.getBoundingClientRect().right;
      })(),
      quiet_names: Array.from(
        document.querySelectorAll('[data-testid="shell-pane-name"]'),
      ).map((element) => element.textContent),
    }),
    SLOT,
  );
  await shot(page, dir, "07-empty-focused-pane");
  // Back: the conversation's pane focused again names it, once.
  await page.locator(PANE("slot-1")).click({ position: { x: 200, y: 300 } });
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general");
  const back = await page.evaluate(
    (slot) => ({
      lip_actions: document.querySelector(slot)?.children.length ?? -1,
      quiet_names: Array.from(
        document.querySelectorAll('[data-testid="shell-pane-name"]'),
      ).map((element) => element.textContent),
    }),
    SLOT,
  );
  // Back to the empty pane: from there the layout menu alone undoes the
  // split, with no other pane clicked first.
  await page.locator(PANE("slot-2")).click({ position: { x: 200, y: 300 } });
  await expect(page.locator(PANE("slot-2"))).toHaveAttribute(
    "data-focused",
    "true",
  );
  const lipMenu = page.locator(`${SLOT} [data-testid="workspace-layout-menu"]`);
  await lipMenu.click();
  await expect(page.getByTestId("workspace-preset-single")).toBeVisible();
  await shot(page, dir, "07-empty-pane-layout-menu-open");
  await page.getByTestId("workspace-preset-single").click();
  await expect(page.locator(PANE("slot-2"))).toHaveCount(0);
  const undone = await page.evaluate(() => ({
    panes: document.querySelectorAll(
      '[data-testid="conversation-workspace-grid"] > [data-luca-card]',
    ).length,
    lip_name: document.querySelector('[data-testid="shell-lip-name"]')
      ?.textContent,
  }));
  checks.empty_pane = {
    empty_focused: empty,
    conversation_focused: back,
    undone_from_the_empty_pane: undone,
  };
  expect(empty.focused_pane).toBe("workspace-pane-slot-2");
  // The lip names an empty focused pane as a state, so the page's only h1
  // is never empty (WP-09a, 4; EMPTY_PANE_LIP_NAME).
  expect(empty.lip_name).toBe("No conversation");
  // The workspace's own control stays; a conversation's actions don't.
  expect(empty.lip_actions).toBe(1);
  expect(empty.layout_menu_in_lip).toBe(1);
  expect(empty.details_in_lip).toBe(0);
  expect(empty.popout_in_lip).toBe(0);
  expect(empty.menu_from_pane_right).toBeCloseTo(8, 0);
  expect(empty.quiet_names.filter((name) => name === "general").length).toBe(1);
  expect(back.lip_actions).toBeGreaterThan(0);
  expect(back.quiet_names).toEqual([]);
  expect(undone.panes).toBeLessThanOrEqual(1);
  expect(undone.lip_name).toBe("general");

  // 8 · In Settings the toggle says what it toggles.
  const railWords = await page
    .getByTestId("shell-lip-toggle")
    .getAttribute("aria-label");
  await page.getByTestId("open-settings-view").click();
  await expect(page.getByTestId("shell-lip-name")).toHaveText("Settings", {
    timeout: 20_000,
  });
  const toggle = page.getByTestId("shell-lip-toggle");
  const openWords = await toggle.getAttribute("aria-label");
  await toggle.focus();
  await shot(page, dir, "08-settings-toggle-close");
  await toggle.click();
  await page.waitForTimeout(600);
  const closedWords = await toggle.getAttribute("aria-label");
  await shot(page, dir, "08-settings-toggle-open");
  await toggle.click();
  checks.settings_toggle_words = {
    in_the_app: railWords,
    settings_list_open: openWords,
    settings_list_closed: closedWords,
  };
  expect(openWords).toMatch(/^Close the section list \((⌘|Ctrl\+)S\)$/);
  expect(closedWords).toMatch(/^Open the section list \((⌘|Ctrl\+)S\)$/);
  expect(railWords).toMatch(/chats rail/);
  saveChecks(dir);
});

test("the header, finished, at 800 × 500", async ({ page }, info) => {
  test.setTimeout(180_000);
  const dir = shotsDir(info.outputPath());
  watchConsole(page, "flag_on_800");
  await openApp(page, { frame: true, size: { width: 800, height: 500 } });
  await openRoute(page, GROUP_ID, /\+/);
  await page.mouse.move(600, 400);
  const lipClip = { x: 0, y: 0, width: 800, height: 44 };
  const small: Record<string, unknown> = {};
  small.buttons = await lipButtons(page);
  await shot(page, dir, "800-09-group", lipClip);
  // At this size the details card takes the conversation's place (the
  // single-panel view): the lip is the frame, not the card, so its actions
  // stay, and Details shows it is open and closes the card from the lip.
  await openRoute(page, GENERAL_ID, "general");
  await expect(page.locator(`${SLOT} > *`)).toHaveCount(3, {
    timeout: 20_000,
  });
  const details = page.getByTestId("shell-lip-details");
  const actionsBefore = await page.evaluate(
    (slot) =>
      Array.from(document.querySelectorAll(`${slot} > *`)).map((element) =>
        Math.round(element.getBoundingClientRect().x),
      ),
    SLOT,
  );
  await details.click();
  await page.mouse.move(600, 400);
  const panel = page.getByTestId("conversation-context-panel");
  await expect(panel).toBeVisible();
  await page.waitForTimeout(400);
  const openState = await page.evaluate((slot) => {
    const button = document.querySelector(
      '[data-testid="shell-lip-details"]',
    ) as HTMLElement | null;
    const card = document.querySelector(
      "[data-buzz-content-surface], [data-buzz-content-plane]",
    );
    const box = button?.getBoundingClientRect();
    const cardBox = card?.getBoundingClientRect();
    const style = button ? getComputedStyle(button) : null;
    return {
      slot_children: document.querySelector(slot)?.children.length ?? -1,
      slot_width: (document.querySelector(slot) as HTMLElement | null)
        ?.offsetWidth,
      actions_x: Array.from(document.querySelectorAll(`${slot} > *`)).map(
        (element) => Math.round(element.getBoundingClientRect().x),
      ),
      aria_expanded: button?.getAttribute("aria-expanded") ?? null,
      label: button?.getAttribute("aria-label") ?? null,
      title: button?.getAttribute("title") ?? null,
      background: style?.backgroundColor ?? null,
      color: style?.color ?? null,
      from_card_right:
        box && cardBox && card
          ? cardBox.right -
            Number.parseFloat(getComputedStyle(card).paddingRight || "0") -
            box.right
          : null,
      lip_name:
        document.querySelector('[data-testid="shell-lip-name"]')?.textContent ??
        null,
      fade_in_card: document.querySelectorAll(
        '[data-testid="shell-card-top-veil"]',
      ).length,
    };
  }, SLOT);
  await shot(page, dir, "800-03-details-open");
  await shot(page, dir, "800-03-details-open-lip", lipClip);
  await details.click();
  await expect(panel).toHaveCount(0);
  await page.mouse.move(600, 400);
  await page.waitForTimeout(400);
  const closedState = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="shell-lip-details"]');
    return {
      aria_expanded: button?.getAttribute("aria-expanded") ?? null,
      label: button?.getAttribute("aria-label") ?? null,
      background: button ? getComputedStyle(button).backgroundColor : null,
      timeline_shown:
        document.querySelector('[data-testid="channel-drop-zone"]') !== null,
    };
  });
  await shot(page, dir, "800-03-details-closed-from-lip", lipClip);
  small.details_open = {
    actions_x_before: actionsBefore,
    open: openState,
    closed_from_the_lip: closedState,
  };
  expect(openState.slot_children).toBe(3);
  expect(openState.actions_x).toEqual(actionsBefore);
  expect(openState.aria_expanded).toBe("true");
  expect(openState.label).toBe("Close conversation details");
  expect(openState.from_card_right).toBeCloseTo(8, 0);
  expect(openState.fade_in_card).toBe(0);
  expect(closedState.aria_expanded).toBe("false");
  expect(closedState.timeline_shown).toBe(true);
  await openRoute(page, FORUM_ID, "watercooler");
  await page.mouse.move(600, 400);
  small.forum_header = await page
    .locator('[data-testid="chat-header"]')
    .count();
  await shot(page, dir, "800-06-forum");
  await openRoute(page, BOB_DM_ID, "bob-tyler");
  await page.mouse.move(600, 400);
  await shot(page, dir, "800-05-presence", lipClip);
  await page.getByTestId("open-settings-view").click();
  await expect(page.getByTestId("shell-lip-name")).toHaveText("Settings", {
    timeout: 20_000,
  });
  small.settings_toggle = await page
    .getByTestId("shell-lip-toggle")
    .getAttribute("aria-label");
  await shot(page, dir, "800-08-settings");
  const previous = JSON.parse(
    (() => {
      try {
        return readFileSync(path.join(dir, "checks-04b.json"), "utf8");
      } catch {
        return "{}";
      }
    })(),
  );
  Object.assign(checks, previous, { at_800x500: small });
  saveChecks(dir);
  expect(small.forum_header).toBe(0);
  expect(small.settings_toggle).toMatch(/section list/);
});

/** The pop-out page for a conversation, opened as the main window opens it,
 *  with every title it gives its window recorded. */
async function openPopout(page: Page, origin: string, frame: boolean) {
  await page.setViewportSize({ width: 720, height: 560 });
  await page.emulateMedia({ colorScheme: "dark" });
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
  await installMockBridge(page);
  await page.addInitScript(() => {
    const record = window as Window & {
      __titles?: string[];
      __windowTitles?: string[];
    };
    record.__titles = [];
    record.__windowTitles = [];
    const descriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "title",
    );
    if (descriptor?.get && descriptor.set) {
      Object.defineProperty(document, "title", {
        configurable: true,
        get() {
          return descriptor.get?.call(document);
        },
        set(value: string) {
          record.__titles?.push(value);
          descriptor.set?.call(document, value);
        },
      });
    }
    // The window's own title (setTitle), where the bridge carries it.
    const internals = (
      window as Window & {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string, args?: Record<string, unknown>) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    if (internals) {
      const original = internals.invoke;
      internals.invoke = (cmd, args) => {
        if (cmd === "plugin:window|set_title") {
          record.__windowTitles?.push(String(args?.value ?? ""));
        }
        return original.call(internals, cmd, args);
      };
    }
  });
  await page.goto(
    `${origin}/?e2e=mock&window=popout&channel=${GROUP_ID}#/channels/${GROUP_ID}`,
  );
  await expect(
    page.getByTestId("popout-conversation-picker-trigger"),
  ).toBeVisible({ timeout: 20_000 });
  // Let every query behind the name settle (agents, profiles, channels).
  await page.waitForTimeout(3000);
  return page.evaluate(() => {
    const record = window as Window & {
      __titles?: string[];
      __windowTitles?: string[];
    };
    return {
      document_title: document.title,
      document_titles_set: record.__titles ?? [],
      window_titles_set: record.__windowTitles ?? [],
      picker:
        document
          .querySelector('.luca-popout-picker [data-testid="chat-title"]')
          ?.textContent?.trim() ?? null,
      picker_label:
        document
          .querySelector('[data-testid="popout-conversation-picker-trigger"]')
          ?.getAttribute("aria-label") ?? null,
      // setTitle runs only inside Tauri (isTauri()); the mock bridge is not.
      is_tauri: Boolean((globalThis as { isTauri?: boolean }).isTauri),
    };
  });
}

test("the pop-out names an unnamed group by its members", async ({
  browser,
}, info) => {
  test.setTimeout(120_000);
  const dir = shotsDir(info.outputPath());
  const origin = info.project.use.baseURL ?? "";
  const onContext = await browser.newContext({ deviceScaleFactor: 2 });
  const onPage = await onContext.newPage();
  watchConsole(onPage, "popout_flag_on");
  const on = await openPopout(onPage, origin, true);
  // The picker's list names it the same way.
  await onPage.getByTestId("popout-conversation-picker-trigger").click();
  const option = await onPage
    .getByTestId(`popout-conversation-picker-option-${GROUP_ID}`)
    .innerText()
    .catch(() => null);
  await shot(onPage, dir, "09-popout-group-picker-open");
  await onPage.keyboard.press("Escape");
  await shot(onPage, dir, "09-popout-group-named");
  await onContext.close();
  const offContext = await browser.newContext({ deviceScaleFactor: 2 });
  const off = await openPopout(await offContext.newPage(), origin, false);
  await offContext.close();
  const previous = JSON.parse(
    (() => {
      try {
        return readFileSync(path.join(dir, "checks-04b.json"), "utf8");
      } catch {
        return "{}";
      }
    })(),
  );
  Object.assign(checks, previous, {
    group_name_popout: {
      flag_on: { ...on, picker_option: option },
      flag_off: off,
    },
  });
  saveChecks(dir);
  expect(on.document_title).toBe("bob-tyler + charlie");
  expect(on.picker).toBe("bob-tyler + charlie");
  expect(on.picker_label).toBe("Switch conversation from bob-tyler + charlie");
  expect(option ?? "").toContain("bob-tyler + charlie");
  expect(on.document_titles_set.filter((t) => t.includes(","))).toEqual([]);
  expect(on.window_titles_set.filter((t) => t.includes(","))).toEqual([]);
  // With the flag off nothing changes: the comma form, as before.
  expect(off.document_title).toBe("bob, charlie");
});

test("flag off draws the base build exactly", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const dir = shotsDir(info.outputPath());
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!reachable, `base build not reachable at ${BASE_URL}`);

  const captureIn = async (
    context: BrowserContext,
    origin: string,
    label: string,
    size: { width: number; height: number },
  ) => {
    await context.clock.install({ time: new Date("2026-10-24T18:30:00") });
    const page = await context.newPage();
    await openApp(page, { frame: false, origin, size });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    const shots: Record<string, string> = {};
    const visit = async (key: string, id: string, title: string) => {
      await expect(async () => {
        await page.evaluate((target) => {
          window.location.hash = `#/channels/${target}`;
        }, id);
        await expect(page.getByTestId("chat-title")).toHaveText(title, {
          timeout: 3_000,
        });
      }).toPass({ timeout: 30_000 });
      await page.mouse.move(size.width - 1, size.height - 1);
      await page.waitForTimeout(1500);
      shots[key] = await shot(
        page,
        dir,
        `flag-off-${size.width}-${key}${label}`,
      );
    };
    await visit("channel", GENERAL_ID, "general");
    await visit("dm", BOB_DM_ID, "bob-tyler");
    await visit("not_joined", DESIGN_ID, "design");
    await visit("forum", FORUM_ID, "watercooler");
    await visit("group", GROUP_ID, "bob, charlie");
    return shots;
  };
  const capture = async (
    origin: string,
    label: string,
    size: { width: number; height: number },
  ) => {
    for (let attempt = 1; ; attempt += 1) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: size,
      });
      try {
        return await captureIn(context, origin, label, size);
      } catch (error) {
        if (attempt >= 3) throw error;
      } finally {
        await context.close();
      }
    }
  };
  const result: Record<string, unknown> = {};
  for (const size of [
    { width: 800, height: 500 },
    { width: 1440, height: 900 },
  ]) {
    const ours = await capture(info.project.use.baseURL ?? "", "", size);
    const base = await capture(BASE_URL, "-base", size);
    for (const key of Object.keys(ours)) {
      result[`${size.width}x${size.height}_${key}`] = {
        ours: sha(ours[key]),
        base: sha(base[key]),
        identical: sha(ours[key]) === sha(base[key]),
      };
    }
  }
  const previous = JSON.parse(
    (() => {
      try {
        return readFileSync(path.join(dir, "checks-04b.json"), "utf8");
      } catch {
        return "{}";
      }
    })(),
  );
  Object.assign(checks, previous, { flag_off_identical: result });
  // Every flag-on screenshot distinct, by hash.
  const files = readdirSync(dir).filter(
    (file) => file.endsWith(".png") && !file.startsWith("flag-off-"),
  );
  const hashes = files.map((file) => sha(path.join(dir, file)));
  checks.shot_hashes_unique = new Set(hashes).size === files.length;
  saveChecks(dir);
  for (const key of Object.keys(result)) {
    expect
      .soft((result[key] as { identical: boolean }).identical, key)
      .toBe(true);
  }
  expect(checks.shot_hashes_unique).toBe(true);
});

test("flag off: the fixes' paths draw the base build exactly", async ({
  browser,
}, info) => {
  test.setTimeout(240_000);
  const dir = shotsDir(info.outputPath());
  const reachable = await fetch(BASE_URL)
    .then((response) => response.ok)
    .catch(() => false);
  test.skip(!reachable, `base build not reachable at ${BASE_URL}`);
  const capture = async (origin: string, label: string) => {
    const shots: Record<string, string> = {};
    // At 800 × 500 with details open (the single-panel view).
    {
      const size = { width: 800, height: 500 };
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: size,
      });
      await context.clock.install({ time: new Date("2026-10-24T18:30:00") });
      const page = await context.newPage();
      await openApp(page, { frame: false, origin, size });
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await expect(async () => {
        await page.evaluate((target) => {
          window.location.hash = `#/channels/${target}`;
        }, GENERAL_ID);
        await expect(page.getByTestId("chat-title")).toHaveText("general", {
          timeout: 3_000,
        });
      }).toPass({ timeout: 30_000 });
      await page
        .getByRole("button", { name: "Open conversation details" })
        .click({ timeout: 15_000 });
      await expect(
        page.getByTestId("conversation-context-panel"),
      ).toBeVisible();
      await page.mouse.move(799, 499);
      await page.waitForTimeout(1500);
      shots.details_open_800 = await shot(
        page,
        dir,
        `flag-off-800-details-open${label}`,
      );
      await context.close();
    }
    // At 1440 × 900, two columns, the empty pane focused.
    {
      const size = { width: 1440, height: 900 };
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: size,
      });
      await context.clock.install({ time: new Date("2026-10-24T18:30:00") });
      const page = await context.newPage();
      await openApp(page, { frame: false, origin, size });
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await expect(async () => {
        await page.evaluate((target) => {
          window.location.hash = `#/channels/${target}`;
        }, GENERAL_ID);
        await expect(page.getByTestId("chat-title")).toHaveText("general", {
          timeout: 3_000,
        });
      }).toPass({ timeout: 30_000 });
      // Open the menu once and choose by the item's own click, without
      // waiting on its entrance to hold still.
      await page
        .getByTestId("workspace-layout-menu")
        .click({ timeout: 15_000 });
      await expect(page.getByTestId("workspace-preset-columns-2")).toBeVisible({
        timeout: 15_000,
      });
      await page
        .getByTestId("workspace-preset-columns-2")
        .dispatchEvent("click");
      await expect(page.locator(PANE("slot-2"))).toBeVisible();
      await page
        .locator(PANE("slot-2"))
        .click({ position: { x: 200, y: 300 }, timeout: 15_000 });
      await expect(page.locator(PANE("slot-2"))).toHaveAttribute(
        "data-focused",
        "true",
      );
      // The menu hands focus back to its trigger on a timer of its own, so
      // whether its ring shows is a race in either build: let the menu
      // finish closing, then leave nothing focused.
      await expect(page.getByTestId("workspace-preset-columns-2")).toHaveCount(
        0,
      );
      await page.waitForTimeout(1000);
      await page.evaluate(() =>
        (document.activeElement as HTMLElement)?.blur(),
      );
      await page.mouse.move(1439, 899);
      await page.waitForTimeout(1500);
      shots.empty_pane_1440 = await shot(
        page,
        dir,
        `flag-off-1440-empty-pane${label}`,
      );
      await context.close();
    }
    return shots;
  };
  // Each repeat keeps its own pair, so a mismatch can be looked at.
  const run = info.repeatEachIndex > 0 ? `-r${info.repeatEachIndex}` : "";
  const ours = await capture(info.project.use.baseURL ?? "", run);
  const base = await capture(BASE_URL, `${run}-base`);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(ours)) {
    result[key] = {
      ours: sha(ours[key]),
      base: sha(base[key]),
      identical: sha(ours[key]) === sha(base[key]),
    };
  }
  const previous = JSON.parse(
    (() => {
      try {
        return readFileSync(path.join(dir, "checks-04b.json"), "utf8");
      } catch {
        return "{}";
      }
    })(),
  );
  Object.assign(checks, previous, { flag_off_fix_paths: result });
  saveChecks(dir);
  for (const key of Object.keys(result)) {
    expect
      .soft((result[key] as { identical: boolean }).identical, key)
      .toBe(true);
  }
});
