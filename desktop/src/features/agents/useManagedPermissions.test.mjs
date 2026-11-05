import assert from "node:assert/strict";
import test from "node:test";

import { createManagedPermissionRefresh } from "./useManagedPermissions.ts";

function fixture() {
  const requests = [];
  const snapshots = [];
  const refresh = createManagedPermissionRefresh(
    () =>
      new Promise((resolve, reject) => {
        requests.push({ resolve, reject });
      }),
    (pending) => snapshots.push(pending),
  );
  return { ...refresh, requests, snapshots };
}

const permission = { pendingId: "mira-public-page" };

test("an older empty snapshot cannot hide a newly pending delegated approval", async () => {
  const state = fixture();
  const initial = state.refresh();
  const pending = state.refresh();
  state.requests[1].resolve([permission]);
  await pending;
  state.requests[0].resolve([]);
  await initial;
  assert.deepEqual(state.snapshots, [[permission]]);
});

test("an older pending snapshot cannot resurrect an answered approval", async () => {
  const state = fixture();
  const pending = state.refresh();
  const resolved = state.refresh();
  state.requests[1].resolve([]);
  await resolved;
  state.requests[0].resolve([permission]);
  await pending;
  assert.deepEqual(state.snapshots, [[]]);
});

test("a stale read failure cannot erase the latest approval", async () => {
  const state = fixture();
  const initial = state.refresh();
  const pending = state.refresh();
  state.requests[1].resolve([permission]);
  await pending;
  state.requests[0].reject(new Error("old read failed"));
  await initial;
  assert.deepEqual(state.snapshots, [[permission]]);
});

test("the latest read failure stays fail-closed", async () => {
  const state = fixture();
  const pending = state.refresh();
  state.requests[0].reject(new Error("read failed"));
  await pending;
  // The empty snapshot removes actionable controls, never grants access.
  assert.deepEqual(state.snapshots, [[]]);
});

test("a disposed subscription cannot publish its in-flight snapshot", async () => {
  const state = fixture();
  const pending = state.refresh();
  state.dispose();
  state.requests[0].resolve([permission]);
  await pending;
  assert.deepEqual(state.snapshots, []);
});
