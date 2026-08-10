import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveManagedAudience } from "./managedAudience.ts";

const owner = "0".repeat(64);
const claude = "a".repeat(64);
const codex = "b".repeat(64);
const human = "c".repeat(64);

function channel(members = [owner, claude, codex, human]) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "group",
    channelType: "dm",
    visibility: "private",
    description: "",
    topic: null,
    purpose: null,
    memberCount: members.length,
    memberPubkeys: members,
    lastMessageAt: null,
    archivedAt: null,
    participants: [],
    participantPubkeys: members,
    isMember: true,
    ttlSeconds: null,
    ttlDeadline: null,
  };
}

const managed = new Set([claude, codex]);

describe("deriveManagedAudience", () => {
  it("activates every managed conversation member for a normal group message", () => {
    assert.deepEqual(
      deriveManagedAudience({
        channel: channel(),
        managedResidentPubkeys: managed,
      }),
      { mode: "conversation", resident_pubkeys: [claude, codex] },
    );
  });

  it("directs a reply to only its managed author", () => {
    assert.deepEqual(
      deriveManagedAudience({
        channel: channel(),
        managedResidentPubkeys: managed,
        replyAuthorPubkey: claude,
      }),
      { mode: "directed", resident_pubkeys: [claude] },
    );
  });

  it("adds explicit managed mentions to the directed reply subset", () => {
    assert.deepEqual(
      deriveManagedAudience({
        channel: channel(),
        managedResidentPubkeys: managed,
        explicitMentionPubkeys: [codex, human],
        replyAuthorPubkey: claude,
      }),
      { mode: "directed", resident_pubkeys: [claude, codex] },
    );
  });

  it("activates exactly the explicitly mentioned resident subset", () => {
    assert.deepEqual(
      deriveManagedAudience({
        channel: channel(),
        managedResidentPubkeys: managed,
        explicitMentionPubkeys: [codex, claude, codex],
      }),
      { mode: "directed", resident_pubkeys: [claude, codex] },
    );
  });

  it("activates no resident for a human reply or human-only mention", () => {
    assert.deepEqual(
      deriveManagedAudience({
        channel: channel(),
        managedResidentPubkeys: managed,
        replyAuthorPubkey: human,
      }),
      { mode: "none" },
    );
    assert.deepEqual(
      deriveManagedAudience({
        channel: channel(),
        managedResidentPubkeys: managed,
        explicitMentionPubkeys: [human],
      }),
      { mode: "none" },
    );
  });
});
