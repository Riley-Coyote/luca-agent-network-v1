import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-10, six places, each with its own rail (docs/luca/rail-system/
 * SHELL_BUILD.md; NAVIGATION.md): under `shell-frame` the icons pick the
 * place, the rail lists what's in it, the card shows the row picked, and the
 * pick is in the address. Screenshots land in WP10_SHOTS when set; the
 * measurements in WP10_SHOTS/measures.json. The base build (the integration
 * branch) is read for the flag-off comparison at WP10_BASE_URL.
 */

const SHOTS = process.env.WP10_SHOTS ?? "test-results/shell-place-rails";
const BASE_URL = process.env.WP10_BASE_URL ?? "http://127.0.0.1:4300";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
const WREN = "c".repeat(64);
const MIRA = "e".repeat(64);

/** One file per measure, so tests running side by side never overwrite
 *  each other's. */
function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

async function boot(
  page: Page,
  {
    shell = true,
    hash = "/agents",
    origin,
    residents = true,
  }: {
    shell?: boolean;
    hash?: string;
    origin?: string;
    /** false: no residents at all, so no Luca. */
    residents?: boolean;
  } = {},
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
    managedAgents: !residents
      ? []
      : [
          {
            name: "Luca",
            pubkey: LUCA,
            personaId: "builtin:fizz",
            status: "running",
          },
          {
            name: "Atlas",
            pubkey: ATLAS,
            personaId: "persona-atlas",
            status: "running",
          },
          {
            name: "Wren",
            pubkey: WREN,
            personaId: "persona-wren",
            status: "stopped",
          },
          {
            name: "Mira",
            pubkey: MIRA,
            status: "stopped",
            lastError: "The runtime exited during start-up.",
          },
        ],
    personas: !residents
      ? []
      : [
          {
            id: "persona-atlas",
            displayName: "Atlas",
            systemPrompt: "Keeps the release honest.",
            runtime: "claude",
          },
          {
            id: "persona-wren",
            displayName: "Wren",
            systemPrompt: "Walks the design through.",
            runtime: "hermes",
          },
        ],
    teams: [
      {
        id: "team-design",
        name: "Design team",
        description: "The two who walk a design from sketch to release.",
        personaIds: ["persona-atlas", "persona-wren"],
      },
    ],
    capabilitySkills: [
      {
        skillId: "skill-review",
        name: "review-pass",
        description: "Reads a diff for correctness and leaves notes.",
        sourceLabels: ["~/.claude/skills"],
        runtimeIds: ["claude"],
        content: "# review-pass",
      },
      {
        skillId: "skill-release",
        name: "release-notes",
        description: "Writes the release notes from the merged work.",
        sourceLabels: ["~/.codex/skills"],
        runtimeIds: ["codex"],
        content: "# release-notes",
      },
    ],
  });
  // No query of the page's own: with one, the router's hash history reads it
  // into the last word of the address on Back (`connected=claude-code?e2e=
  // mock`), which the app's own window never has. The fixture alone turns
  // the mock bridge on (main.tsx).
  await page.goto(`${origin ?? ""}/#${hash}`);
  await expect(page.getByTestId("app-sidebar")).toBeVisible({
    timeout: 20_000,
  });
}

/** One piece in Recently deleted, beside the mock's three kinds, which stay. */
async function seedDeletedPiece(page: Page) {
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: unknown, options?: unknown) => unknown;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke.bind(internals);
    let restored = false;
    internals.invoke = async (cmd, args, options) => {
      const id = (args as { artifactId?: string; input?: unknown } | undefined)
        ?.artifactId;
      if (
        cmd === "restore_artifact" &&
        (id === "old-sketch" ||
          String(JSON.stringify(args)).includes("old-sketch"))
      ) {
        restored = true;
        const all = (await invoke(
          "list_artifacts",
          { input: { deleted: "active" } },
          options,
        )) as { artifacts: Record<string, unknown>[] };
        return all.artifacts[0];
      }
      const result = await invoke(cmd, args, options);
      const input = (args as { input?: { deleted?: string } } | undefined)
        ?.input;
      if (cmd !== "list_artifacts" || input?.deleted !== "deleted")
        return result;
      if (restored) return { artifacts: [], nextCursor: null, total: 0 };
      const all = (await invoke(
        "list_artifacts",
        { input: { deleted: "active" } },
        options,
      )) as { artifacts: Record<string, unknown>[] };
      const sample = all.artifacts[0];
      return {
        artifacts: [
          {
            ...sample,
            deletedAt: "2026-10-25T09:00:00Z",
            id: "old-sketch",
            kind: "image",
            pinned: false,
            summary: "An early sketch of the rail's marks.",
            title: "old-sketch.png",
          },
        ],
        nextCursor: null,
        total: 1,
      };
    };
  });
}

