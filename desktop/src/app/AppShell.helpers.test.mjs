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
  assert.deepEqual(deriveShellRoute("/inbox", { inboxEnabled: true }), {
    selectedChannelId: null,
    selectedView: "inbox",
  });
});

// The Inbox surface is gated off by default (shared/features/inboxSurface.ts).
// `/inbox` then redirects to the normal landing, so the shell must report the
// home view rather than highlighting a nav item that is not rendered.
test("deriveShellRoute_fallsBackToHomeWhenInboxIsDisabled", () => {
  assert.deepEqual(deriveShellRoute("/inbox"), {
    selectedChannelId: null,
    selectedView: "home",
  });
  assert.deepEqual(deriveShellRoute("/inbox", { inboxEnabled: false }), {
    selectedChannelId: null,
    selectedView: "home",
  });
});

test("deriveShellRoute_preservesChannelSelection", () => {
  assert.deepEqual(deriveShellRoute("/channels/project%2Falpha"), {
    selectedChannelId: "project/alpha",
    selectedView: "channel",
  });
});
