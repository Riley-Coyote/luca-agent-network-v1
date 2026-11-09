import assert from "node:assert/strict";
import { test } from "node:test";

import { ResidentStopState } from "./residentStopState.ts";

test("Stop admits each resident once synchronously, without serializing other residents", () => {
  const state = new ResidentStopState();
  const first = state.begin(["luca", "luca"]);
  assert.deepEqual(first.targets, ["luca"]);
  assert.equal(state.begin(["luca"]), null);
  assert.deepEqual(state.begin(["luca", "anima"]).targets, ["anima"]);
  assert.deepEqual(
    [...state.snapshot],
    [
      ["luca", "stopping"],
      ["anima", "stopping"],
    ],
  );
});

test("clearing a pending Stop invalidates its late completion and its old timer", () => {
  const state = new ResidentStopState();
  const old = state.begin(["luca"]);
  state.clear("luca");
  const next = state.begin(["luca"]);
  assert.equal(state.settle(old, new Map([["luca", "stopped"]])).size, 0);
  state.expire(old, "luca");
  assert.equal(state.snapshot.get("luca"), "stopping");
  state.settle(next, new Map([["luca", "stopped"]]));
  state.expire(old, "luca");
  assert.equal(state.snapshot.get("luca"), "stopped");
  state.expire(next, "luca");
  assert.equal(state.snapshot.size, 0);
});

test("a terminal settle cannot regress, duplicate, or invent a resident transition", () => {
  const state = new ResidentStopState();
  const request = state.begin(["luca"]);
  assert.equal(state.settle(request, new Map([["luca", "working"]])).size, 0);
  assert.equal(state.settle(request, new Map([["anima", "stopped"]])).size, 0);
  state.settle(request, new Map([["luca", "needs-attention"]]));
  assert.equal(state.settle(request, new Map([["luca", "stopped"]])).size, 0);
  assert.equal(state.snapshot.get("luca"), "needs-attention");
});

test("separate conversation incarnations never share Stop presentation", () => {
  const a = new ResidentStopState();
  const request = a.begin(["luca"]);
  const b = new ResidentStopState();
  const returnToA = new ResidentStopState();
  b.begin(["luca"]);
  returnToA.begin(["luca"]);
  a.settle(request, new Map([["luca", "needs-attention"]]));
  assert.equal(b.snapshot.get("luca"), "stopping");
  assert.equal(returnToA.snapshot.get("luca"), "stopping");
  assert.notEqual(a.snapshot, b.snapshot);
});

test("a newer same-phase terminal state survives the earlier request's expiry", () => {
  const state = new ResidentStopState();
  const first = state.begin(["luca"]);
  state.settle(first, new Map([["luca", "stopped"]]));
  const next = state.begin(["luca"]);
  state.settle(next, new Map([["luca", "stopped"]]));
  state.expire(first, "luca");
  assert.equal(state.snapshot.get("luca"), "stopped");
  state.expire(next, "luca");
  assert.equal(state.snapshot.size, 0);
});

test("new work stays stoppable while an earlier exact Stop is still pending", () => {
  const state = new ResidentStopState();
  const oldWork = new Map([["luca", "receipt-1:epoch-7"]]);
  const newWork = new Map([["luca", "receipt-2:epoch-8"]]);
  const old = state.begin(["luca"], oldWork);
  assert.deepEqual(state.retireReplaced(oldWork), []);
  assert.deepEqual(state.retireReplaced(new Map()), []);
  assert.deepEqual(state.retireReplaced(newWork), ["luca"]);
  const next = state.begin(["luca"], newWork);
  assert.ok(next);
  assert.equal(state.settle(old, new Map([["luca", "stopped"]])).size, 0);
  state.expire(old, "luca");
  assert.equal(state.snapshot.get("luca"), "stopping");
  state.settle(next, new Map([["luca", "stopped"]]));
  assert.equal(state.snapshot.get("luca"), "stopped");
  const unknown = new ResidentStopState();
  unknown.begin(["luca"]);
  assert.deepEqual(unknown.retireReplaced(newWork), []);
  assert.equal(unknown.snapshot.get("luca"), "stopping");
});