/** Signed records for two agents, through the mock relay. */
async function seedRecords(page: Page) {
  await page.evaluate(
    ({ luca, atlas }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      emit?.({
        channelName: "general",
        content: "Luca signed this: the landing copy is ready for review.",
        kind: 9,
        pubkey: luca,
      });
      emit?.({
        channelName: "general",
        content: "Atlas signed this: the release script passed.",
        kind: 9,
        pubkey: atlas,
      });
    },
    { atlas: ATLAS, luca: LUCA },
  );
}

async function shot(page: Page, name: string) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashOf(page: Page) {
  return page.evaluate(() => window.location.hash);
}

async function railRows(page: Page, place: string) {
  return page.getByTestId(`place-rail-${place}`).evaluate((rail) =>
    [...rail.querySelectorAll<HTMLElement>("[data-place-section]")].map(
      (section) => ({
        key: section.dataset.placeSection,
        title:
          section
            .querySelector(".luca-rail-section-head span")
            ?.textContent?.trim() ?? null,
        add:
          section
            .querySelector(".luca-rail-section-head button")
            ?.getAttribute("aria-label") ?? null,
        rows: [...section.querySelectorAll<HTMLElement>(".luca-rail-row")].map(
          (row) => ({
            name: row.querySelector(".luca-rail-row-name")?.textContent,
            note: row.querySelector(".luca-rail-note")?.textContent ?? null,
            active: row.dataset.active === "true",
            main: row.dataset.main === "true",
            weight: getComputedStyle(
              row.querySelector(".luca-rail-row-name") as Element,
            ).fontWeight,
          }),
        ),
      }),
    ),
  );
}

/** The rail's mark against the picked row: their boxes, which must agree. */
async function markOnPick(page: Page) {
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const row = document.querySelector<HTMLElement>(
      '[data-place-rail] [data-sidebar="menu-button"][data-active="true"]',
    );
    const mark = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="shell-rail-marks"] .luca-mark--row',
      ),
    ].find((each) => Number.parseFloat(getComputedStyle(each).opacity) > 0.5);
    const box = (element: Element | null | undefined) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    };
    return { mark: box(mark), row: box(row) };
  });
}

