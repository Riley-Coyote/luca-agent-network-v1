import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";

/**
 * WP-45, the Mnemos place, reading (polyphonic-beta14-finish.md): a place
 * after Brain whose rail is the mind in view and its rooms, read through
 * the person's own `mnemos interface`. Every mind here is made up: Wren, a
 * mind Luca remembers with, and Field Notes, which no one does. The
 * interface and the old reader are played by this spec, in the page.
 */

const SHOTS = process.env.WP45_SHOTS ?? "test-results/wp45";
const LUCA = "a".repeat(64);
type Mode = "dark" | "light";
type Fault =
  | "missing"
  | "none"
  | "too-old"
  | "timeout"
  | "changed"
  | "no-python";

type Probe = {
  calls: { cmd: string; args?: Record<string, unknown> }[];
  asked: string[];
  decline: boolean;
  fault: Fault | null;
  open: string | null;
};

test.use({
  deviceScaleFactor: 2,
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 900 },
});
test.describe.configure({ timeout: 120_000 });

function measure(key: string, value: unknown) {
  mkdirSync(`${SHOTS}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

async function boot(
  page: Page,
  {
    hash = "/mnemos",
    mode = "dark",
    fault = null,
    decline = false,
  }: {
    hash?: string;
    mode?: Mode;
    fault?: Fault | null;
    decline?: boolean;
  } = {},
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Before the test bridge, so every Mnemos command is this spec's.
  await page.addInitScript(
    ({ luca, fault, decline }) => {
      type Call = (
        cmd: string,
        args?: Record<string, unknown>,
        opts?: unknown,
      ) => Promise<unknown>;
      const win = window as unknown as {
        __TAURI_INTERNALS__?: { invoke?: Call };
        mnemosProbe: Probe;
      };
      const bridge = win.__TAURI_INTERNALS__ ?? {};
      win.__TAURI_INTERNALS__ = bridge;
      const probe: Probe = { calls: [], asked: [], decline, fault, open: null };
      win.mnemosProbe = probe;
      const now = Date.now();
      const day = 86_400_000;
      const iso = (ms: number) => new Date(ms).toISOString();
      const lines = [
        "The lighthouse keeper logs the weather at six, before the gulls.",
        "Pat likes the morning notes short: one line, then the day.",
        "The north stair is the quiet way down to the harbour.",
        "When the fog horn sounds twice, the ferry is running late.",
        "Pat keeps the tide tables in the blue folder by the door.",
        "The new lamp burns cleaner than the old one, and dimmer at dawn.",
        "Saturday is for the long walk out to the point.",
        "Pat would rather hear the bad news first.",
      ];
      // Wren: 124 it can reach (6 of them gone quiet), oldest first,
      // spread over five months, the newest today.
      const wren = Array.from({ length: 124 }, (_, i) => ({
        id: `wren-m${String(i).padStart(3, "0")}`,
        words: `${lines[i % lines.length]}${i % 3 === 0 ? `\n\nNoted on visit ${i + 1}.` : ""}`,
        kept: iso(now - (123 - i) * 1.2 * day - 3_600_000),
        state: i % 20 === 7 ? "dormant" : "active",
        alive: i % 20 === 7 ? 0.03 : 0.6,
        corrected: i === 122 ? iso(now - day) : null,
        impact:
          i === 123 ? "Now I write the weather before anything else." : "",
        author: i % 9 === 4 ? "person" : "agent",
      }));
      const fieldNotes = Array.from({ length: 9 }, (_, i) => ({
        id: `fn-m${i}`,
        words: `Field note ${i + 1}: the heron came back to the reeds.`,
        kept: iso(now - (8 - i) * 9 * day),
        state: "active",
        alive: 0.5,
        corrected: null,
        impact: "",
        author: "agent",
      }));
      const memories: Record<string, typeof wren> = {
        wren,
        "field-notes": fieldNotes,
      };
      const journal = [
        {
          id: "wren-j1",
          text: "A quiet day at the light. The keeper and I counted the boats in, and all of them came home.\n\nI wrote the weather first, as I said I would.",
          mood: "steady, a little proud",
          written: "between_sessions",
          model: "claude-opus-5-5",
          created_at: iso(now - 2 * 3_600_000),
        },
        {
          id: "wren-j2",
          text: "Fog all morning. I kept thinking about the ferry timetable.",
          mood: "restless",
          written: "in_session",
          model: "claude-opus-5-5",
          created_at: iso(now - 3 * day),
        },
        {
          id: "wren-j3",
          text: "First entry. I don't know yet what this journal is for.",
          mood: null,
          written: "between_sessions",
          model: null,
          created_at: iso(now - 40 * day),
        },
      ];
      const notes = [
        {
          id: "wren-n1",
          kind: "note",
          text: "Should I keep the old tide tables, or let them go?",
          author: "agent",
          model: "claude-opus-5-5",
          in_reply_to: null,
          created_at: iso(now - 5 * 3_600_000),
          read_at: null,
          delivered_at: iso(now - 5 * 3_600_000),
        },
        {
          id: "wren-n2",
          kind: "note",
          text: "The lamp is fixed. Thank you for staying late.",
          author: "person",
          model: null,
          in_reply_to: null,
          created_at: iso(now - 2 * day),
          read_at: iso(now - 2 * day),
          delivered_at: iso(now - 2 * day),
        },
        {
          id: "wren-n3",
          kind: "reply",
          text: "It was good to see it lit again.",
          author: "agent",
          model: "claude-opus-5-5",
          in_reply_to: "wren-n2",
          created_at: iso(now - 2 * day + 3_600_000),
          read_at: iso(now - day),
          delivered_at: iso(now - day),
        },
        {
          id: "wren-n4",
          kind: "note",
          text: "Do you want the weather in the morning note, or after it?",
          author: "agent",
          model: "claude-opus-5-5",
          in_reply_to: null,
          created_at: iso(now - 4 * day),
          read_at: iso(now - 3 * day),
          delivered_at: iso(now - 4 * day),
        },
      ];
      const reader = {
        standing: [
          {
            text: "Pat would rather hear the bad news first.",
            clipped: false,
            at: iso(now - 60 * day),
          },
          {
            text: "The weather goes first in every morning note.",
            clipped: false,
            at: iso(now - 10 * day),
          },
        ],
        beliefs: [
          {
            text: "Short notes get read; long ones get saved for later.",
            clipped: false,
            at: iso(now - 30 * day),
            confidence: 0.72,
          },
          {
            text: "The ferry is late more often in fog than in wind.",
            clipped: false,
            at: iso(now - 20 * day),
            confidence: 0.55,
          },
          {
            text: "Pat trusts the tide tables more than the forecast.",
            clipped: false,
            at: iso(now - 8 * day),
            confidence: 0.81,
          },
        ],
        handoffs: [
          {
            text: "Carry forward: ask about the old tide tables, and write the weather first.",
            clipped: false,
            at: iso(now - 6 * 3_600_000),
          },
          {
            text: "Carry forward: the lamp is fixed; check it burns clean.",
            clipped: false,
            at: iso(now - 3 * day),
          },
        ],
      };
      const seen = new Set<string>();
      const minds = [
        {
          id: "wren",
          name: "Wren",
          memories: 124,
          newest: iso(now).slice(0, 10),
          linked: [{ pubkey: luca, name: "Luca" }],
        },
        {
          id: "field-notes",
          name: "Field Notes",
          memories: 9,
          newest: iso(now).slice(0, 10),
          linked: [],
        },
      ];
      const granted = new Set<string>();
      let delegate: Call | undefined;
      const fail = (code: string) => Promise.reject(code);
      const place = async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "mnemos_place_minds") {
          if (probe.fault === "missing")
            return { mnemosReady: false, minds: [] };
          if (probe.fault === "none") return { mnemosReady: true, minds: [] };
          return { mnemosReady: true, minds };
        }
        if (cmd === "open_mnemos_mind") {
          const mind = String(args.mind);
          if (probe.fault === "too-old") return fail("mnemos_too_old");
          if (probe.fault === "changed" && !args.askAgain)
            return fail("mind_changed");
          const linked = minds.find((m) => m.id === mind)?.linked.length;
          if (!linked && !granted.has(mind)) {
            probe.asked.push(mind);
            if (probe.decline) {
              probe.open = null;
              return false;
            }
            granted.add(mind);
          }
          if (probe.fault === "changed") probe.fault = null;
          if (probe.open !== mind) seen.clear();
          probe.open = mind;
          return true;
        }
        if (cmd === "read_mnemos_place") {
          const mind = String(args.mind);
          if (probe.open !== mind) return fail("not_open");
          if (probe.fault === "timeout") {
            probe.open = null;
            return fail("mnemos_timeout");
          }
          const request = args.request as Record<string, unknown>;
          const list = memories[mind] ?? [];
          if (request.command === "memories") {
            const held = list.filter((m) =>
              request.state
                ? m.state === request.state
                : m.state !== "archived",
            );
            const offset = Number(request.offset ?? 0);
            const page = held.slice(offset, offset + Number(request.limit));
            for (const m of page) seen.add(m.id);
            const counts = {
              active: list.filter((m) => m.state === "active").length,
              dormant: list.filter((m) => m.state === "dormant").length,
              archived: mind === "wren" ? 3 : 0,
            };
            return { kind: "memories", memories: page, counts };
          }
          if (request.command === "search") {
            const words = String(request.query).toLowerCase();
            const results = list
              .filter((m) =>
                words
                  .split(/\s+/)
                  .some((w) => m.words.toLowerCase().includes(w)),
              )
              .slice(-6)
              .reverse()
              .map((m, i) => ({
                id: m.id,
                words: m.words,
                kept: m.kept,
                closeness: 1 - i * 0.1,
                found: i === 0 ? "meaning" : i === 1 ? "link" : "words",
              }));
            for (const r of results) seen.add(r.id);
            return { kind: "search", results };
          }
          if (request.command === "journal") {
            const entries =
              mind === "wren" ? journal.slice(0, Number(request.last)) : [];
            for (const e of entries) seen.add(e.id);
            return { kind: "journal", entries };
          }
          if (request.command === "notes") {
            const list = mind === "wren" ? notes : [];
            for (const n of list) seen.add(n.id);
            return { kind: "notes", notes: list };
          }
          return fail("invalid_request");
        }
        if (cmd === "mnemos_place_item") return seen.has(String(args.id));
        if (cmd === "close_mnemos_place") {
          probe.open = null;
          return null;
        }
        if (cmd === "mnemos_place_shown") return null;
        if (cmd === "mnemos_view_status") {
          if (args.residentPubkey !== luca) return fail("unknown resident");
          return {
            grant: "wren-grant",
            scope: {
              agent_id: "wren",
              person_id: "pat-example",
              project_scope: "lighthouse",
            },
            readerReady: probe.fault !== "no-python",
            linked: true,
            mnemosReady: true,
          };
        }
        if (cmd === "read_mnemos_view") {
          const section = String(args.section);
          if (section === "summary")
            return {
              kind: "summary",
              counts: {
                memories: { active: 118, dormant: 6, archived: 3 },
                notes: { all: 4, unread: 1 },
                standing: 2,
                journal: 3,
                handoffs: 2,
                beliefs: 3,
              },
            };
          return {
            kind: "items",
            items: (reader as Record<string, unknown[]>)[section] ?? [],
            nextCursor: null,
          };
        }
        return fail(`unexpected ${cmd}`);
      };
      Object.defineProperty(bridge, "invoke", {
        configurable: true,
        set(next: Call) {
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
    { luca: LUCA, fault, decline },
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Luca",
        pubkey: LUCA,
        personaId: "builtin:fizz",
        status: "running",
      },
    ],
  });
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
  page.evaluate(
    () => (window as unknown as { mnemosProbe: Probe }).mnemosProbe,
  );

async function shot(page: Page, name: string) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  const all = (() => {
    try {
      return JSON.parse(readFileSync(`${SHOTS}/hashes.json`, "utf8"));
    } catch {
      return {};
    }
  })();
  all[name] = hash;
  writeFileSync(`${SHOTS}/hashes.json`, JSON.stringify(all, null, 2));
  return hash;
}

const card = (page: Page) => page.getByTestId("mnemos-place");
const rail = (page: Page) => page.getByTestId("place-rail-mnemos");

/** Lets the window go and come back: `visibilityState`, as macOS reports a
 *  hidden window to the webview. */
async function setVisible(page: Page, visible: boolean) {
  await page.evaluate((visible) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (visible ? "visible" : "hidden"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visible);
}

/** Every request the place sent the interface, by command. */
async function readCommands(page: Page) {
  const probe = await probeOf(page);
  return probe.calls
    .filter((c) => c.cmd === "read_mnemos_place")
    .map((c) => (c.args?.request as { command: string }).command);
}

function consoleClean(errors: string[]) {
  return errors.filter((e) => !/ResizeObserver loop/.test(e));
}

test("(a, b, g) the tile after Brain; the rail; At a glance with real numbers", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/" });
  // (a) The tile sits directly after Brain, and wears NotebookText.
  const order = await page
    .locator("[data-testid^='open-']")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  const brain = order.indexOf("open-brain-setup");
  expect(brain).toBeGreaterThan(-1);
  expect(order[brain + 1]).toBe("open-mnemos-place");
  const icon = await page
    .getByTestId("open-mnemos-place")
    .locator("svg")
    .first()
    .getAttribute("class");
  expect(icon).toContain("lucide-notebook-text");
  await page.getByTestId("open-mnemos-place").click();
  await expect(page).toHaveURL(/#\/mnemos\?.*room=glance/);
  await expect(card(page)).toBeVisible();

  // (b) The rail: the mind in view, its numbers, the rooms with counts.
  // The rail's head: the name, and who remembers with it; the numbers are
  // the card head's alone.
  await expect(page.getByTestId("mnemos-rail-mind-button")).toHaveText(
    "WrenLuca remembers with this",
  );
  const rooms = await rail(page)
    .locator("[data-testid^='place-row-']")
    .evaluateAll((els) => els.map((el) => el.textContent?.trim()));
  expect(rooms).toEqual([
    "At a glance",
    "Memories124",
    "Journal3",
    "Notes4",
    "Beliefs3",
    "Carrying forward2",
  ]);

  // (g) At a glance: the fixture's own numbers.
  await expect(page.getByTestId("place-page-state")).toHaveText(
    "124 memories it can reach · newest today · Luca remembers with this",
  );
  await expect(page.getByTestId("mnemos-count")).toHaveText("124");
  await expect(page.getByTestId("mnemos-plate-memory")).toContainText(
    "6 of them gone quiet · 3 let go",
  );
  await expect(page.getByTestId("mnemos-plate-waiting")).toContainText(
    "Should I keep the old tide tables, or let them go?",
  );
  await expect(page.getByTestId("mnemos-plate-waiting")).toContainText(
    "1 of 2",
  );
  await expect(page.getByTestId("mnemos-plate-journal")).toContainText(
    "A quiet day at the light.",
  );
  await expect(page.getByTestId("mnemos-plate-journal")).toContainText(
    "mood, in its words: steady, a little proud",
  );
  await expect(page.getByTestId("mnemos-plate-beliefs")).toContainText(
    "3 beliefs",
  );
  await expect(page.getByTestId("mnemos-plate-beliefs")).toContainText(
    "held at 72%",
  );
  await expect(page.getByTestId("mnemos-plate-carrying")).toContainText(
    "ask about the old tide tables",
  );
  await expect(
    page.getByTestId("mnemos-plate-lately").locator("li"),
  ).toHaveCount(5);
  await expect(page.getByTestId("mnemos-day-strip")).toBeVisible();
  const strip = await page
    .getByTestId("mnemos-day-strip")
    .locator("[data-count]")
    .evaluateAll((els) =>
      els.reduce((sum, el) => sum + Number(el.getAttribute("data-count")), 0),
    );
  // The strip's last six months hold every memory it holds but the oldest.
  expect(strip).toBeGreaterThan(100);
  expect(strip).toBeLessThanOrEqual(124);
  measure("glance", { strip_counted: strip, rooms });

  const h1 = await shot(page, "01-glance-dark");
  expect(consoleClean(errors)).toEqual([]);

  // (b) The minds list: names and numbers, never a word.
  await page.getByTestId("mnemos-rail-mind-button").click();
  const list = page.getByTestId("mnemos-minds-list");
  await expect(list).toContainText("Field Notes");
  await expect(list).toContainText("9 memories · newest today");
  await expect(list).toContainText("Luca remembers with this");
  const listText = (await list.textContent()) ?? "";
  for (const word of ["lighthouse", "heron", "tide", "gulls"])
    expect(listText.toLowerCase()).not.toContain(word);
  const h7 = await shot(page, "07-minds-list-dark");
  expect(h7).not.toBe(h1);
  measure("minds_list", { text: listText });
});

test("(g) light, and a plate whose source isn't here says so", async ({
  page,
}) => {
  const errors = await boot(page, { mode: "light", fault: "no-python" });
  await expect(page.getByTestId("mnemos-count")).toHaveText("124");
  await expect(
    page.getByTestId("mnemos-plate-beliefs").getByTestId("mnemos-plate-line"),
  ).toHaveText("Reading it here needs Python 3.12 or 3.13 on this Mac.");
  await expect(
    page.getByTestId("mnemos-plate-carrying").getByTestId("mnemos-plate-line"),
  ).toHaveText("Reading it here needs Python 3.12 or 3.13 on this Mac.");
  await expect(page.getByTestId("mnemos-day-strip")).toBeVisible();
  await shot(page, "02-glance-light");
  expect(consoleClean(errors)).toEqual([]);
});

test("(d, e) Memories: newest first, more, Gone quiet, Standing, open one, search", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=memories" });
  const rows = page.getByTestId("mnemos-memories-list").locator("li");
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toHaveAttribute("data-memory", "wren-m123");
  await expect(rows.nth(49)).toHaveAttribute("data-memory", "wren-m074");
  await page.getByTestId("mnemos-more").click();
  await expect(rows).toHaveCount(100);
  await expect(rows.nth(99)).toHaveAttribute("data-memory", "wren-m024");

  // Open the newest: its words, what it changed, when, state, who.
  await page.getByTestId("mnemos-memory-wren-m123").locator("button").click();
  await expect(page).toHaveURL(/item=wren-m123/);
  const opened = page.getByTestId("mnemos-memory-opened");
  await expect(opened).toContainText(
    "When the fog horn sounds twice, the ferry is running late.",
  );
  await expect(opened).toContainText("What it changed, in its words");
  await expect(opened).toContainText(
    "Now I write the weather before anything else.",
  );
  await expect(opened).toContainText("it can reach");
  await expect(opened).toContainText("never corrected");
  await expect(opened).toContainText("written by Wren");
  await shot(page, "03-memories-open-dark");

  // The corrected one says so.
  await page.getByTestId("mnemos-memory-wren-m122").locator("button").click();
  await expect(opened).toContainText(/corrected \w+day/);

  // Gone quiet: the dormant ones only.
  await page.getByTestId("mnemos-chip-dormant").click();
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toHaveAttribute("data-memory", "wren-m107");
  await expect(rows.first()).toContainText("gone quiet");

  // Standing: the old reader's, words only.
  await page.getByTestId("mnemos-chip-standing").click();
  const standing = page.getByTestId("mnemos-standing-list").locator("li");
  await expect(standing).toHaveCount(2);
  await standing.first().locator("button").click();
  await expect(page.getByTestId("mnemos-memories-opened")).toContainText(
    "Pat would rather hear the bad news first.",
  );

  // (e) Search: each result says how it was found; nothing found says so.
  await page.getByTestId("mnemos-search").fill("ferry fog");
  await page.getByTestId("mnemos-search").press("Enter");
  const found = page.getByTestId("mnemos-search-results").locator("li");
  await expect(found).toHaveCount(6);
  await expect(found.nth(0)).toContainText("found by meaning");
  await expect(found.nth(1)).toContainText("found through a link");
  await expect(found.nth(2)).toContainText("found by its words");
  await found.nth(0).locator("button").click();
  await expect(page.getByTestId("mnemos-memory-opened")).toContainText("ferry");
  await shot(page, "04-search-dark");
  await page.getByTestId("mnemos-search").fill("zeppelin");
  await page.getByTestId("mnemos-search").press("Enter");
  await expect(page.getByTestId("mnemos-search-empty")).toHaveText(
    "Nothing close. Try other words, or fewer.",
  );
  const requests = await readCommands(page);
  // The four reading requests, and nothing else (the rail's counts read
  // the journal and notes too).
  expect(
    requests.every((r) =>
      ["memories", "search", "journal", "notes"].includes(r),
    ),
  ).toBe(true);
  expect(requests).toContain("search");
  expect(consoleClean(errors)).toEqual([]);
});

test("(f) Journal and Notes; Waiting first; nothing is written or marked read", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes", mode: "dark" });
  const waiting = page.getByTestId("mnemos-notes-waiting");
  await expect(waiting).toContainText("Waiting on you");
  await expect(waiting.locator("li")).toHaveCount(2);
  await expect(waiting.locator("li").first()).toContainText(
    "Should I keep the old tide tables",
  );
  await expect(page.getByTestId("mnemos-unread-wren-n1")).toBeVisible();
  await expect(
    page.getByTestId("mnemos-notes-earlier").locator("li"),
  ).toHaveCount(1);
  await page.getByTestId("mnemos-thread-wren-n2").locator("button").click();
  const thread = page.getByTestId("mnemos-thread-opened").locator("li");
  await expect(thread).toHaveCount(2);
  await expect(thread.first()).toContainText("You");
  await expect(thread.nth(1)).toContainText("Wren");
  await expect(thread.nth(1)).toContainText("signed Opus 5.5");
  await page.getByTestId("mnemos-thread-wren-n1").locator("button").click();
  await expect(page.getByTestId("mnemos-thread-opened")).toContainText(
    "old tide tables",
  );
  // Reading only: no answer box here.
  await expect(card(page).locator("textarea")).toHaveCount(0);
  await shot(page, "05-notes-dark");
  // Opening notes marked nothing read: the dot is still there.
  await expect(page.getByTestId("mnemos-unread-wren-n1")).toBeVisible();

  // Journal: entries by date, mood in the list; the whole entry opened.
  await rail(page).getByTestId("place-row-journal").locator("button").click();
  const entries = page.getByTestId("mnemos-journal-list").locator("li");
  await expect(entries).toHaveCount(3);
  await expect(entries.first()).toContainText("A quiet day at the light.");
  await expect(entries.first()).toContainText(
    "mood, in its words: steady, a little proud",
  );
  await entries.first().locator("button").click();
  const entry = page.getByTestId("mnemos-entry-opened");
  await expect(entry).toContainText(
    "I wrote the weather first, as I said I would.",
  );
  await expect(entry).toContainText("written between conversations");
  await expect(entry).toContainText("signed Opus 5.5");

  const probe = await probeOf(page);
  const commands = probe.calls.map((c) => c.cmd);
  const allowed = new Set([
    "mnemos_place_minds",
    "open_mnemos_mind",
    "read_mnemos_place",
    "mnemos_place_item",
    "close_mnemos_place",
    "mnemos_place_shown",
    "mnemos_view_status",
    "read_mnemos_view",
  ]);
  expect(commands.filter((c) => !allowed.has(c))).toEqual([]);
  const requests = await readCommands(page);
  expect(
    requests.every((r) =>
      ["memories", "search", "journal", "notes"].includes(r),
    ),
  ).toBe(true);
  measure("invoke_spy", {
    commands: [...new Set(commands)],
    requests: [...new Set(requests)],
  });
  expect(consoleClean(errors)).toEqual([]);
});

test("(f) Journal in the light", async ({ page }) => {
  const errors = await boot(page, {
    hash: "/mnemos?room=journal",
    mode: "light",
  });
  const entries = page.getByTestId("mnemos-journal-list").locator("li");
  await expect(entries).toHaveCount(3);
  await entries.first().locator("button").click();
  await expect(page.getByTestId("mnemos-entry-opened")).toBeVisible();
  await shot(page, "06-journal-light");
  expect(consoleClean(errors)).toEqual([]);
});

test("(c) a linked mind opens unasked; another asks once; declining reads nothing", async ({
  page,
}) => {
  const errors = await boot(page, { decline: true });
  await expect(page.getByTestId("mnemos-count")).toHaveText("124");
  expect((await probeOf(page)).asked).toEqual([]);

  await page.getByTestId("mnemos-rail-mind-button").click();
  await page.getByTestId("mnemos-mind-field-notes").click();
  await expect(page.getByTestId("mnemos-state-declined")).toHaveText(
    /Field Notes’s memory isn’t shown here\. Nothing was read\./,
  );
  let probe = await probeOf(page);
  expect(probe.asked).toEqual(["field-notes"]);
  const readsOfField = probe.calls.filter(
    (c) => c.cmd === "read_mnemos_place" && c.args?.mind === "field-notes",
  );
  expect(readsOfField).toEqual([]);
  await shot(page, "08-asks-once");

  // Yes this time: it opens, and is remembered: never asked again.
  await page.evaluate(() => {
    (window as unknown as { mnemosProbe: Probe }).mnemosProbe.decline = false;
  });
  await page.getByTestId("mnemos-state-declined").getByRole("button").click();
  await expect(page.getByTestId("mnemos-count")).toHaveText("9");
  await page.getByTestId("mnemos-rail-mind-button").click();
  await page.getByTestId("mnemos-mind-wren").click();
  await expect(page.getByTestId("mnemos-count")).toHaveText("124");
  await page.getByTestId("mnemos-rail-mind-button").click();
  await page.getByTestId("mnemos-mind-field-notes").click();
  await expect(page.getByTestId("mnemos-count")).toHaveText("9");
  probe = await probeOf(page);
  expect(probe.asked).toEqual(["field-notes", "field-notes"]);
  // Field Notes has no resident: the old reader's plates say so.
  await expect(
    page.getByTestId("mnemos-plate-beliefs").getByTestId("mnemos-plate-line"),
  ).toHaveText(
    "Polyphonic can show this for a memory one of your agents remembers with.",
  );
  expect(consoleClean(errors)).toEqual([]);
});

test("(h) hidden drops the words, visible brings them back, blur keeps them", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?room=memories&item=wren-m123",
  });
  const opened = page.getByTestId("mnemos-memory-opened");
  await expect(opened).toContainText(
    "When the fog horn sounds twice, the ferry is running late.",
  );

  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(300);
  await expect(opened).toBeVisible();

  await setVisible(page, false);
  await expect(page.getByTestId("mnemos-memories")).toHaveCount(0);
  const text = (await card(page).textContent()) ?? "";
  expect(text).not.toContain("fog horn");
  expect(text).not.toContain("lighthouse keeper");
  const shown = (await probeOf(page)).calls
    .filter((c) => c.cmd === "mnemos_place_shown")
    .map((c) => c.args?.visible);
  expect(shown.at(-1)).toBe(false);

  await setVisible(page, true);
  await expect(opened).toContainText(
    "When the fog horn sounds twice, the ferry is running late.",
  );

  // Leaving the place ends its process.
  await page.getByTestId("open-brain-setup").click();
  await expect(card(page)).toHaveCount(0);
  await expect.poll(async () => (await probeOf(page)).open).toBeNull();
  expect(consoleClean(errors)).toEqual([]);
});

test("(i) each state is one plain line", async ({ page }) => {
  test.setTimeout(150_000);
  const cases: [Fault, string, RegExp][] = [
    ["missing", "mnemos-state-missing", /^Mnemos isn’t on this Mac\.$/],
    [
      "none",
      "mnemos-state-no-minds",
      /^Mnemos is installed, but it doesn’t keep a memory on this Mac yet\.$/,
    ],
    ["too-old", "mnemos-state-too-old", /too old to be read here/],
    ["changed", "mnemos-state-changed", /moved or replaced/],
    ["timeout", "mnemos-state-timeout", /didn’t answer in time/],
  ];
  for (const [fault, testId, words] of cases) {
    const context = await page
      .context()
      .browser()
      ?.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
        baseURL: test.info().project.use.baseURL,
      });
    if (!context) throw new Error("no browser");
    const each = await context.newPage();
    const errors = await boot(each, { fault });
    await expect(each.getByTestId(testId)).toHaveText(words);
    if (fault === "missing") await shot(each, "10-not-on-this-mac");
    if (fault === "changed") {
      // Asked again, it opens.
      await each.getByTestId(testId).getByRole("button").click();
      await expect(each.getByTestId("mnemos-count")).toHaveText("124");
    }
    if (fault === "timeout") {
      await each.evaluate(() => {
        (window as unknown as { mnemosProbe: Probe }).mnemosProbe.fault = null;
      });
      await each.getByTestId(testId).getByRole("button").click();
      await expect(each.getByTestId("mnemos-count")).toHaveText("124");
    }
    expect(consoleClean(errors)).toEqual([]);
    await context.close();
  }
});

test("(j) narrow: the opened thing slides over the list, with a back link", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=memories" });
  const wide = await page
    .getByTestId("mnemos-memories")
    .evaluate((el) => el.clientWidth);
  // Wide, the newest opened by itself.
  await expect(page).toHaveURL(/item=wren-m123/);
  await page.setViewportSize({ width: 1000, height: 800 });
  // Narrow from the start, it stays on the list.
  await page.goto("/#/mnemos?room=memories");
  await expect(page.getByTestId("mnemos-memories-list")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).not.toHaveURL(/item=/);
  const narrow = await page
    .getByTestId("mnemos-memories")
    .evaluate((el) => el.clientWidth);
  expect(narrow).toBeLessThanOrEqual(720);
  await expect(page.getByTestId("mnemos-memories-opened")).toBeHidden();
  await page.getByTestId("mnemos-memory-wren-m123").locator("button").click();
  await expect(page.getByTestId("mnemos-memory-opened")).toBeVisible();
  await expect(page.getByTestId("mnemos-memories-list")).toBeHidden();
  await expect(page.getByTestId("mnemos-back")).toBeVisible();
  await shot(page, "09-narrow-open-dark");
  await page.getByTestId("mnemos-back").click();
  await expect(page.getByTestId("mnemos-memories-list")).toBeVisible();
  await expect(page).not.toHaveURL(/item=/);
  measure("narrow", { room_wide_px: wide, room_narrow_px: narrow });
  expect(consoleClean(errors)).toEqual([]);
});

test("(k) keyboard only: rooms, a search, a memory opened", async ({
  page,
}) => {
  const errors = await boot(page);
  await expect(page.getByTestId("mnemos-count")).toHaveText("124");
  // Into the rail's head, then down its rows with the arrow keys.
  await page.getByTestId("mnemos-rail-mind-button").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/room=memories/);
  // To the search field by Tab alone.
  for (let i = 0; i < 80; i++) {
    const at = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    );
    if (at === "mnemos-search") break;
    await page.keyboard.press("Tab");
  }
  await expect(page.getByTestId("mnemos-search")).toBeFocused();
  await page.keyboard.type("tide");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-search-results")).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    const inResults = await page.evaluate(
      () =>
        !!document.activeElement?.closest(
          "[data-testid='mnemos-search-results']",
        ),
    );
    if (inResults) break;
  }
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-memory-opened")).toBeVisible();
  // The opened side takes focus, for a screen reader to start there.
  await expect(page.getByTestId("mnemos-memories-opened")).toBeFocused();
  // The minds list opens and closes from the keyboard.
  await page.getByTestId("mnemos-rail-mind-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-minds-list")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mnemos-minds-list")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-rail-mind-button")).toBeFocused();
  expect(consoleClean(errors)).toEqual([]);
});

test("measure: type sizes and contrast, both themes", async ({ page }) => {
  const out: Record<string, unknown> = {};
  for (const mode of ["dark", "light"] as const) {
    const context = await page
      .context()
      .browser()
      ?.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 900 },
        baseURL: test.info().project.use.baseURL,
      });
    if (!context) throw new Error("no browser");
    const each = await context.newPage();
    await boot(each, { hash: "/mnemos?room=memories&item=wren-m123", mode });
    await expect(each.getByTestId("mnemos-memory-opened")).toBeVisible();
    out[mode] = await each.evaluate(() => {
      const parse = (c: string) => {
        const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
        return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
      };
      const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const backOf = (el: Element) => {
        let layers: { r: number; g: number; b: number; a: number }[] = [];
        for (let x: Element | null = el; x; x = x.parentElement) {
          const bg = parse(getComputedStyle(x).backgroundColor);
          if (getComputedStyle(x).backgroundColor !== "rgba(0, 0, 0, 0)")
            layers.push(bg);
          if (bg.a >= 1) break;
        }
        layers = layers.reverse();
        let base = { r: 0, g: 0, b: 0 };
        for (const l of layers)
          base = {
            r: l.r * l.a + base.r * (1 - l.a),
            g: l.g * l.a + base.g * (1 - l.a),
            b: l.b * l.a + base.b * (1 - l.a),
          };
        return base;
      };
      const ratio = (el: Element) => {
        const fg = parse(getComputedStyle(el).color);
        const bg = backOf(el);
        const ink = {
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a),
        };
        const [hi, lo] = [lum(ink), lum(bg)].sort((a, b) => b - a);
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      };
      const pick = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        return {
          size: getComputedStyle(el).fontSize,
          contrast: ratio(el),
        };
      };
      return {
        words: pick(
          "[data-testid='mnemos-memory-opened'] .luca-mnemos-words p",
        ),
        row: pick("[data-testid='mnemos-memories-list'] .luca-place-row-title"),
        row_note: pick(
          "[data-testid='mnemos-memories-list'] .luca-place-row-note",
        ),
        impact_label: pick(
          "[data-testid='mnemos-memory-opened'] .luca-mnemos-label",
        ),
        impact: pick(
          "[data-testid='mnemos-memory-opened'] .luca-mnemos-impact p + p",
        ),
        quiet_line: pick("[data-testid='mnemos-memory-line']"),
        chip: pick("[data-testid='mnemos-chip-all']"),
        rail_line: pick(".luca-mnemos-railmind-line"),
      };
    });
    await context.close();
  }
  measure("type_and_contrast", out);
  const dark = out.dark as Record<string, { size: string; contrast: number }>;
  expect(dark.words.size).toBe("16px");
  expect(dark.row.size).toBe("14px");
  expect(dark.words.contrast).toBeGreaterThanOrEqual(7);
});
