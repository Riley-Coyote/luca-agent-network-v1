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
    originChannelId: request.request.channelId,
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
      channelName: "Research",
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
    "Polyphonic setup update: Scout was added to this conversation with Hermes. Send a first message to check the connection.",
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
    /Reviewed Scout was added to this conversation with OpenClaw/,
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
  assert.equal(retry.content, first.content);
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

for (const status of ["stopped", "error"])
  test(`${status}: the receipt points to saved setup without claiming readiness`, () => {
    const result = completion();
    result.attachment.agent.status = status;
    const message = agentManagementCompletionMessage(
      request,
      sourcePubkey,
      result,
    );
    assert.ok(message.content.includes(`Its status is ${status}.`));
    assert.doesNotMatch(
      message.content,
      /was started|already running|ready to use|Send a first message/,
    );
    assert.match(
      message.content,
      /Review its setup in Agents before sending a message/,
    );
  });

test("refuses an update request, unfinished transaction, missing attachment, or changed origin", () => {
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
      originChannelId: "another-conversation",
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

test("an expanded DM receipt returns to the original conversation and links the actual group", () => {
  const result = completion();
  result.attachment.channelId = "f570339f-8f8a-4e08-a779-8d954aa44109";
  result.attachment.channelName = "Luca, Scout";
  const message = agentManagementCompletionMessage(
    request,
    sourcePubkey,
    result,
  );
  assert.equal(message.channelId, request.request.channelId);
  assert.match(
    message.content,
    /added to the group conversation “Luca, Scout”/,
  );
  assert.ok(
    message.content.includes(
      `[Open group conversation](buzz://channel?channel=${result.attachment.channelId})`,
    ),
  );
  assert.doesNotMatch(message.content, /added to this conversation/);
  assert.equal(
    message.marker,
    agentManagementCompletionMessage(request, sourcePubkey, completion())
      .marker,
  );
});

test("an expanded receipt cannot link an invalid destination or interpret its name as markdown", () => {
  const result = completion();
  result.attachment.channelId = "invalid-destination";
  assert.throws(
    () => agentManagementCompletionMessage(request, sourcePubkey, result),
    /valid conversation ID/,
  );
  result.attachment.channelId = "f570339f-8f8a-4e08-a779-8d954aa44109";
  result.attachment.channelName =
    "Group [injected](https://example.com)\n*name*";
  const message = agentManagementCompletionMessage(
    request,
    sourcePubkey,
    result,
  );
  assert.ok(
    message.content.includes(
      "Group \\[injected\\](https://example.com) \\*name\\*",
    ),
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
