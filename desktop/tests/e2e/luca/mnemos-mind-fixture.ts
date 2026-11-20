/**
 * A made-up mind for The mind's browser tests (WP-50): Heron, on a newer
 * Mnemos that gives the whole notebook, with as many memories as a test
 * asks for (a few hundred to look at, 3,000 to measure). Every word is
 * invented, every time relative to `now`; the shapes are the engine's
 * export (`mnemos/companion/export.py`), as `mnemos-newer-fixture.ts` has
 * them, so the page itself reads what a real one gives.
 */

export const HERON_HELLO = {
  protocol: 1,
  mnemos: "0.7.0",
  schema: 19,
  commands: [
    "memories",
    "search",
    "correct",
    "forget",
    "journal",
    "notes",
    "reply",
    "note",
    "hello",
    "notebook",
    "summary",
    "read",
    "hours",
    "shared",
  ],
  parts: ["life", "memories", "pulse"],
  writes_as: "person",
  strict_scope: true,
  scope: {
    agent_id: "heron",
    person_id: "sam-example",
    project_scope: "estuary",
    held: true,
  },
};

const TOPICS = [
  "the tide at the river mouth",
  "the reed beds after rain",
  "Sam's morning walk to the jetty",
  "the old boathouse roof",
  "which birds come back in spring",
  "the ferry timetable in winter",
  "the salt marsh at dusk",
  "the lighthouse keeper's ledger",
  "the mud flats at low water",
  "the heron that nests by the sluice",
  "the weather notes Sam keeps",
  "the path along the sea wall",
];

const SAYINGS = [
  "came back clearer than before",
  "is worth writing down the same day",
  "changes with the season",
  "is what Sam asks about first",
  "was wrong in the old notes",
  "is quieter than it used to be",
  "goes best before eight",
  "should be checked again after a storm",
];

