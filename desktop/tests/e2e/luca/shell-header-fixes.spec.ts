import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import {
  installMockBridge,
  openCreateChannelDialog,
} from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * WP-04's review, re-proved (docs/luca/rail-system/SHELL_BUILD.md, WP-04):
 * the day's label rests on its own rule, a long name keeps clear of a
 * person's presence and the ephemeral badge, the lip's presence and Join
 * hold to the lip under text zoom, the name carries the conversation's
 * description, and with panes side by side the lip's name and actions stand
 * over the focused pane while each other pane names itself at its top.
 *
 * SHELL_SHOTS: where the screenshots and checks go (else the test's output
 * folder).
 */

test.use({ deviceScaleFactor: 2 });
test.describe.configure({ mode: "serial" });

type Box = { x: number; y: number; w: number; h: number };

// Each spec writes to its own folder under SHELL_SHOTS, so its hash checks
// compare its own shots and no other spec's (WP-28, Decided 6).
const SHELL_SHOTS = process.env.SHELL_SHOTS
  ? path.join(process.env.SHELL_SHOTS, "shell-header-fixes")
  : undefined;

function shotsDir(fallback: string) {
  const dir = SHELL_SHOTS ?? fallback;
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function openApp(
  page: Page,
  size: { width: number; height: number } = { width: 1440, height: 900 },
) {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: "dark" });
  await installMockBridge(page);
  await page.addInitScript(
    ({ key }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = true;
      localStorage.setItem(key, JSON.stringify(overrides));
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY },
  );
  page.on("pageerror", (error) => console.log("pageerror", error.message));
  page.on("requestfailed", (request) =>
    console.log("requestfailed", request.url(), request.failure()?.errorText),
  );
  // A plain static server on a busy machine can drop a request (a lazy
  // chunk then fails and the page stays blank): load again, up to twice.
  for (let attempt = 1; ; attempt += 1) {
    await page.goto("/?e2e=mock");
    try {
      await expect(page.getByTestId("shell-lip")).toBeVisible({
        timeout: 15_000,
      });
      return;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

/** Mock conversations opened by route: under the frame the rail groups chats
 *  by home (WP-02), so their old rows aren't there to click. */
const CHANNEL_IDS: Record<string, string> = {
  "bob-tyler": "7eb9f239-9393-50b0-bd76-d85eef0511c7",
  general: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
  random: "9dae0116-799b-5071-a0a8-fdd30a91a35d",
  engineering: "1c7e1c02-87bb-5e88-b2da-5a7a9432d0c9",
};

async function openChannel(page: Page, name: string) {
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
async function openGeneral(page: Page) {
  await page.waitForSelector('[data-testid="app-sidebar"] [data-channel-id]', {
    timeout: 20_000,
  });
  await expect(async () => {
    await page.evaluate(() => {
      window.location.hash = "#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
    });
    await expect(page.getByTestId("shell-lip-name")).toHaveText("general", {
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

const SLOT = '[data-testid="shell-lip-actions"]';
const NAME = '[data-testid="shell-lip-name"] .luca-lip-name__text';
const PANE = (slot: string) => `[data-testid="workspace-pane-${slot}"]`;

const round = (value: number) => Math.round(value * 10) / 10;

/** The slot's items, and the name's box, at the lip. */
async function lipLine(page: Page) {
  return page.evaluate(
    ({ slot, name }) => {
      const r = (element: Element | null) => {
        if (!element) return null;
        const b = element.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right };
      };
      const items = Array.from(
        document.querySelector(slot)?.children ?? [],
      ).map((child) => r(child));
      return {
        items,
        name: r(document.querySelector(name)),
        nameBox: r(document.querySelector('[data-testid="shell-lip-name"]')),
        nameScrollWidth:
          document.querySelector(name)?.scrollWidth ?? Number.NaN,
      };
    },
    { slot: SLOT, name: NAME },
  );
}

async function createEphemeral(page: Page, name: string) {
  await openCreateChannelDialog(page);
  await page.getByTestId("create-channel-name").fill(name);
  await page.getByRole("button", { name: "Channel duration: Ongoing" }).click();
  await page
    .getByLabel("Ephemeral - auto-archives after 7 days of inactivity")
    .click();
  await page.getByTestId("create-channel-submit").click();
  await expect(page.getByTestId("shell-lip-name")).toContainText(
    name.slice(0, 12),
  );
}

test("the day's label rests on its own rule", async ({ page }, info) => {
  const dir = shotsDir(info.outputPath());
  const result: Record<string, unknown> = {};
  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 500 },
  ]) {
    await openApp(page, size);
    await openGeneral(page);
    await expect(
      page.getByTestId("message-timeline-day-divider").first(),
    ).toBeVisible();
    await page.mouse.move(size.width - 1, size.height - 1);
    await settle(page);
    const measure = await page.evaluate(() => {
      const divider = document.querySelector<HTMLElement>(
        '[data-testid="message-timeline-day-divider"]',
      );
      const card = document.querySelector(
        '[data-testid="conversation-workspace-grid"] [data-luca-card]',
      );
      if (!divider || !card) return null;
      const label = divider.querySelector("p");
      const group = divider.parentElement;
      const before = group ? getComputedStyle(group, "::before") : null;
      const groupRect = group?.getBoundingClientRect();
      const ruleY =
        groupRect && before && before.content !== "none"
          ? groupRect.top + Number.parseFloat(before.top || "0")
          : null;
      const labelRect = label?.getBoundingClientRect();
      return {
        cardTop: card.getBoundingClientRect().top,
        dividerStickyTop: getComputedStyle(divider).top,
        labelTop: labelRect?.top ?? null,
        labelBottom: labelRect?.bottom ?? null,
        ruleY,
      };
    });
    expect(measure).not.toBeNull();
    if (!measure) return;
    const key = `${size.width}x${size.height}`;
    const labelBelowCard =
      measure.labelTop === null ? null : measure.labelTop - measure.cardTop;
    // The rule never shows as a stray line below the fade: it is behind its
    // label, or (its day scrolled up) above the reading area, under the fade
    // or past the card's edge.
    const ruleHidden =
      measure.ruleY === null ||
      measure.ruleY <= measure.cardTop + 1 + 22 ||
      (measure.labelTop !== null &&
        measure.labelBottom !== null &&
        measure.ruleY >= measure.labelTop &&
        measure.ruleY <= measure.labelBottom);
    console.log(key, JSON.stringify(measure));
    result[key] = {
      ...measure,
      label_below_card_top: labelBelowCard,
      rule_behind_label: ruleHidden,
    };
    await shot(page, dir, `day-label-${key}`, {
      x: 0,
      y: 0,
      width: size.width,
      height: Math.min(size.height, 200),
    });
    expect(ruleHidden, `${key} rule behind label`).toBe(true);
    // At rest the label sits at the reading area's 22 (and the card's 1
    // edge), not 22 further down.
    expect(labelBelowCard ?? 99).toBeLessThan(26);
  }
  writeFileSync(
    path.join(dir, "checks-day-label.json"),
    JSON.stringify(result, null, 2),
  );
});

test("a long name keeps clear of presence and the badge", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const dir = shotsDir(info.outputPath());
  const result: Record<string, unknown> = {};
  await openApp(page, { width: 800, height: 500 });
  await createEphemeral(
    page,
    "autumn-launch-planning-and-retrospective-notes-for-everyone",
  );
  await page.mouse.move(700, 400);
  await settle(page);
  const ephemeral = await lipLine(page);
  await shot(page, dir, "ephemeral-long-800", {
    x: 260,
    y: 0,
    width: 540,
    height: 48,
  });
  const ephemeralGap =
    ephemeral.items[0] && ephemeral.name
      ? ephemeral.items[0].x - ephemeral.name.right
      : Number.NaN;
  result.ephemeral_800 = {
    name: ephemeral.name,
    first_item_x: ephemeral.items[0]?.x,
    gap: round(ephemeralGap),
    truncated: ephemeral.nameScrollWidth > (ephemeral.name?.w ?? 0),
  };
  expect(ephemeralGap).toBeGreaterThanOrEqual(11.5);

  // The name stays on the card's axis.
  const axis = await page.evaluate(() => {
    const card = document.querySelector(
      '[data-testid="conversation-workspace-grid"] [data-luca-card]',
    );
    const name = document.querySelector('[data-testid="shell-lip-name"]');
    if (!card || !name) return null;
    const c = card.getBoundingClientRect();
    const n = name.getBoundingClientRect();
    return { card: (c.left + c.right) / 2, name: (n.left + n.right) / 2 };
  });
  result.ephemeral_axis = axis;
  expect(Math.abs((axis?.card ?? 0) - (axis?.name ?? 99))).toBeLessThan(1.5);

  // A person's presence: the longest DM name the mock has, at 800.
  await openChannel(page, "bob-tyler");
  await expect(page.getByTestId("shell-lip-name")).toHaveText("bob-tyler");
  await page.mouse.move(700, 400);
  await settle(page);
  const room = await page.evaluate(() =>
    getComputedStyle(
      document.querySelector(".luca-lip-card") as Element,
    ).getPropertyValue("--lip-name-room"),
  );
  const slotWidth = (await box(page, SLOT))?.w ?? 0;
  result.dm_800 = {
    slot_width: round(slotWidth),
    name_room: room,
    expected_room: round(Math.max(100, slotWidth + 20)),
  };
  expect(Number.parseFloat(room)).toBeCloseTo(Math.max(100, slotWidth + 20), 0);
  // With three actions alone (84 wide) the room is the base 100.
  await openGeneral(page);
  await settle(page);
  const plainRoom = await page.evaluate(() =>
    getComputedStyle(
      document.querySelector(".luca-lip-card") as Element,
    ).getPropertyValue("--lip-name-room"),
  );
  result.plain_room = plainRoom;
  expect(plainRoom.trim()).toBe("100px");
  writeFileSync(
    path.join(dir, "checks-name-room.json"),
    JSON.stringify(result, null, 2),
  );
});

test("presence and Join hold to the lip under text zoom", async ({
  page,
}, info) => {
  const dir = shotsDir(info.outputPath());
  const result: Record<string, unknown> = {};
  await openApp(page);
  for (const [label, px] of [
    ["75", "12px"],
    ["100", ""],
    ["150", "24px"],
  ] as const) {
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, px);
    await openChannel(page, "bob-tyler");
    await page.mouse.move(1000, 600);
    await settle(page);
    const avatar = await page.evaluate((slot) => {
      const frame = document.querySelector(
        `${slot} .luca-lip-presence__avatar`,
      );
      const dot = document.querySelector(
        `${slot} [data-testid="chat-presence-badge"]`,
      );
      const face = document.querySelector(`${slot} .luca-lip-presence__face`);
      const tile = document.querySelector(`${slot} .luca-lip-button`);
      const r = (element: Element | null) => {
        if (!element) return null;
        const b = element.getBoundingClientRect();
        return {
          x: Math.round(b.x * 10) / 10,
          y: Math.round(b.y * 10) / 10,
          w: Math.round(b.width * 10) / 10,
          h: Math.round(b.height * 10) / 10,
        };
      };
      return {
        frame: r(frame),
        dot: r(dot),
        tile: r(tile),
        face_font: face ? getComputedStyle(face).fontSize : null,
        face_overflows: face ? face.scrollWidth > face.clientWidth + 0.5 : null,
      };
    }, SLOT);
    await shot(page, dir, `zoom-${label}-dm`, {
      x: 1200,
      y: 0,
      width: 240,
      height: 48,
    });

    await page.evaluate(() => {
      window.location.hash = "#/channels/b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e";
    });
    await expect(page.getByTestId("shell-lip-name")).toHaveText("design");
    await page.mouse.move(1000, 600);
    await settle(page);
    const join = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>(
        '[data-testid="shell-lip-join"]',
      );
      if (!button) return null;
      const b = button.getBoundingClientRect();
      const word = button.querySelector("span");
      const icon = button.querySelector("svg");
      return {
        top: Math.round(b.top * 10) / 10,
        bottom: Math.round(b.bottom * 10) / 10,
        height: Math.round(b.height * 10) / 10,
        scroll_height: button.scrollHeight,
        client_height: button.clientHeight,
        word_font: word ? getComputedStyle(word).fontSize : null,
        icon: icon
          ? Math.round(icon.getBoundingClientRect().width * 10) / 10
          : null,
      };
    });
    await shot(page, dir, `zoom-${label}-join`, {
      x: 1200,
      y: 0,
      width: 240,
      height: 48,
    });
    result[label] = { avatar, join };
    expect(avatar.frame?.w).toBe(22);
    expect(avatar.frame?.h).toBe(22);
    expect(
      (avatar.frame?.y ?? 0) + (avatar.frame?.h ?? 99),
    ).toBeLessThanOrEqual(36);
    expect(avatar.face_overflows).toBe(false);
    expect(join?.scroll_height ?? 99).toBeLessThanOrEqual(
      join?.client_height ?? 0,
    );
    expect(join?.bottom ?? 99).toBeLessThanOrEqual(36);
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  writeFileSync(
    path.join(dir, "checks-zoom.json"),
    JSON.stringify(result, null, 2),
  );
});

test("the lip's name carries the conversation's description", async ({
  page,
}, info) => {
  const dir = shotsDir(info.outputPath());
  await openApp(page);
  const result: Record<string, string | null> = {};
  for (const name of ["general", "random", "engineering"]) {
    await openChannel(page, name);
    result[name] = await page
      .getByTestId("shell-lip-name")
      .getAttribute("title");
  }
  writeFileSync(
    path.join(dir, "checks-description.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result.general).toBe("Company-wide updates");
  expect(result.random).toBe("Off-topic, fun stuff");
  expect(result.engineering).toBe("Desktop release train");
});

test("panes side by side: the lip is the focused pane's", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const dir = shotsDir(info.outputPath());
  const result: Record<string, unknown> = {};
  await openApp(page);
  await openGeneral(page);
  await page.getByTestId("workspace-layout-menu").click();
  await page.getByTestId("workspace-preset-columns-2").click();
  await expect(page.locator(PANE("slot-2"))).toBeVisible();
  // engineering into the right pane, then focus the left.
  await page.locator(PANE("slot-2")).click();
  await openChannel(page, "engineering");

  const measure = async (label: string) => {
    await page.mouse.move(1000, 600);
    await settle(page);
    const m = await page.evaluate((slot) => {
      const r = (element: Element | null) => {
        if (!element) return null;
        const b = element.getBoundingClientRect();
        return {
          left: Math.round(b.left * 10) / 10,
          right: Math.round(b.right * 10) / 10,
          center: Math.round(((b.left + b.right) / 2) * 10) / 10,
        };
      };
      const focused = document.querySelector(
        '[data-testid="conversation-workspace-grid"] > [data-focused="true"]',
      );
      const items = Array.from(document.querySelector(slot)?.children ?? []);
      const quiet = Array.from(
        document.querySelectorAll('[data-testid="shell-pane-name"]'),
      ).map((element) => ({
        text: element.textContent,
        pane:
          element.closest("[data-luca-card]")?.getAttribute("data-testid") ??
          null,
        box: r(element),
        top: Math.round(element.getBoundingClientRect().top * 10) / 10,
        color: getComputedStyle(element).color,
        title: element.getAttribute("title"),
      }));
      return {
        focused_pane: focused?.getAttribute("data-testid") ?? null,
        pane: r(focused),
        name: r(document.querySelector('[data-testid="shell-lip-name"]')),
        name_text:
          document.querySelector('[data-testid="shell-lip-name"]')
            ?.textContent ?? null,
        last_action: r(items[items.length - 1] ?? null),
        first_action: r(items[0] ?? null),
        quiet,
      };
    }, SLOT);
    result[label] = m;
    return m;
  };

  const right = await measure("right_focused");
  await shot(page, dir, "panes-right-focused");
  // Focus the left pane by clicking into its timeline.
  await page.locator(PANE("slot-1")).click({ position: { x: 200, y: 300 } });
  await expect(page.getByTestId("shell-lip-name")).toHaveText("general");
  const left = await measure("left_focused");
  await shot(page, dir, "panes-left-focused");
  await shot(page, dir, "panes-left-focused-lip", {
    x: 260,
    y: 0,
    width: 1180,
    height: 80,
  });

  for (const m of [right, left]) {
    expect(m.pane).not.toBeNull();
    if (!m.pane || !m.last_action || !m.name || !m.first_action) continue;
    // The last action 8 from the focused pane's right edge.
    expect(Math.abs(m.pane.right - m.last_action.right - 8)).toBeLessThan(1.5);
    // The name on the focused pane's axis, clear of its actions.
    expect(Math.abs(m.pane.center - m.name.center)).toBeLessThan(1.5);
    expect(m.name.right).toBeLessThan(m.first_action.left);
    // Exactly one quiet name: the other pane's, at its own top.
    expect(m.quiet.length).toBe(1);
    expect(m.quiet[0].pane).not.toBe(m.focused_pane);
  }
  expect(left.quiet[0].text).toBe("engineering");
  expect(right.quiet[0].text).toBe("general");

  // The rail closed: the slot still rides the focused pane.
  await page.getByTestId("shell-lip-toggle").click();
  const closed = await measure("left_focused_rail_closed");
  await shot(page, dir, "panes-left-focused-rail-closed");
  if (closed.pane && closed.last_action) {
    expect(
      Math.abs(closed.pane.right - closed.last_action.right - 8),
    ).toBeLessThan(1.5);
  }
  await page.getByTestId("shell-lip-toggle").click();

  // Back to one pane: the slot returns to the card's right edge and the
  // quiet names go.
  await page.getByTestId("workspace-layout-menu").click();
  await page.getByTestId("workspace-preset-single").click();
  const single = await measure("single_again");
  const card = await page.evaluate(() => {
    const c = document
      .querySelector(
        '[data-testid="conversation-workspace-grid"] [data-luca-card]',
      )
      ?.getBoundingClientRect();
    return c ? { right: c.right, center: (c.left + c.right) / 2 } : null;
  });
  result.single_card = card;
  expect(single.quiet.length).toBe(0);
  if (card && single.last_action && single.name) {
    expect(Math.abs(card.right - single.last_action.right - 8)).toBeLessThan(
      1.5,
    );
    expect(Math.abs(card.center - single.name.center)).toBeLessThan(1.5);
  }
  await shot(page, dir, "panes-single-again");
  writeFileSync(
    path.join(dir, "checks-panes.json"),
    JSON.stringify(result, null, 2),
  );

  // Every screenshot in the folder distinct, by hash (this test runs last).
  const files = readdirSync(dir).filter((file) => file.endsWith(".png"));
  const hashes = Object.fromEntries(
    files.map((file) => [file, sha(path.join(dir, file))]),
  );
  writeFileSync(
    path.join(dir, "checks-hashes.json"),
    JSON.stringify(hashes, null, 2),
  );
  expect(new Set(Object.values(hashes)).size).toBe(files.length);
});
