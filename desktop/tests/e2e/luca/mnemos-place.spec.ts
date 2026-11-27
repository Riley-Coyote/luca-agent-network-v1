import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../../helpers/animations";
import { installMockBridge } from "../../helpers/bridge";
import { FEATURE_OVERRIDES_STORAGE_KEY } from "../../helpers/features";
import {
  KESTREL_HELLO,
  growKestrel,
  kestrelNotebook,
  PICTURES,
} from "./mnemos-newer-fixture";

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
const SHOTS51 = process.env.WP51_SHOTS ?? "test-results/wp51";
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
/** A row of the list of minds with its own numbers: its newest memory some
 *  days ago, or on a day in an earlier year (`month` from 0). */
type ListMind = {
  id: string;
  name: string;
  memories: number;
  newest:
    | { daysAgo: number }
    | { yearsAgo: number; month: number; day: number };
  linked: { pubkey: string; name: string }[];
};
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
  /** Kestrel's change token (the newer engine's `summary`). */
  token: string;
  /** Kestrel's `read` fails while set. */
  readFails: boolean;
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
    newer = false,
    grown = false,
    listMinds = [],
    wrenLinked,
  }: {
    hash?: string;
    mode?: Mode;
    fault?: Fault | null;
    decline?: boolean;
    /** The classic look: the new look's frame off. */
    classic?: boolean;
    /** Kestrel too: a mind on a newer Mnemos that gives the notebook. */
    newer?: boolean;
    /** Kestrel with a long thread and a memory of many ties. */
    grown?: boolean;
    /** More rows for the list of minds, with numbers of their own (WP-56). */
    listMinds?: ListMind[];
    /** Who remembers with Wren, in place of Luca alone (WP-56). */
    wrenLinked?: { pubkey: string; name: string }[];
  } = {},
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Before the test bridge, so every Mnemos command is this spec's.
  await page.addInitScript(
    ({
      luca,
      ori,
      fault,
      decline,
      kestrel,
      hello,
      pictures,
      extra,
      wrenLinked,
    }) => {
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
        /** Something shown changed in Kestrel's notebook: a new journal
         *  entry (and with `memories`, a new memory, a new version). */
        mnemosBump?: (memories?: boolean) => void;
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
        token: "kt1",
        readFails: false,
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
          newest: iso(now),
          linked: wrenLinked ?? [{ pubkey: luca, name: "Luca" }],
        },
        {
          id: "field-notes",
          name: "Field Notes",
          memories: 9,
          newest: iso(now),
          linked: [],
        },
        ...(kestrel
          ? [
              {
                id: "kestrel",
                name: "Kestrel",
                memories: 12,
                newest: iso(now),
                linked: [] as { pubkey: string; name: string }[],
              },
            ]
          : []),
        // Noon on their day, in the page's own time.
        ...extra.map(({ newest, ...m }) => {
          const d = new Date();
          const at =
            "daysAgo" in newest
              ? new Date(
                  d.getFullYear(),
                  d.getMonth(),
                  d.getDate() - newest.daysAgo,
                  12,
                )
              : new Date(
                  d.getFullYear() - newest.yearsAgo,
                  newest.month,
                  newest.day,
                  12,
                );
          return { ...m, newest: at.toISOString() };
        }),
      ];
      // Kestrel's engine: hello, summary, the notebook, its pictures, and
      // the three newer writes (the hours against this fake only).
      const listed = new Set<string>();
      let bumps = 0;
      win.mnemosBump = (alsoMemories = false) => {
        if (!kestrel) return;
        bumps++;
        kestrel.life.journal.unshift({
          id: `kes-jn${bumps}`,
          at: new Date().toISOString(),
          text: `A new entry, number ${bumps}.`,
          mood: "",
          written: "in_session",
          model: "claude-opus-5-5",
          hour: "",
        });
        if (alsoMemories) {
          kestrel.memories.push({
            ...kestrel.memories[0],
            id: `kes-mn${bumps}`,
            born: new Date().toISOString(),
            content: `A new memory, number ${bumps}.`,
            ties: [],
          });
          kestrel.version = `kv${bumps + 1}`;
          kestrel.life.memory.version = kestrel.version;
          kestrel.life.memory.count = kestrel.memories.length;
          kestrel.life.memory.states.active += 1;
        }
        probe.token = `kt${bumps + 1}`;
      };
      const kestrelSummary = () => {
        if (!kestrel) return {};
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
      const idsIn = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(idsIn);
        else if (value && typeof value === "object")
          for (const [key, inner] of Object.entries(value))
            if (key === "id" && typeof inner === "string") seen.add(inner);
            else idsIn(inner);
      };
      const kestrelRead = (request: Record<string, unknown>) => {
        if (!kestrel) return fail("mind_unavailable");
        if (request.command === "summary")
          return { kind: "summary", summary: kestrelSummary() };
        if (request.command === "notebook" && request.part === "life") {
          idsIn(kestrel.life);
          for (const path of Object.keys(pictures)) listed.add(path);
          return {
            kind: "notebook",
            part: "life",
            document: kestrel.life,
            page: null,
            pictures: Object.keys(pictures),
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
              made: new Date().toISOString(),
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
        if (request.command === "search") {
          const words = String(request.query).toLowerCase();
          const results = kestrel.memories
            .filter((m) => m.content.toLowerCase().includes(words))
            .map((m, i) => ({
              id: m.id,
              words: m.content,
              kept: m.born,
              closeness: 1 - i * 0.1,
              found: "meaning",
            }));
          for (const r of results) seen.add(r.id);
          return { kind: "search", results };
        }
        // A newer engine still answers the first commands; the place
        // never needs them for Kestrel.
        return fail(`unexpected kestrel ${String(request.command)}`);
      };
      const kestrelWrite = (write: Record<string, unknown>) => {
        if (!kestrel) return fail("mind_unavailable");
        const named = [
          ...(Array.isArray(write.note_ids) ? write.note_ids : []),
          write.note_id,
          write.memory_id,
        ].filter((id): id is string => typeof id === "string");
        if (named.some((id) => !seen.has(id))) return fail("unknown_item");
        const at = new Date().toISOString();
        if (write.command === "read") {
          if (probe.readFails) return fail("mnemos_failed");
          for (const n of kestrel.life.notes)
            if ((write.note_ids as string[]).includes(n.id) && !n.read)
              n.read = at;
          probe.token = `${probe.token}r`;
          return { kind: "read", ids: write.note_ids };
        }
        if (write.command === "hours")
          return {
            kind: "hours",
            said: "Quiet hours are on, a made-up answer.",
          };
        if (write.command === "shared") {
          if (write.action === "add") {
            kestrel.life.shared.rows.unshift({
              id: `kes-s${kestrel.life.shared.rows.length + 1}`,
              content: String(write.text),
              author: "person",
              person: "Pat",
              model: "",
              born: at,
              editable: true,
            });
            probe.token = `${probe.token}s`;
          }
          return { kind: "shared", said: "Kept in the shared notebook." };
        }
        if (write.command === "reply" || write.command === "note") {
          const note = {
            id: `kes-n${kestrel.life.notes.length + 1}`,
            at,
            kind: String(write.command),
            text: String(write.text),
            author: "person",
            model: "",
            replyTo: typeof write.note_id === "string" ? write.note_id : "",
            hour: "",
            delivered: null,
            read: null,
          };
          kestrel.life.notes.unshift(note);
          seen.add(note.id);
          probe.token = `${probe.token}n`;
          return {
            kind: "note",
            note: {
              id: note.id,
              kind: note.kind,
              text: note.text,
              author: "person",
              model: null,
              in_reply_to: note.replyTo || null,
              created_at: at,
              read_at: null,
              delivered_at: null,
            },
          };
        }
        if (write.command === "forget") {
          const m = kestrel.memories.find((x) => x.id === write.memory_id);
          if (!m) return fail("unknown_item");
          const states = kestrel.life.memory.states;
          if (m.state === "active") states.active -= 1;
          if (m.state === "dormant") states.dormant -= 1;
          states.archived += 1;
          m.state = "archived";
          kestrel.version = `${kestrel.version}f`;
          kestrel.life.memory.version = kestrel.version;
          probe.token = `${probe.token}f`;
          return { kind: "forgotten", id: m.id, forgotten: at };
        }
        return fail("invalid_request");
      };
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
            if (m.id in memories)
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
        if (cmd === "mnemos_place_hello")
          return probe.open === "kestrel" && args.mind === "kestrel"
            ? hello
            : null;
        if (cmd === "mnemos_place_picture") {
          const path = String(args.path);
          if (args.mind !== "kestrel" || !listed.has(path) || !pictures[path])
            return fail("unknown_item");
          const bytes = Uint8Array.from(atob(pictures[path]), (c) =>
            c.charCodeAt(0),
          );
          return bytes.buffer;
        }
        if (cmd === "write_mnemos_place" && args.mind === "kestrel") {
          if (probe.open !== "kestrel") return fail("not_open");
          return kestrelWrite(args.write as Record<string, unknown>);
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
          if (mind === "kestrel") return kestrelRead(request);
          // An older Mnemos: the app never sends it the newer reads.
          if (request.command === "summary" || request.command === "notebook")
            return fail(`unexpected ${String(request.command)} to 0.6.7`);
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
    {
      luca: LUCA,
      ori: ORI,
      fault,
      decline,
      kestrel: newer
        ? grown
          ? growKestrel(kestrelNotebook(Date.now()), Date.now())
          : kestrelNotebook(Date.now())
        : null,
      hello: KESTREL_HELLO,
      pictures: PICTURES,
      extra: listMinds,
      wrenLinked,
    },
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
  // The notebook's sections in its order, Settings at the foot; this
  // Mnemos (0.6.7) feeds some of them, and the rest say so when opened.
  expect(rooms).toEqual([
    "At a glance",
    "The mind",
    "Log",
    "Memories124",
    "Shared",
    "Beliefs3",
    "Questions",
    "Journal3",
    // Its threads, as Notes lists them: four notes, one a reply.
    "Notes3",
    "Carrying forward2",
    "Hours",
    "Settings",
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
  // What the eye reads on its row (WP-56: the day without "newest").
  expect((await readRow(page, "field-notes")).seen).toEqual([
    "9 memories · today",
  ]);
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
    "mnemos_place_hello",
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
    /Field Notes’ memory isn’t shown here\. Nothing was read\./,
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
  // Field Notes has no resident: the old reader's plates and sections say
  // what every section today's Mnemos can't give says (WP-51, check 5).
  await expect(
    page.getByTestId("mnemos-plate-beliefs").getByTestId("mnemos-plate-line"),
  ).toHaveText("Beliefs needs a newer Mnemos. Updating Mnemos brings it.");
  await expect(
    page.getByTestId("mnemos-plate-carrying").getByTestId("mnemos-plate-line"),
  ).toHaveText(
    "Carrying forward needs a newer Mnemos. Updating Mnemos brings it.",
  );
  for (const [room, what] of [
    ["beliefs", "Beliefs"],
    ["carrying", "Carrying forward"],
  ]) {
    await rail(page).getByTestId(`place-row-${room}`).locator("button").click();
    await expect(page.getByTestId("mnemos-reader-line")).toHaveText(
      `${what} needs a newer Mnemos. Updating Mnemos brings it.`,
    );
  }
  await rail(page).getByTestId("place-row-shared").locator("button").click();
  await expect(page.getByTestId("mnemos-needs-newer")).toHaveText(
    "Shared needs a newer Mnemos. Updating Mnemos brings it.",
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
  // Into the rail's head, then down its rows with the arrow keys: past
  // At a glance, The mind and the Log to Memories.
  await page.getByTestId("mnemos-rail-mind-button").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
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
  // An answer joins its thread: the rail, counting threads, stays.
  await expect(rail(page).getByTestId("place-row-notes")).toHaveText("Notes3");
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
  // A note of its own starts a thread: one more.
  await expect(rail(page).getByTestId("place-row-notes")).toHaveText("Notes4");
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
  // A correction holds the memory's own words, so it follows them: the
  // window hidden, they go, and the correction with them.
  await page.getByTestId("mnemos-correct-open").click();
  await page.getByTestId("mnemos-correct-text").fill("Hidden, it goes.");
  await setVisible(page, false);
  await setVisible(page, true);
  await expect(page.getByTestId("mnemos-memory-opened")).toBeVisible();
  await expect(page.getByTestId("mnemos-correct-text")).toHaveCount(0);
  // The place left: the same.
  await page.getByTestId("mnemos-correct-open").click();
  await page.getByTestId("mnemos-correct-text").fill("Left, it goes.");
  await page.getByTestId("open-brain-setup").click();
  await expect(page).toHaveURL(/#\/brain/);
  await page.getByTestId("open-mnemos-place").click();
  await expect(page.getByTestId("mnemos-memory-opened")).toBeVisible();
  await expect(page.getByTestId("mnemos-correct-text")).toHaveCount(0);
  await page.getByTestId("mnemos-correct-open").click();
  await expect(page.getByTestId("mnemos-correct-text")).not.toHaveValue(
    /it goes/,
  );
  await page.getByTestId("mnemos-correct-cancel").click();
  // The owner's own words were kept through both.
  await rail(page).getByTestId("place-row-notes").click();
  await expect(page.getByTestId("mnemos-answer-text")).toHaveValue(kept);
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

/* ── WP-48, Part 1: the place on the newer Mnemos ──────────────────── */

/** What the place asked of each mind's engine, by command (a notebook
 *  part by its name). */
async function asked(page: Page, mind: string) {
  return (await probeOf(page)).calls
    .filter(
      (c) =>
        (c.cmd === "read_mnemos_place" || c.cmd === "mnemos_place_hello") &&
        c.args?.mind === mind,
    )
    .map((c) => {
      if (c.cmd === "mnemos_place_hello") return "hello";
      const r = c.args?.request as { command: string; part?: string };
      return r.command === "notebook" ? `notebook:${r.part}` : r.command;
    });
}

test("(48-1) a newer Mnemos and a 0.6.7 one side by side", async ({ page }) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=glance",
    newer: true,
  });
  await expect(page.getByTestId("mnemos-rail-mind-button")).toContainText(
    "Kestrel",
  );
  // The rail: every section, its counts from the summary, Settings at the
  // foot.
  await expect(rail(page).getByTestId("place-row-hours")).toHaveText("Hours3");
  const rows = await rail(page)
    .locator("[data-testid^='place-row-']")
    .evaluateAll((els) => els.map((el) => el.textContent?.trim()));
  expect(rows).toEqual([
    "At a glance",
    "The mind",
    "Log",
    "Memories12",
    "Shared2",
    "Beliefs2",
    "Questions3",
    "Journal3",
    // Its threads: three notes, one a reply.
    "Notes2",
    "Carrying forward2",
    "Hours3",
    "Settings",
  ]);
  // At the foot of the rail's own scroll area, well below Hours.
  const gap = await rail(page).evaluate((el) => {
    let scroller = el.parentElement;
    while (scroller && getComputedStyle(scroller).overflowY !== "auto")
      scroller = scroller.parentElement;
    const foot = el.querySelector("[data-place-section='foot']");
    const hours = el.querySelector("[data-testid='place-row-hours']");
    if (!scroller || !foot || !hours) return null;
    const bottom = scroller.getBoundingClientRect().bottom;
    const footBox = foot.getBoundingClientRect();
    return {
      belowFoot: bottom - footBox.bottom,
      aboveFoot: footBox.top - hours.getBoundingClientRect().bottom,
    };
  });
  expect(gap?.belowFoot).toBeLessThan(24);
  expect(gap?.aboveFoot).toBeGreaterThan(120);
  // At a glance reads from the notebook.
  await expect(card(page)).toContainText(
    "Should the morning note lead with the tide even on calm days?",
  );
  // Only the newer engine's own reads; never the old reader.
  const kestrel = await asked(page, "kestrel");
  expect(new Set(kestrel)).toEqual(
    new Set(["hello", "summary", "notebook:life", "notebook:memories"]),
  );
  const memoriesPage = (await probeOf(page)).calls.find(
    (c) =>
      (c.args?.request as { part?: string } | undefined)?.part === "memories",
  );
  expect((memoriesPage?.args?.request as { limit: number }).limit).toBe(500);
  expect(
    (await probeOf(page)).calls.filter((c) => c.cmd.includes("mnemos_view")),
  ).toEqual([]);
  // Each section of the newer one opens with its words.
  for (const [room, words] of [
    ["memories", "When the wind backs south"],
    ["journal", "The fog lifted by nine."],
    ["notes", "Should the morning note lead with the tide"],
    ["beliefs", "The tide is the first thing Pat wants to know."],
    ["carrying", "Ask Pat whether calm days still lead with the tide."],
    ["shared", "The tide goes first in the morning note."],
    ["questions", "What did the late ferry teach you?"],
    ["hours", "I drew this morning's tide"],
  ] as const) {
    await rail(page).getByTestId(`place-row-${room}`).click();
    await expect(card(page)).toContainText(words);
  }
  // Wren, on 0.6.7: read as before, and a section it can't feed says so.
  await page.getByTestId("mnemos-rail-mind-button").click();
  await page.getByTestId("mnemos-mind-wren").click();
  await expect(page.getByTestId("place-page-state")).toContainText(
    "124 memories",
  );
  await rail(page).getByTestId("place-row-hours").click();
  await expect(page.getByTestId("mnemos-needs-newer")).toHaveText(
    "Hours needs a newer Mnemos. Updating Mnemos brings it.",
  );
  await shot48(page, "09-old-engine-line-dark");
  await rail(page).getByTestId("place-row-journal").click();
  await expect(card(page)).toContainText("A quiet day at the light.");
  const wren = await asked(page, "wren");
  expect(wren).toContain("journal");
  expect(wren).not.toContain("summary");
  expect(wren.some((c) => c.startsWith("notebook"))).toBe(false);
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-1) the token loop reads again only when something shown changed", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=journal",
    newer: true,
  });
  await expect(card(page)).toContainText("The fog lifted by nine.");
  const count = async (what: string) =>
    (await asked(page, "kestrel")).filter((c) => c === what).length;
  // Two summaries five seconds apart; the parts read once.
  await expect
    .poll(() => count("summary"), { timeout: 12_000 })
    .toBeGreaterThanOrEqual(2);
  expect(await count("notebook:life")).toBe(1);
  expect(await count("notebook:memories")).toBe(1);
  // A new journal entry: life again, the memories not.
  await page.evaluate(() =>
    (window as unknown as { mnemosBump: (m?: boolean) => void }).mnemosBump(),
  );
  await expect(card(page)).toContainText("A new entry, number 1.", {
    timeout: 12_000,
  });
  expect(await count("notebook:life")).toBe(2);
  expect(await count("notebook:memories")).toBe(1);
  // A new memory: a new version, and the memories again.
  await page.evaluate(() =>
    (window as unknown as { mnemosBump: (m?: boolean) => void }).mnemosBump(
      true,
    ),
  );
  await expect
    .poll(() => count("notebook:memories"), { timeout: 12_000 })
    .toBe(2);
  await expect(rail(page).getByTestId("place-row-memories")).toHaveText(
    "Memories13",
  );
  // Hidden, nothing is asked.
  await setVisible(page, false);
  const before = await count("summary");
  await page.waitForTimeout(6_000);
  expect(await count("summary")).toBe(before);
  expect(consoleClean(errors)).toEqual([]);
});

/* ── WP-48, Part 2: the reading sections on the newer Mnemos ───────── */

/** The writes the place sent Kestrel's engine. */
async function kestrelWrites(page: Page) {
  return (await probeOf(page)).calls
    .filter((c) => c.cmd === "write_mnemos_place" && c.args?.mind === "kestrel")
    .map((c) => c.args?.write as { command: string; note_ids?: string[] });
}

/** A visit to Kestrel three days ago, so what formed since is New. */
async function visitedKestrel(page: Page) {
  await page.addInitScript(() => {
    const seen = Date.now() - 3 * 24 * 3600_000;
    window.localStorage.setItem(
      "luca.mnemos.visit.kestrel",
      JSON.stringify({ since: 0, seen }),
    );
  });
}

const memoryRows = (page: Page) =>
  page
    .getByTestId("mnemos-memories-list")
    .locator("[data-memory]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-memory")));

