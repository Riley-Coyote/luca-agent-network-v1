import assert from "node:assert/strict";
import test from "node:test";

import { normalizeManagedPermissionRequest } from "./managedPermissions.ts";

test("normalizes the bounded action preview without changing runtime choices", () => {
  const request = normalizeManagedPermissionRequest({
    protocol: "luca.managed.permission.v1",
    resident_pubkey: "11".repeat(32),
    conversation_id: "conversation-1",
    session_epoch: 7,
    turn_id: "turn-1",
    acp_request_id: '"permission-1"',
    title: "Running git status --short",
    tool_call_id: "codex-call-1",
    action_preview: "git status --short",
    options: [
      { option_id: "allow-exact", name: "Allow", kind: "allow_once" },
      { option_id: "deny-exact", name: "Decline", kind: "reject_once" },
    ],
  });

  assert.equal(request.protocol, "luca.managed.permission.v1");
  assert.equal(request.actionPreview, "git status --short");
  assert.deepEqual(
    request.options.map((option) => option.optionId),
    ["allow-exact", "deny-exact"],
  );
});

test("keeps an omitted action preview backwards compatible", () => {
  const request = normalizeManagedPermissionRequest({
    protocol: "luca.managed.permission.v1",
    resident_pubkey: "11".repeat(32),
    conversation_id: "conversation-1",
    session_epoch: 7,
    turn_id: "turn-1",
    acp_request_id: "7",
    title: "Legacy permission",
    options: [{ option_id: "allow", name: "Allow", kind: "allow_once" }],
  });

  assert.equal(request.actionPreview, null);
});
