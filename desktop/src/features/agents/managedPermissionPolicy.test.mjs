import assert from "node:assert/strict";
import test from "node:test";

import {
  canRememberCapabilityPermission,
  PERMISSION_TENSE_WIRE_VALUE,
  runtimePermissionOffer,
  visiblePermissionTenses,
} from "./managedPermissionPolicy.ts";

function request(capability, risk) {
  return { capability, risk };
}

test("repo_run high-impact process execution never offers a durable option", () => {
  assert.equal(
    canRememberCapabilityPermission(request("process_execute", "high_impact")),
    false,
  );
});

test("external, destructive, and credential authority is never durable", () => {
  for (const capability of [
    "external_communication",
    "destructive_action",
    "credential_use",
  ]) {
    assert.equal(
      canRememberCapabilityPermission(request(capability, "routine")),
      false,
    );
  }
  assert.equal(
    canRememberCapabilityPermission(request("filesystem_write", "elevated")),
    true,
  );
});

function pending(offer) {
  return {
    pendingId: "pending-1",
    request: { protocol: "luca.managed.permission.v1" },
    ...(offer === undefined ? {} : { offer }),
  };
}

test("runtime_offer_defaults_to_once_and_deny_when_backend_sent_none", () => {
  for (const missing of [pending(undefined), pending(null)]) {
    assert.deepEqual(runtimePermissionOffer(missing), {
      once: true,
      task: false,
      alwaysHere: false,
      deny: true,
      projectLabel: null,
      remembers: [],
      note: null,
    });
  }
});

test("runtime_offer_passes_backend_tenses_through", () => {
  const offer = {
    once: true,
    task: true,
    alwaysHere: true,
    deny: true,
    projectLabel: "luca-agent-network",
    note: null,
  };
  assert.deepEqual(runtimePermissionOffer(pending(offer)), offer);
  const door = {
    once: true,
    task: false,
    alwaysHere: false,
    deny: true,
    projectLabel: null,
    note: "This one always asks.",
  };
  assert.deepEqual(runtimePermissionOffer(pending(door)), door);
});

function offer(overrides) {
  return {
    once: false,
    task: false,
    alwaysHere: false,
    deny: false,
    projectLabel: null,
    remembers: [],
    note: null,
    ...overrides,
  };
}

test("beta.13 P3: the card offers exactly Deny, Once, Always, in that order", () => {
  assert.deepEqual(
    visiblePermissionTenses(offer({ deny: true, once: true, alwaysHere: true })),
    ["deny", "once", "always"],
  );
});

test("a subset offer keeps the same relative order", () => {
  assert.deepEqual(visiblePermissionTenses(offer({ once: true, deny: true })), [
    "deny",
    "once",
  ]);
  assert.deepEqual(visiblePermissionTenses(offer({ deny: true })), ["deny"]);
  assert.deepEqual(visiblePermissionTenses(offer({})), []);
});

test('"for this task" never becomes a fourth button, even if `task` is true', () => {
  const withTask = offer({
    deny: true,
    once: true,
    alwaysHere: true,
    task: true,
  });
  assert.deepEqual(visiblePermissionTenses(withTask), [
    "deny",
    "once",
    "always",
  ]);
});

test("each visible tense sends the wire value the ledger expects", () => {
  assert.equal(PERMISSION_TENSE_WIRE_VALUE.deny, "deny");
  assert.equal(PERMISSION_TENSE_WIRE_VALUE.once, "once");
  // "Always" is still the `always_here` tense on the wire — beta.13 widened
  // what it can remember, not the protocol's name for it.
  assert.equal(PERMISSION_TENSE_WIRE_VALUE.always, "always_here");
});