for (const mode of ["dark", "light"] as const)
  test(`(48-2) the Log: its days, each line opening its thing (${mode})`, async ({
    page,
  }) => {
    const errors = await boot(page, {
      hash: "/mnemos?mind=kestrel&room=log",
      mode,
      newer: true,
    });
    // Today opens by itself: its hour, its journal, its note, what it left
    // itself, and the memories formed.
    const day = page.getByTestId("mnemos-log-day");
    await expect(day).toBeVisible();
    await expect(day.getByLabel("Today")).toBeVisible();
    await expect(day.getByTestId("mnemos-log-event-hour-kes-h1")).toContainText(
      "Its own hour",
    );
    await expect(
      day.getByTestId("mnemos-log-event-journal-kes-j1"),
    ).toContainText("The fog lifted by nine.");
    await expect(day.getByTestId("mnemos-log-event-note-kes-n1")).toContainText(
      "not yet read",
    );
    await expect(
      day.locator("[data-log-event^='left-#left-']").first(),
    ).toContainText("Ask Pat whether calm days");
    await expect(
      day.getByTestId("mnemos-log-event-formed-kes-m11"),
    ).toContainText("Memory formed");
    // Newest first.
    const times = await day
      .locator("[data-log-event]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-log-event")));
    expect(times.indexOf("hour-kes-h1")).toBeLessThan(
      times.indexOf("formed-kes-m11"),
    );
    // The hour says its span on a line of its own, and what it wrote in
    // it sits inside it, one step in, newest first.
    await expect(day.getByTestId("mnemos-log-span-kes-h1")).toHaveText(
      /^\d{1,2}:\d\d( [AP]M)? to \d{1,2}:\d\d [AP]M$/,
    );
    const inside = day.getByTestId("mnemos-log-inside-kes-h1");
    await expect(
      inside.getByTestId("mnemos-log-event-journal-kes-j1"),
    ).toBeVisible();
    await expect(
      inside.getByTestId("mnemos-log-event-note-kes-n1"),
    ).toBeVisible();
    const step = await inside.evaluate((el) => {
      const hourRow = el.parentElement?.querySelector(".luca-place-row");
      const first = el.querySelector(".luca-place-row");
      return {
        indent:
          (first?.getBoundingClientRect().left ?? 0) -
          (hourRow?.getBoundingClientRect().left ?? 0),
        rule: getComputedStyle(el).borderLeftWidth,
      };
    });
    expect(step.indent).toBeGreaterThanOrEqual(16);
    expect(step.rule).toBe("1px");
    // No time on the day's top level runs backwards.
    const top = await day
      .locator("[data-testid='mnemos-log-events'] .luca-place-plate > *")
      .evaluateAll((els) =>
        els.map((el) => Date.parse(el.getAttribute("data-at") ?? "")),
      );
    expect(top.every((t) => !Number.isNaN(t))).toBe(true);
    expect(top).toEqual([...top].sort((a, b) => b - a));
    // A day's summary wraps whole, never cut.
    const cut = await page
      .getByTestId("mnemos-log-list")
      .locator(".luca-place-row-summary")
      .evaluateAll(
        (els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length,
      );
    expect(cut).toBe(0);
    // Earlier days are listed with what they hold.
    await expect(
      page.getByTestId("mnemos-log-list").locator("li").nth(1),
    ).toContainText(/memor|hour|journal|note|answer|belief/);
    if (mode === "light") {
      await shot48(page, "11-log-light");
      expect(consoleClean(errors)).toEqual([]);
      return;
    }
    await shot48(page, "04-log-dark");
    // Each line opens its thing in its own section.
    await day.getByTestId("mnemos-log-event-journal-kes-j1").click();
    await expect(page).toHaveURL(/room=journal&item=kes-j1/);
    await expect(page.getByTestId("mnemos-entry-opened")).toContainText(
      "The fog lifted by nine.",
    );
    await page.goBack();
    await page.getByTestId("mnemos-log-event-hour-kes-h1").click();
    await expect(page).toHaveURL(/room=hours&item=kes-h1/);
    await expect(page.getByTestId("mnemos-hour-opened")).toBeVisible();
    await page.goBack();
    await page.getByTestId("mnemos-log-event-note-kes-n1").click();
    await expect(page).toHaveURL(/room=notes&item=kes-n1/);
    await expect(page.getByTestId("mnemos-thread-opened")).toContainText(
      "Should the morning note lead with the tide",
    );
    await page.goBack();
    await page.locator("[data-log-event^='left-#left-']").first().click();
    await expect(page).toHaveURL(/room=carrying&item=(%23|#)left-/);
    await expect(page.getByTestId("mnemos-carry-opened")).toContainText(
      "Ask Pat whether calm days",
    );
    await page.goBack();
    await page.getByTestId("mnemos-log-event-formed-kes-m11").click();
    await expect(page).toHaveURL(/room=memories&item=kes-m11/);
    await expect(page.getByTestId("mnemos-memory-opened")).toBeVisible();
    // A day further back: a belief change and an answer, each opening.
    await page.goBack();
    await page
      .getByTestId("mnemos-log-list")
      .getByText(/belief change/)
      .first()
      .click();
    await page.locator("[data-log-event^='belief-#belief-']").first().click();
    await expect(page).toHaveURL(/room=beliefs&item=(%23|#)belief-/);
    await expect(page.getByTestId("mnemos-belief-opened")).toContainText(
      "The tide is the first thing Pat wants to know.",
    );
    // Nothing was read again for any of it.
    const asks = await asked(page, "kestrel");
    expect(asks.filter((a) => a === "notebook:memories")).toHaveLength(1);
    expect(asks.filter((a) => a === "memories" || a === "search")).toEqual([]);
    expect(await kestrelWrites(page)).toEqual([]);
    expect(consoleClean(errors)).toEqual([]);
  });

test("(48-2) Memories: the notebook's filters and orders, without asking", async ({
  page,
}) => {
  await visitedKestrel(page);
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=memories",
    newer: true,
  });
  await expect(page.getByTestId("mnemos-memories-count")).toHaveText(
    "12 memories",
  );
  const options = await page
    .getByTestId("mnemos-filter")
    .locator("option")
    .evaluateAll((els) => els.map((el) => el.textContent?.trim()));
  expect(options).toEqual([
    "All (12)",
    "New (2)",
    "Warm (3)",
    "Lessons (1)",
    "Standing (2)",
    "Asked about (2)",
    "Gone quiet (1)",
    "By colleagues (2)",
  ]);
  // One quiet row: the filter's menu, the order's, the count.
  const row = await page.evaluate(() =>
    ["mnemos-filter", "mnemos-sort", "mnemos-memories-count"].map((id) => {
      const el = document.querySelector(`[data-testid='${id}']`);
      const box = (el?.closest("label") ?? el)?.getBoundingClientRect();
      return box ? Math.round(box.top + box.height / 2) : -1;
    }),
  );
  expect(Math.max(...row) - Math.min(...row)).toBeLessThanOrEqual(3);
  await expect(page.locator(".luca-mnemos-menu-shown").first()).toHaveText(
    "All",
  );
  // A memory's tags wrap whole, never cut.
  expect(
    await page
      .getByTestId("mnemos-memories-list")
      .locator(".luca-place-row-summary")
      .evaluateAll(
        (els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length,
      ),
  ).toBe(0);
  expect((await memoryRows(page))[0]).toBe("kes-m11");
  await shot48(page, "05-memories-filters-dark");
  const pick = async (id: string) => {
    await page.getByTestId("mnemos-filter").selectOption(id);
    await expect(page.getByTestId("mnemos-filter")).toHaveValue(id);
    return memoryRows(page);
  };
  expect(await pick("new")).toEqual(["kes-m11", "kes-m10"]);
  expect(await pick("lessons")).toEqual(["kes-m05"]);
  await expect(page.getByTestId("mnemos-memories-count")).toHaveText(
    "1 of 12 memories",
  );
  // The menu says what it shows.
  await expect(page.locator(".luca-mnemos-menu-shown").first()).toHaveText(
    "Lessons",
  );
  expect(await pick("standing")).toEqual(["kes-m07", "kes-m01"]);
  expect(await pick("asked")).toEqual(["kes-m10", "kes-m04"]);
  expect(await pick("quiet")).toEqual(["kes-m08"]);
  expect(await pick("colleagues")).toEqual(["kes-m11", "kes-m03"]);
  const warm = await pick("warm");
  expect(warm).toEqual(
    expect.arrayContaining(["kes-m01", "kes-m04", "kes-m05"]),
  );
  await expect(page.getByTestId("mnemos-memory-kes-m05")).toContainText(
    "warm from its hours",
  );
  await pick("all");
  await page.getByTestId("mnemos-sort").selectOption("recalled");
  expect((await memoryRows(page))[0]).toBe("kes-m03");
  await page.getByTestId("mnemos-sort").selectOption("oldest");
  expect((await memoryRows(page))[0]).toBe("kes-m00");
  await page.getByTestId("mnemos-sort").selectOption("connected");
  expect(["kes-m01"]).toContain((await memoryRows(page))[0]);
  await page.getByTestId("mnemos-sort").selectOption("easiest");
  expect((await memoryRows(page)).at(-1)).toBe("kes-m08");
  // All of it from the notebook as read: no page, no search asked.
  const asks = await asked(page, "kestrel");
  expect(asks.filter((a) => a === "notebook:memories")).toHaveLength(1);
  expect(asks.filter((a) => a === "memories" || a === "search")).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-2) an opened memory: its readings, ties, beliefs, hours and questions", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=memories&item=kes-m01",
    newer: true,
  });
  const opened = page.getByTestId("mnemos-memory-opened");
  const readings = opened.getByTestId("mnemos-memory-readings");
  await expect(readings).toHaveText(
    "strength0.60stability0.50reach0.47links2recalled7×",
  );
  await expect(opened.getByTestId("mnemos-memory-line")).toContainText(
    "signed Kestrel",
  );
  const ties = opened.getByTestId("mnemos-memory-ties");
  await expect(ties.getByTestId("mnemos-memory-tie-kes-m05")).toContainText(
    "a lesson distilled from it",
  );
  await expect(ties.getByTestId("mnemos-memory-tie-kes-m04")).toContainText(
    "came back together",
  );
  await expect(opened.getByTestId("mnemos-memory-beliefs")).toContainText(
    "The tide is the first thing Pat wants to know.",
  );
  await expect(opened.getByTestId("mnemos-memory-hours")).toContainText(
    "Its own hour: reached for it",
  );
  await expect(opened.getByTestId("mnemos-memory-questions")).toHaveCount(0);
  await shot48(page, "06-memory-full-detail-dark");
  // A colleague's is named as one; its questions are listed.
  await ties.getByTestId("mnemos-memory-tie-kes-m04").click();
  await expect(page).toHaveURL(/item=kes-m04/);
  await expect(opened.getByTestId("mnemos-memory-questions")).toContainText(
    "What did the late ferry teach you?",
  );
  await page.goto("/#/mnemos?mind=kestrel&room=memories&item=kes-m03");
  await expect(page.getByTestId("mnemos-memory-line")).toContainText(
    "written by Sonnet 5, a colleague",
  );
  await page.goto("/#/mnemos?mind=kestrel&room=memories&item=kes-m01");
  // Each opens its thing: the belief, the hour.
  await page
    .getByTestId("mnemos-memory-beliefs")
    .getByText("The tide is the first thing Pat wants to know.")
    .click();
  await expect(page).toHaveURL(/room=beliefs&item=(%23|#)belief-/);
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-2) Beliefs: how firmly, what each rests on, its history", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=beliefs",
    newer: true,
  });
  const opened = page.getByTestId("mnemos-belief-opened");
  await expect(opened).toContainText(
    "The tide is the first thing Pat wants to know.",
  );
  // Its line agrees with what's under it: two memories, both its own.
  await expect(opened.getByTestId("mnemos-belief-line")).toContainText(
    "Held at 84% · rests on two memories of its own",
  );
  await expect(opened.getByTestId("mnemos-belief-rests")).toContainText(
    "What it rests on2",
  );
  const width = await opened
    .getByTestId("mnemos-belief-held")
    .evaluate((el) => {
      const bar = el.querySelector("i");
      return bar
        ? bar.getBoundingClientRect().width / el.getBoundingClientRect().width
        : 0;
    });
  expect(width).toBeCloseTo(0.84, 2);
  await expect(opened.getByTestId("mnemos-belief-history")).toContainText(
    "From 72% to 84%",
  );
  await expect(opened.getByTestId("mnemos-belief-history")).toContainText(
    "From 60% to 72%",
  );
  await expect(page.getByTestId("mnemos-beliefs-list")).toContainText(
    "held at 58%",
  );
  await shot48(page, "07-beliefs-dark");
  await opened.getByTestId("mnemos-belief-rests-kes-m05").click();
  await expect(page).toHaveURL(/room=memories&item=kes-m05/);
  await expect(page.getByTestId("mnemos-memory-opened")).toBeVisible();
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-2) Questions: open ones by kind, answered ones with the answer, read only", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=questions",
    newer: true,
  });
  await expect(page.getByTestId("mnemos-question-opened")).toBeVisible();
  const labels = await page
    .getByTestId("mnemos-questions-list")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(labels).toEqual([
    "What did it teach?",
    "Is it still true?",
    "What did it change?",
    "Answered",
  ]);
  const opened = page.getByTestId("mnemos-question-opened");
  await expect(opened).toContainText("What did the late ferry teach you?");
  await expect(opened).toContainText("put to it");
  await expect(
    page.getByTestId("mnemos-questions").getByRole("textbox"),
  ).toHaveCount(0);
  await shot48(page, "08-questions-dark");
  await page
    .locator("[data-testid^='mnemos-questions-row-#answered-']")
    .filter({ hasText: "Still true: one short note" })
    .click();
  await expect(page.getByTestId("mnemos-answered-opened")).toContainText(
    "Still true. Pat said so again last week.",
  );
  await expect(
    page.getByTestId("mnemos-questions").getByRole("textbox"),
  ).toHaveCount(0);
  await page.getByTestId("mnemos-question-about-kes-m07").click();
  await expect(page).toHaveURL(/room=memories&item=kes-m07/);
  expect(await kestrelWrites(page)).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-2) Journal names model and mood; Carrying forward is life.handoffs", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=journal&item=kes-j2",
    newer: true,
  });
  const line = page.getByTestId("mnemos-entry-line");
  await expect(line).toContainText("mood, in its words: patient");
  await expect(line).toContainText("Sonnet 5, a colleague");
  await page.getByTestId("mnemos-entry-kes-j1").click();
  await expect(line).toContainText("mood, in its words: clear");
  await expect(line).toContainText("signed Opus 5.5");
  await rail(page).getByTestId("place-row-carrying").click();
  const rows = page.getByTestId("mnemos-carrying-list").locator("li");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Ask Pat whether calm days");
  await expect(rows.nth(0)).toContainText("the note it left itself");
  await expect(rows.nth(1)).toContainText("left by Sonnet 5, a colleague");
  // From the notebook, never the old reader.
  expect(
    (await probeOf(page)).calls.filter((c) => c.cmd === "read_mnemos_view"),
  ).toEqual([]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-2) a note is read after 1.2 s on screen, once touched, never hidden", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=notes&item=kes-n1",
    newer: true,
  });
  const dot = page.getByTestId("mnemos-note-unread-kes-n1");
  await expect(dot).toBeVisible();
  // On screen, but nobody has touched the page: nothing is read.
  await page.waitForTimeout(2_500);
  expect(await kestrelWrites(page)).toEqual([]);
  // Touched, then hidden before 1.2 s: still nothing.
  await page.mouse.move(700, 400);
  await setVisible(page, false);
  await page.waitForTimeout(2_500);
  expect(await kestrelWrites(page)).toEqual([]);
  // Back on screen: read 1.2 s later, once, in one write.
  await setVisible(page, true);
  const back = Date.now();
  await expect
    .poll(async () => (await kestrelWrites(page)).length, { timeout: 6_000 })
    .toBe(1);
  expect(Date.now() - back).toBeGreaterThanOrEqual(1_200);
  expect(await kestrelWrites(page)).toEqual([
    { command: "read", note_ids: ["kes-n1"] },
  ]);
  await expect(dot).toBeHidden();
  await page.mouse.move(600, 300);
  await page.waitForTimeout(2_000);
  expect(await kestrelWrites(page)).toHaveLength(1);
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-2) keyboard through the Log, Memories, Beliefs and Questions", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=log",
    newer: true,
  });
  const tabTo = async (match: (el: Element | null) => boolean, limit = 80) => {
    for (let i = 0; i < limit; i++) {
      if (await page.evaluate(match, null).catch(() => false)) return;
      await page.keyboard.press("Tab");
    }
    throw new Error("never reached");
  };
  // The Log: a day's line, by Tab, opens the journal entry.
  await page.getByTestId("mnemos-log-day").waitFor();
  await page.getByTestId("mnemos-rail-mind-button").focus();
  await tabTo(
    () =>
      !!document.activeElement?.closest(
        "[data-testid='mnemos-log-event-journal-kes-j1']",
      ),
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/room=journal&item=kes-j1/);
  // Memories: a filter and an order by keyboard alone.
  await page.goto("/#/mnemos?mind=kestrel&room=memories");
  await page.getByTestId("mnemos-memories-list").waitFor();
  await page.getByTestId("mnemos-search").focus();
  await tabTo(
    () =>
      document.activeElement?.getAttribute("data-testid") === "mnemos-filter",
  );
  await page.keyboard.type("L");
  await expect(page.getByTestId("mnemos-filter")).toHaveValue("lessons");
  await expect.poll(() => memoryRows(page)).toEqual(["kes-m05"]);
  // A fresh type-ahead (the platform's waits a moment between words).
  await page.waitForTimeout(1_200);
  await page.keyboard.type("All");
  await expect(page.getByTestId("mnemos-filter")).toHaveValue("all");
  await tabTo(
    () => document.activeElement?.getAttribute("data-testid") === "mnemos-sort",
  );
  await page.keyboard.type("O");
  await expect(page.getByTestId("mnemos-sort")).toHaveValue("oldest");
  await expect.poll(async () => (await memoryRows(page))[0]).toBe("kes-m00");
  // Beliefs: what it rests on, by Tab and Enter.
  await page.goto("/#/mnemos?mind=kestrel&room=beliefs");
  await page.getByTestId("mnemos-belief-opened").waitFor();
  await page.getByTestId("mnemos-rail-mind-button").focus();
  await tabTo(
    () =>
      !!document.activeElement?.closest(
        "[data-testid='mnemos-belief-rests-kes-m01']",
      ),
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/room=memories&item=kes-m01/);
  // Questions: the memory a question is about.
  await page.goto("/#/mnemos?mind=kestrel&room=questions");
  await page.getByTestId("mnemos-question-opened").waitFor();
  await page.getByTestId("mnemos-rail-mind-button").focus();
  await tabTo(
    () =>
      !!document.activeElement?.closest(
        "[data-testid='mnemos-question-about-kes-m04']",
      ),
  );
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/room=memories&item=kes-m04/);
  expect(consoleClean(errors)).toEqual([]);
});

