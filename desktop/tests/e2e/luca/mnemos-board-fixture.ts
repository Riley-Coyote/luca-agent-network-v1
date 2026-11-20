/**
 * Kestrel for the board's browser tests (WP-49): the WP-48 fixture mind,
 * extended here rather than edited. Its schedule in the engine's own shape
 * (`companion/export.py` `schedule`: `when` as `{Hour, Minute}`, `loaded`),
 * two more pictures (one newest, one that can't be read), and an older
 * mind on Mnemos 0.6.7 to keep today's board honest. Every word invented.
 */
import { kestrelNotebook, PICTURES } from "./mnemos-newer-fixture";

/** Its pictures by notebook path: the fixture's two, one more, and a file
 *  that isn't a picture at all (`broken.png`). */
export const BOARD_PICTURES: Record<string, string> = {
  ...PICTURES,
  "studies/harbour-dawn.png": PICTURES["night-sky.png"] ?? "",
  "broken.png": "bm90IGEgcGljdHVyZQ==",
};

/** The path the engine lists but whose bytes are no picture. */
export const BROKEN_PICTURE = "broken.png";

/** Kestrel's notebook, with the board's additions. */
export function kestrelBoard(now: number) {
  const made = kestrelNotebook(now);
  const hour = 3_600_000;
  const day = 24 * hour;
  const iso = (ms: number) => new Date(ms).toISOString();
  const { life } = made;
  return {
    ...made,
    life: {
      ...life,
      schedule: [
        {
          label: "com.mnemos.kestrel.mine",
          kind: "mine",
          when: { Hour: 8, Minute: 0 },
          loaded: true,
        },
        {
          label: "com.mnemos.kestrel.ours",
          kind: "ours",
          when: { Hour: 19, Minute: 0 },
          loaded: true,
        },
        {
          label: "com.mnemos.kestrel.dream",
          kind: "dream",
          when: { Hour: 3, Minute: 30 },
          loaded: true,
        },
      ],
      studio: [
        {
          path: "studies/harbour-dawn.png",
          bytes: 500,
          at: iso(now - 2 * hour),
          picture: "data/studio/studies/harbour-dawn.png",
        },
        ...life.studio,
        {
          path: BROKEN_PICTURE,
          bytes: 15,
          at: iso(now - 3 * day),
          picture: "data/studio/broken.png",
        },
      ],
    },
  };
}

/** Wren, a mind on Mnemos 0.6.7 (no `hello`, no notebook), as its
 *  interface answers the first eight commands. Oldest first. */
export function wrenOld(now: number) {
  const day = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const lines = [
    "The lighthouse keeper logs the weather at six, before the gulls.",
    "Pat likes the morning notes short: one line, then the day.",
    "The north stair is the quiet way down to the harbour.",
    "When the fog horn sounds twice, the ferry is running late.",
  ];
  const memories = Array.from({ length: 24 }, (_, i) => ({
    id: `wren-m${String(i).padStart(3, "0")}`,
    words: lines[i % lines.length] as string,
    kept: iso(now - (23 - i) * 3 * day - 3_600_000),
    state: i === 7 ? "dormant" : "active",
    alive: i === 7 ? 0.03 : 0.6,
    corrected: null,
    impact: "",
    author: "agent",
  }));
  const journal = [
    {
      id: "wren-j1",
      text: "A quiet day at the light. All the boats came home.",
      mood: "steady",
      written: "between_sessions",
      model: "claude-opus-5-5",
      created_at: iso(now - 2 * 3_600_000),
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
  ];
  return { memories, journal, notes };
}
