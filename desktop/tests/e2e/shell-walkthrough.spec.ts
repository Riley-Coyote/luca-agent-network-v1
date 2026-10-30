import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../helpers/features";

/**
 * WP-37, what the walkthrough found (docs/luca/BETA14_RELEASE.md): a new
 * conversation carrying the relay's dm_created note opens on its
 * first-message view in both layouts; an empty Notebook says what it holds
 * once its sources settle, never before; Claude Code's page head reads like
 * an agent's, and its New conversation is the rail's `+`; the Notebook and
 * All activity name a day alike; Settings' list heads speak like the rails'.
 *
 * The relay's note goes only into this spec's own fixture conversations (the
 * DMs `open_dm` makes here), never into the shared mock, so the flag-off
 * comparisons elsewhere keep comparing like with like. Shots land in
 * WP37_SHOTS, measurements in WP37_SHOTS/measures.
 */

const SHOTS = process.env.WP37_SHOTS ?? "test-results/shell-walkthrough";
const LUCA = "a".repeat(64);
const ATLAS = "b".repeat(64);
/** Who signs the relay's own notes in these fixtures. */
const RELAY = "9".repeat(64);
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

type Mode = "dark" | "light";

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** One of the report's three shots, with its hash. */
async function shot(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  await page.waitForTimeout(300);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    path,
    ...(clip ? { clip } : {}),
  });
  return {
    hash: createHash("sha256").update(readFileSync(path)).digest("hex"),
    path,
  };
}

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 180_000 });

type Fixture = {
  /** ms each named command is held before it answers. */
  delays?: Record<string, number>;
  /** Nothing in a mind's notebook or memory yet (the shared mock gives every
   *  mind a few of each); a journal page lands when `window.__WP37__.arrive`
   *  is set. */
  empty?: boolean;
  /** A journal page is being written meanwhile, so the Notebook asks again. */
  journal?: boolean;
  /** The note the relay writes into a DM it makes: its own dm_created, or
   *  (the control) one the timeline has words for. */
  note?: "dm_created" | "channel_created";
};

/**
 * The fixture's own commands, in front of the mock bridge: every DM that
 * `open_dm` makes here gets the relay's dm_created note before the app sees
 * it, as the relay writes it; a command can be held; a journal page can be
 * on its way. What answered when is kept on `window.__WP37__`.
 */