/* ── WP-48, round 2: the check's findings ──────────────────────────── */

test("(48-r2) a note opened from the Log, or by its address, comes into view, marked a moment", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=log",
    newer: true,
    grown: true,
  });
  // The day of the long thread, and its thirteenth reply.
  await page
    .getByTestId("mnemos-log-list")
    .locator("li")
    .filter({ hasText: "16 notes" })
    .click();
  await page.getByTestId("mnemos-log-event-note-kes-r13").click();
  await expect(page).toHaveURL(/room=notes&item=kes-r13/);
  const thread = page.getByTestId("mnemos-thread-opened");
  const asked = thread.locator("li[data-note='kes-r13']");
  await expect(asked).toHaveAttribute("data-marked", "");
  await expect(asked).toHaveAttribute("aria-current", "true");
  await expect(asked).toBeInViewport();
  // The thread opened at that note, not at its first.
  await expect(thread.locator("li[data-note='kes-n2']")).not.toBeInViewport();
  await shot48(page, "12-note-into-view-dark");
  // Marked for a moment only.
  await expect(asked).not.toHaveAttribute("data-marked", "", {
    timeout: 4_000,
  });
  // Its thread is the one the list shows opened.
  await expect(page.getByTestId("mnemos-thread-kes-n2")).toHaveAttribute(
    "aria-current",
    "true",
  );
  // By its address, from a fresh start: the same.
  await page.goto(
    page.url().replace(/#.*$/, "#/mnemos?mind=kestrel&room=notes&item=kes-r07"),
  );
  const seventh = page
    .getByTestId("mnemos-thread-opened")
    .locator("li[data-note='kes-r07']");
  await expect(seventh).toBeInViewport();
  await expect(seventh).toHaveAttribute("aria-current", "true");
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-r2) a filter or order that leaves the opened memory out opens the first, in place", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=memories",
    newer: true,
  });
  await expect(page).toHaveURL(/item=kes-m11/);
  await page.getByTestId("mnemos-memory-kes-m02").click();
  await expect(page).toHaveURL(/item=kes-m02/);
  const steps = await page.evaluate(() => history.length);
  // Lessons holds only kes-m05: kes-m02 closes, and the lesson opens.
  await page.getByTestId("mnemos-filter").selectOption("lessons");
  await expect(page).toHaveURL(/item=kes-m05/);
  await expect(page.getByTestId("mnemos-memory-opened")).toContainText(
    "Lesson: write the tide first",
  );
  await expect(page.getByTestId("mnemos-memory-kes-m05")).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(await page.evaluate(() => history.length)).toBe(steps);
  // Still in the list after an order or All: it stays open.
  await page.getByTestId("mnemos-sort").selectOption("oldest");
  await page.getByTestId("mnemos-filter").selectOption("all");
  await expect(page).toHaveURL(/item=kes-m05/);
  expect(await page.evaluate(() => history.length)).toBe(steps);
  // Back steps over none of it: to the memory opened before.
  await page.goBack();
  await expect(page).toHaveURL(/item=kes-m11/);
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-r2) ties: Show N more shows the rest in place, each openable", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=memories&item=kes-m02",
    newer: true,
    grown: true,
  });
  const ties = page.getByTestId("mnemos-memory-ties");
  await expect(
    ties.locator("[data-testid^='mnemos-memory-tie-kes-']"),
  ).toHaveCount(24);
  const more = page.getByTestId("mnemos-memory-ties-more");
  await expect(more).toHaveText("Show 6 more");
  await more.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveCount(0);
  await expect(
    ties.locator("[data-testid^='mnemos-memory-tie-kes-']"),
  ).toHaveCount(30);
  // Focus is on the first of the rest, where the button was.
  await expect(
    page.getByTestId("mnemos-memory-tie-kes-g24").getByRole("button"),
  ).toBeFocused();
  await page.getByTestId("mnemos-memory-tie-kes-g29").click();
  await expect(page).toHaveURL(/item=kes-g29/);
  await expect(page.getByTestId("mnemos-memory-opened")).toContainText(
    "A harbour fact, number 30.",
  );
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-r2) the head and the rail say one number, after a change too", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=memories",
    newer: true,
  });
  const head = page.getByTestId("place-page-head");
  const row = rail(page).getByTestId("place-row-memories");
  await expect(head).toContainText("12 memories it can reach");
  await expect(row).toHaveText("Memories12");
  // A new memory, read on the next turn of the token loop.
  await page.evaluate(() =>
    (window as unknown as { mnemosBump: (m?: boolean) => void }).mnemosBump(
      true,
    ),
  );
  await expect(row).toHaveText("Memories13", { timeout: 12_000 });
  await expect(head).toContainText("13 memories it can reach");
  // One let go here: both at once.
  await page.getByTestId("mnemos-memory-kes-m02").click();
  await page.getByTestId("mnemos-let-go-open").click();
  await page.getByTestId("mnemos-let-go-yes").click();
  await expect(row).toHaveText("Memories12");
  await expect(head).toContainText("12 memories it can reach");
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-r2) a read that fails leaves the note unread, not asked again at once; the next sight tries again", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=notes&item=kes-n1",
    newer: true,
  });
  await page.evaluate(() => {
    (window as unknown as { mnemosProbe: Probe }).mnemosProbe.readFails = true;
  });
  const dot = page.getByTestId("mnemos-note-unread-kes-n1");
  await expect(dot).toBeVisible();
  await page.mouse.move(700, 400);
  await expect
    .poll(async () => (await kestrelWrites(page)).length, { timeout: 6_000 })
    .toBe(1);
  // Unread still, and while it sits on screen, never asked again.
  await expect(dot).toBeVisible();
  await page.waitForTimeout(5_000);
  expect(await kestrelWrites(page)).toHaveLength(1);
  // The next sight (the window hidden and shown again) tries once more.
  await page.evaluate(() => {
    (window as unknown as { mnemosProbe: Probe }).mnemosProbe.readFails = false;
  });
  await setVisible(page, false);
  await setVisible(page, true);
  await expect
    .poll(async () => (await kestrelWrites(page)).length, { timeout: 6_000 })
    .toBe(2);
  await expect(dot).toBeHidden();
  expect(await kestrelWrites(page)).toEqual([
    { command: "read", note_ids: ["kes-n1"] },
    { command: "read", note_ids: ["kes-n1"] },
  ]);
  expect(consoleClean(errors)).toEqual([]);
});

