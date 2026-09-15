import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAutoSendClearPatch,
  buildPanelStatePatch,
} from "./channelSearchKeys.ts";

describe("buildAutoSendClearPatch", () => {
  it("clears only the auto-submit trigger", () => {
    assert.deepEqual(buildAutoSendClearPatch(), { autoSend: null });
  });
});

describe("buildPanelStatePatch", () => {
  it("expresses a whole panel arrangement as one patch", () => {
    // What opening an exchange does: close every other panel, in one go.
    assert.deepEqual(
      buildPanelStatePatch({
        agentSession: null,
        channelManagement: false,
        profile: null,
        thread: null,
      }),
      {
        agentSession: null,
        agentSessionChannel: null,
        channelManagement: null,
        profile: null,
        profileTab: null,
        profileView: null,
        thread: null,
      },
    );
  });

  it("leaves omitted panels alone", () => {
    assert.deepEqual(buildPanelStatePatch({ thread: "head-1" }), {
      thread: "head-1",
    });
    assert.deepEqual(buildPanelStatePatch({}), {});
  });

  it("resets a profile's sub-view whenever the profile moves", () => {
    assert.deepEqual(buildPanelStatePatch({ profile: "abc" }), {
      profile: "abc",
      profileTab: null,
      profileView: null,
    });
  });

  it("drops the session's channel scope only when the session closes", () => {
    assert.deepEqual(buildPanelStatePatch({ agentSession: "abc" }), {
      agentSession: "abc",
    });
    assert.deepEqual(buildPanelStatePatch({ agentSession: null }), {
      agentSession: null,
      agentSessionChannel: null,
    });
  });

  it("lets an explicit channel scope win over the close default", () => {
    assert.deepEqual(
      buildPanelStatePatch({
        agentSession: "abc",
        agentSessionChannel: "channel-1",
      }),
      { agentSession: "abc", agentSessionChannel: "channel-1" },
    );
  });

  it("carries the channel-management sentinel, not a boolean", () => {
    assert.deepEqual(buildPanelStatePatch({ channelManagement: true }), {
      channelManagement: "1",
    });
    assert.deepEqual(buildPanelStatePatch({ channelManagement: false }), {
      channelManagement: null,
    });
  });
});
