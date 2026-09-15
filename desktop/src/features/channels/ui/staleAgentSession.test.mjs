import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldCloseStaleAgentSession } from "./useChannelAgentSessions.ts";

const RESIDENT =
  "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f";
const OTHER =
  "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";

const settled = {
  agents: [],
  agentsLoaded: true,
  membersSettled: true,
  openAgentSessionPubkey: RESIDENT,
  profilePanelPubkey: null,
};

describe("shouldCloseStaleAgentSession", () => {
  it("closes a session naming nobody in a settled room", () => {
    assert.equal(shouldCloseStaleAgentSession(settled), true);
    assert.equal(
      shouldCloseStaleAgentSession({ ...settled, agents: [{ pubkey: OTHER }] }),
      true,
    );
  });

  it("keeps a session whose resident is in the room", () => {
    assert.equal(
      shouldCloseStaleAgentSession({
        ...settled,
        agents: [{ pubkey: RESIDENT.toUpperCase() }],
      }),
      false,
    );
  });

  it("waits for the members query — a join or leave refetches it", () => {
    assert.equal(
      shouldCloseStaleAgentSession({ ...settled, membersSettled: false }),
      false,
    );
  });

  it("waits for the agent queries", () => {
    assert.equal(
      shouldCloseStaleAgentSession({ ...settled, agentsLoaded: false }),
      false,
    );
  });

  it("leaves a session that is the open profile panel's own view", () => {
    assert.equal(
      shouldCloseStaleAgentSession({
        ...settled,
        profilePanelPubkey: RESIDENT.toUpperCase(),
      }),
      false,
    );
  });

  it("has nothing to close with no session open", () => {
    assert.equal(
      shouldCloseStaleAgentSession({
        ...settled,
        openAgentSessionPubkey: null,
      }),
      false,
    );
  });
});
