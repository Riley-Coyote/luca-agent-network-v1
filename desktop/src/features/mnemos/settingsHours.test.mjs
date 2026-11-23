import assert from "node:assert/strict";
import test from "node:test";

import { scheduleOf } from "./boardWords.ts";
import {
  changeSentence,
  confirmOnce,
  DEFAULT_TIMES,
  hoursWrite,
  sameHours,
  savedHours,
} from "./settingsHours.ts";

test("what's saved: the schedule's own times, the notebook's defaults where none", () => {
  assert.deepEqual(savedHours([]), { on: false, ...DEFAULT_TIMES });
  const plan = scheduleOf([
    { kind: "mine", when: { Hour: 7, Minute: 15 }, loaded: true },
    { kind: "dream", when: { Hour: 3, Minute: 5 }, loaded: true },
  ]);
  assert.deepEqual(savedHours(plan), {
    on: true,
    mine: "07:15",
    ours: "19:00",
    dream: "03:05",
  });
  // Off is off, whatever times the fields still hold.
  assert.ok(
    sameHours(
      { on: false, ...DEFAULT_TIMES },
      { on: false, mine: "01:00", ours: "", dream: "" },
    ),
  );
  assert.ok(
    !sameHours(savedHours(plan), { ...savedHours(plan), ours: "20:00" }),
  );
});

test("the change is said back in one plain sentence first", () => {
  const off = { on: false, ...DEFAULT_TIMES };
  const on = { on: true, mine: "08:00", ours: "19:00", dream: "03:30" };
  assert.deepEqual(changeSentence("Kestrel", off, on), {
    title: "Turn on its quiet hours?",
    text: "This sets a small job on this Mac that wakes Kestrel at 8:00 am for its own hour, 7:00 pm for our hour and 3:30 am to dream.",
    yes: "Turn them on",
  });
  assert.equal(
    changeSentence("Kestrel", on, { ...on, ours: "20:30" }).text,
    "This changes the small job on this Mac that wakes Kestrel: at 8:00 am for its own hour, 8:30 pm for our hour and 3:30 am to dream.",
  );
  assert.equal(changeSentence("Kestrel", on, off).yes, "Turn them off");
  assert.deepEqual(hoursWrite(on), {
    command: "hours",
    on: true,
    mine: "08:00",
    ours: "19:00",
    dream: "03:30",
  });
  assert.deepEqual(hoursWrite(off), { command: "hours", on: false });
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
  const engine = counting("Quiet hours are on.");
  const confirm = confirmOnce(engine.send);
  confirm.ask({ command: "hours", on: true });
  confirm.ask({ command: "hours", on: false });
  assert.equal(engine.sent.length, 0, "asking sends nothing");
  assert.deepEqual(confirm.asking(), { command: "hours", on: false });
  // Two yeses at once: one request.
  const first = confirm.yes();
  const second = confirm.yes();
  assert.equal(engine.sent.length, 1);
  engine.release();
  assert.deepEqual(await first, { sent: true, said: "Quiet hours are on." });
  assert.deepEqual(await second, { sent: false });
  // After it went, another yes sends nothing until asked again.
  assert.deepEqual(await confirm.yes(), { sent: false });
  assert.equal(engine.sent.length, 1);
  assert.deepEqual(engine.sent[0], { command: "hours", on: false });
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