test("places, rails and cards", async ({ page }) => {
  await boot(page);
  await seedRecords(page);
  await seedDeletedPiece(page);

  // ── the places column ──
  const places = await page
    .getByTestId("shell-places")
    .evaluate((nav) =>
      [...nav.querySelectorAll<HTMLElement>("button, [data-testid]")]
        .filter(
          (each) =>
            each.matches(".luca-place") ||
            each.dataset.testid === "shell-place-search",
        )
        .map((each) =>
          each.dataset.testid === "shell-place-search"
            ? "Search"
            : (each.getAttribute("aria-label") ?? ""),
        ),
    );
  measure("places", places);

  // ── Agents: Luca first ──
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId(`place-row-mind:${LUCA}`)).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 20_000 },
  );
  await expect
    .poll(() => hashOf(page), { timeout: 10_000 })
    .toContain(`profile=${LUCA}`);
  measure("agents_hash_first", await hashOf(page));
  measure("agents_rail", await railRows(page, "agents"));
  measure("agents_lip", await page.getByTestId("shell-lip-name").innerText());
  measure("agents_mark", await markOnPick(page));
  // Against the study's (shellStudy.css): the row 50,56 208×30; its note
  // ends 5 in from the row's end, 11 points, faint.
  measure(
    "luca_row_and_note",
    await page.getByTestId(`place-row-mind:${LUCA}`).evaluate((row) => {
      const note = row.querySelector(".luca-rail-note") as HTMLElement;
      const box = row.getBoundingClientRect();
      const noteBox = note.getBoundingClientRect();
      return {
        row: [box.x, box.y, box.width, box.height].map(Math.round),
        noteRight: Math.round(box.right - noteBox.right),
        noteFont: getComputedStyle(note).fontSize,
        noteColor: getComputedStyle(note).color,
      };
    }),
  );
  measure("shot_agents_luca", await shot(page, "agents-luca"));

  // ── a connected app: no longer in Agents; its row is in Chats, under
  // Apps, and its card opens in the Chats card (WP-34, Decided 9) ──
  await expect(page.getByTestId("place-section-agents-connected")).toHaveCount(
    0,
  );
  await page.getByTestId("shell-place-conversations").click();
  await page
    .getByTestId("rail-home-app:claude")
    .locator('[data-rail-focus="home"]')
    .click({ timeout: 20_000 });
  await expect(page.getByTestId("connected-app-card")).toBeVisible();
  await expect(page.getByTestId("runtime-session-list")).toBeVisible({
    timeout: 20_000,
  });
  measure("connected_hash", await hashOf(page));
  measure(
    "connected_lip",
    await page.getByTestId("shell-lip-name").innerText(),
  );
  measure(
    "connected_head",
    await page.getByTestId("place-page-head").innerText(),
  );
  measure(
    "runtime_column_count",
    await page.locator("#runtime-sessions-panel").count(),
  );
  measure("shot_chats_app", await shot(page, "chats-app"));
  await page.getByTestId("open-agents-view").click();
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });

  // ── Agents: a group ──
  await page
    .getByTestId("place-row-group:team-design")
    .locator("button")
    .click();
  await expect(page.getByTestId("group-card")).toBeVisible();
  measure("group_hash", await hashOf(page));
  measure("group_lip", await page.getByTestId("shell-lip-name").innerText());
  measure("group_card", await page.getByTestId("group-card").innerText());
  measure("shot_agents_group", await shot(page, "agents-group"));

  // ── Activity ──
  await page.getByTestId("open-activity-view").click();
  await expect(page.getByTestId("place-rail-activity")).toBeVisible({
    timeout: 20_000,
  });
  // Activity's first pick is All activity (WP-34, Decided 10; Needs you
  // moved to Chats).
  await expect(page.getByTestId("place-row-all")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect
    .poll(() => hashOf(page), { timeout: 10_000 })
    .toContain("stream=all");
  measure("activity_hash_first", await hashOf(page));
  measure("activity_rail", await railRows(page, "activity"));
  await expect(page.getByTestId("place-row-needs-you")).toHaveCount(0);
  await expect(page.getByTestId("place-row-now")).toHaveCount(0);
  await expect(page.getByTestId("place-row-side")).toHaveCount(0);
  measure(
    "activity_tabs",
    await page.getByTestId("activity-section-record").count(),
  );
  measure("shot_activity_all", await shot(page, "activity-all"));
  await page.getByTestId(`place-row-record:${ATLAS}`).locator("button").click();
  await expect(
    page.getByText("Atlas signed this", { exact: false }).first(),
  ).toBeVisible({ timeout: 20_000 });
  measure("record_hash", await hashOf(page));
  measure("record_lip", await page.getByTestId("shell-lip-name").innerText());
  measure("record_resident_tabs", await page.getByRole("tab").count());
  measure("shot_activity_record", await shot(page, "activity-record"));

  // ── Library ──
  await page.getByTestId("open-artifacts-view").click();
  await expect(page.getByTestId("place-rail-library")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("place-row-made:all")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("place-row-deleted")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() => hashOf(page), { timeout: 10_000 })
    .toContain("made=all");
  measure("library_hash_first", await hashOf(page));
  measure("library_rail", await railRows(page, "library"));
  measure("shot_library_all", await shot(page, "library-all"));
  await page.getByTestId("place-row-skills:all").locator("button").click();
  await expect(page.getByTestId("skill-library-list")).toBeVisible({
    timeout: 20_000,
  });
  measure("skills_hash", await hashOf(page));
  measure("shot_library_skills", await shot(page, "library-skills"));
  await page.getByTestId("place-row-deleted").locator("button").click();
  await expect(page.getByText("old-sketch.png")).toBeVisible({
    timeout: 20_000,
  });
  measure("deleted_hash", await hashOf(page));
  measure("deleted_lip", await page.getByTestId("shell-lip-name").innerText());
  measure("shot_library_deleted", await shot(page, "library-deleted"));
});

async function pick(page: Page, id: string) {
  await page.getByTestId(`place-row-${id}`).locator("button").click();
  await expect(page.getByTestId(`place-row-${id}`)).toHaveAttribute(
    "data-active",
    "true",
  );
}

async function activeRow(page: Page) {
  return page
    .locator(
      '[data-place-rail] [data-sidebar="menu-button"][data-active="true"]',
    )
    .getAttribute("data-testid");
}

