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
const SHOTS47 = process.env.WP47_SHOTS ?? "test-results/wp47";
const SHOTS48 = process.env.WP48_SHOTS ?? "test-results/wp48";
const LUCA = "a".repeat(64);
/** A resident of the owner's that remembers with nothing yet. */
const ORI = "b".repeat(64);
/** The engine's own sentence for a reply in one of the agent's hours. */
const QUIET_REPLY =
  "Nothing saved: A reply is the person's own words, and no one is in the room during one of the agent's hours.";
/** `silent`: Mnemos doesn't answer and saves nothing; `save-silent`: it
 *  saves, then doesn't answer. Either way the process ends (a timeout). */
type WriteMode = "quiet" | "busy" | "fail" | "silent" | "save-silent" | null;
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
  /** How the next writes go: refused in a quiet hour, busy, or failed. */
  writeMode: WriteMode;
  /** How long a write is held in flight, in ms. */
  writeDelay: number;
  /** Whether Luca still remembers with Wren (the agent page's link). */
  linked: boolean;
  /** How long a search takes, in ms (the model loading). */
  searchDelay: number;
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
    classic = false,
  }: {
    hash?: string;
    mode?: Mode;
    fault?: Fault | null;
    decline?: boolean;
    /** The classic look: the new look's frame off. */
    classic?: boolean;
  } = {},
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Before the test bridge, so every Mnemos command is this spec's.
  await page.addInitScript(
    ({ luca, ori, fault, decline }) => {
      type Call = (
        cmd: string,
        args?: Record<string, unknown>,
        opts?: unknown,
      ) => Promise<unknown>;
      const win = window as unknown as {
        __TAURI_INTERNALS__?: { invoke?: Call };
        mnemosProbe: Probe;
        mnemosDeliver?: () => void;
        mnemosText?: (text: string) => void;
      };
      const bridge = win.__TAURI_INTERNALS__ ?? {};
      win.__TAURI_INTERNALS__ = bridge;
      const probe: Probe = {
        calls: [],
        asked: [],
        decline,
        fault,
        open: null,
        writeMode: null,
        writeDelay: 0,
        linked: true,
        searchDelay: 0,
      };
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
      // The mind wakes: every note of the person's reaches it.
      win.mnemosDeliver = () => {
        for (const n of notes)
          if (n.author === "person" && !n.delivered_at)
            n.delivered_at = new Date().toISOString();
      };
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
      // The same words everywhere a mind's text shows (the checker's
      // awkward strings).
      win.mnemosText = (text: string) => {
        wren[123].words = text;
        journal[0].text = text;
        notes[0].text = text;
        reader.beliefs[0].text = text;
        reader.handoffs[0].text = text;
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
          const withoutMemory = [{ pubkey: ori, name: "Ori" }];
          if (probe.fault === "missing")
            return { mnemosReady: false, minds: [], withoutMemory: [] };
          if (probe.fault === "none")
            return { mnemosReady: true, minds: [], withoutMemory };
          for (const m of minds)
            m.memories = (memories[m.id] ?? []).filter(
              (x) => x.state !== "archived",
            ).length;
          return {
            mnemosReady: true,
            minds: minds.map((m) => ({
              ...m,
              linked: m.id === "wren" && !probe.linked ? [] : m.linked,
            })),
            withoutMemory,
          };
        }
        if (cmd === "write_mnemos_place") {
          const mind = String(args.mind);
          if (probe.open !== mind) return fail("not_open");
          const write = args.write as Record<string, string>;
          if (probe.writeDelay)
            await new Promise((done) => setTimeout(done, probe.writeDelay));
          if (probe.writeMode === "silent") {
            probe.open = null;
            return fail("mnemos_timeout");
          }
          const outcome = await (async () => {
            if (probe.writeMode === "busy") return fail("mnemos_busy");
            if (probe.writeMode === "fail") return fail("mnemos_failed");
            const at = new Date().toISOString();
            const named = write.note_id ?? write.memory_id;
            if (named !== undefined && !seen.has(named))
              return fail("unknown_item");
            if (write.command === "reply" || write.command === "note") {
              if (probe.writeMode === "quiet")
                return fail(
                  `mnemos_refused:Nothing saved: A ${write.command} is the person's own words, and no one is in the room during one of the agent's hours.`,
                );
              const answered = notes.find((n) => n.id === write.note_id);
              if (write.command === "reply" && answered?.author !== "agent")
                return fail(
                  "mnemos_refused:A reply answers one of the agent's notes.",
                );
              if (answered && !answered.read_at) answered.read_at = at;
              const note = {
                id: `wren-n${notes.length + 1}`,
                kind: write.command,
                text: write.text,
                author: "person",
                model: null,
                in_reply_to: write.note_id ?? null,
                created_at: at,
                read_at: null,
                delivered_at: null,
              };
              notes.push(note);
              seen.add(note.id);
              return { kind: "note", note };
            }
            const list = memories[mind] ?? [];
            const old = list.find((m) => m.id === write.memory_id);
            if (!old || old.state === "archived") return fail("unknown_item");
            if (write.command === "correct") {
              old.state = "archived";
              const fresh = {
                ...old,
                id: `${old.id}-c`,
                words: write.text,
                kept: at,
                state: "active",
                alive: 1,
                corrected: at,
                impact: "",
                author: "person",
              };
              list.push(fresh);
              seen.add(fresh.id);
              return {
                kind: "corrected",
                id: fresh.id,
                replaces: old.id,
                corrected: at,
              };
            }
            if (write.command === "forget") {
              old.state = "archived";
              return { kind: "forgotten", id: old.id, forgotten: at };
            }
            return fail("invalid_request");
          })().then(
            (answer) => ({ answer }),
            (code: unknown) => ({ code }),
          );
          if (probe.writeMode === "save-silent") {
            probe.open = null;
            return fail("mnemos_timeout");
          }
          return "code" in outcome
            ? Promise.reject(outcome.code)
            : outcome.answer;
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
              archived:
                (mind === "wren" ? 3 : 0) +
                list.filter((m) => m.state === "archived").length,
            };
            return { kind: "memories", memories: page, counts };
          }
          if (request.command === "search") {
            if (probe.searchDelay)
              await new Promise((done) => setTimeout(done, probe.searchDelay));
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
          if (args.residentPubkey === ori || !probe.linked)
            return {
              grant: null,
              scope: null,
              readerReady: true,
              linked: false,
              mnemosReady: true,
            };
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
        if (cmd === "mnemos_minds")
          return minds.map((m) => ({
            id: m.id,
            name: m.name,
            memories: m.memories,
            newest: m.newest,
          }));
        if (cmd === "disconnect_mnemos_view") {
          if (args.residentPubkey !== luca || args.grant !== "wren-grant")
            return fail("unexpected unlink");
          probe.linked = false;
          return null;
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
            // Restarting a resident into its memory, or out of it.
            if (
              cmd === "try_stop_managed_agent_for_auto_restart" ||
              cmd === "start_managed_agent"
            ) {
              probe.calls.push({ cmd });
              const agents = (await delegate?.("list_managed_agents")) as {
                pubkey: string;
              }[];
              return agents.find((agent) => agent.pubkey === args?.pubkey);
            }
            if (!cmd.includes("mnemos")) return delegate?.(cmd, args, opts);
            probe.calls.push({
              cmd,
              args: args ? JSON.parse(JSON.stringify(args)) : undefined,
            });
            return place(cmd, args);
          },
      });
    },
    { luca: LUCA, ori: ORI, fault, decline },
  );
  await installMockBridge(page, {
    managedAgents: [
      {
        channelNames: ["agents"],
        name: "Luca",
        pubkey: LUCA,
        personaId: "builtin:fizz",
        status: "running",
        backend: { type: "local" },
      },
      {
        channelNames: ["agents"],
        name: "Ori",
        pubkey: ORI,
        personaId: "builtin:fizz",
        status: "running",
        backend: { type: "local" },
      },
    ],
  });
  await page.addInitScript(
    ({ key, light, classic }) => {
      let overrides: Record<string, boolean> = {};
      try {
        overrides = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        overrides = {};
      }
      overrides["shell-frame"] = !classic;
      localStorage.setItem(key, JSON.stringify(overrides));
      if (light) {
        localStorage.setItem("buzz-theme", "paper");
        localStorage.setItem("buzz-follow-system", "false");
      }
    },
    { key: FEATURE_OVERRIDES_STORAGE_KEY, light: mode === "light", classic },
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
  // Reading sends nothing: the fields are there, and nothing was written.
  expect(
    (await probeOf(page)).calls.filter((c) => c.cmd === "write_mnemos_place"),
  ).toEqual([]);
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

/* ── WP-47: the person's own words ─────────────────────────────────── */

async function shot47(page: Page, name: string) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS47, { recursive: true });
  const path = `${SHOTS47}/${name}.png`;
  await page.screenshot({ path });
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  const all = (() => {
    try {
      return JSON.parse(readFileSync(`${SHOTS47}/hashes.json`, "utf8"));
    } catch {
      return {};
    }
  })();
  all[name] = hash;
  writeFileSync(`${SHOTS47}/hashes.json`, JSON.stringify(all, null, 2));
  return hash;
}

