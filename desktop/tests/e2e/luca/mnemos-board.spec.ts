import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import {
  BOARD_PICTURES,
  BROKEN_PICTURE,
  kestrelBoard,
  wrenOld,
} from "./mnemos-board-fixture";
import { KESTREL_HELLO } from "./mnemos-newer-fixture";

/**
 * WP-49, the place's board, Hours and its dial, Settings, Shared and the
 * pictures (polyphonic-beta14-finish.md). Kestrel is a made-up mind on a
 * newer Mnemos; Wren a made-up one on 0.6.7. Every Mnemos command is played
 * by this spec, in the page: nothing here reaches a real engine, so no
 * `hours` request can schedule anything, and no `mnemos log` starts.
 */

const SHOTS = process.env.WP49_SHOTS ?? "test-results/wp49";
type Mode = "dark" | "light";

type Call = { cmd: string; args?: Record<string, unknown> };
type Probe = {
  calls: Call[];
  open: string | null;
  /** How the next `hours` write goes. */
  hoursMode: "ok" | "refuse";
  /** How the next own-page start goes. */
  ownPage: "ok" | "fail";
  token: string;
};

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 120_000 });

/** The engine's own sentence for the quiet hours inside Hermes. */
const HERMES =
  "The quiet hours run through Claude Code on your own account, so they're set from Claude Code, not from inside Hermes.";

async function boot(
  page: Page,
  {
    hash = "/mnemos?mind=kestrel&room=glance",
    mode = "dark",
    sharedStatus = "ready",
    reducedMotion = false,
    longWords = false,
  }: {
    hash?: string;
    mode?: Mode;
    sharedStatus?: string;
    reducedMotion?: boolean;
    longWords?: boolean;
  } = {},
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  if (reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({
      kestrel,
      wren,
      hello,
      pictures,
      broken,
      sharedStatus,
      hermes,
      longWords,
    }) => {
      type Invoke = (
        cmd: string,
        args?: Record<string, unknown>,
        opts?: unknown,
      ) => Promise<unknown>;
      const win = window as unknown as {
        __TAURI_INTERNALS__?: { invoke?: Invoke };
        boardProbe: Probe;
      };
      const bridge = win.__TAURI_INTERNALS__ ?? {};
      win.__TAURI_INTERNALS__ = bridge;
      const probe: Probe = {
        calls: [],
        open: null,
        hoursMode: "ok",
        ownPage: "ok",
        token: "bt1",
      };
      win.boardProbe = probe;
      kestrel.life.shared.status = sharedStatus;
      if (longWords) {
        // One very long unbroken word in every piece of words either mind
        // has, and in the newest picture's name.
        const long = "W".repeat(300);
        const words = new Set(["content", "text", "said", "mood", "person"]);
        const stretch = (value: unknown) => {
          if (Array.isArray(value)) value.forEach(stretch);
          else if (value && typeof value === "object")
            for (const [key, inner] of Object.entries(value)) {
              if (words.has(key) && typeof inner === "string" && inner)
                (value as Record<string, unknown>)[key] = `${long} ${inner}`;
              else stretch(inner);
            }
        };
        stretch(kestrel);
        stretch(wren);
        const first = kestrel.life.studio[0];
        if (first) {
          const path = `${long}.png`;
          pictures[path] = pictures[first.path] ?? "";
          first.path = path;
        }
      }
      const now = Date.now();
      const iso = (ms: number) => new Date(ms).toISOString();
      const minds = [
        {
          id: "kestrel",
          name: "Kestrel",
          memories: 12,
          newest: iso(now).slice(0, 10),
          linked: [] as { pubkey: string; name: string }[],
        },
        {
          id: "wren",
          name: "Wren",
          memories: 24,
          newest: iso(now).slice(0, 10),
          linked: [] as { pubkey: string; name: string }[],
        },
      ];
      const seen = new Set<string>();
      const listed = new Set<string>();
      const idsIn = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(idsIn);
        else if (value && typeof value === "object")
          for (const [key, inner] of Object.entries(value))
            if (key === "id" && typeof inner === "string") seen.add(inner);
            else idsIn(inner);
      };
      const fail = (code: string) => Promise.reject(code);
      let changes = 1;
      const changed = () => {
        changes += 1;
        probe.token = `bt${changes}`;
      };
      const summary = () => {
        const life = kestrel.life;
        const theirs = life.notes.filter((n) => n.author === "agent");
        return {
          missing: false,
          counts: {
            memories: kestrel.memories.length,
            states: life.memory.states,
            shared: life.shared.rows.length,
            beliefs: life.beliefs.length,
            questions: life.questions.open,
            answered: life.questions.answered.length,
            journal: life.journal.length,
            notes: theirs.length,
            replies: life.notes.length - theirs.length,
            hours: life.hours.length,
            made: life.studio.length,
            carrying: life.handoffs.length,
          },
          unread: theirs.filter((n) => !n.read).length,
          waiting: 1,
          change_token: probe.token,
        };
      };
      const kestrelRead = (request: Record<string, unknown>) => {
        if (request.command === "summary")
          return { kind: "summary", summary: summary() };
        if (request.command === "notebook" && request.part === "life") {
          idsIn(kestrel.life);
          const paths = kestrel.life.studio.map((s) => s.path);
          for (const path of paths) listed.add(path);
          return {
            kind: "notebook",
            part: "life",
            document: kestrel.life,
            page: null,
            pictures: paths,
          };
        }
        if (request.command === "notebook" && request.part === "memories") {
          const offset = Number(request.offset ?? 0);
          const limit = Number(request.limit ?? kestrel.memories.length);
          const slice = kestrel.memories.slice(offset, offset + limit);
          idsIn(slice);
          const end = offset + slice.length;
          return {
            kind: "notebook",
            part: "memories",
            document: {
              version: kestrel.version,
              made: iso(Date.now()),
              memories: slice,
              ...(offset === 0 ? { recalled: kestrel.recalled } : {}),
            },
            page: {
              offset,
              limit,
              total: kestrel.memories.length,
              next: end < kestrel.memories.length ? end : null,
            },
            pictures: [],
          };
        }
        return fail(`unexpected kestrel ${String(request.command)}`);
      };
      const kestrelWrite = (write: Record<string, unknown>) => {
        const named = [write.note_id, write.memory_id].filter(
          (id): id is string => typeof id === "string",
        );
        if (named.some((id) => !seen.has(id))) return fail("unknown_item");
        if (write.command === "hours") {
          if (probe.hoursMode === "refuse")
            return fail(`mnemos_refused:${hermes}`);
          return {
            kind: "hours",
            said: write.on
              ? `Installed: three quiet hours for kestrel, made-up times ${String(write.mine)}, ${String(write.ours)}, ${String(write.dream)}.`
              : "Uninstalled: the quiet hours for kestrel, made up.",
          };
        }
        if (write.command === "shared") {
          const rows = kestrel.life.shared.rows;
          if (write.action === "add") {
            const id = `kes-s${rows.length + 10}`;
            rows.unshift({
              id,
              content: String(write.text),
              author: "person",
              person: "Pat",
              model: "",
              born: iso(Date.now()),
              editable: true,
            });
            changed();
            return {
              kind: "shared",
              said: `Saved to shared memory. Every agent on this machine can read it.\nShared memory ID: ${id}`,
            };
          }
          const row = rows.find((r) => r.id === write.memory_id);
          if (!row) return fail("unknown_item");
          if (write.action === "correct") {
            row.content = String(write.text);
            changed();
            return {
              kind: "shared",
              said: "Corrected. Your earlier words stay in the archive.",
            };
          }
          if (write.action === "forget") {
            if (write.confirmed !== true)
              return fail(
                "mnemos_refused:Letting a shared memory go is asked twice.",
              );
            rows.splice(rows.indexOf(row), 1);
            changed();
            return { kind: "shared", said: "Let go. It stays in the archive." };
          }
        }
        return fail("invalid_request");
      };
      const wrenRead = (request: Record<string, unknown>) => {
        if (request.command === "summary" || request.command === "notebook")
          return fail(`unexpected ${String(request.command)} to 0.6.7`);
        if (request.command === "memories") {
          const held = wren.memories.filter((m) =>
            request.state ? m.state === request.state : m.state !== "archived",
          );
          const offset = Number(request.offset ?? 0);
          const page = held.slice(offset, offset + Number(request.limit));
          for (const m of page) seen.add(m.id);
          return {
            kind: "memories",
            memories: page,
            counts: {
              active: wren.memories.filter((m) => m.state === "active").length,
              dormant: wren.memories.filter((m) => m.state === "dormant")
                .length,
              archived: 3,
            },
          };
        }
        if (request.command === "journal") {
          for (const e of wren.journal) seen.add(e.id);
          return {
            kind: "journal",
            entries: wren.journal.slice(0, Number(request.last)),
          };
        }
        if (request.command === "notes") {
          for (const n of wren.notes) seen.add(n.id);
          return { kind: "notes", notes: wren.notes };
        }
        return fail("invalid_request");
      };
      const place = async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "mnemos_place_minds")
          return { mnemosReady: true, minds, withoutMemory: [] };
        if (cmd === "open_mnemos_mind") {
          if (probe.open !== args.mind) seen.clear();
          probe.open = String(args.mind);
          return true;
        }
        if (cmd === "mnemos_place_hello")
          return probe.open === "kestrel" && args.mind === "kestrel"
            ? hello
            : null;
        if (cmd === "read_mnemos_place") {
          if (probe.open !== args.mind) return fail("not_open");
          const request = args.request as Record<string, unknown>;
          return args.mind === "kestrel"
            ? kestrelRead(request)
            : wrenRead(request);
        }
        if (cmd === "write_mnemos_place") {
          if (probe.open !== args.mind) return fail("not_open");
          if (args.mind !== "kestrel") return fail("invalid_request");
          return kestrelWrite(args.write as Record<string, unknown>);
        }
        if (cmd === "mnemos_place_picture") {
          const path = String(args.path);
          if (args.mind !== "kestrel" || !listed.has(path))
            return fail("unknown_item");
          // The engine listed it, but its bytes are no picture.
          if (path === broken) return fail("not_a_picture");
          const bytes = Uint8Array.from(atob(pictures[path] ?? ""), (c) =>
            c.charCodeAt(0),
          );
          return bytes.buffer;
        }
        if (cmd === "mnemos_place_item") {
          // The engine's own record: whether its store holds that id.
          const id = String(args.id);
          return args.mind === "kestrel"
            ? JSON.stringify([kestrel.memories, kestrel.life]).includes(
                `"id":"${id}"`,
              )
            : seen.has(id);
        }
        if (cmd === "open_mnemos_own_page") {
          if (probe.open !== args.mind) return fail("not_open");
          return probe.ownPage === "fail" ? fail("own_page_unavailable") : null;
        }
        if (cmd === "close_mnemos_place") {
          probe.open = null;
          return null;
        }
        if (cmd === "mnemos_place_shown") return null;
        return fail(`unexpected ${cmd}`);
      };
      let delegate: Invoke | undefined;
      Object.defineProperty(bridge, "invoke", {
        configurable: true,
        set(next: Invoke) {
          delegate = next;
        },
        get:
          () =>
          async (
            cmd: string,
            args?: Record<string, unknown>,
            opts?: unknown,
          ) => {
            if (!cmd.includes("mnemos")) return delegate?.(cmd, args, opts);
            probe.calls.push({
              cmd,
              args: args ? JSON.parse(JSON.stringify(args)) : undefined,
            });
            return place(cmd, args);
          },
      });
    },
    {
      kestrel: kestrelBoard(Date.now()),
      wren: wrenOld(Date.now()),
      hello: KESTREL_HELLO,
      pictures: BOARD_PICTURES,
      broken: BROKEN_PICTURE,
      sharedStatus,
      hermes: HERMES,
      longWords,
    },
  );
  await installMockBridge(page, {});
  await page.addInitScript(
    ({ key, light }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = true;
      localStorage.setItem(key, JSON.stringify(overrides));
      if (light) {
        localStorage.setItem("buzz-theme", "paper");
        localStorage.setItem("buzz-follow-system", "false");
      }
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light: mode === "light" },
  );
  await expect(async () => {
    await page.goto(`/#${hash}`);
    await expect(page.getByTestId("app-sidebar").first()).toBeVisible({
      timeout: 20_000,
    });
  }).toPass({ timeout: 60_000 });
  return errors;
}

const probeOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { boardProbe: Probe }).boardProbe);
const card = (page: Page) => page.getByTestId("mnemos-place");
const rail = (page: Page) => page.getByTestId("place-rail-mnemos");
const board = (page: Page) => page.getByTestId("mnemos-board");

/** The writes sent to the engine, by command. */
async function writes(page: Page, command?: string) {
  return (await probeOf(page)).calls
    .filter((c) => c.cmd === "write_mnemos_place")
    .map((c) => c.args?.write as Record<string, unknown>)
    .filter((w) => !command || w.command === command);
}

function consoleClean(errors: string[]) {
  return errors.filter((e) => !/ResizeObserver loop/.test(e));
}

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

async function shot(page: Page, name: string) {
  await waitForAnimations(page);
  await page.waitForTimeout(300);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(readFileSync(`${SHOTS}/hashes.json`, "utf8"));
  } catch {
    all = {};
  }
  all[name] = hash;
  writeFileSync(`${SHOTS}/hashes.json`, JSON.stringify(all, null, 2));
}

/** Each row of the board's plates, by their top, with each one's height. */
async function plateRows(page: Page) {
  return board(page).evaluate((el) => {
    const rows = new Map<number, { id: string; height: number }[]>();
    for (const plate of el.querySelectorAll<HTMLElement>(
      ":scope > .luca-mnemos-plate",
    )) {
      const box = plate.getBoundingClientRect();
      const top = Math.round(box.top);
      rows.set(top, [
        ...(rows.get(top) ?? []),
        { id: plate.dataset.testid ?? "", height: Math.round(box.height) },
      ]);
    }
    return [...rows.entries()].map(([top, plates]) => ({ top, plates }));
  });
}