/** A small seeded random, so every run makes the same mind. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tie = [string, string, number, string, string, 0 | 1];

/** Heron's notebook: `life`, and `count` memories oldest first. */
export function heronNotebook(now: number, count: number) {
  const hour = 3_600_000;
  const day = 24 * hour;
  const iso = (ms: number) => new Date(ms).toISOString();
  const r = seeded(42);
  const id = (i: number) => `her-m${String(i).padStart(4, "0")}`;
  const memories = Array.from({ length: count }, (_, i) => {
    const topic = i % TOPICS.length;
    const lesson = i % 9 === 8;
    const content = lesson
      ? `Lesson: ${TOPICS[topic]} ${SAYINGS[(i * 5) % SAYINGS.length]}. Write it first, then the rest of the day.`
      : `${TOPICS[topic][0].toUpperCase()}${TOPICS[topic].slice(1)} ${SAYINGS[i % SAYINGS.length]} (note ${i + 1}).`;
    return {
      id: id(i),
      born: iso(now - (count - i) * ((180 * day) / count) - 3 * hour),
      touched: iso(now - (count - i) * ((90 * day) / count)),
      kind: lesson ? "lesson" : "semantic",
      lesson,
      standing: i % 97 === 3,
      asked: i % 61 === 5,
      state: i % 23 === 7 ? "dormant" : "active",
      author: i % 13 === 4 ? "person" : "agent",
      model: i % 13 === 4 ? "" : "claude-opus-5-5",
      acc: i % 23 === 7 ? 0.04 : 0.25 + r() * 0.7,
      recalls: Math.floor(r() * 14),
      ties: [] as Tie[],
      strength: 0.35 + r() * 0.6,
      stability: 0.2 + r() * 0.7,
      content,
      impact: lesson ? "Now I write it before anything else." : "",
    };
  });
  // Ties: each memory to a few earlier ones on its topic (most came back
  // together; some support, a few contradict), and each lesson distilled
  // from the experiences just before it. Each tie is kept on both ends.
  const tie = (s: number, t: number, rel: string, w: number) => {
    const at = iso(now - (count - Math.max(s, t)) * ((180 * day) / count));
    memories[s].ties.push([id(t), rel, w, at, "agent", 1]);
    memories[t].ties.push([id(s), rel, w, at, "agent", 0]);
  };
  for (let i = 1; i < count; i++) {
    const links = 1 + Math.floor(r() * 3);
    for (let k = 0; k < links; k++) {
      const back = TOPICS.length * (1 + Math.floor(r() * 6));
      const t = i - back;
      if (t < 0) continue;
      const roll = r();
      const rel =
        roll < 0.78 ? "co_activated" : roll < 0.94 ? "supports" : "contradicts";
      tie(i, t, rel, Math.round((0.3 + r() * 0.65) * 100) / 100);
    }
    if (memories[i].lesson)
      for (const back of [TOPICS.length, 2 * TOPICS.length])
        if (i - back >= 0) tie(i - back, i, "distilled_into", 0.8);
  }
  const active = memories.filter((m) => m.state === "active").length;
  const newest = memories[count - 1];
  const life = {
    made: iso(now),
    identity: {
      agentId: "heron",
      model: "claude-opus-5-5",
      unfiled: false,
      name: "Heron",
      person: "Sam",
      personId: "sam-example",
      project: "estuary",
      store: "~/.mnemos/heron.db",
    },
    hours: [
      {
        id: "her-h1",
        kind: "mine",
        practice: false,
        status: "done",
        reason: "",
        start: iso(now - 3 * hour),
        end: iso(now - 2 * hour - 20 * 60_000),
        minutes: 40,
        model: "claude-opus-5-5",
        modelName: "Opus 5.5",
        tokens: 38_000,
        waiting: 0,
        untouched: true,
        check: "rows",
        discarded: [],
        journal: [],
        notes: [],
        made: ["estuary.png"],
        said: "I walked the sea wall in my notes and drew the estuary.",
        refused: [],
        trail: {
          woke: [id(count - 1), id(count - 13)],
          waiting: [],
          reached: [id(count - 25), id(count - 2), id(count - 37)],
        },
      },
    ],
    schedule: [{ kind: "mine", when: "03:00", how: "launchd" }],
    jev: { on: false, key: false, env: false, host: "api.typesafe.ai" },
    shared: { status: "ready", rows: [] },
    journal: [
      {
        id: "her-j1",
        at: iso(now - 2 * hour),
        text: "The tide came in early and the reeds went silver. I wrote it first.",
        mood: "clear",
        written: "between_sessions",
        model: "claude-opus-5-5",
        hour: "her-h1",
      },
    ],
    notes: [],
    studio: [
      {
        path: "estuary.png",
        bytes: 900,
        at: iso(now - 2 * hour - 30 * 60_000),
        picture: "data/studio/estuary.png",
      },
    ],
    questions: { open: 0, byKind: {}, asked: [], answered: [] },
    memory: {
      states: { active, dormant: count - active, archived: 0 },
      newest: newest?.born ?? null,
      storeBytes: count * 4096,
      version: "hv1",
      count,
    },
    beliefs: [],
    handoffs: [],
  };
  return {
    life,
    memories,
    version: "hv1",
    recalled: [] as [string, string][],
  };
}

/**
 * What Heron's memory logs of recall, in the engine's shape (`export.py`
 * `recalled`: `[id, when]`, oldest first): twice, several memories came
 * back together (within the engine's five seconds), and once one came back
 * alone, which the page's recall track doesn't mark.
 */
export function heronRecalls(now: number): [string, string][] {
  const hour = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const first = now - 30 * hour;
  const second = now - 6 * hour;
  return [
    ["her-m0001", iso(first)],
    ["her-m0002", iso(first + 1_000)],
    ["her-m0003", iso(first + 2_500)],
    ["her-m0020", iso(now - 12 * hour)],
    ["her-m0010", iso(second)],
    ["her-m0011", iso(second + 3_000)],
  ];
}
