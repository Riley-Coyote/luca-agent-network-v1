import assert from "node:assert/strict";
import test from "node:test";

import { canRememberCapabilityPermission } from "./managedPermissionPolicy.ts";

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