/** Whether any plate scrolls inside, or its words run past it. */
async function platesScroll(page: Page) {
  return board(page).evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>(":scope > .luca-mnemos-plate")]
      .filter(
        (p) =>
          getComputedStyle(p).overflowY === "auto" ||
          getComputedStyle(p).overflowY === "scroll" ||
          p.scrollHeight > p.clientHeight + 1,
      )
      .map((p) => p.dataset.testid),
  );
}

test("(1) the whole board on a newer Mnemos, in its order, both themes and sizes", async ({
  page,
}) => {
  const errors = await boot(page);
  await expect(board(page)).toBeVisible();
  // The plates in the notebook's order.
  const order = await board(page).evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>(":scope > .luca-mnemos-plate")].map(
      (p) => p.querySelector("h2")?.textContent?.trim(),
    ),
  );
  expect(order).toEqual([
    "Waiting on you1",
    "Hours3",
    "Today1 kept",
    "Memory2 let go",
    "Beliefs2, held at 58% to 84%",
    "Made lately4 pictures",
    "What its memory asks3 open",
    "Journal3",
    expect.stringMatching(/^Carrying forwardToday, \d+:\d\d [ap]m$/),
  ]);
  // Each from the notebook.
  await expect(page.getByTestId("mnemos-plate-waiting")).toContainText(
    "Should the morning note lead with the tide even on calm days?",
  );
  await expect(page.getByTestId("mnemos-count")).toHaveText("12");
  await expect(page.getByTestId("mnemos-memory-days")).toHaveText(
    /^12 days with something kept, since [A-Z][a-z]{2} \d{1,2}$/,
  );
  await expect(page.getByTestId("mnemos-plate-day")).toContainText(
    "When the wind backs south, the swell follows by evening.",
  );
  await expect(page.getByTestId("mnemos-plate-day")).toContainText(
    "It woke with one memory in hand",
  );
  await expect(
    page.getByTestId("mnemos-made-thumb").locator("img"),
  ).toHaveCount(3);
  await expect(page.getByTestId("mnemos-plate-made")).toContainText(
    "studies / harbour-dawn · Today,",
  );
  await expect(page.getByTestId("mnemos-plate-asks")).toContainText(
    "What did it teach?",
  );
  await expect(page.getByTestId("mnemos-plate-journal")).toContainText(
    "The fog lifted by nine.",
  );
  await expect(page.getByTestId("mnemos-plate-carrying")).toContainText(
    "Ask Pat whether calm days still lead with the tide.",
  );
  await expect(page.getByTestId("mnemos-plate-carrying")).toContainText(
    "The note it left itself",
  );
  // The memory count is the one large thing.
  const sizes = await board(page).evaluate((el) => {
    const all = [...el.querySelectorAll<HTMLElement>("*")]
      .filter((n) => n.childNodes.length && n.textContent?.trim())
      .map((n) => ({
        id: n.dataset.testid ?? n.className,
        size: Number.parseFloat(getComputedStyle(n).fontSize),
      }));
    const count = all.find((n) => n.id === "mnemos-count")?.size ?? 0;
    const next = Math.max(
      ...all.filter((n) => n.id !== "mnemos-count").map((n) => n.size),
    );
    return { count, next };
  });
  expect(sizes.count).toBeGreaterThanOrEqual(32);
  expect(sizes.next).toBeLessThanOrEqual(16);
  measure("type-sizes", sizes);
  // Rows rest at one height; nothing scrolls inside a plate.
  const rows = await plateRows(page);
  measure("plate-rows-1440", rows);
  expect(rows.map((r) => r.plates.length)).toEqual([3, 3, 3]);
  for (const r of rows)
    expect(new Set(r.plates.map((p) => p.height)).size, JSON.stringify(r)).toBe(
      1,
    );
  expect(await platesScroll(page)).toEqual([]);
  await shot(page, "01-board-dark");

  // At 1100 by 720: two columns, rows still level.
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForTimeout(300);
  const narrow = await plateRows(page);
  measure("plate-rows-1100", narrow);
  expect(narrow.map((r) => r.plates.length)).toEqual([1, 2, 1, 2, 2, 1]);
  for (const r of narrow)
    expect(new Set(r.plates.map((p) => p.height)).size, JSON.stringify(r)).toBe(
      1,
    );
  expect(await platesScroll(page)).toEqual([]);
  await shot(page, "11-board-1100-dark");
  expect(consoleClean(errors)).toEqual([]);
});

test("(1) the board in the light", async ({ page }) => {
  const errors = await boot(page, { mode: "light" });
  await expect(page.getByTestId("mnemos-count")).toHaveText("12");
  await expect(
    page.getByTestId("mnemos-made-thumb").locator("img"),
  ).toHaveCount(3);
  const rows = await plateRows(page);
  for (const r of rows)
    expect(new Set(r.plates.map((p) => p.height)).size).toBe(1);
  await shot(page, "02-board-light");
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForTimeout(300);
  for (const r of await plateRows(page))
    expect(new Set(r.plates.map((p) => p.height)).size).toBe(1);
  expect(consoleClean(errors)).toEqual([]);
});