async function fixture(page: Page, config: Fixture) {
  await page.addInitScript(
    ({ config, relay }) => {
      type Invoke = (
        command: string,
        payload?: unknown,
        options?: unknown,
      ) => Promise<unknown>;
      const state = {
        answered: {} as Record<string, number>,
        arrive: false,
        calls: [] as string[],
        noted: [] as string[],
      };
      (window as unknown as { __WP37__: typeof state }).__WP37__ = state;
      let real: Invoke | undefined;
      const target = window as unknown as {
        __TAURI_INTERNALS__?: Record<string, unknown>;
      };
      const internals = target.__TAURI_INTERNALS__ ?? {};
      target.__TAURI_INTERNALS__ = internals;
      const page = {
        authorship: "resident",
        body: "The release notes, read once more before morning.",
        category: null,
        createdAt: new Date().toISOString(),
        itemId: "page-arrived",
        kind: "journal_page",
        lineageRootId: "page-arrived",
        pinnedOwnerCorrection: false,
        revision: 1,
        sourceEventIds: [],
        sourcePageIds: [],
        status: "active",
        title: "Before morning",
        updatedAt: new Date().toISOString(),
      };
      Object.defineProperty(internals, "invoke", {
        configurable: true,
        set: (invoke: Invoke) => {
          real = invoke;
        },
        get:
          () =>
          async (command: string, payload?: unknown, options?: unknown) => {
            if (!real) throw new Error("mock bridge not installed");
            state.calls.push(command);
            const hold = config.delays?.[command];
            if (hold) await new Promise((done) => setTimeout(done, hold));
            if (config.empty && command === "get_agent_memory") {
              state.answered[command] = performance.now();
              return {
                core: null,
                fetchedAt: Date.now(),
                memories: [],
                truncated: false,
              };
            }
            if (config.empty && command === "list_resident_notebook_items") {
              state.answered[command] = performance.now();
              return {
                availability: "ready",
                items: state.arrive ? [page] : [],
                nextCursor: null,
              };
            }
            if (config.journal) {
              if (command === "get_resident_journal_activity") {
                state.answered[command] = performance.now();
                return state.arrive
                  ? null
                  : {
                      canCancel: false,
                      canRetry: false,
                      jobId: "job-before-morning",
                      lastErrorCode: null,
                      state: "running",
                      updatedAt: new Date().toISOString(),
                    };
              }
            }
            const result = await real(command, payload, options);
            if (command === "open_dm") {
              const channel = result as {
                id: string;
                participant_pubkeys?: string[];
              };
              if (!state.noted.includes(channel.id)) {
                state.noted.push(channel.id);
                const participants = channel.participant_pubkeys ?? [];
                (
                  window as unknown as {
                    __BUZZ_E2E_EMIT_MOCK_MESSAGE__: (input: unknown) => unknown;
                  }
                ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__({
                  channelId: channel.id,
                  content: JSON.stringify(
                    config.note === "channel_created"
                      ? { type: "channel_created", actor: participants[0] }
                      : {
                          type: "dm_created",
                          actor: participants[0],
                          participants,
                        },
                  ),
                  kind: 40099,
                  pubkey: relay,
                });
              }
            }
            state.answered[command] = performance.now();
            return result;
          },
      });
    },
    { config, relay: RELAY },
  );
}

async function boot(
  page: Page,
  {
    flag = true,
    hash = "/",
    log = [],
    mode = "dark",
    fixtures = {},
  }: {
    flag?: boolean;
    hash?: string;
    log?: string[];
    mode?: Mode;
    fixtures?: Fixture;
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
  await fixture(page, fixtures);
  await installMockBridge(page, {
    managedAgents: [
      {
        name: "Luca",
        pubkey: LUCA,
        personaId: "builtin:fizz",
        status: "running",
      },
      { name: "Atlas", pubkey: ATLAS, status: "running" },
    ],
  } as never);
  await expect(async () => {
    await page.goto(`/#${hash}`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 90_000 });
}

/** The DMs this fixture noted, and the hash. */
const noted = (page: Page) =>
  page.evaluate(() => ({
    hash: window.location.hash,
    noted: (window as unknown as { __WP37__: { noted: string[] } }).__WP37__
      .noted,
  }));

/** What the conversation draws: the view, its dates, its rows. */
const conversation = (page: Page) =>
  page.evaluate(() => ({
    dates: [
      ...document.querySelectorAll(
        '[data-testid="message-timeline-day-divider"]',
      ),
    ].map((each) => each.getAttribute("data-day-label")),
    dayGroups: document.querySelectorAll(
      '[data-testid="message-timeline-day-group"][data-day-label]',
    ).length,
    messages: [...document.querySelectorAll('[data-testid="message-row"]')]
      .map((row) => (row.textContent ?? "").trim().slice(0, 80))
      .filter(Boolean),
    // The new chat page's ground: the whole film without the frame, the
    // agent's face in a small pool with it (Riley, 2026-10-27).
    surface:
      document.querySelector(
        ".luca-first-message-surface, .luca-first-message-pool",
      ) !== null,
    systemRows: document.querySelectorAll('[data-testid="system-message-row"]')
      .length,
  }));

async function openAtlas(page: Page, flag: boolean) {
  if (flag) {
    await page
      .getByTestId("app-sidebar")
      .getByRole("button", { name: "Atlas", exact: true })
      .first()
      .click();
  } else {
    // The agent's row opens its list; its chat is the row under it.
    await page.getByTestId("agent-rail-atlas").click();
    await page
      .getByTestId("app-sidebar")
      .getByRole("button", { name: /Chat with Atlas/ })
      .first()
      .click();
  }
}

// ── 1 · a new conversation carrying the relay's note ──────────────────
for (const flag of [true, false]) {
  for (const mode of ["dark", "light"] as Mode[]) {
    test(`first message with the note: flag ${flag ? "on" : "off"}, ${mode}`, async ({
      page,
    }) => {
      const log: string[] = [];
      await boot(page, { flag, log, mode });
      await openAtlas(page, flag);
      await expect(
        page.locator(".luca-first-message-surface, .luca-first-message-pool"),
      ).toBeVisible({
        timeout: 20_000,
      });
      const where = await noted(page);
      // The view holds: sampled over two seconds, it never steps aside and
      // no date or row draws under it.
      const samples: Awaited<ReturnType<typeof conversation>>[] = [];
      for (let index = 0; index < 8; index += 1) {
        samples.push(await conversation(page));
        await page.waitForTimeout(250);
      }
      const channelId = where.hash.match(/channels\/([0-9a-f-]{36})/)?.[1];
      const shotOpen =
        flag && mode === "dark"
          ? await shot(page, "a-first-message-with-note")
          : null;
      // The first real message: the view steps aside and the message shows
      // under its day, as before.
      const input = page.getByTestId("message-input");
      await input.click();
      await input.fill("Atlas, can you read the release notes once more?");
      await input.press("Enter");
      await expect(
        page.locator(".luca-first-message-surface, .luca-first-message-pool"),
      ).toHaveCount(0, {
        timeout: 20_000,
      });
      await expect(
        page
          .getByTestId("message-row")
          .filter({ hasText: "read the release notes once more" }),
      ).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(600);
      const after = await conversation(page);
      measure(`first-message-${flag ? "on" : "off"}-${mode}`, {
        after,
        channelId,
        log,
        noted: where.noted,
        samples,
        shotOpen,
      });
      expect(where.noted).toContain(channelId);
      for (const sample of samples) {
        expect(sample.surface).toBe(true);
        expect(sample.dates).toEqual([]);
        expect(sample.dayGroups).toBe(0);
        expect(sample.systemRows).toBe(0);
        expect(sample.messages).toEqual([]);
      }
      expect(after.surface).toBe(false);
      expect(after.dates).toEqual(["Today"]);
      expect(after.dayGroups).toBe(1);
      expect(after.systemRows).toBe(0);
      // The first message leads; Atlas's reply may already be on its way
      // under it.
      expect(after.messages[0]).toContain("read the release notes once more");
    });
  }
}

// The control: the same fixture with a note the timeline has words for
// shows that the note really arrives with the conversation's history, and
// that only the wordless one is not a message.
test("the control: a note with words is still drawn, under its day", async ({
  page,
}) => {
  const log: string[] = [];
  await boot(page, { fixtures: { note: "channel_created" }, log });
  await openAtlas(page, true);
  await expect(page.getByTestId("system-message-row")).toBeVisible({
    timeout: 20_000,
  });
  await page.waitForTimeout(1500);
  const where = await noted(page);
  const read = await conversation(page);
  const words = await page.getByTestId("system-message-row").innerText();
  measure("first-message-control", { log, read, where, words });
  expect(read.surface).toBe(false);
  expect(read.dates).toEqual(["Today"]);
  expect(read.systemRows).toBe(1);
  expect(words).toContain("created this channel");
});

// ── 2 · an empty Notebook, its line only once its sources settle ──────
async function openNotebook(page: Page) {
  await page
    .getByTestId(`place-row-mind:${ATLAS}`)
    .locator(".luca-rail-row-hit")
    .click();
  await expect(page.getByTestId("mind-space")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("mind-tab-notebook").click();
  await expect(page.getByTestId("mind-notebook")).toBeVisible();
  // Their days is the Notebook's third tab now (BETA14_RELEASE.md WP-40,
  // Decided 3).
  await page.getByTestId("mind-view-days").click();
}

/** Every frame, whether the line is there and whether a day is. */
const sampleFrames = (page: Page) =>
  page.evaluate(() => {
    const frames: { at: number; line: boolean; day: boolean }[] = [];
    (window as unknown as { __WP37_FRAMES__: typeof frames }).__WP37_FRAMES__ =
      frames;
    const tick = () => {
      frames.push({
        at: performance.now(),
        day: document.querySelector('[data-testid="mind-entry"]') !== null,
        line:
          document.querySelector('[data-testid="mind-notebook-empty"]') !==
          null,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const readFrames = (page: Page) =>
  page.evaluate(() => {
    const state = (
      window as unknown as {
        __WP37__: { answered: Record<string, number> };
        __WP37_FRAMES__: { at: number; line: boolean; day: boolean }[];
      }
    ).__WP37__;
    return {
      answered: state.answered,
      frames: (
        window as unknown as {
          __WP37_FRAMES__: { at: number; line: boolean; day: boolean }[];
        }
      ).__WP37_FRAMES__,
    };
  });

const DELAYS = {
  get_agent_memory: 1_800,
  list_artifacts: 2_600,
  list_resident_notebook_items: 1_200,
};

for (const mode of ["dark", "light"] as Mode[]) {
  test(`empty Notebook: the line once its sources settle, ${mode}`, async ({
    page,
  }) => {
    const log: string[] = [];
    await boot(page, {
      fixtures: { delays: DELAYS, empty: true },
      hash: "/agents",
      log,
      mode,
    });
    await expect(page.getByTestId("place-rail-agents")).toBeVisible({
      timeout: 20_000,
    });
    // The sources were read once already by whatever opened first: start
    // again from a cold page so every read is held here.
    await page.evaluate(() => {
      (
        window as unknown as { __WP37__: { answered: object } }
      ).__WP37__.answered = {};
    });
    await sampleFrames(page);
    const opened = await page.evaluate(() => performance.now());
    await openNotebook(page);
    await expect(page.getByTestId("mind-notebook-empty")).toBeVisible({
      timeout: 20_000,
    });
    const { answered, frames } = await readFrames(page);
    const line = page.getByTestId("mind-notebook-empty");
    // WP-40 adds a title above the explanatory line, and replaces the old
    // toolbar/boxed plate with Notebook tabs and unshaded content.
    await expect(line.locator(".luca-mind-empty-title")).toHaveText(
      "Nothing in their days yet",
    );
    const text = await line.locator(".luca-mind-help").innerText();
    const box = await page.evaluate(() => {
      const plate = document.querySelector(
        '[data-testid="mind-notebook-empty"]',
      );
      const toolbar = document.querySelector(".luca-mind-subtabs");
      const words = plate?.querySelector(".luca-mind-help");
      const style = words ? getComputedStyle(words) : null;
      return {
        plate: plate?.getBoundingClientRect().toJSON(),
        plateFill: plate ? getComputedStyle(plate).backgroundColor : null,
        toolbar: toolbar?.getBoundingClientRect().toJSON(),
        words: style
          ? {
              color: style.color,
              fontSize: style.fontSize,
              lineHeight: style.lineHeight,
            }
          : null,
      };
    });
    const firstLine = frames.find((frame) => frame.line && frame.at > opened);
    const lastSource = Math.max(
      ...Object.keys(DELAYS).map((command) => answered[command] ?? Infinity),
    );
    const before = frames.filter(
      (frame) => frame.at > opened && frame.at < lastSource,
    );
    // Sampled at several moments while the sources load.
    const moments = [0.2, 0.4, 0.6, 0.8].map((share) => {
      const at = opened + (lastSource - opened) * share;
      const frame = frames.find((each) => each.at >= at);
      return { at: Math.round(at - opened), line: frame?.line ?? null };
    });
    const shotEmpty =
      mode === "dark" ? await shot(page, "b-empty-notebook") : null;
    measure(`empty-notebook-${mode}`, {
      answered: Object.fromEntries(
        Object.entries(answered).map(([key, at]) => [
          key,
          Math.round(at - opened),
        ]),
      ),
      box,
      firstLineAt: firstLine ? Math.round(firstLine.at - opened) : null,
      framesWhileLoading: before.length,
      lastSourceAt: Math.round(lastSource - opened),
      linesWhileLoading: before.filter((frame) => frame.line).length,
      log,
      moments,
      shotEmpty,
      text,
    });
    expect(text).toBe(
      "Atlas's days will gather here: what they do for you, their own work, their journal.",
    );
    expect(Number.isFinite(lastSource)).toBe(true);
    expect(before.length).toBeGreaterThan(20);
    expect(before.filter((frame) => frame.line)).toHaveLength(0);
    for (const moment of moments) expect(moment.line).toBe(false);
    expect(firstLine && firstLine.at >= lastSource).toBe(true);
    // Under the Notebook tabs, directly on the shared page (WP-40).
    expect(
      box.plate && box.toolbar && box.plate.top >= box.toolbar.bottom,
    ).toBe(true);
    expect(box.plateFill).toBe("rgba(0, 0, 0, 0)");
    expect(box.words?.fontSize).toBe("13px");
  });
}

test("empty Notebook: the line goes the moment a day arrives", async ({
  page,
}) => {
  const log: string[] = [];
  await boot(page, {
    fixtures: { empty: true, journal: true },
    hash: "/agents",
    log,
  });
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  await openNotebook(page);
  await expect(page.getByTestId("mind-notebook-empty")).toBeVisible({
    timeout: 20_000,
  });
  await sampleFrames(page);
  // The page being written lands: the Notebook asks again while a journal
  // job runs, and this time it is there.
  await page.evaluate(() => {
    (window as unknown as { __WP37__: { arrive: boolean } }).__WP37__.arrive =
      true;
  });
  await expect(page.getByTestId("mind-entry")).toHaveCount(1, {
    timeout: 20_000,
  });
  await page.waitForTimeout(300);
  const { frames } = await readFrames(page);
  const both = frames.filter((frame) => frame.line && frame.day);
  const firstDay = frames.findIndex((frame) => frame.day);
  measure("empty-notebook-arrival", {
    bothInOneFrame: both.length,
    frames: frames.length,
    lineAfterDay: frames.slice(firstDay).some((frame) => frame.line),
    lineBeforeDay: frames[firstDay - 1]?.line ?? null,
    log,
  });
  expect(firstDay).toBeGreaterThan(0);
  expect(frames[firstDay - 1]?.line).toBe(true);
  expect(both).toHaveLength(0);
  await expect(page.getByTestId("mind-notebook-empty")).toHaveCount(0);
});

// ── 3 · Claude Code's page head ───────────────────────────────────────
const head = (page: Page) =>
  page.evaluate(() => {
    const card = document.querySelector('[data-testid="connected-app-card"]');
    const header = card?.querySelector('[data-testid="place-page-head"]');
    const box = (el: Element | null | undefined) => {
      const r = el?.getBoundingClientRect();
      return r
        ? {
            bottom: Math.round(r.bottom),
            left: Math.round(r.left),
            right: Math.round(r.right),
            top: Math.round(r.top),
          }
        : null;
    };
    const name = header?.querySelector(".luca-place-page-name");
    const state = header?.querySelector('[data-testid="place-page-state"]');
    const action = header?.querySelector(".luca-place-page-action button");
    const stateStyle = state ? getComputedStyle(state) : null;
    return {
      action: action ? (action.textContent ?? "").trim() : null,
      actionBox: box(action),
      eyebrow:
        header?.querySelector(".luca-place-page-eyebrow")?.textContent ?? null,
      head: box(header),
      headText: (header?.textContent ?? "").trim(),
      name: name?.textContent ?? null,
      nameBox: box(name),
      state: state?.textContent ?? null,
      stateBox: box(state),
      stateStyle: stateStyle
        ? { color: stateStyle.color, fontSize: stateStyle.fontSize }
        : null,
    };
  });

for (const mode of ["dark", "light"] as Mode[]) {
  test(`Claude Code's page head, and its New conversation is the +, ${mode}`, async ({
    page,
  }) => {
    const log: string[] = [];
    await boot(page, { hash: "/apps/claude", log, mode });
    await expect(page.getByTestId("connected-app-card")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByTestId("connected-app-card").getByTestId("place-page-state"),
    ).toHaveText("Connected · on this Mac", { timeout: 20_000 });
    const read = await head(page);
    const shotHead =
      mode === "dark"
        ? await shot(page, "c-claude-code-page-head", {
            height: 150,
            width: 760,
            x: Math.max(0, (read.head?.left ?? 0) - 40),
            y: Math.max(0, (read.head?.top ?? 0) - 30),
          })
        : null;
    // The head's New conversation…
    const navigations: string[] = [];
    await page.getByTestId("connected-app-new-conversation").click();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain("/messages/new");
    await page.waitForTimeout(400);
    navigations.push(await page.evaluate(() => window.location.hash));
    const fromHead = await page.evaluate(() => ({
      hash: window.location.hash,
      page: document.querySelector('[data-testid="new-message-page"]') !== null,
    }));
    // …and the rail's `+` on Claude Code's home: the same navigation.
    await page.goto("/#/apps/claude");
    await expect(page.getByTestId("connected-app-card")).toBeVisible({
      timeout: 20_000,
    });
    const home = page.getByTestId("rail-home-app:claude");
    await home.hover();
    await home
      .getByRole("button", { name: "New conversation with Claude Code" })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toContain("/messages/new");
    await page.waitForTimeout(400);
    const fromPlus = await page.evaluate(() => ({
      hash: window.location.hash,
      page: document.querySelector('[data-testid="new-message-page"]') !== null,
    }));
    measure(`app-head-${mode}`, { fromHead, fromPlus, log, read, shotHead });
    expect(read.eyebrow).toBeNull();
    expect(read.name).toBe("Claude Code");
    expect(read.state).toBe("Connected · on this Mac");
    expect(
      read.stateBox && read.nameBox && read.stateBox.top >= read.nameBox.bottom,
    ).toBe(true);
    expect(read.action).toBe("New conversation");
    expect(
      read.actionBox &&
        read.stateBox &&
        read.actionBox.left > read.stateBox.right,
    ).toBe(true);
    expect(fromHead.hash).toContain("/messages/new?runtime=claude");
    expect(fromHead).toEqual(fromPlus);
  });

  test(`an app not connected says so and offers nothing, ${mode}`, async ({
    page,
  }) => {
    const log: string[] = [];
    await boot(page, { hash: "/apps/grok", log, mode });
    await expect(page.getByTestId("connected-app-card")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByTestId("connected-app-card").getByTestId("place-page-state"),
    ).toHaveText("Not connected on this Mac", { timeout: 20_000 });
    const read = await head(page);
    const body = await page
      .getByTestId("connected-app-card")
      .getByRole("status")
      .first()
      .innerText();
    measure(`app-head-disconnected-${mode}`, { body, log, read });
    expect(read.action).toBeNull();
    expect(
      await page.getByTestId("connected-app-new-conversation").count(),
    ).toBe(0);
    expect(read.headText).not.toMatch(/(^|[^t] )Connected/);
    expect(read.state).toBe("Not connected on this Mac");
    expect(body).toBe("This app is no longer connected on this Mac.");
  });
}

// ── 4 · one way of naming a day ───────────────────────────────────────
test("the Notebook and All activity name the same days the same way", async ({
  page,
}) => {
  const log: string[] = [];
  await boot(page, { fixtures: { empty: true }, hash: "/agents", log });
  await expect(page.getByTestId("place-rail-agents")).toBeVisible({
    timeout: 20_000,
  });
  const noon = (daysAgo: number, yearsAgo = 0) => {
    const at = new Date();
    at.setFullYear(at.getFullYear() - yearsAgo);
    at.setDate(at.getDate() - daysAgo);
    at.setHours(daysAgo === 0 ? Math.max(0, new Date().getHours() - 1) : 12, 0);
    return Math.floor(at.getTime() / 1000);
  };
  const times = [noon(0), noon(1), noon(4), noon(9, 1)];
  const ids = await page.evaluate(
    ({ atlas, general, times }) =>
      times.map(
        (createdAt, index) =>
          (
            window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
              channelId: general,
              content: `Release note ${index + 1}, read again.`,
              createdAt,
              kind: 9,
              pubkey: atlas,
            }) as { id: string }
          ).id,
      ),
    { atlas: ATLAS, general: GENERAL, times },
  );
  await openNotebook(page);
  await expect(page.locator(".luca-mind-day")).toHaveCount(4, {
    timeout: 20_000,
  });
  const notebook = await page.evaluate(() =>
    [...document.querySelectorAll(".luca-mind-day")].map((day) => ({
      label: day.getAttribute("aria-label"),
      times: [...day.querySelectorAll("time")].map((time) =>
        time.getAttribute("datetime"),
      ),
    })),
  );
  await page.goto("/#/pulse");
  await expect(page.getByTestId("all-activity-card")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator(`[data-testid="all-activity-record:${ids[3]}"]`),
  ).toBeVisible({ timeout: 20_000 });
  const activity = await page.evaluate(
    (ids) =>
      ids.map(
        (id) =>
          document
            .querySelector(`[data-testid="all-activity-record:${id}"]`)
            ?.closest('[data-testid="all-activity-day"]')
            ?.getAttribute("aria-label") ?? null,
      ),
    ids,
  );
  const expected = times.map((at) => {
    const day = new Date(at * 1000);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (day.toDateString() === today.toDateString()) return "Today";
    if (day.toDateString() === yesterday.toDateString()) return "Yesterday";
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      weekday: "long",
      ...(day.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
    }).format(day);
  });
  measure("day-labels", { activity, expected, log, notebook, times });
  expect(notebook.map((day) => day.label)).toEqual(expected);
  expect(activity).toEqual(expected);
});

// ── 5 · Settings' list heads speak like the rails' ────────────────────
for (const mode of ["dark", "light"] as Mode[]) {
  test(`Settings' list heads are the Chats rail's heads, ${mode}`, async ({
    page,
  }) => {
    const log: string[] = [];
    await boot(page, { hash: `/channels/${GENERAL}`, log, mode });
    const type = (selector: string) =>
      page.evaluate((selector) => {
        return [...document.querySelectorAll<HTMLElement>(selector)].map(
          (each) => {
            const style = getComputedStyle(each);
            return {
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              letterSpacing: style.letterSpacing,
              shown: each.innerText.trim(),
              textTransform: style.textTransform,
            };
          },
        );
      }, selector);
    await expect(page.locator(".luca-rail-section-head").first()).toBeVisible({
      timeout: 20_000,
    });
    const rail = await type("[data-shell-rail] .luca-rail-section-head");
    await page.goto("/#/settings");
    await expect(page.getByTestId("settings-section-list")).toBeVisible({
      timeout: 20_000,
    });
    const settings = await type(".luca-settings-group-head");
    measure(`settings-heads-${mode}`, { log, rail, settings });
    const voice = ({ shown: _shown, ...rest }: (typeof rail)[number]) => rest;
    expect(rail.length).toBeGreaterThan(0);
    // WP-40 (Decided 1): mono capitals again, so they show in capitals.
    expect(settings.map((each) => each.shown)).toEqual([
      "ACCOUNT",
      "EXPERIENCE",
      "AGENT SYSTEM",
      "APPLICATION",
    ]);
    for (const each of settings) expect(voice(each)).toEqual(voice(rail[0]));
  });
}
