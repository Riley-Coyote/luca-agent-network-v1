import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeManagedPermissionRequest,
  normalizePending,
} from "./managedPermissions.ts";

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

test("carries the beta.11 match fields when the harness sends them", () => {
  const request = normalizeManagedPermissionRequest({
    protocol: "luca.managed.permission.v1",
    resident_pubkey: "11".repeat(32),
    conversation_id: "conversation-1",
    session_epoch: 7,
    turn_id: "turn-1",
    acp_request_id: "9",
    title: "Run git status",
    options: [{ option_id: "allow", name: "Allow", kind: "allow_once" }],
    dispatch_receipt_id: "dispatch-1",
    tool_kind: "execute",
    activity_kind: "command",
    tool_name: "Bash",
    mcp_server: "luca-repositories",
    mcp_tool: "repo_status",
    command_token: "git",
    command_argv_prefix: ["status", "--short"],
    command_segments: [{ token: "git", argv_prefix: ["status", "--short"] }],
    path: "/redacted/project",
    domain: "github.com",
    write: false,
  });

  assert.equal(request.dispatchReceiptId, "dispatch-1");
  assert.equal(request.toolKind, "execute");
  assert.equal(request.activityKind, "command");
  assert.equal(request.toolName, "Bash");
  assert.equal(request.mcpServer, "luca-repositories");
  assert.equal(request.mcpTool, "repo_status");
  assert.equal(request.commandToken, "git");
  assert.deepEqual(request.commandArgvPrefix, ["status", "--short"]);
  assert.deepEqual(request.commandSegments, [
    { token: "git", argvPrefix: ["status", "--short"] },
  ]);
  assert.equal(request.path, "/redacted/project");
  assert.equal(request.domain, "github.com");
  assert.equal(request.write, false);
});

test("a legacy payload normalises to nulls and the fail-closed offer", () => {
  const pending = normalizePending({
    pendingId: "pending-1",
    request: {
      protocol: "luca.managed.permission.v1",
      resident_pubkey: "11".repeat(32),
      conversation_id: "conversation-1",
      session_epoch: 7,
      turn_id: "turn-1",
      acp_request_id: "7",
      title: "Legacy permission",
      options: [{ option_id: "allow", name: "Allow", kind: "allow_once" }],
    },
  });

  assert.equal(pending.request.dispatchReceiptId, null);
  assert.equal(pending.request.toolKind, null);
  assert.equal(pending.request.activityKind, null);
  assert.equal(pending.request.toolName, null);
  assert.equal(pending.request.mcpServer, null);
  assert.equal(pending.request.mcpTool, null);
  assert.equal(pending.request.commandToken, null);
  assert.deepEqual(pending.request.commandArgvPrefix, []);
  assert.deepEqual(pending.request.commandSegments, []);
  assert.equal(pending.request.path, null);
  assert.equal(pending.request.domain, null);
  assert.equal(pending.request.write, null);

  assert.deepEqual(pending.offer, {
    once: true,
    task: false,
    alwaysHere: false,
    deny: true,
    projectLabel: null,
    remembers: [],
    note: null,
  });
});

test("keeps the offer the desktop actually sent", () => {
  const pending = normalizePending({
    pendingId: "pending-2",
    request: {
      protocol: "luca.managed.permission.v1",
      resident_pubkey: "11".repeat(32),
      conversation_id: "conversation-1",
      session_epoch: 7,
      turn_id: "turn-1",
      acp_request_id: "8",
      title: "Run git status",
      options: [{ option_id: "allow", name: "Allow", kind: "allow_once" }],
    },
    offer: {
      once: true,
      task: true,
      always_here: true,
      deny: true,
      project_label: "Luca",
      note: null,
    },
  });

  assert.deepEqual(pending.offer, {
    once: true,
    task: true,
    alwaysHere: true,
    deny: true,
    projectLabel: "Luca",
    remembers: [],
    note: null,
  });
});

test("reads the offer the way the native side serialises it (camelCase)", () => {
  // Beta.11's first walk: the desktop sent `alwaysHere` / `projectLabel` and
  // the reader looked for `always_here` / `project_label`, so every card fell
  // back to Once-or-Deny with no project. Both spellings must work.
  const pending = normalizePending({
    pendingId: "pending-3",
    request: {
      protocol: "luca.managed.permission.v1",
      resident_pubkey: "11".repeat(32),
      conversation_id: "conversation-1",
      session_epoch: 7,
      turn_id: "turn-1",
      acp_request_id: "9",
      title: "Run ls",
      options: [{ option_id: "allow", name: "Allow", kind: "allow_once" }],
    },
    offer: {
      once: true,
      task: true,
      alwaysHere: true,
      deny: true,
      projectLabel: ".buzz",
      note: null,
    },
  });

  assert.deepEqual(pending.offer, {
    once: true,
    task: true,
    alwaysHere: true,
    deny: true,
    projectLabel: ".buzz",
    remembers: [],
    note: null,
  });
});

test("carries the names a compound command would write down", () => {
  // `ls -la /x; echo "exit=$?"` is two segments and two remembered rules; the
  // card has to be able to say so before the owner presses Always here.
  const pending = normalizePending({
    pendingId: "pending-4",
    request: {
      protocol: "luca.managed.permission.v1",
      resident_pubkey: "11".repeat(32),
      conversation_id: "conversation-1",
      session_epoch: 7,
      turn_id: "turn-1",
      acp_request_id: "10",
      title: 'Running ls -la /x; echo "exit=$?"',
      options: [{ option_id: "allow", name: "Allow", kind: "allow_once" }],
      command_segments: [
        { token: "ls" },
        { token: "echo", argv_prefix: ["hello"] },
      ],
    },
    offer: {
      once: true,
      task: true,
      alwaysHere: true,
      deny: true,
      projectLabel: ".buzz",
      remembers: ["ls", "echo"],
      note: null,
    },
  });

  assert.equal(pending.request.commandToken, null);
  assert.deepEqual(pending.request.commandSegments, [
    { token: "ls", argvPrefix: [] },
    { token: "echo", argvPrefix: ["hello"] },
  ]);
  assert.deepEqual(pending.offer.remembers, ["ls", "echo"]);
});