test("(1) on Mnemos 0.6.7, today's board and one line at its foot", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?mind=wren&room=glance" });
  await expect(page.getByTestId("mnemos-glance")).toBeVisible();
  await expect(page.getByTestId("mnemos-count")).toHaveText("24");
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(
    `${SHOTS}/old-board.html`,
    await page
      .getByTestId("mnemos-glance")
      .evaluate((el) =>
        el.outerHTML
          .replace(/blob:[^"]+/g, "blob")
          .replace(/\b\d{1,2}:\d\d\s?[AP]M\b/g, "TIME"),
      ),
  );
  await expect(page.getByTestId("mnemos-plate-waiting")).toContainText(
    "Should I keep the old tide tables, or let them go?",
  );
  await expect(page.getByTestId("mnemos-board-newer")).toHaveText(
    "A newer Mnemos shows more here.",
  );
  // Today's board: the same plates, no heads that go anywhere, no dial.
  const labels = await page
    .getByTestId("mnemos-glance")
    .evaluate((el) =>
      [...el.querySelectorAll("h2")].map((h) => h.textContent?.trim()),
    );
  expect(labels).toEqual([
    "Waiting on you",
    "Memory",
    "Lately",
    "Journal",
    "Carrying forward",
    "Beliefs",
  ]);
  await expect(page.locator(".luca-mnemos-plate-head")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-board")).toHaveCount(0);
  // The line sits under the board, quiet.
  const foot = await page.getByTestId("mnemos-board-newer").evaluate((el) => {
    const glance = document.querySelector("[data-testid='mnemos-glance']");
    return {
      below:
        el.getBoundingClientRect().top -
        (glance?.getBoundingClientRect().bottom ?? 0),
      size: getComputedStyle(el).fontSize,
    };
  });
  expect(foot.below).toBeGreaterThan(8);
  expect(foot.size).toBe("12px");
  await shot(page, "03-board-old-engine-dark");
  // Its rail has no state line: an older Mnemos gives no hours.
  await expect(page.getByTestId("mnemos-rail-state")).toHaveCount(0);
  expect(consoleClean(errors)).toEqual([]);
});

test("(1) every plate's head goes to its section", async ({ page }) => {
  const errors = await boot(page);
  const heads: [string, string][] = [
    ["mnemos-plate-waiting-head", "notes"],
    ["mnemos-plate-hours-head", "hours"],
    ["mnemos-plate-day-head", "log"],
    ["mnemos-plate-memory-head", "memories"],
    ["mnemos-plate-beliefs-head", "beliefs"],
    ["mnemos-plate-made-head", "log"],
    ["mnemos-plate-asks-head", "questions"],
    ["mnemos-plate-journal-head", "journal"],
    ["mnemos-plate-carrying-head", "carrying"],
  ];
  const went: Record<string, string> = {};
  for (const [head, room] of heads) {
    await page.getByTestId(head).click();
    await expect(page).toHaveURL(new RegExp(`room=${room}`));
    went[head] = new URL(page.url().replace("#/", "")).searchParams.get(
      "room",
    ) as string;
    await page.goBack();
    await expect(board(page)).toBeVisible();
  }
  measure("plate-heads", went);
  expect(consoleClean(errors)).toEqual([]);
});

test("(1) beliefs: a bar each, one picked, stepped by pointer and by key", async ({
  page,
}) => {
  const errors = await boot(page);
  const bars = page.getByTestId("mnemos-belief-bars");
  await expect(bars).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByTestId("mnemos-belief-held")).toHaveText(
    "Held at 84% · 1 of 2",
  );
  await expect(page.getByTestId("mnemos-belief-words")).toHaveText(
    "The tide is the first thing Pat wants to know.",
  );
  await page.getByTestId("mnemos-belief-next").click();
  await expect(page.getByTestId("mnemos-belief-held")).toHaveText(
    "Held at 58% · 2 of 2",
  );
  await expect(page.getByTestId("mnemos-belief-words")).toHaveText(
    "Fog and late ferries come together.",
  );
  await expect(page.getByTestId("mnemos-belief-next")).toBeDisabled();
  await bars.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(bars).toHaveAttribute("aria-valuenow", "1");
  await expect(bars).toHaveAttribute(
    "aria-valuetext",
    "Held at 84%: The tide is the first thing Pat wants to know.",
  );
  await page.keyboard.press("End");
  await expect(bars).toHaveAttribute("aria-valuenow", "2");
  // Each bar is as tall as its belief is held.
  const heights = await bars.evaluate((el) =>
    [...el.querySelectorAll("span")].map((s) =>
      Math.round(s.getBoundingClientRect().height),
    ),
  );
  measure("belief-bars", heights);
  expect(heights[0]).toBeGreaterThan(heights[1] as number);
  expect(consoleClean(errors)).toEqual([]);
});

test("(2, 3) the rail's state line; the dial and its one-sentence alternative", async ({
  page,
}) => {
  const errors = await boot(page);
  // Its own hour ended four hours and twenty minutes ago: still warm.
  await expect(page.getByTestId("mnemos-rail-state")).toHaveText(
    "Still warm · its own hour ended 4.3 h ago",
  );
  // Nothing else joins the rail.
  const railMind = await page
    .getByTestId("mnemos-rail-mind-button")
    .evaluate((el) =>
      [...el.querySelectorAll("span")]
        .map((s) => s.textContent?.replace(/\u00a0/g, " ").trim())
        .filter(Boolean),
    );
  expect(railMind).toEqual([
    "Kestrel",
    "Still warm · its own hour ended 4.3 h ago",
  ]);
  const face = page.getByTestId("mnemos-dial-face");
  await expect(face).toHaveAttribute("role", "img");
  const said = (await face.getAttribute("aria-label")) ?? "";
  measure("dial-sentence", { said });
  expect(said).toMatch(
    /^Still warm: its own hour ended 4\.3 h ago; its hours fall at 8:00 am for its own hour, 7:00 pm for our hour and 3:30 am for a dream; it is now \d{1,2}:\d\d [ap]m; next, (its own hour at 8:00 am|our hour at 7:00 pm|a dream at 3:30 am)\.$/,
  );
  await expect(page.getByTestId("mnemos-dial-next")).toHaveText(
    /^Next, (its own hour at 8:00 am|our hour at 7:00 pm|a dream at 3:30 am)$/,
  );
  // Three arcs, the newest hour's kind in the full ink; no accent colour.
  const dial = await page.getByTestId("mnemos-dial").evaluate((el) => {
    const arcs = [...el.querySelectorAll("path")].map((p) => ({
      kind: p.dataset.kind,
      last: p.hasAttribute("data-last"),
      stroke: getComputedStyle(p).stroke,
    }));
    const ink = getComputedStyle(
      document.querySelector(".luca-mnemos-dial-word") as Element,
    ).color;
    return { arcs, ink };
  });
  measure("dial", dial);
  expect(dial.arcs.map((a) => [a.kind, a.last])).toEqual([
    ["mine", true],
    ["ours", false],
    ["dream", false],
  ]);
  // Ink only: every arc is the notebook's own ink, at full or part strength.
  const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).join(",");
  for (const a of dial.arcs)
    expect(rgb(a.stroke), a.stroke).toBe(rgb(dial.ink));
  // It doesn't move.
  const before = await face.innerHTML();
  await page.waitForTimeout(1_500);
  expect(await face.innerHTML()).toBe(before);
  expect(consoleClean(errors)).toEqual([]);
});