test("back and forward step through each place's picks", async ({ page }) => {
  await boot(page);
  await seedRecords(page);
  await seedDeletedPiece(page);
  await expect(page.getByTestId(`place-row-mind:${LUCA}`)).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 20_000 },
  );
  await expect.poll(() => hashOf(page)).toContain(`profile=${LUCA}`);
  const steps: Record<string, unknown>[] = [];
  const back = async () => {
    await page.getByTestId("global-back").click();
    await page.waitForTimeout(400);
  };
  const forward = async () => {
    await page.getByTestId("global-forward").click();
    await page.waitForTimeout(400);
  };
  const record = async (label: string) =>
    steps.push({
      label,
      hash: await hashOf(page),
      row: await activeRow(page),
      lip: await page.getByTestId("shell-lip-name").innerText(),
    });

  // Agents: Luca → Atlas → Design team, then back, back, forward.
  await pick(page, `mind:${ATLAS}`);
  await pick(page, "group:team-design");
  await back();
  await record("agents back 1");
  expect(await activeRow(page)).toBe(`place-row-mind:${ATLAS}`);
  await back();
  await record("agents back 2");
  expect(await activeRow(page)).toBe(`place-row-mind:${LUCA}`);
  await forward();
  await record("agents forward");
  expect(await activeRow(page)).toBe(`place-row-mind:${ATLAS}`);

  // Activity: All activity → Atlas → Luca, back, forward.
  await page.getByTestId("open-activity-view").click();
  await expect(page.getByTestId("place-row-all")).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 20_000 },
  );
  await pick(page, `record:${ATLAS}`);
  await pick(page, `record:${LUCA}`);
  await back();
  await record("activity back");
  expect(await activeRow(page)).toBe(`place-row-record:${ATLAS}`);
  await back();
  await record("activity back 2");
  expect(await activeRow(page)).toBe("place-row-all");
  await forward();
  await record("activity forward");
  expect(await activeRow(page)).toBe(`place-row-record:${ATLAS}`);

  // Library: All → Images → Recently deleted, back, forward.
  await page.getByTestId("open-artifacts-view").click();
  await expect(page.getByTestId("place-row-made:all")).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("place-row-deleted")).toBeVisible({
    timeout: 20_000,
  });
  await pick(page, "made:images");
  await pick(page, "deleted");
  await back();
  await record("library back");
  expect(await activeRow(page)).toBe("place-row-made:images");
  await forward();
  await record("library forward");
  expect(await activeRow(page)).toBe("place-row-deleted");

  // Each place remembers its last pick: Agents again opens on Atlas.
  await page.getByTestId("open-agents-view").click();
  await expect(page.getByTestId(`place-row-mind:${ATLAS}`)).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 20_000 },
  );
  await expect.poll(() => hashOf(page)).toContain(`profile=${ATLAS}`);
  await record("agents remembered");
  // And reopening (a reload) keeps the address's pick.
  await page.reload();
  await expect(page.getByTestId(`place-row-mind:${ATLAS}`)).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 20_000 },
  );
  await record("agents reloaded");
  measure("back_forward", steps);
});

test("the keyboard through each rail, and the rail's +", async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId(`place-row-mind:${LUCA}`)).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 20_000 },
  );
  const result: Record<string, unknown> = {};
  // Tab from the places column reaches the rail.
  await page.getByTestId("open-agents-view").focus();
  let tabs = 0;
  for (; tabs < 12; tabs += 1) {
    await page.keyboard.press("Tab");
    const inRail = await page.evaluate(
      () =>
        document.activeElement?.closest("[data-place-rail]") !== null &&
        document.activeElement?.closest("[data-place-rail]") !== undefined,
    );
    if (inRail) break;
  }
  result.tabsToRail = tabs + 1;
  result.firstFocus = await page.evaluate(() =>
    document.activeElement?.getAttribute("aria-label"),
  );
  for (const place of ["agents", "activity", "library"] as const) {
    if (place === "activity")
      await page.getByTestId("open-activity-view").click();
    if (place === "library")
      await page.getByTestId("open-artifacts-view").click();
    const rail = page.getByTestId(`place-rail-${place}`);
    await expect(rail).toBeVisible({ timeout: 20_000 });
    await rail.locator("[data-rail-focus]").first().focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    result[place] = {
      focused,
      picked: await activeRow(page),
      hash: await hashOf(page),
      lip: await page.getByTestId("shell-lip-name").innerText(),
      mark: await markOnPick(page),
    };
  }
  // The rail's + asks the card: Add agent, New group, Import.
  await page.getByTestId("open-agents-view").click();
  await page.getByTestId("place-add-add-agent").click();
  await expect(
    page.getByRole("dialog", { name: "Add an agent" }),
  ).toBeVisible();
  result.addAgentHash = await hashOf(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("place-add-new-group").click();
  await expect(
    page.getByRole("dialog", { name: "Create group" }),
  ).toBeVisible();
  result.newGroupHash = await hashOf(page);
  await page.keyboard.press("Escape");
  measure("keyboard", result);
});