function measure47(key: string, value: unknown) {
  mkdirSync(`${SHOTS47}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS47}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

/** Every write the place sent, as sent. */
async function writesSent(page: Page) {
  return (await probeOf(page)).calls
    .filter((c) => c.cmd === "write_mnemos_place")
    .map((c) => c.args as { mind: string; write: Record<string, string> });
}

async function setWrites(
  page: Page,
  next: { writeMode?: WriteMode; writeDelay?: number },
) {
  await page.evaluate((next) => {
    Object.assign(
      (window as unknown as { mnemosProbe: Probe }).mnemosProbe,
      next,
    );
  }, next);
}

/** The four writes, and only those, every one owned by the person. */
function onlyTheFour(sent: { write: Record<string, string> }[]) {
  for (const { write } of sent)
    expect(["reply", "note", "correct", "forget"]).toContain(write.command);
}

const ANSWER = "Keep them. The blue folder has room for both.";

test("(47) answer a note: one write, the right ids, the thread at once, a double click sends once", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes" });
  // Wide: the newest waiting thread opens by itself.
  const thread = page.getByTestId("mnemos-thread-opened");
  await expect(thread).toContainText("old tide tables");
  const field = page.getByTestId("mnemos-answer");
  await expect(field).toContainText("Your answer, in your own words");
  await page.getByTestId("mnemos-answer-text").fill(ANSWER);
  await shot47(page, "01-answer-dark");

  // Held in flight: the second click finds the button off.
  await setWrites(page, { writeDelay: 700 });
  await page.getByTestId("mnemos-answer-send").dblclick();
  await expect(page.getByTestId("mnemos-answer-send")).toBeDisabled();
  await expect(thread.locator("li")).toHaveCount(2);
  await expect(thread.locator("li").nth(1)).toContainText(ANSWER);
  await expect(thread.locator("li").nth(1)).toContainText("You");
  await expect(thread.getByTestId("mnemos-note-woken")).toContainText(
    "it wakes with this, once, in its next session",
  );
  // Answered, the thread waits on the mind: no field until it writes.
  await expect(page.getByTestId("mnemos-answer")).toHaveCount(0);
  await page.waitForTimeout(900);
  const sent = await writesSent(page);
  expect(sent).toEqual([
    {
      mind: "wren",
      write: { command: "reply", note_id: "wren-n1", text: ANSWER },
    },
  ]);
  // The question it answers is read now, and no longer waits.
  await expect(page.getByTestId("mnemos-unread-wren-n1")).toHaveCount(0);
  await expect(
    page.getByTestId("mnemos-notes-waiting").locator("li"),
  ).toHaveCount(1);
  await expect(rail(page).getByTestId("place-row-notes")).toHaveText("Notes5");
  await shot47(page, "02-answer-sent-dark");

  // Once it has woken with it, the line says when.
  await page.evaluate(() =>
    (window as unknown as { mnemosDeliver: () => void }).mnemosDeliver(),
  );
  await rail(page).getByTestId("place-row-journal").locator("button").click();
  await rail(page).getByTestId("place-row-notes").locator("button").click();
  await page.getByTestId("mnemos-thread-wren-n1").locator("button").click();
  await expect(thread.getByTestId("mnemos-note-woken")).toContainText(
    /it has woken with this, today at/,
  );
  measure47("answer", { sent });
  onlyTheFour(sent);
  expect(consoleClean(errors)).toEqual([]);
});

test("(47) answer from At a glance", async ({ page }) => {
  const errors = await boot(page);
  const plate = page.getByTestId("mnemos-plate-waiting");
  await expect(plate).toContainText("old tide tables");
  await expect(page.getByTestId("mnemos-answer-in-notes")).toHaveCount(0);
  await plate.getByTestId("mnemos-glance-answer-text").fill(ANSWER);
  await plate.getByTestId("mnemos-glance-answer-send").click();
  await expect(page.getByTestId("mnemos-glance-sent")).toHaveText(
    "Your answer is in Notes; it wakes with this, once, in its next session. Open it",
  );
  // The next one waiting comes forward.
  await expect(plate).toContainText("Do you want the weather");
  await expect(plate).not.toContainText("1 of 2");
  await shot47(page, "07-glance-answer-dark");
  const sent = await writesSent(page);
  expect(sent).toEqual([
    {
      mind: "wren",
      write: { command: "reply", note_id: "wren-n1", text: ANSWER },
    },
  ]);
  await page.getByTestId("mnemos-glance-sent").getByRole("button").click();
  await expect(page).toHaveURL(/room=notes/);
  await expect(page.getByTestId("mnemos-thread-opened")).toContainText(ANSWER);
  expect(consoleClean(errors)).toEqual([]);
});

test("(47) leave a note, in the light", async ({ page }) => {
  const errors = await boot(page, {
    hash: "/mnemos?room=notes",
    mode: "light",
  });
  const row = page.getByTestId("mnemos-leave-row");
  await expect(row).toContainText("Leave Wren a note");
  await expect(row).toContainText(
    "It wakes with it, once, in its next session.",
  );
  await row.locator("button").click();
  const words =
    "The new lamp arrives Thursday. Leave the old one lit till then.";
  await page.getByTestId("mnemos-leave-note-text").fill(words);
  await shot47(page, "03-leave-note-light");
  await page.getByTestId("mnemos-leave-note-send").click();
  await expect(page).toHaveURL(/item=wren-n5/);
  const thread = page.getByTestId("mnemos-thread-opened");
  await expect(thread.locator("li")).toHaveCount(1);
  await expect(thread).toContainText(words);
  await expect(thread.getByTestId("mnemos-note-woken")).toContainText(
    "it wakes with this, once, in its next session",
  );
  // A thread of only your words has nothing of its to answer.
  await expect(page.getByTestId("mnemos-answer")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-leave-note")).toHaveCount(0);
  expect(await writesSent(page)).toEqual([
    { mind: "wren", write: { command: "note", text: words } },
  ]);
  await expect(rail(page).getByTestId("place-row-notes")).toHaveText("Notes5");
  expect(consoleClean(errors)).toEqual([]);
});

test("(47) a quiet hour says so in the engine's words, and keeps the text", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes" });
  await setWrites(page, { writeMode: "quiet" });
  await page.getByTestId("mnemos-answer-text").fill(ANSWER);
  await page.getByTestId("mnemos-answer-send").click();
  await expect(page.getByTestId("mnemos-answer-said")).toHaveText(QUIET_REPLY);
  await expect(page.getByTestId("mnemos-answer-text")).toHaveValue(ANSWER);
  // No way to send it again unasked, and nothing sent it again.
  await page.waitForTimeout(800);
  expect(await writesSent(page)).toHaveLength(1);
  await expect(
    page.getByTestId("mnemos-answer-said").getByRole("button"),
  ).toHaveCount(0);
  await shot47(page, "04-quiet-hour-dark");
  await page.getByTestId("mnemos-leave-row").locator("button").click();
  await page.getByTestId("mnemos-leave-note-text").fill("Morning.");
  await page.getByTestId("mnemos-leave-note-send").click();
  await expect(page.getByTestId("mnemos-leave-note-said")).toHaveText(
    "Nothing saved: A note is the person's own words, and no one is in the room during one of the agent's hours.",
  );
  await expect(page.getByTestId("mnemos-leave-note-text")).toHaveValue(
    "Morning.",
  );
  // Nothing was kept: no new thread, and each refusal was sent once.
  await expect(page.getByTestId("mnemos-thread-wren-n5")).toHaveCount(0);
  expect(await writesSent(page)).toHaveLength(2);
  expect(consoleClean(errors)).toEqual([]);
});

test("(47) the limit: a count only near it, and too long can't be sent", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes" });
  const text = page.getByTestId("mnemos-answer-text");
  await text.fill("Short.");
  await expect(page.getByTestId("mnemos-answer-count")).toHaveCount(0);
  await text.fill("x".repeat(15_000));
  await expect(page.getByTestId("mnemos-answer-count")).toHaveText(
    "1,384 left",
  );
  await expect(page.getByTestId("mnemos-answer-send")).toBeEnabled();
  await text.fill("x".repeat(16_385));
  await expect(page.getByTestId("mnemos-answer-count")).toHaveText("1 over");
  await expect(page.getByTestId("mnemos-answer-send")).toBeDisabled();
  await text.press("ControlOrMeta+Enter");
  await page.waitForTimeout(400);
  expect(await writesSent(page)).toEqual([]);
  // Nothing at all can't be sent either.
  await text.fill("   ");
  await expect(page.getByTestId("mnemos-answer-send")).toBeDisabled();
  expect(consoleClean(errors)).toEqual([]);
});

test("(47) a write that fails says so and keeps the text; Try again is the person's", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes" });
  await setWrites(page, { writeMode: "busy" });
  await page.getByTestId("mnemos-answer-text").fill(ANSWER);
  await page.getByTestId("mnemos-answer-send").click();
  const said = page.getByTestId("mnemos-answer-said");
  await expect(said).toContainText(
    "Mnemos was busy with this memory, so nothing was saved.",
  );
  await expect(page.getByTestId("mnemos-answer-text")).toHaveValue(ANSWER);
  await page.waitForTimeout(800);
  expect(await writesSent(page)).toHaveLength(1);
  // The card is still the room: nothing ended.
  await expect(page.getByTestId("mnemos-thread-opened")).toBeVisible();

  await setWrites(page, { writeMode: "fail" });
  await said.getByRole("button", { name: "Try again" }).click();
  await expect(said).toContainText(
    "It couldn’t be sent just now. Your words are still here.",
  );
  await expect(page.getByTestId("mnemos-answer-text")).toHaveValue(ANSWER);

  await setWrites(page, { writeMode: null });
  await said.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByTestId("mnemos-thread-opened").locator("li"),
  ).toHaveCount(2);
  await expect(page.getByTestId("mnemos-answer-said")).toHaveCount(0);
  const sent = await writesSent(page);
  expect(sent).toHaveLength(3);
  measure47("busy_line", {
    busy: "Mnemos was busy with this memory, so nothing was saved.",
    sent: sent.length,
  });
  expect(consoleClean(errors)).toEqual([]);
});

test("(47) correct it: prefilled, Save, its new words, corrected today; Cancel changes nothing", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=memories" });
  const opened = page.getByTestId("mnemos-memory-opened");
  await expect(page).toHaveURL(/item=wren-m123/);
  const before = "When the fog horn sounds twice, the ferry is running late.";
  await expect(opened).toContainText(before);

  // Cancel changes nothing, and focus goes back.
  await page.getByTestId("mnemos-correct-open").click();
  const field = page.getByTestId("mnemos-correct-text");
  await expect(field).toHaveValue(/^When the fog horn sounds twice/);
  await expect(field).toBeFocused();
  await expect(page.getByTestId("mnemos-correct")).toContainText(
    "Its own words stay in its history. Wren wakes knowing you corrected it, once.",
  );
  await expect(page.getByTestId("mnemos-correct-send")).toBeDisabled();
  await field.fill("Something else entirely.");
  await page.getByTestId("mnemos-correct-cancel").click();
  await expect(opened).toContainText(before);
  await expect(page.getByTestId("mnemos-correct-open")).toBeFocused();
  expect(await writesSent(page)).toEqual([]);

  const after =
    "When the fog horn sounds twice, the ferry is running late, unless the harbour master has called it off.";
  await page.getByTestId("mnemos-correct-open").click();
  await field.fill(after);
  await shot47(page, "05-correct-dark");
  await page.getByTestId("mnemos-correct-send").click();
  await expect(page).toHaveURL(/item=wren-m123-c/);
  await expect(opened).toContainText("unless the harbour master");
  await expect(page.getByTestId("mnemos-memory-line")).toContainText(
    "corrected today",
  );
  await expect(page.getByTestId("mnemos-memory-line")).toContainText(
    "in your words",
  );
  await expect(page.getByTestId("mnemos-correct")).toHaveCount(0);
  const rows = page.getByTestId("mnemos-memories-list").locator("li");
  await expect(rows.first()).toHaveAttribute("data-memory", "wren-m123-c");
  await expect(page.getByTestId("mnemos-memory-wren-m123")).toHaveCount(0);
  const sent = await writesSent(page);
  expect(sent).toEqual([
    {
      mind: "wren",
      write: { command: "correct", memory_id: "wren-m123", text: after },
    },
  ]);
  measure47("correct", { sent });
  expect(consoleClean(errors)).toEqual([]);
});

test("(47) let it go: it asks; no keeps it; yes takes it out and the counts change", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=memories" });
  await expect(page).toHaveURL(/item=wren-m123/);
  await expect(rail(page).getByTestId("place-row-memories")).toHaveText(
    "Memories124",
  );
  await page.getByTestId("mnemos-let-go-open").click();
  const ask = page.getByRole("alertdialog", { name: "Let this memory go?" });
  await expect(ask).toContainText(
    "It won't come back by its words, its meaning or its id. It's kept in the archive, not deleted, and Wren will know, once, that you let a memory go, though not what it said.",
  );
  await expect(page.getByTestId("mnemos-let-go-keep")).toBeFocused();
  await shot47(page, "06-let-go-asks-dark");

  // No: Keep it, and Escape, leave it as it was.
  await page.getByTestId("mnemos-let-go-keep").click();
  await expect(ask).toHaveCount(0);
  await expect(page.getByTestId("mnemos-let-go-open")).toBeFocused();
  await page.getByTestId("mnemos-let-go-open").click();
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(page.getByTestId("mnemos-memory-wren-m123")).toBeVisible();
  expect(await writesSent(page)).toEqual([]);

  // Yes.
  await page.getByTestId("mnemos-let-go-open").click();
  await page.getByTestId("mnemos-let-go-yes").click();
  await expect(page.getByTestId("mnemos-memory-wren-m123")).toHaveCount(0);
  await expect(rail(page).getByTestId("place-row-memories")).toHaveText(
    "Memories123",
  );
  await expect(page.getByTestId("place-page-state")).toHaveText(
    "123 memories it can reach · newest today · Luca remembers with this",
  );
  // Wide, the card is never left empty: the newest opens by itself.
  await expect(page).toHaveURL(/item=wren-m122/);
  expect(await writesSent(page)).toEqual([
    { mind: "wren", write: { command: "forget", memory_id: "wren-m123" } },
  ]);
  await rail(page).getByTestId("place-row-glance").locator("button").click();
  await expect(page.getByTestId("mnemos-count")).toHaveText("123");
  await expect(page.getByTestId("mnemos-plate-memory")).toContainText(
    "6 of them gone quiet · 4 let go",
  );
  measure47("let_go", { memories_after: 123, let_go_after: 4 });
  expect(consoleClean(errors)).toEqual([]);
});

test("(47) one way in: the agent page opens the notebook, the head goes back, unlink still works", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: `/agents?profile=${LUCA}&page=mnemos`,
  });
  const row = page.getByTestId("mind-open-notebook");
  await expect(row).toContainText("Open Luca’s notebook");
  await shot47(page, "08-agent-page-open-notebook-dark");
  await row.click();
  await expect(page).toHaveURL(/#\/mnemos\?.*mind=wren/);
  await expect(page).toHaveURL(/room=glance/);
  await expect(card(page).getByRole("heading", { name: "Wren" })).toBeVisible();

  // The head's "Luca remembers with this" opens Luca's own page.
  await page.getByTestId(`mnemos-head-resident-${LUCA}`).click();
  await expect(page).toHaveURL(new RegExp(`#/agents\\?.*profile=${LUCA}`));

  // Unlinking is still the agent page's, and still works.
  await page.goto(`/#/agents?profile=${LUCA}&page=mnemos`);
  const view = page.getByTestId("mind-mnemos");
  await view.locator("summary").click();
  await view.getByRole("button", { name: "Unlink", exact: true }).click();
  await expect(
    view.getByRole("button", { name: "Use Wren as Luca’s memory" }),
  ).toBeVisible();
  await expect(page.getByTestId("mind-open-notebook")).toHaveCount(0);
  const probe = await probeOf(page);
  expect(probe.calls.some((c) => c.cmd === "disconnect_mnemos_view")).toBe(
    true,
  );
  expect(await writesSent(page)).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(47) residents with no memory yet: listed quietly, with the offer", async ({
  page,
}) => {
  const errors = await boot(page);
  await page.getByTestId("mnemos-rail-mind-button").click();
  const none = page.getByTestId("mnemos-minds-no-memory");
  await expect(none).toContainText("No memory yet");
  await expect(page.getByTestId(`mnemos-offer-${ORI}`)).toHaveText(
    "OriGive Ori a memory",
  );
  await shot47(page, "09-minds-no-memory-yet-dark");
  await page.getByTestId(`mnemos-offer-${ORI}`).click();
  await expect(page).toHaveURL(new RegExp(`profile=${ORI}`));
  await expect(page).toHaveURL(/page=mnemos/);
  await expect(
    page.getByRole("region", { name: "Give Ori a memory" }),
  ).toBeVisible();
  // An offer only: nothing linked, nothing written.
  const probe = await probeOf(page);
  expect(probe.calls.some((c) => c.cmd === "link_mnemos_mind")).toBe(false);
  expect(await writesSent(page)).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(47) keyboard only: answer a note, correct a memory", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes" });
  const tabTo = async (testId: string) => {
    for (let i = 0; i < 80; i++) {
      const at = await page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") ?? "",
      );
      if (at === testId) return;
      await page.keyboard.press("Tab");
    }
    throw new Error(`Tab never reached ${testId}`);
  };
  await expect(page.getByTestId("mnemos-thread-opened")).toBeVisible();
  await tabTo("mnemos-answer-text");
  await page.keyboard.type("Keep them.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(
    page.getByTestId("mnemos-thread-opened").locator("li"),
  ).toHaveCount(2);

  await page.goto("/#/mnemos?room=memories");
  await expect(page).toHaveURL(/item=wren-m123/);
  await tabTo("mnemos-correct-open");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("mnemos-correct-text")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mnemos-correct-open")).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("The fog horn twice means the ferry is late.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).toHaveURL(/item=wren-m123-c/);
  await expect(page.getByTestId("mnemos-memory-opened")).toContainText(
    "The fog horn twice means the ferry is late.",
  );
  const sent = await writesSent(page);
  expect(sent.map((s) => s.write.command)).toEqual(["reply", "correct"]);
  onlyTheFour(sent);
  expect(consoleClean(errors)).toEqual([]);
});

