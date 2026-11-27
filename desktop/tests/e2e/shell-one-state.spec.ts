import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";
import { railGlassAtRest } from "./flagOffSettle";
import { chooseRailAgents } from "../helpers/railAgents";

/**
 * WP-18, one state and one mark for each mind
 * (docs/luca/rail-system/SHELL_BUILD.md; SPEC.md, "Selection"): a side
 * conversation opened from the rail, Side conversations or Needs you marks
 * Luca's home and lights its own row, never its room; in a room you haven't
 * joined the lip's Join is the one solid button; each mind has one state
 * (working, talking, waking, needs attention, resting), said alike in the
 * Agents rail, their head, their profile card and Now; the profile card's
 * Talk; Now names a live side conversation as Side conversations does, each
 * mind once. Seeds as shell-activity.spec.ts. Shots in WP18_SHOTS, the
 * measures in WP18_SHOTS/measures; the base build at WP18_BASE_URL.
 */

const SHOTS = process.env.WP18_SHOTS ?? "test-results/shell-one-state";
const BASE_URL = process.env.WP18_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const DESIGN = "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e";

const X_OPEN = "1".repeat(64);
const X_PAUSED = "2".repeat(64);
const X_DONE = "3".repeat(64);
const ROOT = {
  open: "e4".repeat(32),
  paused: "e5".repeat(32),
  done: "e6".repeat(32),
};

const NOW = Date.now();
const iso = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();
const secs = (minutesAgo: number) =>
  Math.floor((NOW - minutesAgo * 60_000) / 1000);