test("narrow window, Chats and Settings", async ({ page }) => {
  await boot(page, { hash: "/" });
  await expect(page.getByTestId("chat-list")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
  measure("shot_chats", await shot(page, "chats"));
  measure("chats_lip", await page.getByTestId("shell-lip-name").innerText());
  measure(
    "chats_toggle",
    await page.getByTestId("shell-lip-toggle").getAttribute("aria-label"),
  );
  await page.getByTestId("open-settings-view").click();
  await page.waitForTimeout(1200);
  measure("shot_settings", await shot(page, "settings"));
  await page.setViewportSize({ width: 800, height: 500 });
  await page.getByTestId("open-agents-view").click();
  await page.waitForTimeout(1200);
  measure(
    "narrow_rail_open_on_arrival",
    await page.getByTestId("place-rail-agents").isVisible(),
  );
  if (!(await page.getByTestId("place-rail-agents").isVisible()))
    await page.getByTestId("shell-lip-toggle").click();
  await expect(page.getByTestId("place-rail-agents")).toBeVisible();
  for (const [tile, name] of [
    ["open-agents-view", "agents-luca-800"],
    ["open-activity-view", "activity-all-800"],
    ["open-artifacts-view", "library-all-800"],
  ] as const) {
    await page.getByTestId(tile).click();
    await page.waitForTimeout(1200);
    measure(`shot_${name}`, await shot(page, name));
  }
  // A connected app's card, from its row under Apps in Chats (WP-34).
  await page.getByTestId("shell-place-conversations").click();
  if (!(await page.getByTestId("chat-list").isVisible()))
    await page.getByTestId("shell-lip-toggle").click();
  await page
    .getByTestId("rail-home-app:claude")
    .locator('[data-rail-focus="home"]')
    .click({ timeout: 20_000 });
  await expect(page.getByTestId("connected-app-card")).toBeVisible({
    timeout: 20_000,
  });
  measure("shot_chats-app-800", await shot(page, "chats-app-800"));
  measure(
    "narrow_card",
    await page.getByTestId("connected-app-card").evaluate((card) => {
      const box = card.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        scrollX: document.documentElement.scrollWidth,
      };
    }),
  );
});

test("flag off: the same as the base build", async ({ browser }) => {
  const result: Record<string, { here: string; base: string; same: boolean }> =
    {};
  for (const [name, hash, ready] of [
    ["chats", "/", "chat-list"],
    ["agents", "/agents", "agents-view"],
    ["activity", "/pulse", "owner-activity-view"],
    ["library", "/artifacts", "artifact-library-screen"],
  ] as const) {
    const hashes: string[] = [];
    for (const origin of ["", BASE_URL]) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
      });
      // Both builds' clocks start at the same instant (WP-21, 3), so a time
      // printed on the page can't differ by a minute between the two shots.
      await context.clock.install({ time: new Date("2026-10-26T18:30:00") });
      const page = await context.newPage();
      await boot(page, { shell: false, hash, origin });
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      hashes.push(
        await shot(page, `flagoff-${name}-${origin ? "base" : "here"}`),
      );
      await context.close();
    }
    result[name] = {
      here: hashes[0],
      base: hashes[1],
      same: hashes[0] === hashes[1],
    };
  }
  measure("flag_off", result);
  for (const each of Object.values(result)) expect(each.same).toBe(true);
});

// ── the review's fixes (WP-10 review, design) ───────────────────────────

/** Every frame's position of the rail's mark while a row is picked: when
 *  it first moves, and its first steps. */
async function traceMark(page: Page, rowId: string) {
  await page.evaluate(() => {
    const w = window as unknown as { __trace: { t: number; y: number }[] };
    w.__trace = [];
    const start = performance.now();
    const sample = () => {
      const mark = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-testid="shell-rail-marks"] .luca-mark--row',
        ),
      ].find((each) => Number.parseFloat(getComputedStyle(each).opacity) > 0.5);
      w.__trace.push({
        t: Math.round(performance.now() - start),
        y: mark ? Math.round(mark.getBoundingClientRect().y * 10) / 10 : -1,
      });
      if (performance.now() - start < 900) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByTestId(`place-row-${rowId}`).locator("button").click();
  await page.waitForTimeout(1000);
  const trace = await page.evaluate(
    () =>
      (window as unknown as { __trace: { t: number; y: number }[] }).__trace,
  );
  const firstY = trace[0]?.y ?? 0;
  const firstMove = trace.findIndex((each) => each.y !== firstY);
  const steps = trace
    .slice(firstMove, firstMove + 5)
    .map(
      (each, index) =>
        Math.round((each.y - trace[firstMove + index - 1].y) * 10) / 10,
    );
  return {
    firstMoveAt: trace[firstMove]?.t ?? null,
    frameBeforeFirstMove: trace[firstMove - 1]?.t ?? null,
    firstSteps: steps,
    total: Math.round(((trace.at(-1)?.y ?? 0) - firstY) * 10) / 10,
    frames: trace.slice(Math.max(0, firstMove - 6), firstMove + 3),
  };
}
const FIX = process.env.WP10_FIX_SHOTS ?? `${SHOTS}/fixes`;
function fixMeasure(key: string, value: unknown) {
  mkdirSync(`${FIX}/measures`, { recursive: true });
  writeFileSync(`${FIX}/measures/${key}.json`, JSON.stringify(value, null, 2));
}
async function fixShot(page: Page, name: string) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(FIX, { recursive: true });
  await page.screenshot({ path: `${FIX}/${name}.png` });
}