test("(48-r2) a memory's tags use the row's whole width; no separator ends a line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await visitedKestrel(page);
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=memories",
    newer: true,
  });
  const list = page.getByTestId("mnemos-memories-list");
  await expect(list.getByTestId("mnemos-memory-tags").first()).toBeVisible();
  const rows = await list.locator(".luca-place-row").evaluateAll((els) =>
    els.map((row) => {
      const what = row.querySelector(".luca-place-row-what");
      const note = row.querySelector(".luca-place-row-note");
      const tags = row.querySelector(".luca-mnemos-tags");
      const title = row.querySelector(".luca-place-row-title");
      const box = (el: Element | null) => el?.getBoundingClientRect();
      const left = box(tags)?.left ?? 0;
      const spans = tags ? [...tags.children] : [];
      return {
        rowWidth: box(row)?.width ?? 0,
        whatWidth: box(what)?.width ?? 0,
        // Where the title's words end, not its box.
        titleRight: (() => {
          if (!title) return 0;
          const range = document.createRange();
          range.selectNodeContents(title);
          return Math.max(
            0,
            ...[...range.getClientRects()].map((rect) => rect.right),
          );
        })(),
        noteLeft: box(note)?.left ?? 0,
        tagsWidth: box(tags)?.width ?? null,
        clips: tags ? getComputedStyle(tags).overflow : null,
        // Each tag whole, its words only; the first on each line starts
        // at the row's edge, its separator outside what is shown.
        words: spans.map((t) => t.textContent ?? ""),
        lineStarts: spans.filter(
          (t) => Math.abs(t.getBoundingClientRect().left - left) < 1,
        ).length,
        lines: new Set(
          spans.map((t) => Math.round(t.getBoundingClientRect().top)),
        ).size,
      };
    }),
  );
  const tagged = rows.filter((r) => r.tagsWidth !== null);
  expect(tagged.length).toBeGreaterThan(3);
  for (const r of rows) {
    // The words span the row; the title stops short of the day.
    expect(r.whatWidth).toBeGreaterThanOrEqual(r.rowWidth - 21);
    expect(r.titleRight).toBeLessThanOrEqual(r.noteLeft);
  }
  for (const r of tagged) {
    expect(r.tagsWidth).toBeGreaterThanOrEqual(r.rowWidth - 21);
    expect(r.clips).toBe("hidden");
    expect(r.words.every((w) => !w.includes("·"))).toBe(true);
    expect(r.lineStarts).toBe(r.lines);
  }
  await shot48(page, "13-memory-tags-dark");
  expect(consoleClean(errors)).toEqual([]);
});