type Mode = "dark" | "light";

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** A shot, its hash, and whether it is one colour (a blank proves nothing). */
async function shot(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
  still = false,
) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({
    path,
    ...(clip ? { clip } : {}),
    ...(still
      ? {
          animations: "disabled" as const,
          mask: [page.locator("[data-flagoff-mask]")],
        }
      : {}),
  });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Solid: the primary fill, opaque and light on dark or dark on light,
 *  rather than the page's own ground (an outline button is filled with the
 *  ground). A tint of the ink (WP-25's quiet button, ink at 8%) is quiet,
 *  not solid (WP-28, Decided 4). */
function solid(background: string | undefined, mode: Mode) {
  const [r, g, b, a = 1] = (background?.match(/\d+(\.\d+)?/g) ?? []).map(
    Number,
  );
  if ([r, g, b].some((each) => each === undefined || Number.isNaN(each)))
    return false;
  if (a < 0.9) return false;
  const light = (r + g + b) / 3 > 128;
  return mode === "dark" ? light : !light;
}

test.use({ trace: "off", video: "off" });
test.describe.configure({ timeout: 300_000 });

const AGENTS = [
  { name: "Luca", pubkey: LUCA, personaId: "builtin:fizz", status: "running" },
  { name: "Atlas", pubkey: ATLAS, status: "running" },
  { name: "Wren", pubkey: WREN, status: "running" },
] as const;

const SEEDS = {
  exchanges: [
    {
      bucket: 3,
      channelName: "general",
      deadline: secs(-30),
      exchangeId: X_OPEN,
      members: [LUCA, ATLAS],
      openedBy: LUCA,
      rootEventId: ROOT.open,
      spent: 1,
    },
    {
      bucket: 3,
      channelName: "design",
      deadline: secs(-20),
      exchangeId: X_PAUSED,
      members: [LUCA, WREN],
      openedBy: LUCA,
      phase: "paused" as const,
      rootEventId: ROOT.paused,
      spent: 3,
    },
    {
      bucket: 3,
      channelName: "engineering",
      deadline: secs(60),
      exchangeId: X_DONE,
      members: [ATLAS, LUCA],
      openedBy: ATLAS,
      rootEventId: ROOT.done,
      spent: 2,
      state: "closed" as const,
    },
  ],
  runtimeTasks: [
    {
      channelName: "general",
      completedAt: iso(160),
      residentPubkey: LUCA,
      runtimeFamily: "claude_code" as const,
      startedAt: iso(180),
      state: "succeeded" as const,
      summary: "Fix the failing build",
      taskId: "task-build",
    },
    {
      channelName: "design",
      residentPubkey: LUCA,
      runtimeFamily: "claude_code" as const,
      startedAt: iso(10),
      state: "active" as const,
      summary: "Rail glass plates",
      taskId: "task-glass",
      updatedAt: iso(2),
    },
  ],
};

async function boot(
  page: Page,
  {
    hash,
    mode = "dark",
    origin,
    shell = true,
    seeds = true,
  }: {
    hash: string;
    mode?: Mode;
    origin?: string;
    shell?: boolean;
    seeds?: boolean;
  },
) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  await page.emulateMedia({ colorScheme: mode });
  if (shell)
    await page.addInitScript((key) => {
      const raw = window.localStorage.getItem(key);
      const overrides = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      overrides["shell-frame"] = true;
      window.localStorage.setItem(key, JSON.stringify(overrides));
    }, FEATURE_OVERRIDES_STORAGE_KEY);
  if (mode === "light")
    await page.addInitScript(() => {
      window.localStorage.setItem("buzz-theme", "paper");
      window.localStorage.setItem("buzz-follow-system", "false");
    });
  await installMockBridge(page, {
    managedAgents: AGENTS.map((agent) => ({ ...agent })),
    ...(seeds ? SEEDS : {}),
  });
  await chooseRailAgents(page);
  await expect(async () => {
    await page.goto(`${origin ?? ""}/#${hash}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
}

/** Each exchange's first message and a turn, as shell-activity.spec.ts. */
async function speak(page: Page) {
  await page.evaluate(
    ({ atlas, wren, luca, root, ids, at }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Expected the mock bridge.");
      const say = (
        channelName: string,
        content: string,
        createdAt: number,
        pubkey?: string,
        extraTags?: string[][],
        id?: string,
      ) =>
        emit({
          channelName,
          content,
          createdAt,
          extraTags,
          id,
          kind: 9,
          pubkey,
        });
      say(
        "general",
        "@Luca ask Atlas if the notes are ready.",
        at.open,
        undefined,
        undefined,
        root.open,
      );
      say(
        "general",
        "Atlas, are the release notes ready?",
        at.open + 30,
        luca,
        [["exchange", ids.open, "1"]],
      );
      say(
        "design",
        "@Luca check the walk-through time with Wren.",
        at.paused,
        undefined,
        undefined,
        root.paused,
      );
      say("design", "Wren moved it to Thursday.", at.paused + 120, wren, [
        ["exchange", ids.paused, "3"],
      ]);
      say(
        "engineering",
        "@Atlas ask Luca about the cache change.",
        at.done,
        undefined,
        undefined,
        root.done,
      );
      say("engineering", "Luca agreed: ship it.", at.done + 60, atlas, [
        ["exchange", ids.done, "2"],
      ]);
    },
    {
      at: { done: secs(300), open: secs(40), paused: secs(90) },
      atlas: ATLAS,
      ids: { done: X_DONE, open: X_OPEN, paused: X_PAUSED },
      luca: LUCA,
      root: ROOT,
      wren: WREN,
    },
  );
}

/** What the Chats rail marks: the glass homes, the lit rows, the mark. */
async function railMarks(page: Page) {
  return page.evaluate(() => {
    const rail = document.querySelector('[data-testid="chat-list"]');
    const active = [
      ...(rail?.querySelectorAll<HTMLElement>(
        '[data-home][data-active="true"]',
      ) ?? []),
    ].map((row) => row.dataset.home);
    const current = [
      ...(rail?.querySelectorAll<HTMLElement>('[data-current="true"]') ?? []),
    ].map((row) => ({
      id: row.dataset.sideId ?? row.dataset.channelId ?? null,
      ariaCurrent: row.getAttribute("aria-current"),
      color: getComputedStyle(
        row.querySelector(".luca-rail-session-title") ?? row,
      ).color,
    }));
    const lucaRow = rail?.querySelector<HTMLElement>('[data-home="luca"]');
    const mark = document.querySelector<HTMLElement>(".luca-mark--row");
    const markBox = mark?.getBoundingClientRect();
    const lucaBox = lucaRow?.getBoundingClientRect();
    return {
      active,
      current,
      markOnLuca:
        markBox && lucaBox
          ? Math.abs(markBox.top - lucaBox.top) < 2 &&
            Math.abs(markBox.height - lucaBox.height) < 2
          : null,
      markTop: markBox ? Math.round(markBox.top) : null,
      lucaTop: lucaBox ? Math.round(lucaBox.top) : null,
      hash: decodeURIComponent(window.location.hash),
    };
  });
}

async function settle(page: Page, ms = 900) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(ms);
}

// ── d1 · a side conversation marks where it belongs ─────────────────────
for (const [mode, width, height] of [
  ["dark", 1440, 900],
  ["light", 800, 500],
] as const) {
  test(`d1: a side conversation marks the home doing the work (${mode} ${width})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width, height },
    });
    const page = await context.newPage();
    await boot(page, { hash: `/channels/${GENERAL}`, mode });
    await expect(page.getByTestId("chat-list")).toBeVisible({
      timeout: 20_000,
    });
    await speak(page);
    const exchangeRow = page.getByTestId(`rail-side-exchange:${X_OPEN}`);
    await expect(exchangeRow).toBeVisible({ timeout: 20_000 });
    const out: Record<string, unknown> = {};
    // Before: the room is what is open.
    await settle(page);
    out.before = await railMarks(page);

    // From the rail: the exchange in general, then the task in design.
    await exchangeRow.click();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain(ROOT.open);
    await settle(page, 1500);
    out.railExchange = await railMarks(page);
    const exchangeAddress = await page.evaluate(() => window.location.hash);
    if (mode === "dark")
      out.shotRailExchange = await shot(
        page,
        `d1-rail-exchange-${mode}-${width}`,
      );
    // A task opens its own page (WP-35), marked under its app.
    await page.getByTestId("rail-side-task:task-glass").click();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain("/apps/claude/tasks/task-glass");
    await settle(page, 1500);
    out.railTask = await railMarks(page);
    out.shotRailTask = await shot(page, `d1-rail-task-${mode}-${width}`);
    // The task's room, by its address: one you haven't joined, where the
    // lip's Join is the one solid button.
    await page.evaluate((room) => {
      window.location.hash = `#/channels/${room}`;
    }, DESIGN);
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain(DESIGN);
    await settle(page, 1500);
    out.join = await page.evaluate(() => {
      const fill = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        return {
          text: node.textContent?.trim(),
          background: style.backgroundColor,
          border: style.borderTopColor,
          borderWidth: style.borderTopWidth,
        };
      };
      return {
        lip: fill('[data-testid="shell-lip-join"]'),
        banner: fill('[data-testid="join-banner"] button'),
      };
    });
    out.shotRailTaskRoom = await shot(
      page,
      `d1-rail-task-room-${mode}-${width}`,
    );

    // Opening the room's own row marks the room again.
    const generalRow = page.locator(
      `[data-testid="chat-list"] [data-home][data-channel-id="${GENERAL}"] [data-rail-focus="home"]`,
    );
    await generalRow.click();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .not.toContain(DESIGN);
    await settle(page);
    out.roomAgain = await railMarks(page);

    // From All activity (Side conversations retired with WP-34): the task;
    // then the exchange by its address, from outside the rail.
    await page.evaluate(() => {
      window.location.hash = "#/pulse?stream=all";
    });
    await expect(page.getByTestId("all-activity-card")).toBeVisible({
      timeout: 20_000,
    });
    await page
      .getByTestId("all-activity-task:task-glass")
      .locator(".luca-place-row-open")
      .click();
    // A task opens its own page (WP-35), marked under its app.
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain("/apps/claude/tasks/task-glass");
    await expect(page.getByTestId("chat-list")).toBeVisible({
      timeout: 20_000,
    });
    await settle(page, 1500);
    out.sideTask = await railMarks(page);
    await page.evaluate(() => {
      window.location.hash = "#/pulse?stream=all";
    });
    await expect(page.getByTestId("all-activity-card")).toBeVisible({
      timeout: 20_000,
    });
    await page.evaluate((address) => {
      window.location.hash = address;
    }, exchangeAddress);
    await expect(page.getByTestId("chat-list")).toBeVisible({
      timeout: 20_000,
    });
    await settle(page, 1500);
    out.sideExchange = await railMarks(page);

    // From Needs you: the paused exchange with Wren.
    await page.evaluate(() => {
      window.location.hash = "#/needs-you";
    });
    const needs = page.locator(
      '[data-needs-kind="exchange"] [data-testid="needs-you-open"]',
    );
    await expect(needs.first()).toBeVisible({ timeout: 20_000 });
    await needs.first().click();
    await expect(page.getByTestId("chat-list")).toBeVisible({
      timeout: 20_000,
    });
    await settle(page, 1500);
    out.needsExchange = await railMarks(page);
    measure(`d1-${mode}-${width}`, out);

    // The home doing the work is marked (WP-34, Decided 3): the agent an
    // exchange asks, the app a task runs in; never Luca, never the room.
    const lit = (
      marks: Awaited<ReturnType<typeof railMarks>>,
      id: string,
      home: string,
    ) =>
      marks.active.length === 1 &&
      marks.active[0] === home &&
      marks.current.length === 1 &&
      marks.current[0]?.id === id &&
      marks.current[0]?.ariaCurrent === "page";
    const atlasHome = `agent:${ATLAS}`;
    expect(
      lit(out.railExchange as never, `exchange:${X_OPEN}`, atlasHome),
    ).toBe(true);
    expect(lit(out.railTask as never, "task:task-glass", "app:claude")).toBe(
      true,
    );
    expect(lit(out.sideTask as never, "task:task-glass", "app:claude")).toBe(
      true,
    );
    expect(
      lit(out.sideExchange as never, `exchange:${X_OPEN}`, atlasHome),
    ).toBe(true);
    expect(
      lit(out.needsExchange as never, `exchange:${X_PAUSED}`, `agent:${WREN}`),
    ).toBe(true);
    const again = out.roomAgain as Awaited<ReturnType<typeof railMarks>>;
    expect(again.active).not.toContain(atlasHome);
    expect(again.active).not.toContain("app:claude");
    expect(again.current.some((row) => row.id?.startsWith("task:"))).toBe(
      false,
    );
    const join = out.join as {
      lip: { background: string } | null;
      banner: { background: string } | null;
    };
    expect(solid(join.lip?.background, mode)).toBe(true);
    expect(solid(join.banner?.background, mode)).toBe(false);
    await context.close();
  });
}

