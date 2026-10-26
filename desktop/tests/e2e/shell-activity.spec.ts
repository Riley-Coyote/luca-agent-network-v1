import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-14, what agents say to each other, and what needs you
 * (docs/luca/rail-system/SHELL_BUILD.md; NAVIGATION.md, "Activity" and
 * "Chats"): under `shell-frame` Activity opens on Needs you, every item
 * answerable in place, its count on the Activity icon and at the row's end;
 * Side conversations is one feed by day of every exchange and runtime task;
 * Luca's side conversations sit under Luca in the Chats rail; a connected
 * app's card says what Luca did with it. Every row comes from a seeded record
 * (exchanges in three rooms, three runtime tasks, a proposal, a permission
 * request, a question). Screenshots land in WP14_SHOTS when set, the
 * measurements in WP14_SHOTS/measures. The base build is at WP14_BASE_URL.
 */

const SHOTS = process.env.WP14_SHOTS ?? "test-results/shell-activity";
const BASE_URL = process.env.WP14_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

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

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

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

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 300_000 });

const AGENTS = [
  { name: "Luca", pubkey: LUCA, personaId: "builtin:fizz", status: "running" },
  { name: "Atlas", pubkey: ATLAS, status: "running" },
  { name: "Wren", pubkey: WREN, status: "running" },
] as const;

/** Exchanges in three rooms (open, paused, closed), and a permission
 *  request: the records both builds' mocks serve alike. */
const SHARED_SEEDS = {
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
        protocol: "luca.managed.permission.v1" as const,
        resident_pubkey: ATLAS,
        session_epoch: 1,
        title: "Run the release script",
        turn_id: "turn-1",
      },
    },
  ],
};

/** Runtime tasks (two for Claude Code, one for Codex), a proposal and a
 *  question: lists only this build's mock serves. */
