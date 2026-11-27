import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";
import { chooseRailAgents } from "../helpers/railAgents";

/**
 * WP-27, three from the final flows check (docs/luca/rail-system/
 * SHELL_BUILD.md), under `shell-frame`, in Chromium and WebKit:
 * - a room opens on its newest message whatever its stack holds, and keeps
 *   it in view as the stack folds and shows;
 * - an open form never leaves the window: the stack is bounded by the room
 *   above the message box, the form opens with its head in view and its
 *   actions are reached by scrolling the stack;
 * - the right-hand card says the shared word for a stopped mind: "Off".
 * With the flag off, the room matches the integration base by hash. Run in
 * both engines from ~/.claude/plans/polyphonic-shell-build/wp27-tools/
 * pw.config.ts; the smoke project runs it in Chromium. Shots land in
 * WP27_SHOTS, measurements in WP27_SHOTS/measures.
 */

const SHOTS = process.env.WP27_SHOTS ?? "test-results/shell-room-flows";
const BASE_URL = process.env.WP27_BASE_URL ?? "http://127.0.0.1:4334";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const X_OPEN = "1".repeat(64);
const ROOT_OPEN = "e4".repeat(32);

type Mode = "dark" | "light";

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

const isoAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
const secsAgo = (minutes: number) =>
  Math.floor((Date.now() - minutes * 60_000) / 1000);

/** The flows check's room (final-review-flows/lib.ts), the question seeded
 *  into #general so all three asks show there; Wren stopped. */
const SEEDS = {
  exchanges: [
    {
      bucket: 3,
      channelName: "general",
      deadline: secsAgo(-30),
      exchangeId: X_OPEN,
      members: [LUCA, ATLAS],
      openedBy: LUCA,
      rootEventId: ROOT_OPEN,
      spent: 1,
    },
  ],
  managedInputs: [
    {
      channelName: "general",
      pendingId: "question-word",
      request: {
        fields: [
          {
            description: null,
            key: "word",
            kind: "single",
            label: "Which word",
            options: [
              { description: null, label: "Preview", value: "preview" },
              { description: null, label: "Beta", value: "beta" },
            ],
            required: true,
          },
        ],
        message: "Should the Tidepool page say preview or beta?",
        resident_pubkey: WREN,
      },
    },
  ],
  managedPermissions: [
    {
      pendingId: "permission-release",
      request: {
        acp_request_id: "acp-1",
        action_preview: "./scripts/release.sh --dry-run",
        conversation_id: GENERAL,
        options: [
          { kind: "allow_once", name: "Allow once", option_id: "allow" },
          { kind: "reject_once", name: "Reject", option_id: "reject" },
        ],
        protocol: "luca.managed.permission.v1",
        resident_pubkey: ATLAS,
        session_epoch: 1,
        title: "Run the release script",
        turn_id: "turn-1",
      },
    },
  ],
  runtimeTaskProposals: [
    {
      channelName: "general",
      createdAt: isoAgo(5),
      proposalId: "proposal-notes",
      residentPubkey: LUCA,
      runtimeFamily: "claude_code",
      summary: "Update the release notes for beta 7.",
    },
  ],
  runtimeTasks: [
    {
      channelName: "general",
      completedAt: isoAgo(160),
      residentPubkey: LUCA,
      runtimeFamily: "claude_code",
      startedAt: isoAgo(180),
      state: "succeeded",
      summary: "Fix the failing build",
      taskId: "task-build",
    },
  ],
};