// ── d2, d3, d4 · one state, the card, Now ───────────────────────────────
for (const mode of ["dark", "light"] as const) {
  test(`d2-d4: one state for each mind, said alike (${mode})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await boot(page, { hash: "/agents", mode });
    await speak(page);
    const out: Record<string, unknown> = {};

    // The Agents rail.
    const note = (pubkey: string) =>
      page
        .getByTestId(`place-row-mind:${pubkey}`)
        .locator(".luca-rail-note")
        .textContent();
    await expect.poll(() => note(ATLAS), { timeout: 20_000 }).toBe("talking");
    out.rail = {
      atlas: await note(ATLAS),
      luca: await note(LUCA),
      wren: await note(WREN),
    };

    // Their heads.
    const head = async (pubkey: string) => {
      await page.evaluate((key) => {
        window.location.hash = `#/agents?profile=${key}`;
      }, pubkey);
      const now = page.getByTestId("mind-now");
      await expect(now).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(900);
      return {
        text: await now.textContent(),
        state: await now.getAttribute("data-mind-state"),
      };
    };
    out.head = { atlas: await head(ATLAS), luca: await head(LUCA) };
    if (mode === "dark")
      out.shotHead = await shot(page, `d2-luca-head-${mode}`, {
        x: 300,
        y: 40,
        width: 1000,
        height: 160,
      });

    // Their profile cards.
    const card = async (pubkey: string) => {
      await page.evaluate(
        ({ key, room }) => {
          window.location.hash = `#/channels/${room}?profile=${key}`;
        },
        { key: pubkey, room: GENERAL },
      );
      const summary = page.getByTestId("profile-agent-summary");
      await expect(summary).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(900);
      return {
        state: await page
          .getByTestId("profile-agent-summary-state")
          .textContent(),
        buttons: await summary.getByRole("button").evaluateAll((items) =>
          items.map((each) => {
            const style = getComputedStyle(each);
            return {
              text: each.textContent?.trim(),
              background: style.backgroundColor,
              color: style.color,
            };
          }),
        ),
      };
    };
    const atlasCard = await card(ATLAS);
    out.shotCard = await shot(page, `d3-atlas-card-${mode}`);
    out.card = { atlas: atlasCard, luca: await card(LUCA) };

    // Now retired with WP-34: live work shows once, in the Chats rail,
    // under whoever does it.
    await page.getByTestId("shell-place-conversations").click();
    await expect(page.getByTestId("chat-list")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId(`rail-side-exchange:${X_OPEN}`)).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(1500);
    out.now = await page
      .locator('[data-shell-rail] [data-side-row="live"]')
      .evaluateAll((rows) =>
        rows.map((row) => ({
          title: row.querySelector(".luca-rail-session-title")?.textContent,
          home: row.closest<HTMLElement>("[data-home-group]")?.dataset
            .homeGroup,
          state: row.querySelector(".luca-rail-working")?.textContent ?? null,
        })),
      );
    out.shotNow = await shot(page, `d4-now-${mode}`);
    measure(`d2-d4-${mode}`, out);

    const rail = out.rail as Record<string, string>;
    const heads = out.head as Record<string, { state: string; text: string }>;
    const cards = out.card as Record<
      string,
      { state: string; buttons: { text: string; background: string }[] }
    >;
    const now = out.now as { title: string; state: string; home: string }[];
    // d2: Atlas talking with Luca reads talking in all four; Luca, whose
    // task runs, reads working in all four.
    expect(rail.atlas).toBe("talking");
    expect(heads.atlas.state).toBe("talking");
    expect(heads.atlas.text).toContain("Talking");
    expect(cards.atlas.state).toBe("Talking");
    const atlasNow = now.find((row) => row.home === `agent:${ATLAS}`);
    expect(atlasNow?.state).toBe("talking");
    expect(rail.luca).toBe("working");
    expect(heads.luca.state).toBe("working");
    expect(cards.luca.state).toBe("Working");
    expect(now.find((row) => row.home === "app:claude")?.state).toBe("working");
    // d3: Open their space and Talk, neither solid.
    expect(cards.atlas.buttons.map((button) => button.text)).toEqual([
      "Open their space",
      "Talk",
    ]);
    for (const button of cards.atlas.buttons)
      expect(solid(button.background, mode)).toBe(false);
    // d4: each piece of live work once, under whoever does it; none under
    // Luca, who is one chat.
    expect(now.map((row) => `${row.home} ${row.title}`).sort()).toEqual([
      `agent:${ATLAS} Luca · general`,
      "app:claude Rail glass plates",
    ]);
    await context.close();
  });
}

