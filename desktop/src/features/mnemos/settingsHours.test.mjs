import assert from "node:assert/strict";
import test from "node:test";

import { webOfHour, webPage } from "./hourWeb.ts";
import { lifeOf, quietHoursOf } from "./notebookShapes.ts";
import {
  clockWords,
  confirmOnce,
  HOUR_ROWS,
  hermesHour,
  hourLine,
  hoursAsk,
  hoursChanged,
  hoursHint,
  hoursWrite,
  LENGTHS,
  lengthsFor,
  lengthWord,
  onlineLine,
  savedHours,
} from "./settingsHours.ts";

/** The fixture's hours, as Mnemos 0.7.0 gives them (`life.quietHours`). */
const HERE = {
  where: "here",
  hours: {
    mine: { on: true, at: "08:00", minutes: 60, online: true },
    ours: { on: true, at: "19:00", minutes: 30, online: false },
    dream: { on: false, at: "03:30", minutes: 20, online: false },
  },
  cant: null,
};

const saved = () => savedHours(quietHoursOf(structuredClone(HERE)));
const edit = (hours, kind, patch) => ({
  ...hours,
  [kind]: { ...hours[kind], ...patch },
});

test("reading quietHours here: each hour by itself, in the notebook's order", () => {
  assert.deepEqual(
    HOUR_ROWS.map((r) => [r.kind, r.label]),
    [
      ["mine", "Its own hour"],
      ["ours", "Our hour"],
      ["dream", "The dream"],
    ],
  );
  assert.deepEqual(saved(), HERE.hours);
  // The dream is never online, whatever it says; a missing field is its
  // plain empty value.
  const odd = quietHoursOf({
    where: "here",
    hours: { mine: { on: true }, dream: { on: true, online: true } },
    cant: "",
  });
  assert.deepEqual(savedHours(odd), {
    mine: { on: true, at: "", minutes: null, online: false },
    ours: { on: false, at: "", minutes: null, online: false },
    dream: { on: true, at: "", minutes: null, online: false },
  });
  assert.equal(odd.cant, null);
});

test("reading quietHours with cant, inside Hermes, unreadable, and missing", () => {
  const cant = quietHoursOf({
    ...HERE,
    cant: "None can be turned on here: Claude Code isn't installed.",
  });
  assert.equal(cant.where, "here");
  assert.equal(
    cant.cant,
    "None can be turned on here: Claude Code isn't installed.",
  );
  assert.deepEqual(savedHours(cant), HERE.hours, "the rows still read");

  const hermes = quietHoursOf({
    where: "hermes",
    hours: {
      mine: {
        at: "08:00",
        on: true,
        online: true,
        limited: true,
        made_by: "x",
      },
      ours: null,
      dream: { at: "03:30", on: true, online: false, limited: true },
    },
  });
  assert.equal(hermes.where, "hermes");
  assert.equal(savedHours(hermes), null, "nothing to set inside Hermes");
  assert.deepEqual(hermesHour("mine", hermes.hours), {
    state: "On",
    starts: { label: "Starts at", value: "8:00 am" },
    online: {
      label: "Can go online",
      line: "It can search and read the web in this hour.",
    },
    notLimited: false,
  });
  assert.deepEqual(hermesHour("ours", hermes.hours), {
    state: "Off",
    starts: null,
    online: null,
    notLimited: false,
  });
  assert.deepEqual(hermesHour("dream", hermes.hours).online, {
    label: "Never online.",
    line: null,
  });
  const loose = quietHoursOf({
    where: "hermes",
    hours: {
      mine: { at: "every morning", on: true, online: false, limited: false },
    },
  });
  assert.deepEqual(hermesHour("mine", loose.hours), {
    state: "On",
    starts: { label: "Runs on Hermes’s schedule", value: "every morning" },
    online: { label: "Offline", line: null },
    notLimited: true,
  });
  const unread = quietHoursOf({ where: "hermes", hours: null });
  assert.equal(unread.hours, null);
  assert.equal(hermesHour("mine", unread.hours).state, "Can’t tell");

  // Here, but couldn't be read: nothing to set.
  assert.equal(
    savedHours(quietHoursOf({ where: "here", hours: null, cant: null })),
    null,
  );
  // A Mnemos from before 0.7.0 gives none at all.
  for (const none of [undefined, null, "here", [], { where: "elsewhere" }])
    assert.equal(quietHoursOf(none), null, String(none));
  assert.equal(lifeOf({}).quietHours, null);
  assert.equal(lifeOf({ quietHours: HERE }).quietHours.where, "here");
});