async function boot(
  page: Page,
  {
    baseURL,
    flag = true,
    hash = `/channels/${GENERAL}`,
    log = [],
    mode = "dark",
  }: {
    baseURL?: string;
    flag?: boolean;
    hash?: string;
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
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        personaId: "builtin:fizz",
        pubkey: LUCA,
        status: "running",
      },
      { name: "Atlas", pubkey: ATLAS, status: "running" },
      { name: "Wren", pubkey: WREN, status: "stopped" },
    ],
    ...SEEDS,
  } as never);
  await chooseRailAgents(page);
  await expect(async () => {
    await page.goto(`${baseURL ?? ""}/#${hash}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 90_000 });
}

/** The flows check's words in #general, after the first paint. */
async function speak(page: Page) {
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
  await page.evaluate(
    ({ at, luca, root, exchange }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      emit?.({
        channelName: "general",
        content: "@Luca ask Atlas if the notes are ready.",
        createdAt: at,
        id: root,
        kind: 9,
      } as never);
      emit?.({
        channelName: "general",
        content: "Atlas, are the release notes ready for Sam's read?",
        createdAt: at + 30,
        extraTags: [["exchange", exchange, "1"]],
        kind: 9,
        pubkey: luca,
      } as never);
    },
    { at: secsAgo(40), exchange: X_OPEN, luca: LUCA, root: ROOT_OPEN },
  );
}

/** The room's geometry, read without scrolling anything. */
async function room(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { bottom: r.bottom, height: r.height, top: r.top };
    };
    const section = document.querySelector('[data-testid="channel-drop-zone"]');
    const stack = document.querySelector('[data-testid="room-stack"]');
    const composer = document.querySelector(
      '[data-testid="channel-composer-overlay"] [data-testid="message-composer"]',
    );
    const scroller = document.querySelector<HTMLElement>(
      '[data-buzz-conversation-scroll="true"]',
    );
    // The newest message: the row that ends lowest in the timeline, drawn
    // or not.
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
      composer: box(composer),
      folded: stack?.hasAttribute("data-folded") ?? null,
      newest: box(newest),
      newestText: (newest?.textContent ?? "").slice(0, 60),
      rows: rows.length,
      scroll: scroller
        ? {
            fromBottom: Math.round(
              scroller.scrollHeight -
                scroller.scrollTop -
                scroller.clientHeight,
            ),
            max: scroller.scrollHeight - scroller.clientHeight,
            top: scroller.scrollTop,
          }
        : null,
      section: box(section),
      stack: box(stack),
      viewport: { height: window.innerHeight },
      whole: stack?.hasAttribute("data-whole") ?? null,
    };
  });
}

type Room = Awaited<ReturnType<typeof room>>;

function expectNewestInView(each: Room) {
  if (!each.stack || !each.section || !each.newest)
    throw new Error("no stack or no message");
  // Its bottom at or above the stack's top, and on the card: a message taller
  // than the room left above a shown stack may begin above the card's top.
  expect(each.newest.bottom).toBeLessThanOrEqual(each.stack.top + 0.5);
  expect(each.newest.bottom).toBeGreaterThan(each.section.top);
}

// ── d1 · a room opens on its newest message, whatever the stack holds ───
for (const [width, height] of [
  [1440, 900],
  [800, 500],
] as const) {
  for (const mode of ["dark", "light"] as Mode[]) {
    test(`d1 opens on its newest message at ${width} ${mode}`, async ({
      page,
    }) => {
      const log: string[] = [];
      await page.setViewportSize({ width, height });
      await boot(page, { log, mode });
      await expect(page.getByTestId("room-stack")).toBeVisible({
        timeout: 20_000,
      });
      await speak(page);
      await page.mouse.move(width - 10, 10);
      await page.waitForTimeout(1800);
      const open = await room(page);
      const openShot = await shot(page, `d1-open-${width}-${mode}`);
      // Fold and show, after the first paint: the anchor holds.
      const toggled: Room[] = [];
      for (let i = 0; i < 2; i++) {
        const held = page.getByTestId("pending-held");
        if (await held.isVisible()) await held.click();
        else await page.getByTestId("room-stack-hide").click();
        await page.waitForTimeout(700);
        toggled.push(await room(page));
        if (i === 0 && width === 800)
          await shot(page, `d1-toggled-${width}-${mode}`);
      }
      measure(`d1-${width}-${mode}`, { log, open, openShot, toggled });
      expect(open.rows).toBeGreaterThan(0);
      for (const each of [open, ...toggled]) {
        expectNewestInView(each);
        expect(each.scroll?.fromBottom ?? 99).toBeLessThanOrEqual(2);
      }
      expect(toggled.map((each) => each.folded)).toEqual(
        open.folded ? [false, true] : [true, false],
      );
      expect(openShot.colours).toBeGreaterThan(8);
      expect(log).toEqual([]);
    });
  }
}

// ── d2 · an open form never leaves the window ───────────────────────────
for (const [width, height] of [
  [1440, 900],
  [800, 500],
] as const) {
  for (const mode of ["dark", "light"] as Mode[]) {
    test(`d2 an open form stays in the window at ${width} ${mode}`, async ({
      page,
    }) => {
      const log: string[] = [];
      await page.setViewportSize({ width, height });
      await boot(page, { log, mode });
      await expect(page.getByTestId("room-stack")).toBeVisible({
        timeout: 20_000,
      });
      await speak(page);
      await page.mouse.move(width - 10, 10);
      await page.waitForTimeout(1200);
      if (await page.getByTestId("pending-held").isVisible())
        await page.getByTestId("pending-held").click();
      await page.getByTestId("needs-you-proposal-change").click();
      const form = page.getByTestId("runtime-task-confirmation");
      await expect(form).toBeVisible();
      await page.waitForTimeout(700);
      const read = async () =>
        page.evaluate(() => {
          const box = (el: Element | null) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { bottom: r.bottom, top: r.top };
          };
          const form = document.querySelector(
            '[data-testid="runtime-task-confirmation"]',
          );
          const body = document.querySelector(".luca-room-stack__body");
          const action = (name: string) =>
            box(
              [...(form?.querySelectorAll("button") ?? [])].find(
                (b) => b.textContent?.trim() === name,
              ) ?? null,
            );
          return {
            body: box(body),
            bodyScroll: body
              ? {
                  max: body.scrollHeight - body.clientHeight,
                  top: body.scrollTop,
                }
              : null,
            cancel: action("Cancel"),
            form: box(form),
            head: box(
              [...(form?.querySelectorAll("p") ?? [])].find(
                (p) => p.textContent?.trim() === "Run task",
              ) ?? null,
            ),
            run: action("Run"),
          };
        });
      const opened = await read();
      const geometry = await room(page);
      await shot(page, `d2-open-${width}-${mode}`);
      // Its actions, reached by scrolling the stack.
      await page.locator(".luca-room-stack__body").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.waitForTimeout(400);
      const scrolled = await read();
      await shot(page, `d2-actions-${width}-${mode}`);
      measure(`d2-${width}-${mode}`, { geometry, log, opened, scrolled });
      if (!geometry.stack || !geometry.section || !geometry.composer)
        throw new Error("no stack");
      // Bounded by the room above the message box.
      expect(geometry.whole).toBe(true);
      expect(geometry.stack.top).toBeGreaterThanOrEqual(geometry.section.top);
      expect(geometry.stack.bottom).toBeLessThanOrEqual(geometry.composer.top);
      expect(geometry.stack.bottom).toBeLessThanOrEqual(height);
      if (!opened.head || !opened.body || !scrolled.body)
        throw new Error("no form");
      // Opens with its head in view.
      expect(opened.head.top).toBeGreaterThanOrEqual(opened.body.top);
      expect(opened.head.bottom).toBeLessThanOrEqual(opened.body.bottom);
      // Its actions in the body and the window once scrolled to.
      for (const each of [scrolled.cancel, scrolled.run]) {
        if (!each) throw new Error("no action");
        expect(each.top).toBeGreaterThanOrEqual(scrolled.body.top);
        expect(each.bottom).toBeLessThanOrEqual(scrolled.body.bottom + 0.5);
        expect(each.bottom).toBeLessThanOrEqual(height);
      }
      if (width === 1440 && opened.form) {
        // Whole, with no scrolling.
        expect(opened.form.top).toBeGreaterThanOrEqual(opened.body.top);
        expect(opened.form.bottom).toBeLessThanOrEqual(
          opened.body.bottom + 0.5,
        );
      }
      // Cancel works where it was scrolled to.
      await form.getByRole("button", { exact: true, name: "Cancel" }).click();
      await expect(form).toHaveCount(0, { timeout: 10_000 });
      expect(log).toEqual([]);
    });
  }
}

// ── d3 · the right-hand card says the shared word ───────────────────────
for (const mode of ["dark", "light"] as Mode[]) {
  test(`d3 a stopped mind reads off on its card ${mode}`, async ({ page }) => {
    const log: string[] = [];
    await boot(page, { hash: "/", log, mode });
    await page
      .locator('[data-testid="app-sidebar"] button[aria-label="Wren"]')
      .first()
      .click();
    await page.getByTestId("shell-lip-details").click();
    const tab = page.locator('[data-testid^="drawer-context-agent"]').first();
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await tab.click();
    const state = page.getByTestId("resident-drawer-state");
    await expect(state).toBeVisible({ timeout: 20_000 });
    await page.mouse.move(1430, 10);
    await page.waitForTimeout(600);
    const word = (await state.textContent())?.replace(/\s+/g, "").trim();
    const rail = await page
      .locator('[data-testid="app-sidebar"]')
      .getByText(/^off$/i)
      .count();
    await shot(page, `d3-card-${mode}`);
    measure(`d3-${mode}`, { log, rail, word });
    expect(word?.split("·")[0]).toBe("Off");
    expect(log).toEqual([]);
  });
}

// ── flag off: the room as the integration base draws it ───────────────────
test("flag off matches the base", async ({ page }) => {
  const out: Record<string, unknown> = {};
  const at = async (origin: string | undefined, width: number) => {
    await page.setViewportSize({ width, height: width === 800 ? 500 : 900 });
    await boot(page, { baseURL: origin, flag: false });
    await expect(page.getByTestId("runtime-task-confirmation")).toBeVisible({
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
