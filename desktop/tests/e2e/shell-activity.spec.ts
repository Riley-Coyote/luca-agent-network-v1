import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";
import { railGlassAtRest } from "./flagOffSettle";
import { chooseRailAgents } from "../helpers/railAgents";

/**
 * WP-14, what agents say to each other, and what needs you
 * (docs/luca/rail-system/SHELL_BUILD.md; NAVIGATION.md, "Activity" and
 * "Chats"), as WP-34 moved them (BETA14_RELEASE.md): Needs you tops the
 * Chats rail and opens in the Chats card, every item answerable in place,
 * its count on the Chats icon and at the row's end; Activity is the record
 * (All activity, a thread by day); the work hangs in the Chats rail under
 * whoever does it (an exchange under the agent asked, a task under its app);
 * a connected app's card, now in Chats, says what Luca did with it. Every row comes from a seeded record
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
  await chooseRailAgents(page);
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
  // Needs you opens from the top of the Chats rail, in the Chats card
  // (WP-34, Decided 2).
  await boot(page, { hash: "/needs-you" });
  await expect(page.getByTestId("needs-you-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("/needs-you");
  await speak(page);
  const items = page.locator("[data-needs-kind]");
  await expect(items).toHaveCount(4, { timeout: 20_000 });
  await expect(page.getByTestId("rail-needs-you")).toHaveAttribute(
    "data-active",
    "true",
  );
  const kinds = await items.evaluateAll((nodes) =>
    nodes.map((node) => {
      const row = node.querySelector<HTMLElement>(".luca-place-row");
      const title = node.querySelector(".luca-place-row-title");
      const note = node.querySelector(".luca-place-row-note");
      const box = row?.getBoundingClientRect();
      return {
        kind: (node as HTMLElement).dataset.needsKind,
        title: title?.textContent,
        titleSize: title ? getComputedStyle(title).fontSize : null,
        summary: node.querySelector(".luca-place-row-summary")?.textContent,
        note: note?.textContent,
        noteRight: note ? Math.round(note.getBoundingClientRect().right) : null,
        answers: [
          ...node.querySelectorAll<HTMLElement>(".luca-ask-answers button"),
        ].map((button) => ({
          label: button.textContent,
          border: getComputedStyle(button).borderTopWidth,
          fill: getComputedStyle(button).backgroundColor,
        })),
        extra: node.querySelector(".luca-ask-extra")?.textContent ?? null,
        // No outline, fill or shadow around an item.
        item: {
          background: getComputedStyle(node).backgroundColor,
          border: getComputedStyle(node).borderTopWidth,
          shadow: getComputedStyle(node).boxShadow,
        },
        rowHeight: box ? Math.round(box.height * 10) / 10 : null,
        forms: node.querySelectorAll(
          '[data-testid="managed-permission-card"], [data-testid="managed-input-card"], [data-testid="runtime-task-confirmation"]',
        ).length,
      };
    }),
  );
  const firstRowGap = await page.evaluate(() => {
    const eyebrow = document.querySelector(
      '[data-testid="needs-you-card"] .luca-place-group > h2',
    );
    const title = document.querySelector(
      '[data-testid="needs-you-card"] .luca-place-row-title',
    );
    return eyebrow && title
      ? Math.round(
          title.getBoundingClientRect().top -
            eyebrow.getBoundingClientRect().bottom,
        )
      : null;
  });
  measure("needs_you_kinds", { firstRowGap, kinds });
  expect(kinds.find((each) => each.kind === "question")?.title).toBe(
    "Should the Tidepool page say preview or beta?",
  );
  const questionCut = await page
    .getByTestId("needs-you-question:question-word")
    .locator(".luca-place-row-title")
    .evaluate((title) => title.scrollWidth > title.clientWidth + 1);
  expect(questionCut).toBe(false);
  for (const each of kinds) {
    expect(each.forms).toBe(0);
    expect(each.answers.length).toBeGreaterThan(0);
    expect(each.item.shadow).toBe("none");
    // On the page an ask's own words are 15/21 (BETA14_RELEASE.md WP-33,
    // Decided 6), led by the asker's face.
    expect(each.titleSize).toBe("15px");
  }
  expect(new Set(kinds.map((each) => each.noteRight)).size).toBe(1);
  expect(kinds.find((each) => each.kind === "permission")?.note).toBe("now");
  expect(
    kinds
      .find((each) => each.kind === "permission")
      ?.answers.map((a) => a.label),
  ).toEqual(["Deny", "Once"]);
  expect(
    kinds.find((each) => each.kind === "question")?.answers.map((a) => a.label),
  ).toEqual(["Preview", "Beta", "Send", "Skip"]);
  expect(
    kinds.find((each) => each.kind === "proposal")?.answers.map((a) => a.label),
  ).toEqual(["Run", "Not now"]);
  expect(kinds.find((each) => each.kind === "proposal")?.extra).toContain(
    "Claude Code · ask when needed",
  );
  expect(kinds.find((each) => each.kind === "permission")?.summary).toBe(
    "Atlas asks · general",
  );

  // The permission's preview sits behind Details; Change… opens the form.
  const permissionRow = page.getByTestId(
    "needs-you-permission:permission-release",
  );
  await permissionRow.getByRole("button", { name: "Details" }).click();
  await expect(permissionRow.getByTestId("needs-you-details")).toContainText(
    "./scripts/release.sh --dry-run",
  );
  const proposalRow = page.getByTestId("needs-you-proposal:proposal-notes");
  await proposalRow.getByTestId("needs-you-proposal-change").click();
  await expect(
    proposalRow.getByTestId("runtime-task-confirmation"),
  ).toBeVisible();
  measure("shot_needs_you_open", await shot(page, "needs-you-details-open"));
  await proposalRow.getByTestId("needs-you-proposal-change").click();
  await permissionRow.getByRole("button", { name: "Hide details" }).click();

  // The whole row opens, not just its title (fix 10): its time cell, here.
  const rowStyle = await permissionRow
    .locator(".luca-place-row")
    .evaluate((row) => getComputedStyle(row).cursor);
  measure("row_cursor", rowStyle);
  expect(rowStyle).toBe("pointer");
  await permissionRow.locator(".luca-place-row").hover();
  await page.waitForTimeout(250);
  measure(
    "row_hover_plate",
    await permissionRow
      .locator(".luca-place-row")
      .evaluate((row) => getComputedStyle(row).backgroundColor),
  );
  // A press in the time cell lands on the row's own target.
  const rowBox = await permissionRow.locator(".luca-place-row").boundingBox();
  if (!rowBox) throw new Error("Expected the permission's row.");
  await permissionRow
    .locator(".luca-place-row")
    .click({ position: { x: rowBox.width - 24, y: 16 } });
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain(`/channels/${GENERAL}`);
  await page.goBack();
  await expect(items).toHaveCount(4, { timeout: 20_000 });
  expect(kinds.map((each) => each.kind).sort()).toEqual([
    "exchange",
    "permission",
    "proposal",
    "question",
  ]);

  // The count moved from Activity to Chats (WP-34, Decided 2).
  const count = async () => ({
    tile: (await page.getByTestId("shell-place-conversations-count").count())
      ? await page.getByTestId("shell-place-conversations-count").textContent()
      : null,
    tileLabel: await page
      .getByTestId("shell-place-conversations")
      .getAttribute("aria-label"),
    activityTile: await page.getByTestId("open-activity-view-count").count(),
    // Read without waiting: at zero the note is not drawn at all.
    row: await page
      .getByTestId("rail-needs-you")
      .evaluate(
        (row) => row.querySelector(".luca-rail-needs")?.textContent ?? null,
      ),
  });
  const before = await count();
  expect(before.tile).toBe("4");
  expect(before.row).toBe("4");
  expect(before.activityTile).toBe(0);
  const badge = await page.evaluate(() => {
    const tile = document.querySelector(
      '[data-testid="shell-place-conversations"]',
    );
    const count = document.querySelector(
      '[data-testid="shell-place-conversations-count"]',
    );
    const dot = document.querySelector(
      '[data-testid="shell-place-conversations"]',
    );
    if (!tile || !count) return null;
    const t = tile.getBoundingClientRect();
    const c = count.getBoundingClientRect();
    const style = getComputedStyle(count);
    const probe = document.createElement("span");
    probe.style.background = "hsl(var(--mn-signal))";
    document.body.append(probe);
    const signal = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      background: style.backgroundColor,
      signal,
      fontSize: style.fontSize,
      centreFromRight: Math.round((t.right - (c.left + c.right) / 2) * 10) / 10,
      centreFromTop: Math.round(((c.top + c.bottom) / 2 - t.top) * 10) / 10,
      overhangs:
        c.right > t.right + 0.5 ||
        c.top < t.top - 0.5 ||
        c.left < t.left ||
        c.bottom > t.bottom,
      iconMask: getComputedStyle(tile.querySelector("svg") as Element)
        .maskImage,
      chatsTile: Boolean(dot),
    };
  });
  measure("count_badge_before", { ...before, badge });
  expect(badge?.background).toBe(badge?.signal);
  expect(badge?.fontSize).toBe("11px");
  expect(badge?.overhangs).toBe(false);
  expect(badge?.centreFromRight).toBe(7);
  expect(badge?.centreFromTop).toBe(7);
  expect(badge?.iconMask).toContain("radial-gradient");
  await page.mouse.move(1300, 860);
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

  // Answer one of each where it stands, from the keyboard: after each, focus
  // is on the next item's first control, and after the last on the empty
  // line, never back at the page's top.
  const answered: Record<string, number> = {};
  const focusAfter: Record<string, string | null> = {};
  const whereFocus = () =>
    page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return "body";
      const item = active.closest<HTMLElement>("[data-needs-key]");
      return item
        ? `${item.dataset.needsKey} ${active.dataset.testid ?? active.tagName}`
        : (active.dataset.testid ?? active.tagName);
    });
  const order = await items.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.needsKey),
  );
  measure("needs_you_order", order);
  const answer = async (key: string, press: () => Promise<void>) => {
    const item = page.getByTestId(`needs-you-${key}`);
    await press();
    await expect(item).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(200);
    answered[key] = await items.count();
    focusAfter[key] = await whereFocus();
  };
  await answer("permission:permission-release", async () => {
    await page
      .getByTestId("needs-you-permission:permission-release")
      .getByRole("button", { name: /once/i })
      .first()
      .focus();
    await page.keyboard.press("Enter");
  });
  await answer("question:question-word", async () => {
    const question = page.getByTestId("needs-you-question:question-word");
    await question.getByRole("button", { name: "Beta", exact: true }).focus();
    await page.keyboard.press("Space");
    await question.getByTestId("needs-you-question-send").focus();
    await page.keyboard.press("Enter");
  });
  await answer("proposal:proposal-notes", async () => {
    await page
      .getByTestId("needs-you-proposal:proposal-notes")
      .getByTestId("needs-you-proposal-not-now")
      .focus();
    await page.keyboard.press("Enter");
  });
  await answer(`exchange:${X_PAUSED}`, async () => {
    await page
      .getByTestId(`needs-you-exchange:${X_PAUSED}`)
      .getByTestId("needs-you-exchange-go")
      .focus();
    await page.keyboard.press("Enter");
  });
  measure("focus_after_answer", focusAfter);
  // The next item's Open (its first control) after each; the line at the end.
  let left = [...order];
  for (const key of Object.keys(focusAfter)) {
    const at = left.indexOf(key);
    left = left.filter((each) => each !== key);
    const next = left[Math.min(at, left.length - 1)];
    expect(focusAfter[key]).toBe(
      next ? `${next} needs-you-open` : "needs-you-empty",
    );
  }
  await expect(page.getByTestId("needs-you-empty")).toHaveText(
    "Nothing is waiting on you.",
  );
  const after = await count();
  measure("answer_in_place", { answered, after });
  expect(after.tile).toBeNull();
  expect(after.row).toBeNull();
  expect(after.tileLabel).toBe("Chats");
  measure("shot_needs_you_answered", await shot(page, "needs-you-answered"));
});

// Side conversations retired with WP-34 (Decided 10): Activity is the
// record, a thread by day, and what passed between two minds is in the work
// itself, hung in the Chats rail under whoever does it.
test("all activity: one thread, by day; exchanges hang in the rail", async ({
  page,
}) => {
  await boot(page, { hash: "/pulse" });
  await expect(page.getByTestId("all-activity-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("stream=all");
  await speak(page);
  const rows = page.locator("[data-activity-kind='task']");
  await expect(rows).toHaveCount(3, { timeout: 20_000 });
  const feed = await page.getByTestId("all-activity-card").evaluate((card) =>
    [...card.querySelectorAll('[data-testid="all-activity-day"]')].map(
      (day) => ({
        // The label's words, not its count (WP-33, Decided 2).
        day: day.querySelector("h2 > span")?.textContent,
        thread: day.querySelector("ul")?.getAttribute("data-thread"),
        rows: [
          ...day.querySelectorAll<HTMLElement>("[data-activity-kind]"),
        ].map((row) => ({
          kind: row.dataset.activityKind,
          title: row.querySelector(".luca-place-row-title")?.textContent,
          summary: row.querySelector(".luca-place-row-summary")?.textContent,
          note: row.querySelector(".luca-place-row-note")?.textContent,
        })),
      }),
    ),
  );
  measure("all_activity_feed", feed);
  // By day, newest first: each day once, the first one today, each a thread.
  const dayLabels = feed.map((day) => day.day);
  expect(dayLabels[0]).toBe("Today");
  expect(new Set(dayLabels).size).toBe(dayLabels.length);
  for (const day of feed) expect(day.thread).toBe("true");
  const tasks = feed
    .flatMap((day) => day.rows)
    .filter((row) => row.kind === "task");
  expect(tasks.map((row) => row.title)).toEqual([
    "Claude Code · Rail glass plates",
    "Claude Code · Fix the failing build",
    "Codex · Release script check",
  ]);
  expect(tasks[0].summary).toBe("working · for Luca · design");
  expect(tasks[2].summary).toBe("done · for Atlas · engineering");
  for (const row of tasks) expect(row.note).not.toBe("");
  measure("shot_all_activity", await shot(page, "all-activity"));

  // The exchange Luca opened with Atlas hangs under Atlas in the Chats rail,
  // and opens its room at its first message.
  await page.getByTestId("shell-place-conversations").click();
  const row = page.getByTestId(`rail-side-exchange:${X_OPEN}`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(
    page
      .locator(`[data-home-group="agent:${ATLAS}"]`)
      .getByTestId(`rail-side-exchange:${X_OPEN}`),
  ).toBeVisible();
  await row.click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 15_000 })
    .toContain(ROOT.open);
  // It stays there: nothing rewrites it afterwards.
  await page.waitForTimeout(1500);
  const opened = await page.evaluate(() => window.location.hash);
  measure("side_open", opened);
  expect(opened).toContain(ROOT.open);
});

// WP-34, Decided 3: only work nests. Luca's side conversations moved under
// whoever does the work: an exchange under the agent it asks, a task under
// the app that runs it.
test("the work under whoever does it, in the Chats rail", async ({ page }) => {
  await boot(page, { hash: `/channels/${GENERAL}` });
  const rail = page.getByTestId("chat-list");
  await expect(rail).toBeVisible({ timeout: 20_000 });
  await speak(page);
  await expect(page.getByTestId(`rail-side-exchange:${X_OPEN}`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("rail-side-task:task-glass")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
  const read = (group: string) =>
    page.locator(`[data-home-group="${group}"]`).evaluate((home) =>
      [...home.querySelectorAll<HTMLElement>("[data-side-row]")].map((row) => ({
        side: row.dataset.sideRow ?? null,
        label: row.querySelector(".luca-rail-session-title")?.textContent,
        trailing:
          row.querySelector(
            ".luca-rail-working, .luca-rail-status, .luca-rail-session-ago",
          )?.textContent ?? null,
      })),
    );
  const work = {
    luca: await page
      .locator('[data-home-group="luca"] [data-side-row]')
      .count(),
    atlas: await read(`agent:${ATLAS}`),
    wren: await read(`agent:${WREN}`),
    claude: await read("app:claude"),
    codex: await read("app:codex"),
  };
  measure("work_rows", work);
  // Luca is one chat: nothing hangs under it.
  expect(work.luca).toBe(0);
  // The words (fix 16): talking… for a live exchange, working… for a
  // running task, paused for a paused one.
  expect(work.atlas).toContainEqual({
    side: "live",
    label: "Luca · general",
    trailing: "talking",
  });
  expect(work.wren).toContainEqual({
    side: "quiet",
    label: "Luca · design",
    trailing: "paused",
  });
  expect(work.claude.map((row) => row.label)).toEqual([
    "Rail glass plates",
    "Fix the failing build",
  ]);
  expect(work.claude[0].trailing).toBe("working");
  expect(work.claude[1].trailing).toMatch(/^\d+[mhdw]$/);
  expect(work.codex.map((row) => row.label)).toEqual(["Release script check"]);
  // Atlas asked Luca in engineering: Luca nests nothing, so it hangs nowhere.
  await expect(page.getByTestId(`rail-side-exchange:${X_DONE}`)).toHaveCount(0);
  const box = await rail.boundingBox();
  await page
    .getByTestId("rail-side-task:task-build")
    .evaluate((row) => row.scrollIntoView({ block: "end" }));
  measure(
    "shot_work_rows",
    await shot(page, "work-rows", {
      x: 0,
      y: 0,
      width: Math.ceil((box?.x ?? 60) + (box?.width ?? 260) + 8),
      height: 900,
    }),
  );
  // Folded, an app's home says what is live out of sight (fix 12).
  await page
    .getByTestId("rail-home-app:claude")
    .locator("[data-chevron]")
    .click();
  const foldedHome = await page
    .getByTestId("rail-home-app:claude")
    .evaluate((row) => ({
      signal: row.querySelector(".luca-rail-signal")?.textContent ?? null,
      label: row
        .querySelector("[data-rail-focus=home]")
        ?.getAttribute("aria-label"),
    }));
  measure("app_folded", foldedHome);
  expect(foldedHome.signal).toBe("working");
  expect(foldedHome.label).toContain("working");
  await page
    .getByTestId("rail-home-app:claude")
    .locator("[data-chevron]")
    .click();
  // A task opens its own page (WP-35), finished or not, marked under its
  // app; the lip names it under the app.
  await page.getByTestId("rail-side-task:task-build").click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("/apps/claude/tasks/task-build");
  await expect(page.getByTestId("rail-side-task:task-build")).toHaveAttribute(
    "data-current",
    "true",
  );
  await expect(page.getByTestId("rail-home-app:claude")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("shell-lip")).toContainText(
    /Claude Code\s*\/\s*Fix the failing build/,
  );
});

test("a connected app: what Luca did with it", async ({ page }) => {
  // The minds' states are read on the Agents rail; the app's card is in
  // Chats since WP-34 (Decided 9).
  await boot(page, { hash: "/agents" });
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  // A mind running a runtime task counts as working (review, fix 5); Atlas,
  // whose Codex task is done, is talking with Luca in general (an exchange
  // still open): one state for each mind (WP-18, Decided 2).
  const stateOf = (pubkey: string) =>
    page
      .getByTestId(`place-row-mind:${pubkey}`)
      .locator(".luca-rail-note")
      .textContent();
  await expect.poll(() => stateOf(LUCA), { timeout: 20_000 }).toBe("working");
  measure("working_rule", {
    atlas: await stateOf(ATLAS),
    luca: await stateOf(LUCA),
  });
  expect(await stateOf(ATLAS)).toBe("talking");
  await page.getByTestId("shell-place-conversations").click();
  await page
    .getByTestId("rail-home-app:claude")
    .locator("[data-rail-focus=home]")
    .click();
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
  // Luca's runs only, the room alone under each (fix 11), and the list 32
  // below Sessions (fix 17).
  expect(rows.map((row) => row.summary)).toEqual(["design", "general"]);
  const gap = await page.evaluate(() => {
    const history = document.querySelector(
      '[data-testid="connected-what-luca-did"]',
    );
    const before = history?.parentElement?.previousElementSibling;
    return history && before
      ? Math.round(
          history.getBoundingClientRect().top -
            before.getBoundingClientRect().bottom,
        )
      : null;
  });
  measure("connected_gap", gap);
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
  // A task opens its own page (WP-35).
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toContain("/apps/claude/tasks/task-build");
});

test("800 x 500: needs you and all activity", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await boot(page, { hash: "/needs-you" });
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
  const asks = await page.locator("[data-needs-kind]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const title = node.querySelector(".luca-place-row-title") as HTMLElement;
      const what = node.querySelector(".luca-place-row-what") as HTMLElement;
      const answers = node.querySelector(".luca-ask-answers") as HTMLElement;
      return {
        title: title.textContent,
        cut: title.scrollWidth > title.clientWidth + 1,
        answersBelow:
          answers.getBoundingClientRect().top >=
          what.getBoundingClientRect().bottom - 1,
      };
    }),
  );
  measure("narrow_asks", asks);
  for (const ask of asks) {
    expect(ask.cut).toBe(false);
    expect(ask.answersBelow).toBe(true);
  }
  measure("shot_needs_you_800", await shot(page, "needs-you-800"));
  await page.goto("/#/pulse");
  await expect(page.getByTestId("all-activity-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("[data-activity-kind]").first()).toBeVisible({
    timeout: 20_000,
  });
  const allOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  measure("narrow_all_activity_overflow", allOverflow);
  expect(allOverflow).toBeLessThanOrEqual(0);
  measure("shot_all_activity_800", await shot(page, "all-activity-800"));
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
      // Both builds' clocks start at the same instant (WP-21, 3), so a time
      // printed on the page can't differ by a minute between the two shots.
      await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
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
      await railGlassAtRest(page);
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

test("landing on an exchange: its message in view, named for you", async ({
  page,
}) => {
  // From its row under Atlas in the Chats rail (WP-34; Side conversations'
  // feed before).
  await boot(page, { hash: "/needs-you" });
  await expect(page.getByTestId("chat-list")).toBeVisible({ timeout: 20_000 });
  await speak(page);
  const exchange = page.getByTestId(`rail-side-exchange:${X_OPEN}`);
  await expect(exchange).toBeVisible({ timeout: 20_000 });
  // general holds a permission request and a proposal: the waiting stack.
  await exchange.click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { timeout: 15_000 })
    .toContain(`thread=${ROOT.open}`);
  const bar = page.getByTestId("focused-thread-bar");
  await expect(bar).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const geometry = await page.evaluate((root) => {
    const rect = (el: Element | null | undefined) => {
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        left: Math.round(box.left),
        right: Math.round(box.right),
      };
    };
    const message = document.querySelector(
      `[data-message-id="${root}"], [data-event-id="${root}"]`,
    );
    const visible = (el: Element | null) =>
      el
        ? getComputedStyle(el).display !== "none" &&
          el.getClientRects().length > 0
        : false;
    const stackCards = [
      ...document.querySelectorAll(
        '[data-testid="managed-permission-card"], [data-testid="runtime-task-confirmation"], [data-testid="runtime-task-proposal-row"]',
      ),
    ].filter(visible);
    return {
      barText: document
        .querySelector('[data-testid="focused-thread-bar"]')
        ?.textContent?.replace(/\s+/g, " "),
      bar: rect(document.querySelector('[data-testid="focused-thread-bar"]')),
      day: rect(
        [
          ...document.querySelectorAll(".type-eyebrow, [data-day-divider]"),
        ].find((el) => /today/i.test(el.textContent ?? "")),
      ),
      pill: rect(document.querySelector('[data-testid="message-unread-pill"]')),
      message: rect(message),
      messageFound: Boolean(message),
      held: rect(document.querySelector('[data-testid="pending-held"]')),
      heldText: document.querySelector('[data-testid="pending-held"]')
        ?.textContent,
      stackCards: stackCards.map((el) => rect(el)),
      overlayTop: rect(
        document.querySelector('[data-testid="channel-composer-overlay"]'),
      ),
    };
  }, ROOT.open);
  measure("landing", geometry);
  measure("shot_landing", await shot(page, "exchange-landing"));
  expect(geometry.barText).toContain("Your message");
  // The message is clear of the bar, the day label, the pill and the stack.
  if (!geometry.message || !geometry.day || !geometry.bar)
    throw new Error("Expected the message, its day and the bar.");
  expect(geometry.day.top).toBeGreaterThanOrEqual(geometry.bar.bottom);
  if (geometry.pill) {
    expect(geometry.pill.top).toBeGreaterThanOrEqual(geometry.day.bottom);
    expect(geometry.message.top).toBeGreaterThanOrEqual(geometry.pill.bottom);
  }
  if (geometry.overlayTop)
    expect(geometry.message.bottom).toBeLessThanOrEqual(
      geometry.overlayTop.top,
    );
  expect(geometry.stackCards).toHaveLength(0);
  // The room's stack, folded to its one line (WP-23, Decided 2).
  expect(geometry.heldText?.toLowerCase()).toContain("needs you · 2 · show");
  // Show brings them back.
  await page.getByTestId("pending-held").click();
  await expect(page.getByTestId("managed-permission-card")).toBeVisible();
  // The proposal is the ask's one row in the room as well (WP-16).
  await expect(page.getByTestId("runtime-task-proposal-row")).toBeVisible();
  measure("shot_landing_shown", await shot(page, "exchange-landing-shown"));
});

// Now retired with WP-34 (Decided 10): live work shows once, in the Chats
// rail. An old address to it lands on All activity, and what was live in
// Now is live in the rail.
test("now: retired; live work is in the rail", async ({ page }) => {
  await boot(page, { hash: "/pulse?stream=now" });
  await expect(page.getByTestId("all-activity-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("owner-activity-view")).toHaveCount(0);
  await expect(page.getByTestId("place-row-now")).toHaveCount(0);
  await speak(page);
  await page.getByTestId("shell-place-conversations").click();
  const live = page.locator('[data-shell-rail] [data-side-row="live"]');
  await expect(live).toHaveCount(2, { timeout: 20_000 });
  const rows = await live.evaluateAll((nodes) =>
    nodes.map((node) => ({
      home: node.closest<HTMLElement>("[data-home-group]")?.dataset.homeGroup,
      title: node.querySelector(".luca-rail-session-title")?.textContent,
    })),
  );
  measure("now_live_in_rail", rows);
  expect(rows.map((row) => `${row.home} ${row.title}`).sort()).toEqual([
    `agent:${ATLAS} Luca · general`,
    "app:claude Rail glass plates",
  ]);
});

test("the count past 99 reads 99+, on the icon and the row", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    const raw = window.localStorage.getItem(key);
    const overrides = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    overrides["shell-frame"] = true;
    window.localStorage.setItem(key, JSON.stringify(overrides));
  }, FEATURE_OVERRIDES_STORAGE_KEY);
  await installMockBridge(page, {
    managedAgents: AGENTS.map((agent) => ({ ...agent })),
    managedPermissions: Array.from({ length: 104 }, (_, index) => ({
      pendingId: `permission-${index}`,
      request: {
        ...SHARED_SEEDS.managedPermissions[0].request,
        acp_request_id: `acp-${index}`,
        title: `Run step ${index + 1}`,
        turn_id: `turn-${index}`,
      },
    })),
  });
  await chooseRailAgents(page);
  await expect(async () => {
    await page.goto(`/#/channels/${GENERAL}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
  // On the Chats icon and the Chats rail's row since WP-34 (Decided 2).
  await expect(page.getByTestId("shell-place-conversations-count")).toHaveText(
    "99+",
    {
      timeout: 20_000,
    },
  );
  const row = await page.getByTestId("rail-needs-you-count").textContent();
  const overhang = await page.evaluate(() => {
    const tile = document
      .querySelector('[data-testid="shell-place-conversations"]')
      ?.getBoundingClientRect();
    const count = document
      .querySelector('[data-testid="shell-place-conversations-count"]')
      ?.getBoundingClientRect();
    return tile && count
      ? { left: count.left - tile.left, right: tile.right - count.right }
      : null;
  });
  measure("count_99", { overhang, row });
  expect(row).toBe("99+");
  measure(
    "shot_count_99",
    await shot(page, "count-99", { x: 0, y: 0, width: 330, height: 260 }),
  );
});
