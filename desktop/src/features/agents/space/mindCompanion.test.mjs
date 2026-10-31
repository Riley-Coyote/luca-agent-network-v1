import assert from "node:assert/strict";
import test from "node:test";

import { awayReason } from "./mindCompanion.ts";

const base = { name: "Atlas", harness: "Codex" };

test("WP-43: not set up says so, and offers Set up", () => {
  assert.deepEqual(
    awayReason({
      ...base,
      managed: false,
      running: false,
      channelAvailable: false,
    }),
    {
      kind: "setup",
      text: "Atlas isn't set up on this Mac yet.",
      action: "Set up Atlas",
    },
  );
});

test("WP-43: a mind that's off is started first", () => {
  assert.deepEqual(
    awayReason({
      ...base,
      managed: true,
      running: false,
      channelAvailable: false,
    }),
    {
      kind: "stopped",
      text: "Atlas is off. Start them to give them time of their own.",
      action: "Start Atlas",
    },
  );
});

test("WP-43: a running harness without the channel can't, and says so", () => {
  assert.deepEqual(
    awayReason({
      ...base,
      managed: true,
      running: true,
      channelAvailable: false,
    }),
    { kind: "unsupported", text: "Codex can't take time of their own yet." },
  );
});

test("WP-43: with the channel, it's ready, running or not", () => {
  for (const running of [true, false])
    assert.deepEqual(
      awayReason({ ...base, managed: true, running, channelAvailable: true }),
      { kind: "ready" },
    );
});