/* ── WP-51: the place, joined ──────────────────────────────────────── */

/** A whole-window picture for WP-51, its hash. */
async function shot51(page: Page, name: string) {
  await waitForAnimations(page);
  await page.waitForTimeout(400);
  mkdirSync(SHOTS51, { recursive: true });
  const path = `${SHOTS51}/${name}.png`;
  await page.screenshot({ path });
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function measure51(key: string, value: unknown) {
  mkdirSync(`${SHOTS51}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS51}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

for (const mode of ["dark", "light"] as const)
  test(`(51) an opened memory: its own drawing above its words, and the way to the mind (${mode})`, async ({
    page,
  }) => {
    const errors = await boot(page, {
      hash: "/mnemos?mind=kestrel&room=memories&item=kes-m01",
      mode,
      newer: true,
    });
    const opened = page.getByTestId("mnemos-memory-opened");
    const drawing = opened.getByTestId("mnemos-memory-drawing");
    await expect(drawing).toHaveAttribute("role", "img");
    await expect(drawing).toHaveAttribute("aria-label", /\S/);
    // Small, at the left, above the words; drawn in their ink.
    const place = await opened.evaluate((el) => {
      const d = el
        .querySelector("[data-testid='mnemos-memory-drawing']")
        ?.getBoundingClientRect();
      const w = el.querySelector(".luca-mnemos-words");
      const words = w?.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const ink = (x: Element | null | undefined) =>
        x ? getComputedStyle(x).color : "";
      return {
        size: d ? [Math.round(d.width), Math.round(d.height)] : null,
        left: d ? Math.round(d.left - box.left) : -1,
        above: d && words ? words.top - d.bottom : -1,
        sameInk:
          ink(
            el.querySelector("[data-testid='mnemos-memory-drawing']")
              ?.parentElement,
          ) === ink(w),
      };
    });
    expect(place.size).toEqual([56, 56]);
    expect(place.left).toBeLessThanOrEqual(1);
    expect(place.above).toBeGreaterThan(0);
    expect(place.sameInk).toBe(true);
    await expect
      .poll(async () =>
        opened.evaluate((el) => {
          const c = el.querySelector(
            "[data-testid='mnemos-memory-drawing']",
          ) as HTMLCanvasElement | null;
          const ctx = c?.getContext("2d");
          if (!c || !ctx || !c.width) return 0;
          const px = ctx.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < px.length; i += 4) if ((px[i] ?? 0) > 0) n++;
          return n;
        }),
      )
      .toBeGreaterThan(50);
    // "See it in the mind" sits with its quiet line.
    const link = page.getByTestId("mnemos-memory-to-mind");
    await expect(link).toHaveText("See it in the mind");
    await expect(page.getByTestId("mnemos-memory-line")).toContainText(
      "See it in the mind",
    );
    await page.waitForTimeout(900);
    const hash = await shot51(
      page,
      mode === "dark"
        ? "01-memory-with-drawing"
        : "06-memory-with-drawing-light",
    );
    measure51(`drawing-${mode}`, { ...place, hash });
    if (mode === "dark") {
      await link.click();
      await expect(page).toHaveURL(/room=mind&item=kes-m01/);
    }
    expect(consoleClean(errors)).toEqual([]);
  });

test("(51) on today's Mnemos: no drawing, no way to the mind", async ({
  page,
}) => {
  const errors = await boot(page, { hash: "/mnemos?room=memories" });
  await expect(page.getByTestId("mnemos-memory-opened")).toBeVisible();
  await expect(page.getByTestId("mnemos-memory-drawing")).toHaveCount(0);
  await expect(page.getByTestId("mnemos-memory-to-mind")).toHaveCount(0);
  expect(consoleClean(errors)).toEqual([]);
});

test("(51) The mind's own mark in the rail", async ({ page }) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=glance",
    newer: true,
  });
  const face = (id: string) =>
    rail(page)
      .getByTestId(`place-row-${id}`)
      .locator(".luca-rail-face svg")
      .getAttribute("class");
  await expect(rail(page).getByTestId("place-row-mind")).toBeVisible();
  expect(await face("mind")).toContain("lucide-waypoints");
  expect(await face("glance")).not.toContain("lucide-waypoints");
  await shot51(page, "03-rail-with-mind-icon");
  expect(consoleClean(errors)).toEqual([]);
});

/** Lately's rows on today's board: how many lines each shows, whether a
 *  word is split across two showing lines, and whether any is cut short
 *  with an ellipsis. */
async function latelyFacts(page: Page) {
  return page.getByTestId("mnemos-plate-lately").evaluate((plate) =>
    [...plate.querySelectorAll<HTMLElement>(".luca-mnemos-clamp")].map((el) => {
      const s = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const line = Number.parseFloat(s.lineHeight);
      const text = el.firstChild;
      // A word across two showing lines draws as two boxes there.
      let split = 0;
      let long = 0;
      if (text?.nodeType === Node.TEXT_NODE) {
        const words = (text.textContent ?? "").matchAll(/\S+/g);
        for (const w of words) {
          const r = document.createRange();
          r.setStart(text, w.index ?? 0);
          r.setEnd(text, (w.index ?? 0) + w[0].length);
          const shown = [...r.getClientRects()].filter(
            (x) => x.top < box.bottom - 1 && x.bottom > box.top + 1,
          );
          const lines = new Set(shown.map((x) => Math.round(x.top)));
          // A word wider than the line may break; it's counted apart.
          const wide = [...r.getClientRects()].reduce(
            (sum, x) => sum + x.width,
            0,
          );
          if (lines.size > 1) {
            if (wide > box.width) long++;
            else split++;
          }
        }
      }
      return {
        text: (el.textContent ?? "").slice(0, 40),
        ellipsis: s.textOverflow === "ellipsis",
        clamp: s.webkitLineClamp,
        lines: Math.round(box.height / line),
        wholeLines:
          Math.abs(box.height / line - Math.round(box.height / line)) < 0.05,
        split,
        long,
        widerThanPlate: el.scrollWidth > el.clientWidth + 1,
      };
    }),
  );
}

test("(51) today's board: Lately in at most two lines, ending on a whole word", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  const errors = await boot(page);
  const lately = page.getByTestId("mnemos-plate-lately");
  await expect(lately.locator("li")).toHaveCount(5);
  const facts = await latelyFacts(page);
  for (const f of facts) {
    expect(f.ellipsis, f.text).toBe(false);
    expect(f.clamp, f.text).toBe("none");
    expect(f.lines, f.text).toBeLessThanOrEqual(2);
    expect(f.wholeLines, f.text).toBe(true);
    expect(f.split, f.text).toBe(0);
  }
  expect(facts.some((f) => f.lines > 1)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot51(page, "04-old-board-lately");

  // One very long word: two lines of it, cut clean at the line's edge,
  // and the other plates stay on the first screen.
  const long = `${"W".repeat(300)} and the rest of the line`;
  await rail(page).getByTestId("place-row-journal").locator("button").click();
  await page.evaluate((text) => {
    (window as unknown as { mnemosText: (text: string) => void }).mnemosText(
      text,
    );
  }, long);
  await page.getByTestId("mnemos-rail-mind-button").click();
  await page.getByTestId("mnemos-mind-field-notes").click();
  await page.getByTestId("mnemos-rail-mind-button").click();
  await page.getByTestId("mnemos-mind-wren").click();
  await rail(page).getByTestId("place-row-glance").locator("button").click();
  await expect(lately.locator("li").first()).toContainText("WWWW");
  const stretched = await latelyFacts(page);
  for (const f of stretched) {
    expect(f.lines, f.text).toBeLessThanOrEqual(2);
    expect(f.wholeLines, f.text).toBe(true);
    expect(f.split, f.text).toBe(0);
    expect(f.widerThanPlate, f.text).toBe(false);
  }
  expect(stretched[0]?.long).toBe(1);
  const firstScreen = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "[data-testid='mnemos-glance'] > .luca-mnemos-plate",
      ),
    ].map((p) => ({
      id: p.dataset.testid,
      top: Math.round(p.getBoundingClientRect().top),
    })),
  );
  for (const p of firstScreen) expect(p.top, p.id).toBeLessThan(900);
  await shot51(page, "08-old-board-long-word");
  measure51("old-board-lately", { facts, stretched, firstScreen });
  expect(consoleClean(errors)).toEqual([]);
});

test("(51) an hour by its address: from the Log and from a memory, that hour opens", async ({
  page,
}) => {
  const errors = await boot(page, {
    hash: "/mnemos?mind=kestrel&room=log",
    newer: true,
  });
  await expect(page.getByTestId("mnemos-log-day")).toBeVisible();
  // The day of its practice hour (kes-h3, four days ago), from the Log.
  const day = await page.evaluate(() => {
    const at = new Date(Date.now() - 4 * 86_400_000 - 2 * 3_600_000);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  });
  await page.goto(`/#/mnemos?mind=kestrel&room=log&item=%23${day}`);
  await page.getByTestId("mnemos-log-event-hour-kes-h3").click();
  await expect(page).toHaveURL(/room=hours&item=kes-h3/);
  const opened = page.getByTestId("mnemos-hour-opened");
  await expect(opened).toContainText("practice, on a copy of its memory");
  await expect(page.getByTestId("mnemos-hours-row-kes-h3")).toHaveAttribute(
    "aria-current",
    "true",
  );
  // From a memory on its trail.
  await page.goto("/#/mnemos?mind=kestrel&room=memories&item=kes-m03");
  await page
    .getByTestId("mnemos-memory-hours")
    .getByRole("button", { name: /Our hour/ })
    .click();
  await expect(page).toHaveURL(/room=hours&item=kes-h3/);
  await expect(opened).toContainText("practice, on a copy of its memory");
  // And an older one by its address alone.
  await page.goto("/#/mnemos?mind=kestrel&room=hours&item=kes-h2");
  await expect(opened).toContainText("ran as Sonnet 5");
  expect(consoleClean(errors)).toEqual([]);
});

/** What a section shows of what its rail row counts, read off the page. */
async function shownCount(page: Page, room: string) {
  return page.evaluate((room) => {
    const card = document.querySelector("[data-testid='mnemos-place']");
    if (!card) return null;
    const rows = (sel: string) => card.querySelectorAll(sel).length;
    const number = (sel: string) => {
      const t = card.querySelector(sel)?.textContent ?? "";
      const m = t.replace(/,/g, "").match(/\d+/);
      return m ? Number(m[0]) : null;
    };
    switch (room) {
      case "memories":
        return (
          number("[data-testid='mnemos-memories-count']") ??
          number("[data-testid='place-page-state']")
        );
      case "shared":
        return rows("[data-testid='mnemos-shared-list'] .luca-place-row");
      case "beliefs":
        return rows(
          "[data-testid='mnemos-beliefs'] .luca-mnemos-list .luca-place-row",
        );
      case "questions":
        // The rail counts what it still asks; the answered sit apart,
        // under their own label.
        return rows(
          "[data-testid='mnemos-questions-list']:not([aria-label='Answered']) .luca-place-row",
        );
      case "journal":
        return rows("[data-testid='mnemos-journal-list'] .luca-place-row");
      case "notes":
        // A thread is a row, and the rail counts threads.
        return rows("[data-testid^='mnemos-notes-'] .luca-place-row");
      case "carrying":
        return rows(
          "[data-testid='mnemos-carrying'] .luca-mnemos-list .luca-place-row",
        );
      case "hours":
        return rows("[data-testid='mnemos-hours-list'] .luca-place-row");
      default:
        return null;
    }
  }, room);
}

/** Every section in the rail's order, by the keyboard alone: Down to its
 *  row, Enter, Tab into it, Enter on the first thing there, Escape, back,
 *  and Shift+Tab to its row again. Each count in the rail is read against
 *  what its section shows. */
async function keyboardWalk(page: Page, rooms: string[]) {
  const walked: Record<string, unknown>[] = [];
  const focusIn = (sel: string) =>
    page.evaluate((sel) => !!document.activeElement?.closest(sel), sel);
  await page.getByTestId("mnemos-rail-mind-button").focus();
  for (const room of rooms) {
    await page.keyboard.press("ArrowDown");
    expect(await focusIn(`[data-testid='place-row-${room}']`), room).toBe(true);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`room=${room}(&|$)`));
    await page.waitForTimeout(400);
    const railText =
      (await rail(page).getByTestId(`place-row-${room}`).textContent()) ?? "";
    const railCount = railText.match(/\d[\d,]*$/)?.[0]?.replace(/,/g, "");
    const shown = await shownCount(page, room);
    // Into the section.
    let reached: string | null = null;
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => {
        const el = document.activeElement;
        if (
          !el?.closest("[data-testid='mnemos-place']") ||
          el.closest("[data-testid='place-page-head']")
        )
          return null;
        return (
          el.getAttribute("data-testid") ??
          el.closest("[data-testid]")?.getAttribute("data-testid") ??
          el.tagName
        );
      });
      if (reached) break;
    }
    const url = page.url();
    const steps = () => page.evaluate(() => history.length);
    const before = await steps();
    let went: string | null = null;
    if (reached) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      // Where Enter went somewhere new, back returns to the section.
      if ((await steps()) > before) {
        went = page.url();
        await page.keyboard.press("Meta+BracketLeft");
        await expect.poll(() => page.url(), { message: room }).toBe(url);
      }
    }
    // Shift+Tab back to the section's row.
    let home = false;
    for (let i = 0; i < 80 && !home; i++) {
      await page.keyboard.press("Shift+Tab");
      home = await focusIn(`[data-testid='place-row-${room}']`);
    }
    expect(home, `${room}: back to its row`).toBe(true);
    walked.push({
      room,
      reached,
      went,
      railCount: railCount ?? null,
      shown,
    });
  }
  return walked;
}