// ── 800 × 500: the state words still read, live work still once ─────────
test("d2/d4 at 800 x 500 (dark)", async ({ browser }) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 800, height: 500 },
  });
  const page = await context.newPage();
  await boot(page, { hash: `/channels/${GENERAL}` });
  await speak(page);
  await expect(page.getByTestId(`rail-side-exchange:${X_OPEN}`)).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1500);
  const rows = await page
    .locator('[data-shell-rail] [data-side-row="live"]')
    .evaluateAll((nodes) =>
      nodes.map(
        (node) =>
          `${node.closest<HTMLElement>("[data-home-group]")?.dataset.homeGroup} ${node.querySelector(".luca-rail-session-title")?.textContent}`,
      ),
    );
  const hash = await shot(page, "d4-now-dark-800");
  measure("d4-now-800", { rows, hash });
  expect(rows).toContain(`agent:${ATLAS} Luca · general`);
  expect(new Set(rows).size).toBe(rows.length);
  await context.close();
});

// ── the flag off: the same as the base build ────────────────────────────
test("flag off: the same as the base build", async ({ browser }) => {
  const result: Record<string, unknown> = {};
  for (const [name, hash, ready] of [
    ["general", `/channels/${GENERAL}`, "chat-list"],
    ["design", `/channels/${DESIGN}`, "join-banner"],
    ["activity", "/pulse?stream=now", "owner-activity-view"],
    ["agents", "/agents", "agents-view"],
    ["profile", `/channels/${GENERAL}?profile=${ATLAS}`, "user-profile-panel"],
  ] as const) {
    const hashes: string[] = [];
    for (const [index, origin] of ["", BASE_URL, BASE_URL].entries()) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
      });
      // Both builds' clocks start at the same instant (WP-21, 3), so a time
      // printed on the page can't differ by a minute between the two shots.
      await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
      const page = await context.newPage();
      await boot(page, { hash, origin, shell: false });
      await expect(page.getByTestId(ready).first()).toBeVisible({
        timeout: 20_000,
      });
      await speak(page);
      await page.waitForTimeout(2000);
      await railGlassAtRest(page);
      // Only small animated marks are masked: the residents' eyes.
      await page.evaluate(() => {
        for (const node of document.querySelectorAll<HTMLElement>(
          "canvas, [data-resident-mark]",
        )) {
          const box = node.getBoundingClientRect();
          if (box.width < 200 && box.height < 200)
            node.setAttribute("data-flagoff-mask", "");
        }
      });
      hashes.push(
        await shot(
          page,
          `flagoff-${name}-${["here", "base", "base-again"][index]}`,
          undefined,
          true,
        ),
      );
      await context.close();
    }
    result[name] = {
      here: hashes[0],
      base: hashes[1],
      baseAgain: hashes[2],
      same: hashes[0] === hashes[1],
      baseStable: hashes[1] === hashes[2],
    };
  }
  measure("flag_off", result);
  // Each shot is checked for more than one colour afterwards (the report's
  // non-blank check): a hash of a blank page would match anything.
  for (const each of Object.values(result) as { same: boolean }[])
    expect(each.same).toBe(true);
});