/* ── WP-48, Part 0: the review's fixes ─────────────────────────────── */

async function shot48(page: Page, name: string) {
  await waitForAnimations(page);
  await page.waitForTimeout(250);
  mkdirSync(SHOTS48, { recursive: true });
  const path = `${SHOTS48}/${name}.png`;
  await page.screenshot({ path });
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  const all = (() => {
    try {
      return JSON.parse(readFileSync(`${SHOTS48}/hashes.json`, "utf8"));
    } catch {
      return {};
    }
  })();
  all[name] = hash;
  writeFileSync(`${SHOTS48}/hashes.json`, JSON.stringify(all, null, 2));
  return hash;
}

function measure48(key: string, value: unknown) {
  mkdirSync(`${SHOTS48}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS48}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

test("(48-0a) Leave Wren a note is the list's first row, and opens its field beside it", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes" });
  const first = page
    .getByTestId("mnemos-notes")
    .locator(".luca-mnemos-list li")
    .first();
  await expect(first).toContainText("Leave Wren a note");
  await expect(first).toContainText(
    "It wakes with it, once, in its next session.",
  );
  // No box always open above the list.
  await expect(page.locator(".luca-mnemos-list textarea")).toHaveCount(0);
  await first.locator("button").click();
  const opened = page.getByTestId("mnemos-leave-opened");
  await expect(opened.getByRole("heading")).toHaveText("Leave Wren a note");
  await expect(page.getByTestId("mnemos-leave-note-text")).toBeVisible();
  await expect(first).toHaveAttribute("aria-current", "true");
  await shot48(page, "01-notes-leave-row-dark");
  // Another thread takes its place; the row brings it back.
  await page.getByTestId("mnemos-thread-wren-n4").locator("button").click();
  await expect(opened).toHaveCount(0);
  await first.locator("button").click();
  await expect(page.getByTestId("mnemos-leave-opened")).toBeVisible();
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-0b, 0c, 0d) one line that grows, Send beside it; one link style; labels set as labels", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes" });
  const text = page.getByTestId("mnemos-answer-text");
  const send = page.getByTestId("mnemos-answer-send");
  const rest = await text.boundingBox();
  const sendBox = await send.boundingBox();
  if (!rest || !sendBox) throw new Error("no field");
  expect(rest.height).toBeLessThanOrEqual(44);
  // Beside it, on its line.
  expect(sendBox.x).toBeGreaterThan(rest.x + rest.width - 1);
  expect(
    Math.abs(sendBox.y + sendBox.height - (rest.y + rest.height)),
  ).toBeLessThan(2);
  await text.fill("Keep them.");
  await shot48(page, "02-answer-one-line-dark");
  await text.fill(
    Array.from({ length: 9 }, (_, i) => `Line ${i + 1}`).join("\n"),
  );
  const grown = await text.boundingBox();
  if (!grown) throw new Error("no field");
  const line = await text.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).lineHeight),
  );
  // It grows to about five lines, then scrolls inside.
  expect(grown.height).toBeGreaterThan(rest.height + line * 3);
  expect(grown.height).toBeLessThanOrEqual(line * 5 + 16);

  // (d) The field's label is a section label, as the lists' are.
  const label = await page
    .getByTestId("mnemos-answer")
    .locator("label")
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, weight: s.fontWeight, color: s.color };
    });
  const listLabel = await page
    .getByTestId("mnemos-notes-waiting")
    .locator(".luca-place-section-label")
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, weight: s.fontWeight, color: s.color };
    });
  expect(label).toEqual(listLabel);
  expect(label.size).not.toBe("16px");

  // Cleared, so no unsent words follow it to At a glance.
  await text.fill("");
  // (c) One link style: the head's.
  await rail(page).getByTestId("place-row-glance").locator("button").click();
  const head = await page
    .getByTestId(`mnemos-head-resident-${LUCA}`)
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.textDecorationLine, s.fontWeight, s.textUnderlineOffset];
    });
  const thread = await page.getByTestId("mnemos-open-thread").evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.textDecorationLine, s.fontWeight, s.textUnderlineOffset];
  });
  expect(thread).toEqual(head);
  expect(head[0]).toBe("underline");
  expect(Number(head[1])).toBeLessThan(500);

  // (b) At rest, the Waiting plate stands no taller than its neighbours.
  const tall = await page.evaluate(() => {
    const content = (id: string) => {
      const plate = document.querySelector(`[data-testid="${id}"]`);
      if (!plate) return 0;
      const top = plate.getBoundingClientRect().top;
      let bottom = top;
      for (const child of Array.from(plate.children))
        bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
      return Math.round(bottom - top);
    };
    return {
      waiting: content("mnemos-plate-waiting"),
      memory: content("mnemos-plate-memory"),
      lately: content("mnemos-plate-lately"),
    };
  });
  expect(tall.waiting).toBeLessThanOrEqual(Math.max(tall.memory, tall.lately));
  await shot48(page, "03-glance-rest-dark");
  measure48("part0", { field_rest_px: rest.height, label, tall, link: head });
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-0f) a first search by meaning shows it is working until the answer comes", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=memories" });
  await page.evaluate(() => {
    (window as unknown as { mnemosProbe: Probe }).mnemosProbe.searchDelay =
      1500;
  });
  await page.getByTestId("mnemos-search").fill("ferry");
  await page.getByTestId("mnemos-search").press("Enter");
  await expect(page.getByTestId("mnemos-searching")).toHaveText("Searching…");
  await expect(page.getByTestId("mnemos-search-results")).toBeVisible();
  await expect(page.getByTestId("mnemos-searching")).toHaveText("");
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-0e) the agent page in the new look: the relationship and the notebook", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: `/agents?profile=${LUCA}&page=mnemos`,
  });
  const view = page.getByTestId("mind-mnemos");
  await expect(page.getByTestId("mind-open-notebook")).toBeVisible();
  await expect(view.getByRole("button", { name: /^Memories/ })).toHaveCount(0);
  await expect(view.getByText("Memory sections")).toHaveCount(0);
  const probe = await probeOf(page);
  expect(probe.calls.filter((c) => c.cmd === "read_mnemos_view")).toEqual([]);
  await shot48(page, "10-agent-page-new-look-dark");
  expect(consoleClean(errors)).toEqual([]);
});

/* ── WP-48: the independent check of 636c3414c, its fixes ────────────── */

const setProbe = (page: Page, next: Partial<Probe>) =>
  page.evaluate((next) => {
    Object.assign(
      (window as unknown as { mnemosProbe: Probe }).mnemosProbe,
      next,
    );
  }, next);

/** Every memories page the place asked for (not the counts alone). */
async function memoryPages(page: Page) {
  return (await probeOf(page)).calls.filter(
    (c) =>
      c.cmd === "read_mnemos_place" &&
      (c.args?.request as { command: string; limit?: number }).command ===
        "memories" &&
      Number((c.args?.request as { limit?: number }).limit) > 0,
  ).length;
}

test("(check 1) a mind's unbroken words wrap everywhere and never widen what holds them", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=journal" });
  const unbroken = "U".repeat(300);
  await page.evaluate((text) => {
    (window as unknown as { mnemosText: (text: string) => void }).mnemosText(
      text,
    );
  }, unbroken);
  const found: Record<string, unknown> = {};
  for (const room of [
    "memories",
    "journal",
    "notes",
    "beliefs",
    "carrying",
    "glance",
  ]) {
    await rail(page).getByTestId(`place-row-${room}`).click();
    await expect(page).toHaveURL(new RegExp(`room=${room}`));
    // The note with these words is in its own thread.
    if (room === "notes")
      await page.getByTestId("mnemos-thread-wren-n1").click();
    await expect(card(page)).toContainText("UUUUUUUUUUUUUUUUUUUU");
    if (room !== "glance")
      await expect(
        page.getByTestId(`mnemos-${room}-opened`).locator("article"),
      ).toContainText("UUUUUUUUUU");
    const measured = await page.evaluate(() => {
      const place = document.querySelector("[data-testid='mnemos-place']");
      if (!place) return null;
      const edge = place.getBoundingClientRect().right;
      const over = [...place.querySelectorAll("*")]
        .filter((el) => el.getBoundingClientRect().right > edge + 1)
        .map((el) => el.getAttribute("data-testid") ?? el.tagName);
      const panes = [
        ...place.querySelectorAll(".luca-mnemos-list, .luca-mnemos-opened"),
      ].map((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      return {
        over,
        panes,
        pageX:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });
    found[room] = measured;
    expect(measured?.over, room).toEqual([]);
    for (const pane of measured?.panes ?? [])
      expect(pane.sw, room).toBeLessThanOrEqual(pane.cw + 1);
    expect(measured?.pageX, room).toBe(false);
  }
  measure48("check1_unbroken", found);
  expect(consoleClean(errors)).toEqual([]);
});

test("(check 2) while a search is out, nothing is opened beside it; then its first result opens", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=memories" });
  await expect(page).toHaveURL(/item=wren-m123/);
  await expect(page.getByTestId("mnemos-correct-open")).toBeVisible();
  await setProbe(page, { searchDelay: 1500 });
  await page.getByTestId("mnemos-search").fill("tide");
  await page.getByTestId("mnemos-search").press("Enter");
  await expect(page.getByTestId("mnemos-searching")).toHaveText("Searching…");
  await expect(page.getByTestId("mnemos-search-working")).toHaveText(
    "Searching…",
  );
  await expect(page.getByTestId("mnemos-memory-opened")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-correct-open")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-let-go-open")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-search-results")).toBeVisible();
  await expect(page).toHaveURL(/item=wren-m116/);
  await expect(page.getByTestId("mnemos-memory-opened")).toContainText(
    "tide tables",
  );
  await expect(page.getByTestId("mnemos-search-working")).toHaveCount(0);
  expect(consoleClean(errors)).toEqual([]);
});

test("(check 3) Show older memories reads one new page per click", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=memories" });
  await expect(
    page.getByTestId("mnemos-memories-list").locator("li"),
  ).toHaveCount(50);
  const counts = [await memoryPages(page)];
  await page.getByTestId("mnemos-more").click();
  await expect(
    page.getByTestId("mnemos-memories-list").locator("li"),
  ).toHaveCount(100);
  counts.push(await memoryPages(page));
  await page.getByTestId("mnemos-more").click();
  await expect(
    page.getByTestId("mnemos-memories-list").locator("li"),
  ).toHaveCount(124);
  counts.push(await memoryPages(page));
  await expect(page.getByTestId("mnemos-more")).toHaveCount(0);
  expect(counts[1] - counts[0]).toBe(1);
  expect(counts[2] - counts[1]).toBe(1);
  measure48("check3_pages", { counts });
  expect(consoleClean(errors)).toEqual([]);
});

test("(check 4) a write that times out is looked for before anything is said", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes" });
  // Saved, then silent: it is found, and shown as sent.
  await setWrites(page, { writeMode: "save-silent" });
  await page.getByTestId("mnemos-answer-text").fill(ANSWER);
  await page.getByTestId("mnemos-answer-send").click();
  await expect(
    page.getByTestId("mnemos-thread-opened").locator("li"),
  ).toHaveCount(2);
  await expect(page.getByTestId("mnemos-answer-said")).toHaveCount(0);
  const calls = (await probeOf(page)).calls.map((c) => c.cmd);
  const wrote = calls.indexOf("write_mnemos_place");
  expect(calls.slice(wrote + 1)).toContain("open_mnemos_mind");
  expect(calls.slice(wrote + 1)).toContain("read_mnemos_place");
  expect(await writesSent(page)).toHaveLength(1);

  // Silent without saving: nothing found, said plainly, words kept.
  await setWrites(page, { writeMode: "silent" });
  await page.getByTestId("mnemos-leave-row").click();
  await page.getByTestId("mnemos-leave-note-text").fill("A note that waits.");
  await page.getByTestId("mnemos-leave-note-send").click();
  const said = page.getByTestId("mnemos-leave-note-said");
  await expect(said).toContainText(
    "Mnemos didn’t answer, and nothing was saved. Your words are still here.",
  );
  await expect(page.getByTestId("mnemos-leave-note-text")).toHaveValue(
    "A note that waits.",
  );
  expect(await writesSent(page)).toHaveLength(2);
  await setWrites(page, { writeMode: null });
  await said.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("mnemos-thread-opened")).toContainText(
    "A note that waits.",
  );
  expect(await writesSent(page)).toHaveLength(3);

  // A correction the same way.
  await rail(page).getByTestId("place-row-memories").click();
  await expect(page).toHaveURL(/item=wren-m123/);
  await setWrites(page, { writeMode: "silent" });
  await page.getByTestId("mnemos-correct-open").click();
  await page.getByTestId("mnemos-correct-text").fill("Fixed words, unsaved.");
  await page.getByTestId("mnemos-correct-send").click();
  await expect(page.getByTestId("mnemos-correct-said")).toContainText(
    "nothing was saved",
  );
  await setWrites(page, { writeMode: "save-silent" });
  await page
    .getByTestId("mnemos-correct-said")
    .getByRole("button", { name: "Try again" })
    .click();
  await expect(page).toHaveURL(/item=wren-m123-c/);
  await expect(page.getByTestId("mnemos-memory-opened")).toContainText(
    "Fixed words, unsaved.",
  );
  expect(await writesSent(page)).toHaveLength(5);
  expect(consoleClean(errors)).toEqual([]);
});

test("(check 5) the owner's unsent words stay for the app session, and only in memory", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes" });
  const kept = "Half an answer, not sent yet.";
  await page.getByTestId("mnemos-answer-text").fill(kept);
  await rail(page).getByTestId("place-row-journal").click();
  await rail(page).getByTestId("place-row-notes").click();
  await expect(page.getByTestId("mnemos-answer-text")).toHaveValue(kept);
  // Another thread opened, then this one again.
  await page.getByTestId("mnemos-thread-wren-n4").click();
  await page.getByTestId("mnemos-thread-wren-n1").click();
  await expect(page.getByTestId("mnemos-answer-text")).toHaveValue(kept);
  // Hidden and shown.
  await setVisible(page, false);
  await expect(page.getByTestId("mnemos-answer-text")).toHaveCount(0);
  await setVisible(page, true);
  await expect(page.getByTestId("mnemos-answer-text")).toHaveValue(kept);
  // Left, and back.
  await page.getByTestId("open-brain-setup").click();
  await expect(page).toHaveURL(/#\/brain/);
  await page.getByTestId("open-mnemos-place").click();
  await expect(page.getByTestId("mnemos-answer-text")).toHaveValue(kept);
  // The same words at a glance, where the same note is answered.
  await rail(page).getByTestId("place-row-glance").click();
  await expect(page.getByTestId("mnemos-glance-answer-text")).toHaveValue(kept);
  // A correction, kept and opened again where it was left.
  await rail(page).getByTestId("place-row-memories").click();
  await page.getByTestId("mnemos-correct-open").click();
  await page
    .getByTestId("mnemos-correct-text")
    .fill("A correction, half done.");
  await rail(page).getByTestId("place-row-journal").click();
  await rail(page).getByTestId("place-row-memories").click();
  await expect(page.getByTestId("mnemos-correct-text")).toHaveValue(
    "A correction, half done.",
  );
  // Never in storage.
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  expect(stored).not.toContain("Half an answer");
  expect(stored).not.toContain("half done");
  // Cancel clears it; sent, it goes.
  await page.getByTestId("mnemos-correct-cancel").click();
  await rail(page).getByTestId("place-row-journal").click();
  await rail(page).getByTestId("place-row-memories").click();
  await expect(page.getByTestId("mnemos-correct-text")).toHaveCount(0);
  await rail(page).getByTestId("place-row-notes").click();
  await page.getByTestId("mnemos-answer-send").click();
  await expect(
    page.getByTestId("mnemos-thread-opened").locator("li"),
  ).toHaveCount(2);
  await rail(page).getByTestId("place-row-glance").click();
  await rail(page).getByTestId("place-row-notes").click();
  await page.getByTestId("mnemos-thread-wren-n4").click();
  await expect(page.getByTestId("mnemos-answer-text")).toHaveValue("");
  expect(consoleClean(errors)).toEqual([]);
});

test("(check 6) Enter sends and Shift+Enter starts a line, as in the message box; trailing space is trimmed", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=notes" });
  const text = page.getByTestId("mnemos-answer-text");
  await text.click();
  await page.keyboard.type("Keep them.");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Both folders.   ");
  await page.keyboard.press("Shift+Enter");
  expect(await writesSent(page)).toHaveLength(0);
  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId("mnemos-thread-opened").locator("li"),
  ).toHaveCount(2);
  const sent = await writesSent(page);
  expect(sent.map((s) => s.write.text)).toEqual(["Keep them.\nBoth folders."]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(check 7) a bad address falls back and then says what is shown, in place", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/" });
  const before = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    location.hash = "#/mnemos?room=bogus";
  });
  await expect(page).toHaveURL(/room=glance/);
  await expect(page).not.toHaveURL(/bogus/);
  await page.evaluate(() => {
    location.hash = "#/mnemos?room=memories&mind=does-not-exist";
  });
  await expect(page).toHaveURL(/mind=wren/);
  await expect(page).not.toHaveURL(/does-not-exist/);
  await expect(card(page)).toContainText("Wren");
  // Each fix replaced its entry: two steps in, two back.
  expect(await page.evaluate(() => history.length)).toBe(before + 2);
  await page.goBack();
  await expect(page).toHaveURL(/room=glance/);
  expect(consoleClean(errors)).toEqual([]);
});

test("(check 8) in the classic look, the place's address goes home", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?room=notes",
    classic: true,
  });
  await expect(page).not.toHaveURL(/mnemos/);
  await expect(page.getByTestId("mnemos-place")).toHaveCount(0);
  expect(consoleClean(errors)).toEqual([]);
});

test("(check 9) nothing in the place moves under reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 960, height: 900 });
  const errors = await boot(page, { hash: "/mnemos?room=journal" });
  await page.getByTestId("mnemos-entry-wren-j1").click();
  // At once: a 120 ms fade would still be running.
  const running = await page.evaluate(() => {
    const place = document.querySelector("[data-testid='mnemos-place']");
    return document
      .getAnimations()
      .filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return a.playState === "running" && target && place?.contains(target);
      })
      .map((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return `${(a as CSSAnimation).animationName ?? "a transition"} on ${target?.className ?? "?"}`;
      });
  });
  expect(running).toEqual([]);
  await expect(page.getByTestId("mnemos-journal-opened")).toBeVisible();
  // Narrow, so the push is what would have run.
  await expect(page.getByTestId("mnemos-journal-list")).toBeHidden();
  expect(consoleClean(errors)).toEqual([]);
});