test("the lengths menu: the notebook's seven, and an odd saved length in its place", () => {
  assert.deepEqual(LENGTHS, [10, 20, 30, 45, 60, 90, 120]);
  assert.deepEqual(LENGTHS.map(lengthWord), [
    "10 minutes",
    "20 minutes",
    "30 minutes",
    "45 minutes",
    "An hour",
    "An hour and a half",
    "Two hours",
  ]);
  assert.deepEqual(lengthsFor(60), LENGTHS);
  assert.deepEqual(lengthsFor(25), [10, 20, 25, 30, 45, 60, 90, 120]);
  assert.deepEqual(lengthsFor(5), [5, 10, 20, 30, 45, 60, 90, 120]);
  assert.equal(lengthWord(25), "25 minutes");
  assert.deepEqual(lengthsFor(null), LENGTHS);
});

test("what Save sends: only what changed, each hour carrying on as it will be", () => {
  const was = saved();
  // Nothing changed: nothing to send.
  assert.deepEqual(hoursChanged(was, was), {});
  // One hour on, offline: it carries on, and nothing it already has.
  assert.deepEqual(hoursChanged(edit(was, "dream", { on: true }), was), {
    dream: { on: true },
  });
  // One hour on with a new time and length.
  assert.deepEqual(
    hoursChanged(
      edit(was, "dream", { on: true, at: "04:15", minutes: 10 }),
      was,
    ),
    { dream: { on: true, at: "04:15", minutes: 10 } },
  );
  // Online turned on, alone.
  assert.deepEqual(hoursChanged(edit(was, "ours", { online: true }), was), {
    ours: { on: true, online: true },
  });
  // A time change alone; a length change alone.
  assert.deepEqual(hoursChanged(edit(was, "mine", { at: "07:30" }), was), {
    mine: { on: true, at: "07:30" },
  });
  assert.deepEqual(hoursChanged(edit(was, "ours", { minutes: 45 }), was), {
    ours: { on: true, minutes: 45 },
  });
  // An hour turned off carries on: false and nothing else, whatever else
  // was touched before.
  assert.deepEqual(
    hoursChanged(
      edit(was, "mine", { on: false, at: "06:00", minutes: 20, online: false }),
      was,
    ),
    { mine: { on: false } },
  );
  // The dream never carries online, even if something set it.
  assert.deepEqual(
    hoursChanged(edit(was, "dream", { on: true, online: true }), was),
    { dream: { on: true } },
  );
  // Several hours in one request.
  const many = edit(
    edit(edit(was, "mine", { on: false }), "ours", {
      at: "20:00",
      online: true,
    }),
    "dream",
    { on: true, minutes: 10 },
  );
  assert.deepEqual(hoursWrite(hoursChanged(many, was)), {
    command: "hours",
    hours: {
      mine: { on: false },
      ours: { on: true, at: "20:00", online: true },
      dream: { on: true, minutes: 10 },
    },
  });
  // A time field emptied is not sent.
  assert.deepEqual(hoursChanged(edit(was, "mine", { at: "" }), was), {});
  // Changed and changed back: nothing.
  assert.deepEqual(
    hoursChanged(
      edit(edit(was, "ours", { on: false }), "ours", { on: true }),
      was,
    ),
    {},
  );
});

