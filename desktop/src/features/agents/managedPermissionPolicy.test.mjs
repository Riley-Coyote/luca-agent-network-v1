import assert from "node:assert/strict";
import test from "node:test";

import {
  canRememberCapabilityPermission,
  runtimePermissionOffer,
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