const ROOMS_IN_ORDER = [
  "glance",
  "mind",
  "log",
  "memories",
  "shared",
  "beliefs",
  "questions",
  "journal",
  "notes",
  "carrying",
  "hours",
  "settings",
];

for (const which of ["newer", "today"] as const)
  test(`(51) the whole place by the keyboard alone, in the rail's order (${which === "newer" ? "a newer Mnemos" : "Mnemos 0.6.7"})`, async ({
    page,
  }) => {
    const errors = await boot(
      page,
      which === "newer"
        ? { hash: "/mnemos?mind=kestrel&room=glance", newer: true }
        : { hash: "/mnemos?mind=wren&room=glance" },
    );
    await expect(
      page.getByTestId(which === "newer" ? "mnemos-board" : "mnemos-glance"),
    ).toBeVisible();
    const walked = await keyboardWalk(page, ROOMS_IN_ORDER);
    measure51(`keyboard-walk-${which}`, walked);
    for (const w of walked)
      if (w.railCount !== null)
        expect(String(w.shown), `${w.room}: rail and section`).toBe(
          w.railCount,
        );
    expect(consoleClean(errors)).toEqual([]);
  });

/** Every piece of words in the place that shows under the Quick Chat
 *  button, as the place stands now (what its scroller hides doesn't
 *  show); with `column`, every piece in the button's column at any height,
 *  since anything there can be scrolled under it (the shell's rule keeps
 *  the column clear, 8 short of the button). */
