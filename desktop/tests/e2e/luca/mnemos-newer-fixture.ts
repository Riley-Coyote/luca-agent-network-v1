/**
 * A made-up mind on a newer Mnemos, for the place's browser tests: Kestrel,
 * whose engine says `hello` and gives the whole notebook (`life`, its
 * memories in pages, `summary`). Every word here is invented; times are
 * relative to `now`. Its shapes are the engine's export
 * (`mnemos/companion/export.py`), so the page's guards see what a real one
 * gives.
 */

/** Two small pictures from its studio (made here, 64 by 48). */
export const PICTURES: Record<string, string> = {
  "tide-chart.png":
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAACBUlEQVR42tXY2VIUQRAF0PsRiLgBKqKyCAqCsq8KouKGgCgouIBGwLDv68z8pZ/Ag59gG2l0dHTXdGdV5UtGnIee6pt5ax5nUNa1rBoudC+rhvKeFdVwsXdFNVT05VTDpf6carg8sKoargyuqoarQ2uq4drwmmqofLKuGqqergv6c/47Sna5EapHNqTEbk8E9xsbcX10Q4Tx9kSqwtiIG882RdA642HyXKru3xe4Obbpj3bZvhJpRM3zLU+0yyfg04hbL7Y80Tr/jFVj+Izal9s+6GZSMYdG3B7f9hHs4if5YX4j7rzacUZ3ssr71Bkbcff1jrNgl23ediSzEXVvdt3QbRymZBsRHNW/3XXgNkiXEGwEbWx4t2fFbSqcdZsyDv7/Ao0Te1YcRqKzgo24936fNgYPTLZ54wbbfKkRNE3uB4LX9MBhFS61gb8kPYzmqYMAheg5HT+ZuYefTAnj/vQBCULhcwpmjLOHsyozhgcfDglFw49GnAwfszE9gJaZwxBtjJ7w3zrIXMhpROvHoxANRE9ir0q9dZbZmLkBDz8dRdGY8TB5LsKzEW2zxzGlfpsnkyJS/g3gjKN97jjGuCsZE+TTiEefT5Jiu4wZWc6NePzlRDV0zJ+qhs6FU9XQ9fVMNXR/O1MNPd/zqqH3R1419C0WVEP/UkE1DPwsqobBX0XV/gIG2fNzpQF8ugAAAABJRU5ErkJggg==",
  "night-sky.png":
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAABEUlEQVR42u3ZOxKCMBCA4S0zvp+doKCg4P1P5QUcK7MZKxJFZGWzgZmvcCCQ/BAqQY12osEQUPW437QuAyIPmUfg+G0DNY4q8ALrIJfaxQDj3CR0QNyeWWvMArgmpguYxKLpgD0X3Hitx3AGkAggYHoQrWcB+En5F5B0zDwFsruBmiWihRCQNoV7oPlVfwL+LOXXgHnqOXzh78/qgKNo/QgwL5FgTHv2LKAWJ9GGAA8Css9w29WNYQRqmYkWQkAuGnEAfjBdB6xyG67DddxDOuAsWj8CzI6inJXwhqDWF9vrXxbXced4RuDbgmpVHqK8APsNFDZTWYgAalOI5mkAboGvA0rRAgjYlqLpgKtoQwC3J6nmDhwUtyGiAAAAAElFTkSuQmCC",
};

/** What its engine says to `hello`. */
export const KESTREL_HELLO = {
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
    agent_id: "kestrel",
    person_id: "pat-example",
    project_scope: "lighthouse",
    held: true,
  },
};

const LINES = [
  "The harbour lights come on in order, east to west.",
  "Pat reads the tide chart before the weather.",
  "Gulls gather on the north wall before a storm.",
  "The keeper's ledger is kept in pencil, never ink.",
  "A late ferry means the fog came in early.",
  "Lesson: write the tide first; everything else follows from it.",
  "The lamp room is coldest an hour before dawn.",
  "Pat prefers one short note to three long ones.",
  "The east buoy rings a half-tone flat.",
  "Saturday's walk goes out past the second jetty.",
  "The old charts mark the sandbar a little too far north.",
  "When the wind backs south, the swell follows by evening.",
];