const RUNTIME_SEEDS = {
  managedInputs: [
    {
      channelName: "design",
      pendingId: "question-word",
      request: {
        fields: [
          {
            description: null,
            key: "word",
            kind: "single" as const,
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
  runtimeTaskProposals: [
    {
      channelName: "general",
      createdAt: iso(5),
      proposalId: "proposal-notes",
      residentPubkey: LUCA,
      runtimeFamily: "claude_code" as const,
      summary: "Update the release notes for beta 7.",
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
    {
      channelName: "engineering",
      completedAt: iso(26 * 60),
      residentPubkey: ATLAS,
      runtimeFamily: "codex" as const,
      startedAt: iso(26 * 60 + 20),
      state: "succeeded" as const,
      summary: "Release script check",
      taskId: "task-release",
    },
  ],
};

async function boot(
  page: Page,
  {
    shell = true,
    hash,
    origin,
    runtime = true,
    permission = true,
  }: {
    shell?: boolean;
    hash: string;
    origin?: string;
    runtime?: boolean;
    /** false: no permission request (its card's eyes animate on a clock). */
    permission?: boolean;
  },
) {
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      console.log("BROWSER ERROR", message.text());
  });
  if (shell) {
    await page.addInitScript((key) => {
      const raw = window.localStorage.getItem(key);
      const overrides = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      overrides["shell-frame"] = true;
      window.localStorage.setItem(key, JSON.stringify(overrides));
    }, FEATURE_OVERRIDES_STORAGE_KEY);
  }
  await installMockBridge(page, {
    managedAgents: AGENTS.map((agent) => ({ ...agent })),
    exchanges: SHARED_SEEDS.exchanges,
    ...(permission
      ? { managedPermissions: SHARED_SEEDS.managedPermissions }
      : {}),
    ...(runtime ? RUNTIME_SEEDS : {}),
  });
  // No query of the page's own, so Back and the picks read the address as
  // the app's own window does. Retry a blank first load.
  await expect(async () => {
    await page.goto(`${origin ?? ""}/#${hash}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
}

/** The owner's first message of each exchange and a turn in each, at real
 *  times, as they would have been spoken. */
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
        "Atlas, are the release notes ready for Sam's read?",
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
      say(
        "engineering",
        "Luca agreed: ship it with the update feed.",
        at.done + 60,
        atlas,
        [["exchange", ids.done, "2"]],
      );
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

test("needs you: every kind, answered in place, counted", async ({ page }) => {
  await boot(page, { hash: "/pulse" });
  // Activity's first pick is Needs you (Decided 2).
  await expect(page.getByTestId("needs-you-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("stream=needs-you");
  await speak(page);
  const items = page.locator("[data-needs-kind]");
  await expect(items).toHaveCount(4, { timeout: 20_000 });
  await expect(page.getByTestId("place-row-needs-you")).toHaveAttribute(
    "data-active",
    "true",
  );
  const kinds = await items.evaluateAll((nodes) =>
    nodes.map((node) => ({
      kind: (node as HTMLElement).dataset.needsKind,
      ask: node.querySelector(".luca-needs-ask")?.textContent,
      when: node.querySelector(".luca-needs-when")?.textContent,
      answer: [
        ...node.querySelectorAll(
          '[data-testid="managed-permission-card"], [data-testid="managed-input-card"], [data-testid="runtime-task-confirmation"], [data-testid="needs-you-exchange"]',
        ),
      ].map((each) => each.getAttribute("data-testid")),
    })),
  );
  measure("needs_you_kinds", kinds);
  expect(kinds.map((each) => each.kind).sort()).toEqual([
    "exchange",
    "permission",
    "proposal",
    "question",
  ]);
  for (const each of kinds) expect(each.answer).toHaveLength(1);

  const count = async () => ({
    tile: (await page.getByTestId("open-activity-view-count").count())
      ? await page.getByTestId("open-activity-view-count").textContent()
      : null,
    tileLabel: await page
      .getByTestId("open-activity-view")
      .getAttribute("aria-label"),
    // Read without waiting: at zero the note is not drawn at all.
    row: await page
      .getByTestId("place-row-needs-you")
      .evaluate(
        (row) => row.querySelector(".luca-rail-note")?.textContent ?? null,
      ),
  });
  const before = await count();
  expect(before.tile).toBe("4");
  expect(before.row).toBe("4");
  const badgeBox = await page
    .getByTestId("open-activity-view-count")
    .boundingBox();
  measure("count_badge_before", { ...before, badgeBox });
  measure("shot_needs_you", await shot(page, "needs-you"));
  measure(
    "shot_activity_count",
    await shot(page, "activity-count", { x: 0, y: 0, width: 330, height: 260 }),
  );

  // Open goes to its conversation (checked on one), then back.
  await page
    .getByTestId("needs-you-permission:permission-release")
    .getByTestId("needs-you-open")
    .click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain(`/channels/${GENERAL}`);
  await page.goBack();
  await expect(items).toHaveCount(4, { timeout: 20_000 });

  // Answer one of each where it stands.
  const answered: Record<string, number> = {};
  const permission = page.getByTestId(
    "needs-you-permission:permission-release",
  );
  await permission.getByRole("button", { name: /once/i }).first().click();
  await expect(permission).toHaveCount(0, { timeout: 10_000 });
  answered.permission = await items.count();

  const question = page.getByTestId("needs-you-question:question-word");
  await question.getByLabel("Beta").check();
  await question.getByRole("button", { name: "Send answer" }).click();
  await expect(question).toHaveCount(0, { timeout: 10_000 });
  answered.question = await items.count();

  const proposal = page.getByTestId("needs-you-proposal:proposal-notes");
  await proposal.getByRole("button", { name: "Cancel runtime task" }).click();
  await expect(proposal).toHaveCount(0, { timeout: 10_000 });
  answered.proposal = await items.count();

  const exchange = page.getByTestId(`needs-you-exchange:${X_PAUSED}`);
  await exchange.getByTestId("needs-you-exchange-go").click();
  await expect(exchange).toHaveCount(0, { timeout: 10_000 });
  answered.exchange = await items.count();

  await expect(page.getByTestId("needs-you-empty")).toHaveText(
    "Nothing is waiting on you.",
  );
  const after = await count();
  measure("answer_in_place", { answered, after });
  expect(after.tile).toBeNull();
  expect(after.row).toBeNull();
  expect(after.tileLabel).toBe("Activity");
  measure("shot_needs_you_answered", await shot(page, "needs-you-answered"));
});

test("side conversations: one feed, by day", async ({ page }) => {
  await boot(page, { hash: "/pulse?stream=side" });
  await expect(page.getByTestId("side-conversations-card")).toBeVisible({
    timeout: 20_000,
  });
  await speak(page);
  const rows = page.locator("[data-side-kind]");
  await expect(rows).toHaveCount(6, { timeout: 20_000 });
  // The exchanges' times are their latest turns, heard live.
  await expect
    .poll(() =>
      page
        .getByTestId(`side-row-${X_OPEN}`)
        .locator(".luca-place-row-note")
        .textContent(),
    )
    .not.toBe("");
  const feed = await page
    .getByTestId("side-conversations-card")
    .evaluate((card) =>
      [...card.querySelectorAll('[data-testid="side-day"]')].map((day) => ({
        day: day.querySelector("h2")?.textContent,
        rows: [...day.querySelectorAll<HTMLElement>("[data-side-kind]")].map(
          (row) => ({
            kind: row.dataset.sideKind,
            state: row.dataset.sideState,
            title: row.querySelector(".luca-place-row-title")?.textContent,
            summary: row.querySelector(".luca-place-row-summary")?.textContent,
            detail: row.querySelector(".luca-place-row-detail")?.textContent,
            note: row.querySelector(".luca-place-row-note")?.textContent,
          }),
        ),
      })),
    );
  measure("side_feed", feed);
  // By day, newest first: each day once, the first one today.
  const dayLabels = feed.map((day) => day.day);
  expect(dayLabels[0]).toBe("Today");
  expect(new Set(dayLabels).size).toBe(dayLabels.length);
  const titles = feed.flatMap((day) => day.rows.map((row) => row.title));
  expect(titles).toEqual([
    "Luca asked Claude Code",
    "Luca asked Atlas",
    "Luca asked Wren",
    "Luca asked Claude Code",
    "Atlas asked Luca",
    "Atlas asked Codex",
  ]);
  const open = feed
    .flatMap((day) => day.rows)
    .find((row) => row.title === "Luca asked Atlas");
  if (!open) throw new Error("Expected the open exchange's row.");
  expect(open.state).toBe("talking");
  expect(open.detail).toContain("1 turn");
  expect(open.summary).toBe("general");
  measure("shot_side_conversations", await shot(page, "side-conversations"));

  // An exchange opens its room at its first message.
  await page.getByTestId(`side-row-${X_OPEN}`).getByRole("button").click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain(`/channels/${GENERAL}`);
  const opened = await page.evaluate(() => window.location.hash);
  measure("side_open", opened);
  expect(opened).toContain(`messageId=${ROOT.open}`);
});

test("Luca's side conversations under Luca in the Chats rail", async ({
  page,
}) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  const rail = page.getByTestId("chat-list");
  await expect(rail).toBeVisible({ timeout: 20_000 });
  await speak(page);
  const sideRows = page.locator('[data-home-group="luca"] [data-side-row]');
  await expect
    .poll(() => sideRows.count(), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
  // The latest few, and every one still talking or working.
  await expect
    .poll(() =>
      page
        .getByTestId(`rail-side-exchange:${X_OPEN}`)
        .locator(".luca-rail-session-title")
        .textContent()
        .catch(() => null),
    )
    .toBe("Atlas · general");
  await page.waitForTimeout(800);
  const read = () =>
    page.locator('[data-home-group="luca"]').evaluate((home) =>
      [...home.querySelectorAll<HTMLElement>(".luca-rail-session")].map(
        (row) => ({
          side: row.dataset.sideRow ?? null,
          label:
            row.querySelector(".luca-rail-session-title")?.textContent ??
            row.textContent,
          trailing:
            row.querySelector(".luca-rail-working, .luca-rail-session-ago")
              ?.textContent ?? null,
          working: Boolean(row.querySelector(".luca-rail-working")),
        }),
      ),
    );
  const folded = await read();
  for (const live of ["Atlas · general", "Claude Code · Rail glass plates"])
    expect(folded.map((row) => row.label)).toContain(live);
  for (const row of folded.filter((each) => each.side === "live"))
    expect(row.working).toBe(true);
  const box = await page.getByTestId("chat-list").boundingBox();
  measure(
    "shot_luca_side_rows",
    await shot(page, "luca-side-rows", {
      x: 0,
      y: 0,
      width: Math.ceil((box?.x ?? 60) + (box?.width ?? 260) + 8),
      height: 440,
    }),
  );
  // "N more" opens the rest; then all five of Luca's are there.
  const more = page.getByTestId("rail-more-luca");
  if (await more.count()) await more.click();
  const all = await read();
  measure("luca_rows", { all, folded });
  expect(
    all
      .filter((row) => row.side)
      .map((row) => row.label)
      .sort(),
  ).toEqual([
    "Atlas · engineering",
    "Atlas · general",
    "Claude Code · Fix the failing build",
    "Claude Code · Rail glass plates",
    "Wren · design",
  ]);
  // Each opens where it happened.
  await page.getByTestId(`rail-side-exchange:${X_DONE}`).click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toMatch(new RegExp(`(messageId|thread)=${ROOT.done}`));
});

test("a connected app: what Luca did with it", async ({ page }) => {
  await boot(page, { hash: "/agents?connected=claude-code" });
  await expect(page.getByTestId("connected-app-card")).toBeVisible({
    timeout: 20_000,
  });
  const history = page.getByTestId("connected-what-luca-did");
  await expect(history).toBeVisible({ timeout: 20_000 });
  await history.scrollIntoViewIfNeeded();
  const rows = await history.evaluate((list) =>
    [...list.querySelectorAll<HTMLElement>(".luca-place-row")].map((row) => ({
      title: row.querySelector(".luca-place-row-title")?.textContent,
      summary: row.querySelector(".luca-place-row-summary")?.textContent,
      detail: row.querySelector(".luca-place-row-detail")?.textContent,
      note: row.querySelector(".luca-place-row-note")?.textContent,
    })),
  );
  measure("connected_history", rows);
  expect(rows.map((row) => row.title)).toEqual([
    "Rail glass plates",
    "Fix the failing build",
  ]);
  measure(
    "shot_connected_what_luca_did",
    await shot(page, "connected-what-luca-did"),
  );
  await page
    .getByTestId("connected-task-task-build")
    .getByRole("button")
    .click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain(`/channels/${GENERAL}`);
});

test("800 x 500: needs you and side conversations", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await boot(page, { hash: "/pulse" });
  await expect(page.locator("[data-needs-kind]")).toHaveCount(4, {
    timeout: 20_000,
  });
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - window.innerWidth,
    card: (() => {
      const card = document.querySelector('[data-testid="needs-you-card"]');
      return card ? card.scrollWidth - card.clientWidth : null;
    })(),
  }));
  measure("narrow_overflow", overflow);
  expect(overflow.page).toBeLessThanOrEqual(0);
  measure("shot_needs_you_800", await shot(page, "needs-you-800"));
  await page
    .getByTestId("place-row-side")
    .click()
    .catch(async () => {
      await page.goto("/#/pulse?stream=side");
    });
  await expect(page.getByTestId("side-conversations-card")).toBeVisible();
  measure("shot_side_800", await shot(page, "side-conversations-800"));
});

test("flag off: the same as the base build", async ({ browser }) => {
  const result: Record<
    string,
    { here: string; base: string; baseAgain: string; same: boolean }
  > = {};
  for (const [name, hash, ready] of [
    ["chats", `/channels/${GENERAL}`, "chat-list"],
    ["activity", "/pulse", "owner-activity-view"],
    ["agents", "/agents", "agents-view"],
  ] as const) {
    const hashes: string[] = [];
    // The base twice: what differs between its own two loads is a clock
    // (the residents' eyes glance on a timer), not this package.
    for (const [index, origin] of ["", BASE_URL, BASE_URL].entries()) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await boot(page, {
        hash,
        origin,
        permission: false,
        runtime: false,
        shell: false,
      });
      await expect(page.getByTestId(ready).first()).toBeVisible({
        timeout: 20_000,
      });
      await page.waitForTimeout(1500);
      // The residents' eyes over the composer glance on a timer: the base
      // differs from itself there, so both builds' shots mask them.
      await page.evaluate(() => {
        for (const [x, y] of [
          [620, 763],
          [676, 763],
        ]) {
          const at = document.elementFromPoint(x, y);
          const mark =
            at?.closest("svg, canvas, [data-resident-mark], button") ?? at;
          mark?.setAttribute("data-flagoff-mask", "");
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
      base: hashes[1],
      baseAgain: hashes[2],
      here: hashes[0],
      same: hashes[0] === hashes[1],
    };
  }
  measure("flag_off", result);
  for (const each of Object.values(result)) expect(each.same).toBe(true);
});
