import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveShellRoute,
  shouldBounceForChannelNotification,
} from "./AppShell.helpers.ts";

test("shouldBounceForChannelNotification_allowsTopLevelChannelMessages", () => {
  assert.equal(shouldBounceForChannelNotification([["h", "channel"]]), true);
});

test("shouldBounceForChannelNotification_suppressesThreadReplies", () => {
  assert.equal(
    shouldBounceForChannelNotification([
      ["h", "channel"],
      ["e", "root", "", "reply"],
    ]),
    false,
  );
});

test("shouldBounceForChannelNotification_allowsBroadcastReplies", () => {
  assert.equal(
    shouldBounceForChannelNotification([
      ["h", "channel"],
      ["e", "root", "", "reply"],
      ["broadcast", "1"],
    ]),
    true,
  );
});

test("deriveShellRoute_selectsInboxWithoutAConversation", () => {
  assert.deepEqual(deriveShellRoute("/inbox"), {
    selectedChannelId: null,
    selectedView: "inbox",
  });
});

test("deriveShellRoute_preservesChannelSelection", () => {
  assert.deepEqual(deriveShellRoute("/channels/project%2Falpha"), {
    selectedChannelId: "project/alpha",
    selectedView: "channel",
  });
});