test("the foot: unsaved, the engine's last words, scheduled, or all off", () => {
  const was = saved();
  assert.equal(hoursHint(was, {}, null), "Scheduled on this Mac.");
  assert.equal(
    hoursHint(was, { dream: { on: true } }, "Said before."),
    "Not saved yet.",
  );
  assert.equal(hoursHint(was, {}, "The dream: on."), "The dream: on.");
  const off = Object.fromEntries(
    Object.entries(was).map(([k, h]) => [k, { ...h, on: false }]),
  );
  assert.equal(
    hoursHint(off, {}, null),
    "All off. Nothing runs between conversations.",
  );
  assert.equal(
    onlineLine(true),
    "It can search and read the web in this hour. Every page it reads is listed in Hours.",
  );
  assert.equal(
    onlineLine(false),
    "It can’t search or read the web in this hour.",
  );
});

test("the confirm: a line for each hour that changes, and only the true sentences", () => {
  const was = saved();
  assert.equal(clockWords("08:00"), "8:00 am");
  assert.equal(clockWords("19:00"), "7:00 pm");
  assert.equal(
    hourLine("mine", was.mine),
    "Its own hour: on, daily at 8:00 am, up to an hour, online.",
  );
  assert.equal(hourLine("ours", { ...was.ours, on: false }), "Our hour: off.");
  assert.equal(
    hourLine("dream", { on: true, at: "04:15", minutes: 10, online: false }),
    "The dream: on, daily at 4:15 am, up to 10 minutes, never online.",
  );
  assert.equal(
    hourLine("ours", { on: true, at: "19:00", minutes: 90, online: false }),
    "Our hour: on, daily at 7:00 pm, up to an hour and a half, offline.",
  );

  const ask = (now) => hoursAsk("Kestrel", hoursChanged(now, was), now, was);
  // An hour turned on, offline.
  assert.deepEqual(
    ask(edit(was, "dream", { on: true, at: "04:15", minutes: 10 })),
    {
      title: "Save these quiet hours?",
      lines: [
        "The dream: on, daily at 4:15 am, up to 10 minutes, never online.",
      ],
      sentences: [
        "Turning an hour on sets a small job on this Mac that wakes Kestrel at that time.",
      ],
    },
  );
  // One turned off.
  assert.deepEqual(ask(edit(was, "ours", { on: false })), {
    title: "Save these quiet hours?",
    lines: ["Our hour: off."],
    sentences: ["Turning one off takes its job away."],
  });
  // Online from off to on.
  assert.deepEqual(ask(edit(was, "ours", { online: true })).sentences, [
    "Online, it can search and read the web in that hour. Every page it reads is listed in Hours.",
  ]);
  // Online from on to off says none of them; a time change neither.
  assert.deepEqual(ask(edit(was, "mine", { online: false })).sentences, []);
  assert.deepEqual(ask(edit(was, "mine", { at: "07:00" })), {
    title: "Save these quiet hours?",
    lines: ["Its own hour: on, daily at 7:00 am, up to an hour, online."],
    sentences: [],
  });
  // Several at once: in the notebook's order, every true sentence once.
  const many = edit(
    edit(edit(was, "dream", { on: true }), "mine", { on: false }),
    "ours",
    { online: true },
  );
  assert.deepEqual(ask(many), {
    title: "Save these quiet hours?",
    lines: [
      "Its own hour: off.",
      "Our hour: on, daily at 7:00 pm, up to 30 minutes, online.",
      "The dream: on, daily at 3:30 am, up to 20 minutes, never online.",
    ],
    sentences: [
      "Turning an hour on sets a small job on this Mac that wakes Kestrel at that time.",
      "Turning one off takes its job away.",
      "Online, it can search and read the web in that hour. Every page it reads is listed in Hours.",
    ],
  });
});