/** The card's head against the card: where it sits, in every card. */
async function headPlace(page: Page) {
  return page.evaluate(() => {
    const head = document.querySelector<HTMLElement>(
      '[data-testid="place-page-head"]',
    );
    const card = document
      .querySelector<HTMLElement>("main[data-buzz-glass-inset]")
      ?.getBoundingClientRect();
    const page = head?.closest<HTMLElement>(".luca-place-page");
    const axis = head?.closest<HTMLElement>(".luca-place-page-axis");
    if (!head || !card || !axis) return null;
    const box = head.getBoundingClientRect();
    const axisBox = axis.getBoundingClientRect();
    return {
      headTop: Math.round(box.top - card.top),
      axisWidth: Math.round(axisBox.width),
      axisCentreOffset: Math.round(
        axisBox.left + axisBox.width / 2 - (card.left + card.width / 2),
      ),
      padding: page ? getComputedStyle(page).padding : null,
    };
  });
}

test("review fixes", async ({ page }) => {
  await boot(page);
  await seedRecords(page);
  await seedDeletedPiece(page);
  await expect(page.getByTestId(`place-row-mind:${LUCA}`)).toHaveAttribute(
    "data-active",
    "true",
    { timeout: 20_000 },
  );
  const dot = () =>
    page.getByTestId("shell-place-conversations-unread").count();

  // 1. Chats' unread dot speaks off Chats' own rail.
  const fix1: Record<string, number> = { agents: await dot() };
  // 2. State words from the live signal; 13. the rail is a named nav.
  fixMeasure("fix_2_agents_rail", await railRows(page, "agents"));
  fixMeasure("fix_13_navs", {
    agents: await page
      .getByTestId("place-rail-nav-agents")
      .evaluate((nav) => [nav.tagName, nav.getAttribute("aria-label")]),
  });
  await fixShot(page, "agents-luca");

  // 14. The mark's first move to a card's first mount (a group's: the
  // connected app left Agents for the Chats rail with WP-34), beside a
  // later pick's, which finds the page idle.
  const firstVisit = await traceMark(page, "group:team-design");
  // 3 and 5. The connected card on the shared page; its sessions flat. It
  // opens from its row under Apps in Chats (WP-34, Decided 9).
  await page.getByTestId("shell-place-conversations").click();
  await page
    .getByTestId("rail-home-app:claude")
    .locator('[data-rail-focus="home"]')
    .click({ timeout: 20_000 });
  await expect(page.getByTestId("connected-app-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("runtime-session-list")).toBeVisible({
    timeout: 20_000,
  });
  const heads: Record<string, unknown> = {};
  heads.connected = await headPlace(page);
  fixMeasure(
    "fix_5_sessions",
    await page.getByTestId("connected-app-card").evaluate((card) => {
      const rows = [...card.querySelectorAll<HTMLElement>(".luca-place-row")];
      const row = rows[0];
      const action = row?.querySelector<HTMLElement>(".luca-place-row-action");
      const search = card.querySelector<HTMLElement>(".luca-place-search");
      const style = (element: Element | null | undefined) =>
        element ? getComputedStyle(element) : null;
      return {
        eyebrow: card.querySelector(".luca-place-group > h2")?.textContent,
        eyebrowTransform: style(card.querySelector(".luca-place-group > h2"))
          ?.textTransform,
        rows: rows.length,
        rowBorder: style(row)?.borderTopWidth,
        rowBackground: style(row)?.backgroundColor,
        articles: card.querySelectorAll("article").length,
        titleColor: style(row?.querySelector(".luca-place-row-title"))?.color,
        summaryColor: style(row?.querySelector(".luca-place-row-summary"))
          ?.color,
        note: row?.querySelector(".luca-place-row-note")?.textContent,
        noteWidth: Math.round(
          row?.querySelector(".luca-place-row-note")?.getBoundingClientRect()
            .width ?? 0,
        ),
        columns: style(row)?.gridTemplateColumns,
        actionOpacityAtRest: style(action)?.opacity,
        searchBorder: style(search)?.borderBottomColor,
        searchOutline: style(search?.querySelector("input"))?.outlineStyle,
      };
    }),
  );
  await page
    .getByTestId("runtime-session-session-claude_code-checkpoint")
    .hover();
  await page.waitForTimeout(300);
  fixMeasure(
    "fix_5_action_on_hover",
    await page
      .getByTestId("runtime-session-session-claude_code-checkpoint")
      .evaluate((row) => {
        const action = row.querySelector<HTMLElement>(".luca-place-row-action");
        return {
          opacity: action ? getComputedStyle(action).opacity : null,
          text: action?.textContent,
        };
      }),
  );
  await fixShot(page, "agents-connected");
  // 16. The sessions search shows focus: the Library search's ring.
  await page.getByPlaceholder("Search sessions").focus();
  fixMeasure(
    "fix_16_search_focus",
    await page
      .getByTestId("connected-app-card")
      .locator(".luca-place-search")
      .first()
      .evaluate((field) => ({
        count: document.querySelectorAll(".luca-place-search").length,
        boxShadow: getComputedStyle(field).boxShadow,
        background: getComputedStyle(field).backgroundColor,
      })),
  );
  await fixShot(page, "agents-connected-search-focus");
  await page.keyboard.press("Escape");
  await page.getByTestId("open-agents-view").click();
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  const laterPick = await traceMark(page, `mind:${LUCA}`);
  const laterPick2 = await traceMark(page, "group:team-design");
  fixMeasure("fix_14_mark_first_move", { firstVisit, laterPick, laterPick2 });

  // 3, 10, 11. The group: the shared page, the list grid, no icons.
  await page
    .getByTestId("place-row-group:team-design")
    .locator("button")
    .click();
  await expect(page.getByTestId("group-card")).toBeVisible();
  heads.group = await headPlace(page);
  fixMeasure(
    "fix_10_11_group",
    await page.getByTestId("group-card").evaluate((card) => {
      const row = card.querySelector<HTMLElement>(".luca-place-row");
      const style = row ? getComputedStyle(row) : null;
      return {
        columns: style?.gridTemplateColumns,
        gap: style?.columnGap,
        padding: style?.padding,
        actionIcons: [
          card.querySelector('[data-testid="group-edit"] svg'),
          card.querySelector('[data-testid="group-add-to-room"] svg'),
        ].filter(Boolean).length,
        actions: [
          card.querySelector('[data-testid="group-edit"]')?.textContent,
          card.querySelector('[data-testid="group-add-to-room"]')?.textContent,
        ],
      };
    }),
  );
  await fixShot(page, "agents-group");

  // Activity: 1, 3, 6, on All activity (Now retired with WP-34).
  await page.getByTestId("open-activity-view").click();
  await pick(page, "all");
  await expect(page.getByTestId("all-activity-card")).toBeVisible({
    timeout: 20_000,
  });
  fix1.activity = await dot();
  heads.now = await headPlace(page);
  fixMeasure(
    "fix_6_now",
    await page.getByTestId("all-activity-card").evaluate((scroll) => ({
      dashed: [...scroll.querySelectorAll<HTMLElement>("*")].filter(
        (each) => getComputedStyle(each).borderTopStyle === "dashed",
      ).length,
      articles: scroll.querySelectorAll("article").length,
      badges: scroll.querySelectorAll('[class*="rounded-full"]').length,
      rows: scroll.querySelectorAll(".luca-place-row").length,
      headings: [
        ...scroll.querySelectorAll<HTMLElement>(
          '[data-testid^="owner-activity-group-"]',
        ),
      ]
        .filter((each) => getComputedStyle(each).display !== "none")
        .map((each) => ({
          text: each.textContent,
          letterSpacing: getComputedStyle(each).letterSpacing,
          transform: getComputedStyle(each).textTransform,
        })),
      quiet: scroll.querySelector(
        '[data-testid="owner-activity-empty-history"]',
      )?.textContent,
    })),
  );
  await fixShot(page, "activity-all");

  // 4 and 8. One mind's signed record: no card inside the card; its line.
  await page.getByTestId(`place-row-record:${ATLAS}`).locator("button").click();
  await expect(
    page.getByText("Atlas signed this", { exact: false }).first(),
  ).toBeVisible({ timeout: 20_000 });
  heads.record = await headPlace(page);
  fixMeasure(
    "fix_4_8_record",
    await page.evaluate(() => {
      const card = document.querySelector("main[data-buzz-glass-inset]");
      return {
        surfaces: card?.querySelectorAll("[data-luca-conversation-surface]")
          .length,
        // A surface drawn inside the record's page would be a card in the
        // card; the one left is the card's own, around the page.
        surfaceInsidePage:
          document
            .querySelector(".luca-place-page")
            ?.querySelector("[data-luca-conversation-surface]") !== null,
        pageInsideSurface:
          document
            .querySelector(".luca-place-page")
            ?.closest("[data-luca-conversation-surface]") !== null,
        pageFill: getComputedStyle(
          document.querySelector(".luca-place-page")?.parentElement ??
            document.body,
        ).backgroundColor,
        line: document.querySelector(".luca-place-page-line")?.textContent,
      };
    }),
  );
  await fixShot(page, "activity-record");

  // Library: 1, 3, 12, 15.
  await page.getByTestId("open-artifacts-view").click();
  await expect(page.getByTestId("artifact-library-list")).toBeVisible({
    timeout: 20_000,
  });
  fix1.library = await dot();
  heads.libraryAll = await headPlace(page);
  const lips: Record<string, string> = {
    all: await page.getByTestId("shell-lip-name").innerText(),
  };
  fixMeasure(
    "fix_15_footer",
    await page.evaluate(() => {
      const note = document.querySelector('[data-testid="library-footnote"]');
      const card = document
        .querySelector("main[data-buzz-glass-inset]")
        ?.getBoundingClientRect();
      const box = note?.getBoundingClientRect();
      return {
        text: note?.textContent,
        bodiesLine: document.body.innerText.includes(
          "Bodies load only when Canvas opens",
        ),
        rightClear: card && box ? Math.round(card.right - box.right) : null,
      };
    }),
  );
  await fixShot(page, "library-all");
  await pick(page, "skills:all");
  await expect(page.getByTestId("skill-library-list")).toBeVisible({
    timeout: 20_000,
  });
  heads.librarySkills = await headPlace(page);
  lips.skillsAll = await page.getByTestId("shell-lip-name").innerText();
  await pick(page, "skills:claude");
  lips.skillsClaude = await page.getByTestId("shell-lip-name").innerText();
  await fixShot(page, "library-skills-claude");
  await pick(page, "deleted");
  await expect(page.getByText("old-sketch.png")).toBeVisible();
  heads.libraryDeleted = await headPlace(page);
  lips.deleted = await page.getByTestId("shell-lip-name").innerText();
  await pick(page, "made:images");
  lips.images = await page.getByTestId("shell-lip-name").innerText();
  fixMeasure("fix_12_lips", lips);
  fixMeasure("fix_13_navs_all", {
    navs: await page
      .locator("nav[aria-label]")
      .evaluateAll((navs) => navs.map((nav) => nav.getAttribute("aria-label"))),
  });

  // 1 on Brain, and Chats with its own rail open: no dot there.
  await page.evaluate(() => {
    window.location.hash = "#/brain";
  });
  await page.waitForTimeout(1500);
  fix1.brain = await dot();
  await page.getByTestId("shell-place-conversations").click();
  await page.waitForTimeout(1200);
  fix1.chatsRailOpen = await dot();
  fixMeasure("fix_1_unread_dot", fix1);

  // 3 at 800 x 500: the head in the same place.
  await page.setViewportSize({ width: 800, height: 500 });
  await page.getByTestId("shell-place-conversations").click();
  await page.waitForTimeout(800);
  if (!(await page.getByTestId("chat-list").isVisible()))
    await page.getByTestId("shell-lip-toggle").click();
  await page
    .getByTestId("rail-home-app:codex")
    .locator('[data-rail-focus="home"]')
    .click({ timeout: 20_000 });
  await page.waitForTimeout(500);
  heads.connected800 = await headPlace(page);
  await fixShot(page, "chats-app-800");
  await page.getByTestId("open-activity-view").click();
  await page.waitForTimeout(1200);
  heads.now800 = await headPlace(page);
  await page.getByTestId("open-artifacts-view").click();
  await page.waitForTimeout(1200);
  heads.library800 = await headPlace(page);
  await fixShot(page, "library-800");
  fixMeasure("fix_3_heads", heads);
});