async function underChatButton(page: Page, column = false) {
  return page.evaluate((column) => {
    const button = document
      .querySelector("[data-testid='quickchat-launcher']")
      ?.getBoundingClientRect();
    const place = document.querySelector("[data-testid='mnemos-place']");
    if (!button || !place) return ["no button or place"];
    const left = column ? button.left - 8 : button.left;
    const out: string[] = [];
    const walker = document.createTreeWalker(place, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      if (!text.data.trim()) continue;
      const host = text.parentElement as HTMLElement;
      let clip: DOMRect | null = null;
      for (let up: HTMLElement | null = host; up; up = up.parentElement)
        if (getComputedStyle(up).overflowY !== "visible") {
          clip = up.getBoundingClientRect();
          break;
        }
      range.selectNodeContents(text);
      for (const box of range.getClientRects()) {
        if (!box.width || !box.height) continue;
        if (
          !column &&
          clip &&
          (box.top >= clip.bottom || box.bottom <= clip.top)
        )
          continue;
        if (
          box.right > left &&
          box.left < button.right &&
          (column || (box.bottom > button.top && box.top < button.bottom))
        )
          out.push(
            `${host.tagName.toLowerCase()} "${text.data.trim().slice(0, 30)}"`,
          );
      }
    }
    return out;
  }, column);
}

for (const which of ["newer", "today"] as const)
  test(`(51-7) the Quick Chat button covers nothing in the place, at rest or scrolled to the end, at 1100 × 720 (${which === "newer" ? "a newer Mnemos" : "Mnemos 0.6.7"})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 720 });
    if (which === "newer") await visitedKestrel(page);
    const errors = await boot(page, {
      hash:
        which === "newer"
          ? "/mnemos?mind=kestrel&room=glance"
          : "/mnemos?room=glance",
      newer: which === "newer",
    });
    await expect(page.getByTestId("quickchat-launcher")).toBeVisible();
    const found: Record<
      string,
      { rest: string[]; end: string[]; column: string[] }
    > = {};
    for (const room of ROOMS_IN_ORDER) {
      await rail(page)
        .getByTestId(`place-row-${room}`)
        .locator("button")
        .click();
      await expect(page).toHaveURL(new RegExp(`room=${room}`));
      await page.waitForTimeout(400);
      const rest = await underChatButton(page);
      const column = await underChatButton(page, true);
      // Every scroller in the place, to its end.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll<HTMLElement>(
          "[data-testid='mnemos-place'], [data-testid='mnemos-place'] *",
        )) {
          const y = getComputedStyle(el).overflowY;
          if (
            (y === "auto" || y === "scroll") &&
            el.scrollHeight > el.clientHeight
          )
            el.scrollTop = el.scrollHeight;
        }
      });
      await page.waitForTimeout(150);
      const end = await underChatButton(page);
      found[room] = { rest, end, column };
    }
    const where = await page.evaluate(() => {
      const box = (sel: string) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r
          ? [r.left, r.top, r.right, r.bottom].map((n) => Math.round(n))
          : null;
      };
      const axis = document.querySelector(
        "[data-testid='mnemos-place'] .luca-place-page-axis",
      );
      return {
        button: box("[data-testid='quickchat-launcher']"),
        axis: box("[data-testid='mnemos-place'] .luca-place-page-axis"),
        axisPaddingRight: axis ? getComputedStyle(axis).paddingRight : null,
      };
    });
    measure51(`chat-button-${which}`, { where, found });
    for (const [room, f] of Object.entries(found)) {
      expect(f.rest, `${room} at rest`).toEqual([]);
      expect(f.end, `${room} scrolled to the end`).toEqual([]);
      expect(f.column, `${room}: nothing in the button's column`).toEqual([]);
    }
    expect(consoleClean(errors)).toEqual([]);
  });

/* ── WP-55: the newest memory's day, in the person's own time ───────── */

/**
 * A place whose date is never the world-time date at this moment: twelve
 * hours behind while the world-time hour is before 11, fourteen ahead
 * after. So the test below fails, at any hour, on an app that names the
 * world-time day.
 */
const FAR_ZONE = new Date().getUTCHours() < 11 ? "Etc/GMT+12" : "Etc/GMT-14";
const SHOTS55 = process.env.WP55_SHOTS ?? "test-results/wp55";

test.describe("(55) far from world time", () => {
  test.use({ timezoneId: FAR_ZONE });

  test("(55) a memory made this minute is newest today, in the head and in the rail", async ({
    page,
  }) => {
    const errors = await boot(page, { hash: "/mnemos?mind=wren&room=glance" });
    const where = await page.evaluate(() => ({
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      day: new Date().getDate(),
      worldDay: new Date().getUTCDate(),
    }));
    expect(where.zone).toBe(FAR_ZONE);
    // The page's own day is not the world-time day here.
    expect(where.day).not.toBe(where.worldDay);
    // Soft, so a wrong day shows in every place it is said at once.
    await expect
      .soft(page.getByTestId("place-page-state"))
      .toHaveText(
        "124 memories it can reach · newest today · Luca remembers with this",
      );
    // The rail's list of the minds on this Mac: each one's newest day.
    await page.getByTestId("mnemos-rail-mind-button").click();
    await expect(page.getByTestId("mnemos-mind-wren")).toBeVisible();
    expect
      .soft((await readRow(page, "wren")).seen)
      .toEqual(["124 memories · today"]);
    expect
      .soft((await readRow(page, "field-notes")).seen)
      .toEqual(["9 memories · today"]);
    await waitForAnimations(page);
    mkdirSync(SHOTS55, { recursive: true });
    await page.screenshot({ path: `${SHOTS55}/01-newest-today-far-zone.png` });
    expect(consoleClean(errors)).toEqual([]);
  });
});

/* ── WP-56: the list of minds never cuts the day off ────────────────── */

const SHOTS56 = process.env.WP56_SHOTS ?? "test-results/wp56";
/** A run's own name in its measures, so two builds can be laid side by side. */
const RUN56 = process.env.WP56_RUN ?? "run";

/** The rows that test the number line: a big count with yesterday, a
 *  six-figure count with a date in another year, and three who remember. */
const LIST_MINDS: ListMind[] = [
  {
    id: "harbor-log",
    name: "Harbor Log",
    memories: 9347,
    newest: { daysAgo: 1 },
    linked: [],
  },
  {
    id: "old-shoreline",
    name: "Old Shoreline",
    memories: 123456,
    newest: { yearsAgo: 1, month: 10, day: 26 },
    linked: [],
  },
  {
    id: "lamp-room",
    name: "Lamp Room",
    memories: 300,
    newest: { daysAgo: 1 },
    linked: [
      { pubkey: LUCA, name: "Luca" },
      { pubkey: "c".repeat(64), name: "Wren" },
      { pubkey: "d".repeat(64), name: "Opus" },
    ],
  },
];
const ROWS56 = ["wren", "field-notes", ...LIST_MINDS.map((m) => m.id)];

type Box = { left: number; top: number; right: number; bottom: number };
type RowRead = {
  /** What the eye reads on the number line, one string per drawn line. */
  seen: string[];
  /** Every dot drawn on it: inside the line's visible box, and whether it
   *  is the first or last thing on its drawn line. */
  dots: { box: Box; inside: boolean; atEdge: boolean }[];
  /** The line and each piece of it: nothing wider than its box. */
  pieces: { name: string; scrollWidth: number; clientWidth: number }[];
  /** Anything on the line that would cut with an ellipsis. */
  ellipsis: string[];
  row: Box;
  line: Box;
  name: Box;
  /** The first glyph after the dot, where the day starts. */
  dayStart: number | null;
  /** The line under it (who remembers with this), and whether it is cut. */
  third: { text: string; scrollWidth: number; clientWidth: number } | null;
};

/** Reads a row of the list of minds as it is drawn (WP-56). */
function readRow(page: Page, id: string): Promise<RowRead> {
  return page.getByTestId(`mnemos-mind-${id}`).evaluate((row) => {
    const box = (r: DOMRect) => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
    });
    const lines = row.querySelectorAll<HTMLElement>(
      ".luca-mnemos-railmind-line",
    );
    const line = lines[0];
    const clip = line.getBoundingClientRect();
    const glyphs: { ch: string; r: DOMRect }[] = [];
    const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const parent = node.parentElement as HTMLElement;
      if (parent.closest(".sr-only")) continue;
      if (getComputedStyle(parent).visibility !== "visible") continue;
      const text = node.textContent ?? "";
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        glyphs.push({ ch: text[i], r });
      }
    }
    // Only what falls in the line's visible box is drawn.
    const shown = glyphs.filter(
      (g) =>
        g.r.left >= clip.left - 0.5 &&
        g.r.right <= clip.right + 0.5 &&
        g.r.top >= clip.top - 0.5 &&
        g.r.bottom <= clip.bottom + 0.5,
    );
    const rows = new Map<number, { ch: string; r: DOMRect }[]>();
    for (const g of shown) {
      const key = Math.round(g.r.top);
      rows.set(key, [...(rows.get(key) ?? []), g]);
    }
    const drawn = [...rows.values()].map((gs) =>
      gs.sort((a, b) => a.r.left - b.r.left),
    );
    const seen = drawn.map((gs) =>
      gs
        .map((g) => g.ch)
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    );
    const dots = glyphs
      .filter((g) => g.ch === "·")
      .map((g) => {
        const inside = shown.includes(g);
        const mine = drawn.find((gs) => gs.includes(g)) ?? [];
        const ink = mine.filter((x) => x.ch.trim());
        return {
          box: box(g.r),
          inside,
          atEdge: inside && (ink[0] === g || ink[ink.length - 1] === g),
        };
      });
    const dot = shown.find((g) => g.ch === "·");
    const after = dot
      ? shown
          .filter((g) => g.ch.trim() && g.r.left > dot.r.right - 0.5)
          .filter((g) => Math.round(g.r.top) === Math.round(dot.r.top))
          .sort((a, b) => a.r.left - b.r.left)[0]
      : undefined;
    const pieces = [line, ...Array.from(line.children)]
      .filter((el) => !el.classList.contains("sr-only"))
      .filter((el) => getComputedStyle(el).display !== "inline")
      .filter((el) => getComputedStyle(el).position !== "absolute")
      .map((el) => ({
        name: el.className || el.tagName,
        scrollWidth: (el as HTMLElement).scrollWidth,
        clientWidth: (el as HTMLElement).clientWidth,
      }));
    const ellipsis = [line, ...Array.from(line.querySelectorAll("*"))]
      .filter((el) => getComputedStyle(el).textOverflow === "ellipsis")
      .map((el) => el.className || el.tagName);
    const third = lines[1];
    return {
      seen,
      dots,
      pieces,
      ellipsis,
      row: box(row.getBoundingClientRect()),
      line: box(clip),
      name: box(
        (
          row.querySelector(".luca-mnemos-railmind-name") as HTMLElement
        ).getBoundingClientRect(),
      ),
      dayStart: after ? after.r.left : null,
      third: third
        ? {
            text: third.textContent ?? "",
            scrollWidth: third.scrollWidth,
            clientWidth: third.clientWidth,
          }
        : null,
    };
  });
}

