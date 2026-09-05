import assert from "node:assert/strict";
import test from "node:test";

import {
  installNavigationViewTransitions,
  observeNavigationTransitionReady,
} from "./navigationViewTransitions.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function transition() {
  return {
    ready: Promise.resolve(),
    updateCallbackDone: Promise.resolve(),
    finished: Promise.resolve(),
    skipTransition() {},
  };
}

test("successful readiness does not inspect or replace callback completion", async () => {
  const ready = deferred();
  const native = {
    ready: ready.promise,
    get updateCallbackDone() {
      throw new Error("a successful animation needs no callback observer");
    },
  };
  const observed = observeNavigationTransitionReady(native);
  ready.resolve();
  assert.equal(await observed, undefined);
  assert.equal(native.ready, ready.promise);
});

test("a skipped ready is handled only after the original update succeeds", async () => {
  const ready = deferred();
  const update = deferred();
  let settled = false;
  const observed = observeNavigationTransitionReady({
    ready: ready.promise,
    updateCallbackDone: update.promise,
  }).then(() => {
    settled = true;
  });
  ready.reject(new DOMException("Transition was skipped", "AbortError"));
  await Promise.resolve();
  assert.equal(settled, false);
  update.resolve();
  await observed;
  assert.equal(settled, true);
});

for (const error of [
  new Error("callback failed"),
  new DOMException("duplicate transition name", "InvalidStateError"),
  Object.assign(new Error("not a native skip"), { name: "AbortError" }),
]) {
  test(`non-skip readiness failure remains observable: ${error.message}`, async () => {
    await assert.rejects(
      observeNavigationTransitionReady({
        ready: Promise.reject(error),
        updateCallbackDone: Promise.resolve(),
      }),
      (actual) => actual === error,
    );
  });
}

for (const callbackError of [
  new Error("real update failure"),
  new DOMException("Transition was skipped", "AbortError"),
]) {
  test(`a failed original update is preserved after ready AbortError: ${callbackError.name}`, async () => {
    const update = deferred();
    const observed = observeNavigationTransitionReady({
      ready: Promise.reject(
        new DOMException("Transition was skipped", "AbortError"),
      ),
      updateCallbackDone: update.promise,
    });
    const rejection = assert.rejects(
      observed,
      (actual) => actual === callbackError,
    );
    update.reject(callbackError);
    await rejection;
  });
}

test("native receiver, arguments, object, lifecycle promises and methods are preserved", async () => {
  const native = transition();
  const calls = [];
  let updates = 0;
  const host = {
    startViewTransition(...args) {
      calls.push({ receiver: this, args });
      return native;
    },
  };
  const original = host.startViewTransition;
  const restore = installNavigationViewTransitions(host);
  const update = () => {
    updates += 1;
  };
  const options = { update, types: ["deeper"] };
  for (const argument of [update, options]) {
    const actual = host.startViewTransition(argument);
    assert.equal(actual, native);
    assert.equal(actual.ready, native.ready);
    assert.equal(actual.updateCallbackDone, native.updateCallbackDone);
    assert.equal(actual.finished, native.finished);
    assert.equal(actual.skipTransition, native.skipTransition);
    assert.equal(calls.at(-1).receiver, host);
    assert.equal(calls.at(-1).args[0], argument);
  }
  assert.equal(
    updates,
    0,
    "only the native method may invoke the update callback",
  );
  assert.equal(calls.length, 2);
  await native.ready;
  restore();
  assert.equal(host.startViewTransition, original);
});

test("unsupported environments are unchanged", () => {
  assert.doesNotThrow(() => installNavigationViewTransitions()());
  const host = {};
  installNavigationViewTransitions(host)();
  assert.deepEqual(host, {});
});

test("repeat installation is idempotent and restoration preserves the descriptor", () => {
  const host = { startViewTransition: () => transition() };
  const descriptor = Object.getOwnPropertyDescriptor(
    host,
    "startViewTransition",
  );
  const restore = installNavigationViewTransitions(host);
  const installed = host.startViewTransition;
  assert.equal(installNavigationViewTransitions(host), restore);
  assert.equal(host.startViewTransition, installed);
  restore();
  restore();
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(host, "startViewTransition"),
    descriptor,
  );
});

test("restoration removes only its own override of an inherited native method", () => {
  const prototype = { startViewTransition: () => transition() };
  const host = Object.create(prototype);
  const restore = installNavigationViewTransitions(host);
  assert.equal(Object.hasOwn(host, "startViewTransition"), true);
  restore();
  assert.equal(Object.hasOwn(host, "startViewTransition"), false);
  assert.equal(host.startViewTransition, prototype.startViewTransition);
});

test("cleanup cannot clobber a later wrapper or installation", () => {
  const host = { startViewTransition: () => transition() };
  const first = installNavigationViewTransitions(host);
  const laterWrapper = () => transition();
  host.startViewTransition = laterWrapper;
  first();
  assert.equal(host.startViewTransition, laterWrapper);
  const second = installNavigationViewTransitions(host);
  const secondWrapper = host.startViewTransition;
  first();
  assert.equal(host.startViewTransition, secondWrapper);
  second();
  assert.equal(host.startViewTransition, laterWrapper);
});

test("a synchronous native start failure propagates unchanged", () => {
  const error = new Error("native start failed");
  const host = {
    startViewTransition() {
      throw error;
    },
  };
  const restore = installNavigationViewTransitions(host);
  assert.throws(
    () => host.startViewTransition(() => {}),
    (actual) => actual === error,
  );
  restore();
});