test("(4) Hours: the list, an hour opened, and every way out of it", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?mind=kestrel&room=hours" });
  await expect(page.getByTestId("mnemos-hours-subtitle")).toHaveText(
    "Time between conversations that’s Kestrel’s own: an hour to itself, half an hour for the day’s work, a short time each night to dream.",
  );
  await expect(page.getByTestId("mnemos-hours-dial-face")).toBeVisible();
  const list = page.getByTestId("mnemos-hours-list");
  await expect(list.locator("li")).toHaveCount(3);
  await expect(page.getByTestId("mnemos-hours-row-kes-h1")).toContainText(
    "Its own hour · still warm",
  );
  await expect(page.getByTestId("mnemos-hours-row-kes-h3")).toContainText(
    "Our hour · practice · cold",
  );
  await expect(page.getByTestId("mnemos-hours-row-kes-h1")).toContainText(
    "It woke with one memory in hand, found one question waiting, and reached for two.",
  );
  await shot(page, "04-hours-dark");

  // The newest opened (wide, by itself).
  const opened = page.getByTestId("mnemos-hour-opened");
  await expect(opened).toBeVisible();
  await expect(page.getByTestId("mnemos-hour-head")).toHaveText(
    /^Today, \d{1,2}:\d\d [ap]m to \d{1,2}:\d\d [ap]m · Still warm · ran as Opus 5\.5 · nothing refused$/,
  );
  await expect(page.getByTestId("mnemos-hour-name")).toHaveText("Its own hour");
  await expect(opened).toContainText("What it wrote in its journal");
  await expect(opened).toContainText("The notes it left");
  await expect(opened).toContainText("What it made");
  await expect(page.getByTestId("mnemos-hour-said")).toHaveText(
    "I drew this morning's tide and left Pat a question about calm days.",
  );
  await expect(page.getByTestId("mnemos-trail-woke")).toContainText(
    "Woke with, in hand1",
  );
  await expect(page.getByTestId("mnemos-trail-waiting")).toContainText(
    "Found waiting, as questions1",
  );
  await expect(page.getByTestId("mnemos-trail-reached")).toContainText(
    "Reached for2",
  );
  await expect(
    page.getByTestId("mnemos-hour-thumb").locator("img"),
  ).toHaveCount(1);
  // The opened hour read down to its trail.
  await page.getByTestId("mnemos-trail-reached").scrollIntoViewIfNeeded();
  await shot(page, "05-hour-opened-dark");

  const links: Record<string, string> = {};
  const follow = async (testId: string, expectUrl: RegExp, words: string) => {
    await page.getByTestId(testId).click();
    await expect(page).toHaveURL(expectUrl);
    await expect(card(page)).toContainText(words);
    links[testId] = page.url().split("?")[1] ?? "";
    await page.goBack();
    await expect(opened).toBeVisible();
  };
  await follow(
    "mnemos-hour-journal-kes-j1",
    /room=journal.*item=kes-j1|item=kes-j1.*room=journal/,
    "The fog lifted by nine.",
  );
  await follow(
    "mnemos-hour-note-kes-n1",
    /room=notes.*item=kes-n1|item=kes-n1.*room=notes/,
    "Should the morning note lead with the tide",
  );
  for (const [group, id, words] of [
    ["mnemos-trail-woke", "kes-m01", "Pat reads the tide chart"],
    [
      "mnemos-trail-waiting",
      "kes-m04",
      "A late ferry means the fog came in early.",
    ],
    ["mnemos-trail-reached", "kes-m05", "Lesson: write the tide first"],
  ] as const)
    await follow(
      `${group}-${id}`,
      new RegExp(`room=memories.*item=${id}|item=${id}.*room=memories`),
      words,
    );
  measure("hour-links", links);

  // A practice hour says so.
  await page.getByTestId("mnemos-hours-row-kes-h3").getByRole("button").click();
  await expect(page.getByTestId("mnemos-hour-name")).toHaveText(
    "Our hour, for the day’s work, a practice run",
  );
  await expect(page.getByTestId("mnemos-hour-head")).toContainText(
    "practice, on a copy of its memory",
  );
  expect(consoleClean(errors)).toEqual([]);
});

test("(4) Hours in the light", async ({ page }) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=hours",
    mode: "light",
  });
  await expect(page.getByTestId("mnemos-hour-opened")).toBeVisible();
  await expect(
    page.getByTestId("mnemos-hour-thumb").locator("img"),
  ).toHaveCount(1);
  await shot(page, "12-hours-light");
  expect(consoleClean(errors)).toEqual([]);
});

test("(5a) quiet hours: said back first, one request on the yes, the scheduler's words", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=settings",
  });
  await expect(page.getByTestId("mnemos-hours-switch")).toBeChecked();
  await expect(page.getByTestId("mnemos-hours-mine")).toHaveValue("08:00");
  await expect(page.getByTestId("mnemos-hours-ours")).toHaveValue("19:00");
  await expect(page.getByTestId("mnemos-hours-dream")).toHaveValue("03:30");
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveText(
    "Scheduled on this Mac.",
  );
  await shot(page, "06-settings-dark");
  // Typing sends nothing.
  await page.getByTestId("mnemos-hours-ours").fill("20:30");
  await expect(page.getByTestId("mnemos-hours-hint")).toHaveText(
    "Not saved yet.",
  );
  await page.waitForTimeout(500);
  expect(await writes(page, "hours")).toEqual([]);
  await page.getByTestId("mnemos-hours-save").click();
  await expect(page.getByTestId("mnemos-hours-ask-text")).toHaveText(
    "This changes the small job on this Mac that wakes Kestrel: at 8:00 am for its own hour, 8:30 pm for our hour and 3:30 am to dream.",
  );
  expect(await writes(page, "hours")).toEqual([]);
  await shot(page, "07-settings-confirm-dark");
  // Not now: nothing.
  await page.getByTestId("mnemos-hours-ask-no").click();
  expect(await writes(page, "hours")).toEqual([]);
  // Yes: one request, the right fields, the scheduler's words as given.
  await page.getByTestId("mnemos-hours-save").click();
  await page.getByTestId("mnemos-hours-ask-yes").dblclick();
  await expect(page.getByTestId("mnemos-hours-said")).toHaveText(
    "Installed: three quiet hours for kestrel, made-up times 08:00, 20:30, 03:30.",
  );
  expect(await writes(page, "hours")).toEqual([
    {
      command: "hours",
      on: true,
      mine: "08:00",
      ours: "20:30",
      dream: "03:30",
    },
  ]);
  // Off is asked the same way, and sends on: false.
  await page.getByTestId("mnemos-hours-switch").click();
  await expect(page.getByTestId("mnemos-hours-mine")).toBeDisabled();
  expect((await writes(page, "hours")).length).toBe(1);
  await page.getByTestId("mnemos-hours-save").click();
  await expect(page.getByTestId("mnemos-hours-ask")).toContainText(
    "Turn off its quiet hours?",
  );
  await page.getByTestId("mnemos-hours-ask-yes").click();
  await expect(page.getByTestId("mnemos-hours-said")).toHaveText(
    "Uninstalled: the quiet hours for kestrel, made up.",
  );
  const sent = await writes(page, "hours");
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual({ command: "hours", on: false });
  measure("hours-writes", sent);
  expect(consoleClean(errors)).toEqual([]);
});

test("(5a) the engine's refusal is shown in its own words", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=settings",
  });
  await page.evaluate(() => {
    (window as unknown as { boardProbe: Probe }).boardProbe.hoursMode =
      "refuse";
  });
  await page.getByTestId("mnemos-hours-dream").fill("04:00");
  await page.getByTestId("mnemos-hours-save").click();
  await page.getByTestId("mnemos-hours-ask-yes").click();
  await expect(page.getByTestId("mnemos-hours-refused")).toHaveText(HERMES);
  expect(await writes(page, "hours")).toHaveLength(1);
  // The person's change is still there, unsaved.
  await expect(page.getByTestId("mnemos-hours-dream")).toHaveValue("04:00");
  expect(consoleClean(errors)).toEqual([]);
});

