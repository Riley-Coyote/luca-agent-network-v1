import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * WP-LAB2 · the lab's fixture is a REAL capture, and stays one.
 *
 * The point of this package was that the previous lab's narration was
 * invented. These assertions are the guard: if someone hand-edits a nicer
 * phrase into the fixture, or points it at something that is not a resident
 * turn, this fails.
 */
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/real-turn-2026-09-11.json", import.meta.url),
    "utf8",
  ),
);

test("the fixture is a captured resident turn, not a hand-written one", () => {
  assert.match(fixture.capturedFrom, /\.codex\/sessions\/.*rollout-.*\.jsonl$/);
  assert.equal(fixture.originator, "buzz-acp");
  assert.match(fixture.cwd, /\.buzz$/);
  assert.ok(fixture.durationMs > 60_000, "a real turn, not a stub");
  assert.equal(fixture.frames.length, fixture.frameCount);
});

test("every frame is an acp_read session/update the desktop would ingest", () => {
  for (const frame of fixture.frames) {
    assert.equal(frame.kind, "acp_read");
    assert.equal(frame.payload.method, "session/update");
    assert.ok(frame.payload.params.update.sessionUpdate);
    assert.ok(Date.parse(frame.at) > 0);
  }
});

test("frames only carry the kinds deriveActivity understands", () => {
  const allowed = new Set([
    "agent_thought_chunk",
    "agent_message_chunk",
    "tool_call",
    "tool_call_update",
  ]);
  for (const frame of fixture.frames) {
    assert.ok(allowed.has(frame.payload.params.update.sessionUpdate));
  }
});

test("every tool_call carries an object the status line can name", () => {
  const calls = fixture.frames
    .map((frame) => frame.payload.params.update)
    .filter((update) => update.sessionUpdate === "tool_call");
  assert.ok(calls.length > 20, "the turn did real work");
  for (const call of calls) {
    assert.ok(call.title && call.title.length > 0, "a title off the frame");
    assert.ok(["read", "search", "execute", "edit"].includes(call.kind));
    if (call.kind === "read" && call.locations) {
      assert.ok(call.locations[0].path.length > 0);
    }
  }
});

test("the phrases are the resident's, not the lab's", () => {
  // An invention check. Deliberately narrow: Luca's own prose in this turn
  // uses the word "placeholder", so a generic filler-word blocklist would
  // fail on real writing. What must never appear is the sentence the previous
  // lab made up, or stand-in copy.
  const raw = JSON.stringify(fixture);
  for (const banned of [
    "Two of the entries under Fixed",
    "Lorem ipsum",
    "the quick brown fox",
  ]) {
    assert.ok(!raw.includes(banned), `fixture contains ${banned}`);
  }
});