test("an emptied pick stays; no Luca, no pick", async ({ page }) => {
  // 17. Restoring the last deleted piece keeps Recently deleted picked.
  await boot(page, { hash: "/artifacts?deleted=recently" });
  await seedDeletedPiece(page);
  await page.getByTestId("open-agents-view").click();
  await page.getByTestId("open-artifacts-view").click();
  await expect(page.getByText("old-sketch.png")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Restore old-sketch.png" }).click();
  await expect(page.getByText("old-sketch.png")).toHaveCount(0, {
    timeout: 10_000,
  });
  await page.waitForTimeout(800);
  const afterRestore = {
    hash: await hashOf(page),
    row: await activeRow(page),
    lip: await page.getByTestId("shell-lip-name").innerText(),
    words: await page.getByTestId("library-deleted-empty").innerText(),
    clearFilters: await page
      .getByRole("button", { name: "Clear filters" })
      .count(),
  };
  await fixShot(page, "library-deleted-emptied");
  await pick(page, "made:all");
  await page.waitForTimeout(500);
  const afterLeaving = {
    deletedRow: await page.getByTestId("place-row-deleted").count(),
  };
  fixMeasure("fix_17_emptied_pick", { afterRestore, afterLeaving });
});

test("no residents: nothing picked", async ({ page }) => {
  // 18. With no Luca, nothing is picked and the lip says the place's name.
  await boot(page, { residents: false });
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("No residents yet")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(800);
  fixMeasure("fix_18_no_luca", {
    picked: await page
      .locator('[data-place-rail] [data-active="true"]')
      .count(),
    lip: await page.getByTestId("shell-lip-name").innerText(),
    hash: await hashOf(page),
    lucaRow: await page.getByTestId("place-row-luca").count(),
    mark: await markOnPick(page),
  });
  await fixShot(page, "agents-no-residents");
});