test("the web group: an http or https page opens, by host and path; any other address only reads", () => {
  assert.deepEqual(webPage("https://tides.example.org/harbour/today?x=1"), {
    written: "https://tides.example.org/harbour/today?x=1",
    shown: "tides.example.org/harbour/today",
    href: "https://tides.example.org/harbour/today?x=1",
  });
  assert.deepEqual(webPage("http://example.com/"), {
    written: "http://example.com/",
    shown: "example.com",
    href: "http://example.com/",
  });
  for (const other of [
    "ftp://charts.example.net/old.pdf",
    "javascript:alert(1)",
    "file:///Users/pat/notes.txt",
    "data:text/html,<b>x</b>",
    "not an address",
    "<img src=x onerror=alert(1)>",
  ])
    assert.deepEqual(
      webPage(other),
      { written: other, shown: other, href: null },
      other,
    );
  // Text only, as the hour wrote it; empty entries and non-strings left out
  // when the notebook is read.
  const life = lifeOf({
    hours: [
      {
        id: "h1",
        online: true,
        web: {
          read: ["https://a.example/x", "", 7, "<b>bold</b>"],
          searched: ["spring tides <i>north</i>", null, ""],
        },
      },
      { id: "h2", online: false },
      { id: "h3" },
    ],
  });
  const [h1, h2, h3] = life.hours;
  assert.equal(h1.online, true);
  assert.deepEqual(h1.web, {
    read: ["https://a.example/x", "<b>bold</b>"],
    searched: ["spring tides <i>north</i>"],
  });
  assert.deepEqual(
    webOfHour(h1.web).read.map((p) => p.href),
    ["https://a.example/x", null],
  );
  assert.equal(h2.online, false);
  assert.deepEqual(h2.web, { read: [], searched: [] });
  assert.equal(h3.online, null);
});

/** A made-up send that counts what it was given. */
function counting(answer = "said") {
  const sent = [];
  let release;
  const send = (write) => {
    sent.push(write);
    return new Promise((resolve) => {
      release = () => resolve(answer);
    });
  };
  return { sent, send, release: () => release() };
}

test("the confirm: nothing is sent before the yes; exactly one request after", async () => {
  const engine = counting("The dream: on.");
  const confirm = confirmOnce(engine.send);
  confirm.ask(hoursWrite({ dream: { on: true } }));
  confirm.ask(hoursWrite({ mine: { on: false } }));
  assert.equal(engine.sent.length, 0, "asking sends nothing");
  assert.deepEqual(confirm.asking(), {
    command: "hours",
    hours: { mine: { on: false } },
  });
  // Two yeses at once: one request.
  const first = confirm.yes();
  const second = confirm.yes();
  assert.equal(engine.sent.length, 1);
  engine.release();
  assert.deepEqual(await first, { sent: true, said: "The dream: on." });
  assert.deepEqual(await second, { sent: false });
  // After it went, another yes sends nothing until asked again.
  assert.deepEqual(await confirm.yes(), { sent: false });
  assert.equal(engine.sent.length, 1);
  assert.deepEqual(engine.sent[0], {
    command: "hours",
    hours: { mine: { on: false } },
  });
});

test("the confirm: no lets the ask go unsent; a failure sends once and stays failed", async () => {
  const engine = counting();
  const confirm = confirmOnce(engine.send);
  confirm.ask({
    command: "shared",
    action: "forget",
    memory_id: "s1",
    confirmed: true,
  });
  confirm.no();
  assert.deepEqual(await confirm.yes(), { sent: false });
  assert.equal(engine.sent.length, 0);

  const refusing = confirmOnce(async (write) => {
    refusing.count = (refusing.count ?? 0) + 1;
    throw { kind: "said", said: `No: ${write}` };
  });
  refusing.ask("x");
  await assert.rejects(refusing.yes(), { kind: "said", said: "No: x" });
  assert.equal(refusing.count, 1);
  assert.deepEqual(
    await refusing.yes(),
    { sent: false },
    "not resent by itself",
  );
});