test("(5b, 5c, 6) Jev is shown only, with no key field; Mnemos's own page, once a click", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=settings",
  });
  const jev = page.getByTestId("mnemos-settings-jev");
  await expect(page.getByTestId("mnemos-jev-on")).toContainText("Off");
  await expect(page.getByTestId("mnemos-jev-key")).toContainText(
    "No key is saved on this Mac.",
  );
  await expect(jev).toContainText("Jev is set on Mnemos’s own page.");
  // No key field anywhere: nothing to type in Jev, no password field.
  await expect(jev.locator("input, textarea")).toHaveCount(0);
  await expect(page.locator("input[type='password']")).toHaveCount(0);
  await expect(
    card(page).getByText(/key/i).locator("xpath=ancestor-or-self::input"),
  ).toHaveCount(0);
  // The button starts the command once per click.
  await page.getByTestId("mnemos-own-page").click();
  await expect
    .poll(async () =>
      (await probeOf(page)).calls.filter(
        (c) => c.cmd === "open_mnemos_own_page",
      ),
    )
    .toEqual([{ cmd: "open_mnemos_own_page", args: { mind: "kestrel" } }]);
  await expect(page.getByTestId("mnemos-own-page-failed")).toHaveCount(0);
  // When it can't start: one plain line.
  await page.evaluate(() => {
    (window as unknown as { boardProbe: Probe }).boardProbe.ownPage = "fail";
  });
  await page.getByTestId("mnemos-own-page").click();
  await expect(page.getByTestId("mnemos-own-page-failed")).toHaveText(
    "Mnemos’s own page couldn’t be started on this Mac.",
  );
  expect(
    (await probeOf(page)).calls.filter((c) => c.cmd === "open_mnemos_own_page"),
  ).toHaveLength(2);
  // About this memory.
  const about = page.getByTestId("mnemos-settings-about");
  for (const [row, words] of [
    ["name", "Kestrel"],
    ["model", "Opus 5.5"],
    ["whose", "Pat"],
    ["project", "lighthouse"],
    ["store", "~/.mnemos/kestrel.db"],
    ["size", "0.5 MB"],
    ["mnemos", "0.7.0"],
  ] as const)
    await expect(about.getByTestId(`mnemos-about-${row}`)).toContainText(words);
  expect(consoleClean(errors)).toEqual([]);
});

test("(8) Shared: add, correct, let go asked twice; each exactly one request", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?mind=kestrel&room=shared" });
  await expect(page.getByTestId("mnemos-shared-line")).toHaveText(
    "Every agent on this machine can read these words. They’re signed as you.",
  );
  // The add row first, then the rows newest first.
  const rows = await page
    .getByTestId("mnemos-shared-section")
    .locator("li[data-testid^='mnemos-shared-']")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  expect(rows).toEqual([
    "mnemos-shared-add-row",
    "mnemos-shared-row-kes-s2",
    "mnemos-shared-row-kes-s1",
  ]);
  // The newest opens by itself, with who wrote it; not editable, so no
  // correcting it.
  await expect(page.getByTestId("mnemos-shared-who")).toContainText(
    "agent · Opus 5.5",
  );
  await expect(page.getByTestId("mnemos-shared-correct-open")).toHaveCount(0);
  await shot(page, "08-shared-dark");

  // Add: the field on the right; the words kept while away.
  await page.getByTestId("mnemos-shared-add-row").getByRole("button").click();
  const field = page.getByTestId("mnemos-shared-add-text");
  await field.fill("The kettle in the lamp room is new.");
  await page
    .getByTestId("mnemos-shared-row-kes-s1")
    .getByRole("button")
    .click();
  await page.getByTestId("mnemos-shared-add-row").getByRole("button").click();
  await expect(field).toHaveValue("The kettle in the lamp room is new.");
  expect(await writes(page, "shared")).toEqual([]);
  await page.getByTestId("mnemos-shared-add-send").click();
  await expect(page.getByTestId("mnemos-shared-said")).toHaveText(
    "Saved to shared memory. Every agent on this machine can read it.",
  );
  expect(await writes(page, "shared")).toEqual([
    {
      command: "shared",
      action: "add",
      text: "The kettle in the lamp room is new.",
    },
  ]);
  // It arrives in the list on the notebook's next reading.
  await expect(page.getByTestId("mnemos-shared-row-kes-s12")).toBeVisible({
    timeout: 12_000,
  });

  // Correct it: prefilled, sent once.
  await page
    .getByTestId("mnemos-shared-row-kes-s1")
    .getByRole("button")
    .click();
  await expect(page.getByTestId("mnemos-shared-who")).toContainText("You");
  await page.getByTestId("mnemos-shared-correct-open").click();
  const fix = page.getByTestId("mnemos-shared-correct-text");
  await expect(fix).toHaveValue("We keep the harbour log in pencil.");
  await fix.fill("We keep the harbour log in soft pencil.");
  await page.getByTestId("mnemos-shared-correct-send").click();
  await expect(page.getByTestId("mnemos-shared-said")).toHaveText(
    "Corrected. Your earlier words stay in the archive.",
  );
  expect((await writes(page, "shared")).slice(1)).toEqual([
    {
      command: "shared",
      action: "correct",
      memory_id: "kes-s1",
      text: "We keep the harbour log in soft pencil.",
    },
  ]);

  // Let it go: asked first (Keep it sends nothing), then once on the yes,
  // with confirmed.
  await page.getByTestId("mnemos-shared-let-go").click();
  await expect(page.getByTestId("mnemos-shared-ask")).toContainText(
    "Let this memory go?",
  );
  await expect(page.getByTestId("mnemos-shared-keep")).toBeFocused();
  await shot(page, "09-shared-let-go-dark");
  await page.getByTestId("mnemos-shared-keep").click();
  expect((await writes(page, "shared")).length).toBe(2);
  await page.getByTestId("mnemos-shared-let-go").click();
  await page.getByTestId("mnemos-shared-let-go-yes").dblclick();
  await expect(page.getByTestId("mnemos-shared-said")).toHaveText(
    "Let go. It stays in the archive.",
  );
  const sent = await writes(page, "shared");
  expect(sent.slice(2)).toEqual([
    {
      command: "shared",
      action: "forget",
      memory_id: "kes-s1",
      confirmed: true,
    },
  ]);
  measure("shared-writes", sent);
  await expect(page.getByTestId("mnemos-shared-row-kes-s1")).toHaveCount(0, {
    timeout: 12_000,
  });
  expect(consoleClean(errors)).toEqual([]);
});

test("(8) a shared notebook that isn't ready says so in its own line", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=shared",
    sharedStatus: "off",
  });
  await expect(page.getByTestId("mnemos-shared-not-ready")).toHaveText(
    "Shared memory is off.",
  );
  expect(consoleClean(errors)).toEqual([]);
});

