import assert from "node:assert/strict";
import test from "node:test";

import { agentManagementCompletionMessage } from "./agentManagementCompletion.ts";

const sourcePubkey = "a".repeat(64);
const residentPubkey = "b".repeat(64);
const request = {
  type: "agent_management_request",
  action: "create",
  requestId: "create-scout-1",
  request: {
    channelId: "origin-conversation",
    displayName: "Scout",
    systemPrompt: "Investigate this project.",
    requestedRuntimeFamily: "hermes",
  },
};

function completion() {
  return {
    receipt: {
      schemaVersion: 1,
      transactionId: "native-transaction-1",
      runtime: "hermes",
      residentPubkey,
      nativeSemanticHash: "native-identity-hash",
      status: "complete",
      reused: false,
      needsAttention: false,
      recoveryAction: null,
      retainedWorkspace: false,
    },
    attachment: {
      channelId: request.request.channelId,
      agent: {
        name: "Scout",
        pubkey: residentPubkey,
        status: "running",
        nativeRuntimeBinding: { kind: "hermes" },
      },
      membershipAdded: true,
      started: true,
    },
  };
}

test("returns a host setup receipt to the originating conversation, without an agent mention", () => {
  const message = agentManagementCompletionMessage(
    request,
    sourcePubkey,
    completion(),
  );
  assert.equal(message.agentPubkey, sourcePubkey);
  assert.equal(message.channelId, request.request.channelId);
  assert.equal(message.markerScope, "agent");
  assert.equal(
    message.content,
    "Polyphonic setup update: Scout was linked to its Hermes profile and added to this conversation. Its runtime process was started. An authenticated reply has not been verified.",
  );
  assert.equal(message.mentionPubkeys, undefined);
  assert.equal(message.parentEventId, undefined);
});

test("uses the actual resident name and native family after owner review", () => {
  const result = completion();
  result.receipt.runtime = "openclaw";
  result.attachment.agent.nativeRuntimeBinding.kind = "openclaw";
  result.attachment.agent.name = "Reviewed Scout";
  const message = agentManagementCompletionMessage(
    request,
    sourcePubkey,
    result,
  );
  assert.match(
    message.content,
    /Reviewed Scout was linked to its OpenClaw agent/,
  );
});

test("the conversation receipt excludes native configuration and the private creation instructions", () => {
  const result = completion();
  result.attachment.agent.nativeRuntimeBinding.hermesHome =
    "/private/native-profile";
  const message = agentManagementCompletionMessage(
    request,
    sourcePubkey,
    result,
  );
  const wire = JSON.stringify(message);
  for (const withheld of [
    request.request.systemPrompt,
    result.receipt.transactionId,
    result.receipt.nativeSemanticHash,
    result.attachment.agent.nativeRuntimeBinding.hermesHome,
  ]) {
    assert.equal(wire.includes(withheld), false);
  }
});

test("a receipt delivery retry uses the same marker even when the transaction was reconciled", () => {
  const first = agentManagementCompletionMessage(
    request,
    sourcePubkey,
    completion(),
  );
  const retried = completion();
  retried.receipt.reused = true;
  retried.attachment.started = false;
  retried.attachment.membershipAdded = false;
  const retry = agentManagementCompletionMessage(
    request,
    sourcePubkey,
    retried,
  );
  assert.equal(first.marker, retry.marker);
  assert.match(retry.content, /process was already running/);
  const another = agentManagementCompletionMessage(
    { ...request, requestId: "create-scout-2" },
    sourcePubkey,
    completion(),
  );
  assert.notEqual(first.marker, another.marker);
});

test("marker identity is unambiguous and source identity is normalized", () => {
  const message = agentManagementCompletionMessage(
    { ...request, requestId: "request:1 / retry" },
    sourcePubkey.toUpperCase(),
    completion(),
  );
  assert.equal(
    message.marker,
    "polyphonic-agent-creation.v1:request%3A1%20%2F%20retry",
  );
  assert.equal(message.agentPubkey, sourcePubkey);
});

test("a non-running status is reported without claiming process startup or readiness", () => {
  const result = completion();
  result.attachment.agent.status = "stopped";
  const message = agentManagementCompletionMessage(
    request,
    sourcePubkey,
    result,
  );
  assert.match(message.content, /runtime reports stopped/);
  assert.doesNotMatch(
    message.content,
    /was started|already running|ready to use/,
  );
  assert.match(message.content, /authenticated reply has not been verified/);
});

test("refuses an update request, unfinished transaction, missing attachment, or changed conversation", () => {
  const invalid = [
    { ...completion(), attachment: null },
    {
      ...completion(),
      receipt: { ...completion().receipt, status: "rolled_back" },
    },
    {
      ...completion(),
      receipt: { ...completion().receipt, status: "needs_attention" },
    },
    {
      ...completion(),
      receipt: { ...completion().receipt, needsAttention: true },
    },
    {
      ...completion(),
      attachment: {
        ...completion().attachment,
        channelId: "another-conversation",
      },
    },
  ];
  for (const result of invalid) {
    assert.throws(
      () => agentManagementCompletionMessage(request, sourcePubkey, result),
      /has not completed in its original conversation/,
    );
  }
  assert.throws(
    () =>
      agentManagementCompletionMessage(
        { ...request, action: "update" },
        sourcePubkey,
        completion(),
      ),
    /has not completed in its original conversation/,
  );
});

test("refuses a missing, substituted, or differently bound native resident", () => {
  const missingKey = completion();
  missingKey.receipt.residentPubkey = null;
  const substituted = completion();
  substituted.attachment.agent.pubkey = "c".repeat(64);
  const changedBinding = completion();
  changedBinding.attachment.agent.nativeRuntimeBinding.kind = "openclaw";
  const missingBinding = completion();
  missingBinding.attachment.agent.nativeRuntimeBinding = null;
  for (const result of [
    missingKey,
    substituted,
    changedBinding,
    missingBinding,
  ]) {
    assert.throws(
      () => agentManagementCompletionMessage(request, sourcePubkey, result),
      /resident identity could not be confirmed/,
    );
  }
  assert.throws(
    () => agentManagementCompletionMessage(request, "", completion()),
    /resident identity could not be confirmed/,
  );
});