type WhoRead = {
  text: string;
  /** What the eye reads of it, one string per drawn line. */
  seen: string[];
  scrollWidth: number;
  clientWidth: number;
  ellipsis: boolean;
  box: Box;
};

/** Reads a "… remembers with this" line as it is drawn (WP-56). */
function readWho(el: import("@playwright/test").Locator): Promise<WhoRead> {
  return el.evaluate((line) => {
    const clip = line.getBoundingClientRect();
    const glyphs: { ch: string; r: DOMRect }[] = [];
    const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const text = node.textContent ?? "";
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (
          r.left < clip.left - 0.5 ||
          r.right > clip.right + 0.5 ||
          r.top < clip.top - 0.5 ||
          r.bottom > clip.bottom + 0.5
        )
          continue;
        glyphs.push({ ch: text[i], r });
      }
    }
    const rows = new Map<number, string[]>();
    for (const g of glyphs) {
      const key = Math.round(g.r.top);
      rows.set(key, [...(rows.get(key) ?? []), g.ch]);
    }
    const el = line as HTMLElement;
    return {
      text: el.textContent ?? "",
      seen: [...rows.values()].map((cs) => cs.join("").trim()),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      ellipsis: getComputedStyle(el).textOverflow === "ellipsis",
      box: {
        left: clip.left,
        top: clip.top,
        right: clip.right,
        bottom: clip.bottom,
      },
    };
  });
}

/** A who line is drawn whole: every word in its box, nothing cut. */
function expectWhole(who: WhoRead, words: string, where: string) {
  expect.soft(who.text, `${where}: its words`).toBe(words);
  expect.soft(who.seen.join(" "), `${where}: what the eye reads`).toBe(words);
  expect.soft(who.ellipsis, `${where}: an ellipsis in play`).toBe(false);
  expect
    .soft(who.scrollWidth, `${where}: cut`)
    .toBeLessThanOrEqual(who.clientWidth);
}

/** How wide the rail is, and whether anything offers to resize it. */
function railWidth(page: Page) {
  return page.evaluate(() => {
    const rail = document.querySelector("[data-testid='place-rail-mnemos']");
    const list = document.querySelector("[data-testid='mnemos-minds-list']");
    return {
      viewport: window.innerWidth,
      rail: rail ? rail.getBoundingClientRect().width : null,
      list: list ? list.getBoundingClientRect().width : null,
      sidebarWidth: getComputedStyle(
        document.querySelector("[data-slot='sidebar-wrapper']") ??
          document.documentElement,
      ).getPropertyValue("--sidebar-width"),
      handles: document.querySelectorAll(
        "[data-sidebar='rail'], [data-sidebar-resize], [aria-label*='esize']",
      ).length,
    };
  });
}

/** The day of a ListMind's newest memory, as the row should say it. */
function dayOf(m: ListMind) {
  const d = new Date();
  if ("daysAgo" in m.newest) return m.newest.daysAgo === 1 ? "yesterday" : "";
  return new Date(
    d.getFullYear() - m.newest.yearsAgo,
    m.newest.month,
    m.newest.day,
  ).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function checkRows(page: Page, where: string) {
  const read: Record<string, RowRead> = {};
  const whoRead: Record<string, WhoRead> = {};
  for (const id of ROWS56) read[id] = await readRow(page, id);
  const spoken: Record<string, string> = {};
  for (const id of ROWS56)
    spoken[id] = await page.getByTestId(`mnemos-mind-${id}`).ariaSnapshot();
  measure56(`${RUN56}-${where}`, {
    width: await railWidth(page),
    read,
    spoken,
  });

  const expected: Record<string, [string, string]> = {
    wren: ["124 memories", "today"],
    "field-notes": ["9 memories", "today"],
  };
  for (const m of LIST_MINDS)
    expected[m.id] = [
      `${m.memories.toLocaleString("en-US")} memories`,
      dayOf(m),
    ];
  for (const id of ROWS56) {
    const r = read[id];
    const [count, day] = expected[id];
    // The eye: the count and the day, the dot between them on one line, or
    // the day whole on a line of its own with no dot left at either edge.
    const one = r.seen.length === 1;
    expect
      .soft(r.seen, `${where} ${id}: what the eye reads`)
      .toEqual(one ? [`${count} · ${day}`] : [count, day]);
    for (const d of r.dots)
      expect
        .soft(d.atEdge, `${where} ${id}: a dot at a line's edge`)
        .toBe(false);
    expect
      .soft(r.dots.filter((d) => d.inside).length, `${where} ${id}: dots drawn`)
      .toBe(one ? 1 : 0);
    for (const p of r.pieces)
      expect
        .soft(p.scrollWidth, `${where} ${id}: ${p.name} cut`)
        .toBeLessThanOrEqual(p.clientWidth);
    expect.soft(r.ellipsis, `${where} ${id}: an ellipsis in play`).toEqual([]);
    // Who remembers with it: the whole sentence, on two lines if need be.
    const who = page
      .getByTestId(`mnemos-mind-${id}`)
      .locator(".luca-mnemos-railmind-line")
      .nth(1);
    if (await who.count()) {
      const w = await readWho(who);
      whoRead[id] = w;
      expectWhole(w, w.text, `${where} ${id} who`);
    }
    // The ear: still a sentence.
    expect
      .soft(spoken[id], `${where} ${id}: what a screen reader hears`)
      .toContain(`${count}, newest ${day}`);
  }
  measure56(`${RUN56}-${where}-who`, whoRead);
  expect
    .soft(whoRead["lamp-room"]?.seen, `${where}: three names, on two lines`)
    .toHaveLength(2);
  return read;
}

function measure56(key: string, value: unknown) {
  mkdirSync(`${SHOTS56}/measures`, { recursive: true });
  writeFileSync(
    `${SHOTS56}/measures/${key}.json`,
    JSON.stringify(value, null, 2),
  );
}

for (const mode of ["dark", "light"] as const)
  test(`(56) the list of minds never cuts the day off, ${mode}`, async ({
    page,
    browser,
  }) => {
    const errors = await boot(page, {
      hash: "/mnemos?mind=wren&room=glance",
      mode,
      listMinds: LIST_MINDS,
    });
    await page.getByTestId("mnemos-rail-mind-button").click();
    const list = page.getByTestId("mnemos-minds-list");
    await expect(list).toBeVisible();
    await expect(page.getByTestId("mnemos-mind-lamp-room")).toBeVisible();
    await waitForAnimations(page);
    mkdirSync(SHOTS56, { recursive: true });

    // At the rail's default width.
    const read = await checkRows(page, `${mode}-default`);
    // Two rows that fit, cropped, for laying the builds side by side.
    const top = read.wren.row;
    const fits = read["field-notes"].row;
    const clip = {
      x: top.left,
      y: top.top,
      width: top.right - top.left,
      height: fits.bottom - top.top,
    };
    await page.screenshot({
      path: `${SHOTS56}/${RUN56}-${mode}-two-rows.png`,
      clip,
    });
    if (mode === "dark")
      await list.screenshot({ path: `${SHOTS56}/${RUN56}-dark-list.png` });

    // Forced to wrap: the worst case's day on a line of its own, whole, no
    // dot at either edge.
    const worst = read["old-shoreline"];
    measure56(`${RUN56}-${mode}-worst`, worst);
    expect(worst.seen.length, "the worst case wraps at this width").toBe(2);
    if (mode === "dark")
      await page
        .getByTestId("mnemos-mind-old-shoreline")
        .screenshot({ path: `${SHOTS56}/${RUN56}-dark-wrapped-row.png` });

    // At the narrowest the window allows the rail: a narrow window.
    await page.setViewportSize({ width: 900, height: 900 });
    await waitForAnimations(page);
    await page.waitForTimeout(300);
    if (await list.isVisible()) await checkRows(page, `${mode}-narrow-window`);
    expect(consoleClean(errors)).toEqual([]);

    // A close look, at three times: the big count and the wrapped one.
    if (mode === "light") {
      const close = await browser.newContext({
        deviceScaleFactor: 3,
        viewport: { width: 1440, height: 900 },
      });
      const near = await close.newPage();
      await boot(near, {
        hash: "/mnemos?mind=wren&room=glance",
        mode,
        listMinds: LIST_MINDS,
      });
      await near.getByTestId("mnemos-rail-mind-button").click();
      await expect(near.getByTestId("mnemos-mind-old-shoreline")).toBeVisible();
      await waitForAnimations(near);
      const a = (await readRow(near, "harbor-log")).row;
      const b = (await readRow(near, "old-shoreline")).row;
      await near.screenshot({
        path: `${SHOTS56}/${RUN56}-light-two-rows-3x.png`,
        clip: {
          x: a.left,
          y: a.top,
          width: a.right - a.left,
          height: b.bottom - a.top,
        },
      });
      await close.close();
    }
  });

for (const mode of ["dark", "light"] as const)
  test(`(56) the head names three who remember, whole, ${mode}`, async ({
    page,
  }) => {
    const three = "Luca, Sable and Opus remember with this";
    const errors = await boot(page, {
      hash: "/mnemos?mind=wren&room=glance",
      mode,
      wrenLinked: [
        { pubkey: LUCA, name: "Luca" },
        { pubkey: "e".repeat(64), name: "Sable" },
        { pubkey: "f".repeat(64), name: "Opus" },
      ],
    });
    const head = page.getByTestId("mnemos-rail-mind-button");
    await expect(head).toContainText(three);
    const inHead = await readWho(head.locator(".luca-mnemos-railmind-who"));
    expectWhole(inHead, three, `${mode} head`);
    expect.soft(inHead.seen, `${mode} head: on two lines`).toHaveLength(2);
    await head.click();
    const row = page
      .getByTestId("mnemos-mind-wren")
      .locator(".luca-mnemos-railmind-who");
    await expect(row).toBeVisible();
    const inRow = await readWho(row);
    expectWhole(inRow, three, `${mode} row`);
    measure56(`${RUN56}-${mode}-head-three`, { inHead, inRow });
    if (mode === "dark") {
      await waitForAnimations(page);
      await page
        .getByTestId("mnemos-rail-mind")
        .screenshot({ path: `${SHOTS56}/${RUN56}-dark-head-three.png` });
    }
    expect(consoleClean(errors)).toEqual([]);
  });