test("(7) a picture opened large, stepped, closed; one that can't be read", async ({
  page,
}) => {
  const errors = await boot(page);
  const thumbs = page.getByTestId("mnemos-made-thumb");
  await expect(thumbs.locator("img")).toHaveCount(3);
  const opener = page.getByTestId("mnemos-made-thumb-0");
  await opener.click();
  const view = page.getByTestId("mnemos-picture");
  await expect(view).toBeFocused();
  await expect(board(page)).toBeHidden();
  // The card and its head stay.
  await expect(page.getByTestId("place-page-head").first()).toBeVisible();
  await expect(page.getByTestId("mnemos-picture-name")).toHaveText(
    "studies / harbour-dawn",
  );
  await expect(page.getByTestId("mnemos-picture-step")).toHaveText("1 of 4");
  await expect(page.getByTestId("mnemos-picture-img")).toBeVisible();
  const large = await page
    .getByTestId("mnemos-picture-img")
    .evaluate((img) => Math.round(img.getBoundingClientRect().width));
  measure("picture-width", { large });
  expect(large).toBeGreaterThan(300);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("mnemos-picture-name")).toHaveText(
    "tide-chart",
  );
  await expect(page.getByTestId("mnemos-picture-hour")).toContainText(
    "its own hour, Today,",
  );
  await shot(page, "10-picture-open-dark");
  await page.getByTestId("mnemos-picture-next").click();
  await expect(page.getByTestId("mnemos-picture-name")).toHaveText("night-sky");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("mnemos-picture-name")).toHaveText("broken");
  await expect(page.getByTestId("mnemos-picture-unread")).toHaveText(
    "This picture couldn’t be read.",
  );
  await expect(view.locator("img")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-picture-next")).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("mnemos-picture-name")).toHaveText("night-sky");
  // Escape closes; focus is back on the thumbnail that opened it.
  await page.keyboard.press("Escape");
  await expect(view).toHaveCount(0);
  await expect(board(page)).toBeVisible();
  await expect(opener).toBeFocused();
  // The back arrow closes too, and the hour that made one opens that hour.
  await page.getByTestId("mnemos-made-thumb-1").click();
  await page.getByTestId("mnemos-picture-back").click();
  await expect(board(page)).toBeVisible();
  await page.getByTestId("mnemos-made-thumb-1").click();
  await page.getByTestId("mnemos-picture-hour").click();
  await expect(page).toHaveURL(/room=hours/);
  await expect(page.getByTestId("mnemos-hour-name")).toHaveText("Its own hour");
  // Only paths the engine listed were ever asked for.
  const probe = await probeOf(page);
  const asked = probe.calls
    .filter((c) => c.cmd === "mnemos_place_picture")
    .map((c) => String(c.args?.path));
  const listed = [
    "studies/harbour-dawn.png",
    "tide-chart.png",
    "night-sky.png",
    "broken.png",
  ];
  measure("pictures-asked", asked);
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((p) => listed.includes(p))).toBe(true);
  expect(consoleClean(errors)).toEqual([]);
});

test("(7, 9) hidden, the words and the pictures go; shown again, they're read again", async ({
  page,
}) => {
  const errors = await boot(page);
  await expect(
    page.getByTestId("mnemos-made-thumb").locator("img"),
  ).toHaveCount(3);
  const urls = await page
    .getByTestId("mnemos-made-thumb")
    .locator("img")
    .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(board(page)).toHaveCount(0);
  await expect(card(page)).not.toContainText("Ask Pat whether calm days");
  await expect(page.locator("img[src^='blob:']")).toHaveCount(0);
  // The pictures' addresses were let go.
  const readable = await page.evaluate(async (list) => {
    const out: boolean[] = [];
    for (const u of list)
      out.push(
        await fetch(u).then(
          () => true,
          () => false,
        ),
      );
    return out;
  }, urls);
  measure("hidden-pictures-readable", readable);
  expect(readable).toEqual([false, false, false]);
  await expect(page.getByTestId("mnemos-rail-state")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByTestId("mnemos-made-thumb").locator("img"),
  ).toHaveCount(3);
  await expect(page.getByTestId("mnemos-rail-state")).toBeVisible();
  // The three let-go addresses this test itself asked for fail to load, as
  // they should; nothing else is said.
  const rest = consoleClean(errors);
  expect(rest.filter((e) => !e.includes("ERR_FILE_NOT_FOUND"))).toEqual([]);
  expect(rest.length).toBe(3);
});

test("(keyboard) the board, a picture, Hours, Settings and Shared by keyboard alone", async ({
  page,
}) => {
  const errors = await boot(page);
  // The plate heads are buttons in the Tab order.
  await page.getByTestId("mnemos-plate-hours-head").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/room=hours/);
  await page.goBack();
  // A thumbnail opens by keyboard, steps, and closes.
  await page.getByTestId("mnemos-made-thumb-0").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-picture")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("mnemos-picture-step")).toHaveText("2 of 4");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mnemos-made-thumb-0")).toBeFocused();
  // Settings: the switch, a time, Save, the ask, Not now: all by keys.
  await rail(page).getByTestId("place-row-settings").click();
  await page.getByTestId("mnemos-hours-switch").focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("mnemos-hours-switch")).not.toBeChecked();
  await page.getByTestId("mnemos-hours-save").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-hours-ask-yes")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("mnemos-hours-ask-no")).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await writes(page, "hours")).toEqual([]);
  // Shared: open the add row by keyboard, type, Enter sends once.
  await rail(page).getByTestId("place-row-shared").click();
  await page.getByTestId("mnemos-shared-add-row").getByRole("button").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("mnemos-shared-add-text").focus();
  await page.keyboard.type("Typed by keyboard alone.");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-shared-said")).toBeVisible();
  expect(await writes(page, "shared")).toEqual([
    { command: "shared", action: "add", text: "Typed by keyboard alone." },
  ]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(motion) under reduced motion nothing on the board moves", async ({
  page,
}) => {
  const errors = await boot(page, { reducedMotion: true });
  await expect(page.getByTestId("mnemos-count")).toHaveText("12");
  await page.getByTestId("mnemos-made-thumb-0").click();
  await expect(page.getByTestId("mnemos-picture")).toBeVisible();
  const moving = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return (
          target instanceof Element &&
          target.closest("[data-testid='mnemos-place']") &&
          a.playState === "running"
        );
      })
      .map((a) => (a as CSSAnimation).animationName ?? "transition"),
  );
  measure("reduced-motion-running", moving);
  expect(moving).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

/** Every place on a board where something shows past its plate's edge
 *  (what an inner box clips doesn't count: that's the fade). */
async function overflowing(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const plate of document.querySelectorAll<HTMLElement>(
      "[data-testid='mnemos-place'] .luca-mnemos-plate",
    )) {
      const edge = plate.getBoundingClientRect();
      if (plate.scrollWidth > plate.clientWidth + 1)
        out.push(`${plate.dataset.testid ?? "plate"} scrolls`);
      for (const el of plate.querySelectorAll<HTMLElement>("*")) {
        const box = el.getBoundingClientRect();
        if (!box.width) continue;
        let right = box.right;
        for (
          let up = el.parentElement;
          up && up !== plate;
          up = up.parentElement
        )
          if (getComputedStyle(up).overflowX !== "visible")
            right = Math.min(right, up.getBoundingClientRect().right);
        if (right > edge.right + 0.5)
          out.push(
            `${plate.dataset.testid ?? plate.className}: ${el.tagName.toLowerCase()}.${el.className} ${Math.round(right - edge.right)} px over`,
          );
      }
    }
    return out;
  });
}