/** Kestrel's notebook: `life`, and its memories oldest first. */
export function kestrelNotebook(now: number) {
  const hour = 3_600_000;
  const day = 24 * hour;
  const iso = (ms: number) => new Date(ms).toISOString();
  const memories = LINES.map((content, i) => ({
    id: `kes-m${String(i).padStart(2, "0")}`,
    born: iso(now - (11 - i) * 2 * day - 5 * hour),
    touched: iso(now - (11 - i) * day),
    kind: i === 5 ? "lesson" : "semantic",
    lesson: i === 5,
    standing: i === 1 || i === 7,
    asked: i === 4 || i === 10,
    state: i === 8 ? "dormant" : "active",
    author: i === 7 ? "person" : "agent",
    model: i === 7 ? "" : i % 4 === 3 ? "claude-sonnet-5" : "claude-opus-5-5",
    acc: i === 8 ? 0.04 : 0.35 + (i % 5) * 0.12,
    recalls: (i * 7) % 11,
    ties:
      i === 1
        ? [
            ["kes-m05", "distilled_into", 0.8, iso(now - 4 * day), "agent", 1],
            ["kes-m04", "co_activated", 0.5, iso(now - 6 * day), "agent", 0],
          ]
        : i === 4
          ? [["kes-m01", "co_activated", 0.5, iso(now - 6 * day), "agent", 1]]
          : i === 5
            ? [
                [
                  "kes-m01",
                  "distilled_into",
                  0.8,
                  iso(now - 4 * day),
                  "agent",
                  0,
                ],
              ]
            : [],
    strength: 0.5 + (i % 4) * 0.1,
    stability: 0.3 + (i % 3) * 0.2,
    content,
    impact:
      i === 5 ? "Now the tide goes at the top of every morning note." : "",
  }));
  const journal = [
    {
      id: "kes-j1",
      // Written in its hour (5 h to 4 h 20 min ago).
      at: iso(now - 4 * hour - 35 * 60_000),
      text: "The fog lifted by nine. I wrote the tide first and the rest came easily.",
      mood: "clear",
      written: "between_sessions",
      model: "claude-opus-5-5",
      hour: "kes-h1",
    },
    {
      id: "kes-j2",
      at: iso(now - 2 * day),
      text: "A long day of small corrections. The charts were wrong about the sandbar.",
      mood: "patient",
      written: "in_session",
      model: "claude-sonnet-5",
      hour: "",
    },
    {
      id: "kes-j3",
      at: iso(now - 9 * day),
      text: "First night with the new lamp. It hums.",
      mood: "",
      written: "between_sessions",
      model: "claude-opus-5-5",
      hour: "",
    },
  ];
  const notes = [
    {
      id: "kes-n1",
      at: iso(now - 4 * hour - 25 * 60_000),
      kind: "question",
      text: "Should the morning note lead with the tide even on calm days?",
      author: "agent",
      model: "claude-opus-5-5",
      replyTo: "",
      hour: "kes-h1",
      delivered: null,
      read: null,
    },
    {
      id: "kes-n2",
      at: iso(now - 3 * day),
      kind: "",
      text: "The sandbar is further south than the old chart says.",
      author: "person",
      model: "",
      replyTo: "",
      hour: "",
      delivered: iso(now - 3 * day + hour),
      read: iso(now - 3 * day + hour),
    },
    {
      id: "kes-n3",
      at: iso(now - 3 * day + 2 * hour),
      kind: "reply",
      text: "Thank you. I corrected it, and kept the old line in its history.",
      author: "agent",
      model: "claude-opus-5-5",
      replyTo: "kes-n2",
      hour: "",
      delivered: null,
      read: iso(now - 2 * day),
    },
  ];
  const hours = [
    {
      id: "kes-h1",
      kind: "mine",
      practice: false,
      status: "done",
      reason: "",
      start: iso(now - 5 * hour),
      end: iso(now - 4 * hour - 20 * 60_000),
      minutes: 40,
      model: "claude-opus-5-5",
      modelName: "Opus 5.5",
      tokens: 41_200,
      waiting: 1,
      untouched: true,
      check: "rows",
      discarded: [],
      journal: [journal[0]],
      notes: [notes[0]],
      made: ["tide-chart.png"],
      said: "I drew this morning's tide and left Pat a question about calm days.",
      refused: [],
      trail: {
        woke: ["kes-m01"],
        waiting: ["kes-m04"],
        reached: ["kes-m05", "kes-m01"],
      },
    },
    {
      id: "kes-h2",
      kind: "dream",
      practice: false,
      status: "done",
      reason: "",
      start: iso(now - day - 6 * hour),
      end: iso(now - day - 5 * hour - 30 * 60_000),
      minutes: 30,
      model: "claude-sonnet-5",
      modelName: "Sonnet 5",
      tokens: 18_500,
      waiting: 0,
      untouched: true,
      check: "rows",
      discarded: [],
      journal: [],
      notes: [],
      made: ["night-sky.png"],
      said: "A dream over the old charts. Nothing kept but a picture of the sky.",
      refused: [],
      trail: { woke: ["kes-m10"], waiting: [], reached: [] },
    },
    {
      id: "kes-h3",
      kind: "ours",
      practice: true,
      status: "done",
      reason: "",
      start: iso(now - 4 * day - 3 * hour),
      end: iso(now - 4 * day - 2 * hour),
      minutes: 60,
      model: "claude-opus-5-5",
      modelName: "Opus 5.5",
      tokens: 52_000,
      waiting: 0,
      untouched: true,
      check: "rows",
      discarded: [],
      journal: [],
      notes: [],
      made: [],
      said: "Practice on a copy: sorted the ledger by season.",
      refused: [],
      trail: { woke: [], waiting: [], reached: ["kes-m03"] },
    },
  ];
  const life = {
    made: iso(now),
    identity: {
      agentId: "kestrel",
      model: "claude-opus-5-5",
      unfiled: false,
      name: "Kestrel",
      person: "Pat",
      personId: "pat-example",
      project: "lighthouse",
      store: "~/.mnemos/kestrel.db",
    },
    hours,
    schedule: [{ kind: "mine", when: "03:00", how: "launchd" }],
    jev: { on: false, key: false, env: false, host: "api.typesafe.ai" },
    shared: {
      status: "ready",
      rows: [
        {
          id: "kes-s1",
          content: "We keep the harbour log in pencil.",
          author: "person",
          person: "Pat",
          model: "",
          born: iso(now - 6 * day),
          editable: true,
        },
        {
          id: "kes-s2",
          content: "The tide goes first in the morning note.",
          author: "agent",
          person: "",
          model: "claude-opus-5-5",
          born: iso(now - 2 * day),
          editable: false,
        },
      ],
    },
    journal,
    notes,
    studio: [
      {
        path: "tide-chart.png",
        bytes: 800,
        at: iso(now - 4 * hour - 30 * 60_000),
        picture: "data/studio/tide-chart.png",
      },
      {
        path: "night-sky.png",
        bytes: 500,
        at: iso(now - day - 5 * hour - 40 * 60_000),
        picture: "data/studio/night-sky.png",
      },
    ],
    questions: {
      open: 3,
      byKind: { lesson: 1, fact: 1, impact: 1 },
      asked: [
        {
          id: "kes-q1",
          kind: "lesson",
          prompt: "What did the late ferry teach you? [kes-m04]",
          excerpt: "A late ferry means the fog came in early.",
          shown: 2,
          at: iso(now - day),
          about: "kes-m04",
        },
        {
          id: "kes-q2",
          kind: "fact",
          prompt: "Is the sandbar still marked too far north?",
          excerpt: "The old charts mark the sandbar a little too far north.",
          shown: 0,
          at: iso(now - 2 * day),
          about: "kes-m10",
        },
        {
          id: "kes-q3",
          kind: "impact",
          prompt: "What did the cold lamp room change?",
          excerpt: "The lamp room is coldest an hour before dawn.",
          shown: 1,
          at: iso(now - 3 * day),
          about: "kes-m06",
        },
      ],
      answered: [
        {
          kind: "reaffirm",
          prompt: "Still true: one short note beats three long ones?",
          excerpt: "Pat prefers one short note to three long ones.",
          answer: "Still true. Pat said so again last week.",
          at: iso(now - 5 * day),
          about: "kes-m07",
        },
        {
          kind: "lesson",
          prompt: "What did the gulls teach you?",
          excerpt: "Gulls gather on the north wall before a storm.",
          answer: "Look at the wall before the barometer.",
          at: iso(now - 8 * day),
          about: "kes-m02",
        },
      ],
    },
    memory: {
      states: { active: 11, dormant: 1, archived: 2 },
      newest: memories[11]?.born ?? null,
      storeBytes: 524_288,
      version: "kv1",
      count: 12,
    },
    beliefs: [
      {
        text: "The tide is the first thing Pat wants to know.",
        confidence: 0.84,
        born: iso(now - 20 * day),
        revised: iso(now - 2 * day),
        revisions: 2,
        history: [
          { at: iso(now - 10 * day), from: 0.6, to: 0.72 },
          { at: iso(now - 2 * day), from: 0.72, to: 0.84 },
        ],
        supports: ["kes-m01", "kes-m05"],
      },
      {
        text: "Fog and late ferries come together.",
        confidence: 0.58,
        born: iso(now - 12 * day),
        revised: null,
        revisions: 0,
        history: [],
        supports: ["kes-m04"],
      },
    ],
    handoffs: [
      {
        text: "Ask Pat whether calm days still lead with the tide.",
        at: iso(now - 4 * hour),
        model: "claude-opus-5-5",
      },
      {
        text: "Check the east buoy's ring after the storm.",
        at: iso(now - 3 * day),
        model: "claude-sonnet-5",
      },
    ],
  };
  return { life, memories, version: "kv1", recalled: ["kes-m01", "kes-m05"] };
}