test("(1) one 300-letter word everywhere: nothing goes past its plate, no word is cut", async ({
  page,
}) => {
  const errors = await boot(page, { longWords: true });
  await expect(page.getByTestId("mnemos-count")).toHaveText("12");
  await expect(
    page.getByTestId("mnemos-made-thumb").locator("img"),
  ).toHaveCount(3);
  const wide = await overflowing(page);
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForTimeout(300);
  const narrow = await overflowing(page);
  // No ellipsis anywhere on the board: words end whole, or fade.
  const ellipses = await board(page).evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("*")]
      .filter((n) => getComputedStyle(n).textOverflow === "ellipsis")
      .map((n) => n.className),
  );
  // Today's board on 0.6.7, too.
  await page.goto("/#/mnemos?mind=wren&room=glance");
  await expect(page.getByTestId("mnemos-board-newer")).toBeVisible();
  await expect(page.getByTestId("mnemos-count")).toHaveText("24");
  const old = await overflowing(page);
  measure("long-words", { wide, narrow, ellipses, old });
  expect(wide).toEqual([]);
  expect(narrow).toEqual([]);
  expect(ellipses).toEqual([]);
  expect(old).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(1) the strip of days spans six months in thin ticks, months named under it", async ({
  page,
}) => {
  const errors = await boot(page);
  const strip = page.getByTestId("mnemos-day-strip");
  const facts = await strip.evaluate((el) => {
    const ticks = [
      ...el.querySelectorAll<HTMLElement>(".luca-mnemos-ticks > span"),
    ];
    const kept = ticks.filter((t) => t.dataset.count !== "0");
    return {
      days: ticks.length,
      kept: kept.length,
      widest: Math.max(...ticks.map((t) => t.getBoundingClientRect().width)),
      firstKept: ticks.findIndex((t) => t.dataset.count !== "0"),
      months: [...el.querySelectorAll(".luca-mnemos-months > span")].map(
        (m) => m.textContent,
      ),
      label: el.querySelector("[role='img']")?.getAttribute("aria-label"),
    };
  });
  measure("strip", facts);
  expect(facts.days).toBe(182);
  expect(facts.kept).toBe(12);
  expect(facts.widest).toBeLessThanOrEqual(2.5);
  // A young mind: its ticks at the right end.
  expect(facts.firstKept).toBeGreaterThan(150);
  expect(facts.months.length).toBeGreaterThanOrEqual(5);
  expect(facts.label).toMatch(/^Memories kept each day, the last six months/);
  expect(consoleClean(errors)).toEqual([]);
});

test("(2) the rail's state line is never cut: it wraps", async ({ page }) => {
  const errors = await boot(page);
  const line = page.getByTestId("mnemos-rail-state");
  await expect(line).toHaveText("Still warm · its own hour ended 4.3 h ago");
  const fit = await line.evaluate((el) => ({
    overflow: getComputedStyle(el).textOverflow,
    wraps: getComputedStyle(el).whiteSpace,
    cut: el.scrollWidth > el.clientWidth + 1,
    lines: Math.round(
      el.getBoundingClientRect().height /
        Number.parseFloat(getComputedStyle(el).lineHeight),
    ),
  }));
  measure("rail-line", fit);
  expect(fit.cut).toBe(false);
  expect(fit.overflow).not.toBe("ellipsis");
  expect(fit.wraps).toBe("normal");
  expect(consoleClean(errors)).toEqual([]);
});

test("(5a) the confirm sits directly under the group it speaks for", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=settings",
  });
  const gaps = async () =>
    page.getByTestId("mnemos-settings-hours").evaluate((el) => {
      const group = el.querySelector(".luca-place-group") as HTMLElement;
      const next = group.nextElementSibling as HTMLElement;
      const rows = group.querySelectorAll("li");
      return {
        under: Math.round(
          next.getBoundingClientRect().top -
            group.getBoundingClientRect().bottom,
        ),
        rows:
          rows.length > 1
            ? Math.round(
                (rows[1] as HTMLElement).getBoundingClientRect().top -
                  (rows[0] as HTMLElement).getBoundingClientRect().bottom,
              )
            : 0,
        what: next.dataset.testid ?? next.className,
      };
    });
  await page.getByTestId("mnemos-hours-ours").fill("20:30");
  await page.getByTestId("mnemos-hours-save").click();
  await expect(page.getByTestId("mnemos-hours-ask")).toBeVisible();
  const asked = await gaps();
  measure("confirm-gap", asked);
  expect(asked.what).toBe("mnemos-hours-ask");
  expect(asked.under).toBeLessThanOrEqual(8);
  expect(asked.under).toBeGreaterThanOrEqual(0);
  expect(consoleClean(errors)).toEqual([]);
});

test("(8) an unsent correction of a shared row goes with the place; an unsent addition stays", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?mind=kestrel&room=shared" });
  const original = "We keep the harbour log in pencil.";
  const correct = async () => {
    await page
      .getByTestId("mnemos-shared-row-kes-s1")
      .getByRole("button")
      .click();
    await page.getByTestId("mnemos-shared-correct-open").click();
    return page.getByTestId("mnemos-shared-correct-text");
  };
  const add = async () => {
    await page.getByTestId("mnemos-shared-add-row").getByRole("button").click();
    return page.getByTestId("mnemos-shared-add-text");
  };
  const hide = (state: "hidden" | "visible") =>
    page.evaluate((s) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => s,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
  // Both written, neither sent.
  await (await add()).fill("My own words, not sent yet.");
  await (await correct()).fill("Someone else's words, half corrected.");
  // Another room and back: both are still there.
  await rail(page).getByTestId("place-row-journal").click();
  await rail(page).getByTestId("place-row-shared").click();
  await expect(await correct()).toHaveValue(
    "Someone else's words, half corrected.",
  );
  // The window hidden and shown: the correction is gone, the addition stays.
  await hide("hidden");
  await expect(page.getByTestId("mnemos-shared-section")).toHaveCount(0);
  await hide("visible");
  await expect(await correct()).toHaveValue(original);
  await expect(await add()).toHaveValue("My own words, not sent yet.");
  // The place left and come back to: the same.
  await (await correct()).fill("Corrected again, not sent.");
  await page.evaluate(() => {
    location.hash = "/";
  });
  await expect(page.getByTestId("mnemos-place")).toHaveCount(0);
  await page.evaluate(() => {
    location.hash = "/mnemos?mind=kestrel&room=shared";
  });
  await expect(await correct()).toHaveValue(original);
  await expect(await add()).toHaveValue("My own words, not sent yet.");
  expect(await writes(page, "shared")).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});
