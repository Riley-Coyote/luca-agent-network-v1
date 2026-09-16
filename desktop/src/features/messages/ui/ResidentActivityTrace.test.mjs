import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ResidentActivityTrace,
  shouldSettleActivityTrace,
} from "./ResidentActivityTrace.tsx";

const startedAt = 1_800_000_000_000;
const entry = (id, sequence, kind, text, roomText) => ({
  id,
  sequence,
  kind,
  text,
  roomText,
  status: "done",
});
const firstActivity = entry(
  "read",
  1,
  "activity",
  "Reading private-notes.md",
  "Reading a file",
);
const firstNarration = entry(
  "narration-one",
  2,
  "narration",
  "I am checking the first section.",
  "I am checking the first section.",
);
const latestActivity = entry(
  "search",
  3,
  "activity",
  "Searching private-notes.md",
  "Searching files",
);
const latestNarration = entry(
  "narration-two",
  4,
  "narration",
  "I found the section to update.",
  "I found the section to update.",
);

function trace(overrides = {}) {
  return {
    conversationId: "test-conversation",
    residentPubkey: "test-resident",
    dispatchReceiptId: "test-dispatch",
    turnId: "test-turn",
    finalMessageId: null,
    startedAt,
    endedAt: startedAt + 499_000,
    status: "completed",
    // Storage order is deliberately different from turn sequence.
    entries: [latestNarration, firstActivity, latestActivity, firstNarration],
    truncated: false,
    ...overrides,
  };
}

function render(traceOverrides = {}, props = {}) {
  return renderToStaticMarkup(
    React.createElement(ResidentActivityTrace, {
      trace: trace(traceOverrides),
      residentName: "Luca",
      privateConversation: true,
      ...props,
    }),
  );
}

test("the working row is one plain phrase, and nothing else", () => {
  const html = render({ status: "working", endedAt: null });
  // The step, said plainly. Not the runtime's own words, not its narration.
  assert.match(html, /Searching the code/);
  assert.doesNotMatch(html, /private-notes\.md/);
  assert.doesNotMatch(html, /I found the section to update\./);
  assert.doesNotMatch(html, /I am checking the first section\./);
  assert.equal((html.match(/data-activity-status=/g) ?? []).length, 1);
  // No narration line, and no expanded record while the turn is working.
  assert.equal((html.match(/data-activity-narration=/g) ?? []).length, 0);
  assert.doesNotMatch(html, /data-activity-trace-list|<ol/);
  assert.match(html, /data-activity-phrase="settled"/);
  assert.match(html, /data-activity-stop="true"/);
  assert.match(html, /aria-label="Stop Luca"/);
  assert.doesNotMatch(html, /<details|data-activity-name/);
  assert.equal((html.match(/<canvas/g) ?? []).length, 1);
});

test("the phrase names the object for the owner and follows the open step", () => {
  const reading = render({
    status: "working",
    endedAt: null,
    entries: [firstActivity],
  });
  assert.match(reading, /Reading private-notes\.md/);
  // A finished step yields to the reply once its words start arriving.
  const writing = render(
    { status: "working", endedAt: null },
    { streaming: true },
  );
  assert.match(
    writing,
    /<span class="resident-activity-status-text">Writing<\/span>/,
  );
  const open = render(
    {
      status: "working",
      endedAt: null,
      entries: [{ ...latestActivity, status: "active" }],
    },
    { streaming: true },
  );
  assert.match(open, /Searching the code/);
});

test("the settled disclosure starts closed, counts tools only and preserves event order", () => {
  const html = render();
  assert.match(html, /Luca worked for 8m 19s · 2 steps/);
  assert.match(html, /<details class="resident-activity-disclosure">/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|\s|>)/);
  assert.match(html, /<summary[^>]*data-activity-trace-summary/);
  assert.match(html, /<ol[^>]*aria-label="Luca&#x27;s work record"/);
  const phrases = [
    "Reading private-notes.md",
    "I am checking the first section.",
    "Searching private-notes.md",
    "I found the section to update.",
  ];
  const positions = phrases.map((phrase) => html.indexOf(phrase));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
  assert.doesNotMatch(
    html,
    /data-activity-elapsed|data-activity-stop|buzz-shimmer/,
  );
  assert.equal((html.match(/data-activity-kind="activity"/g) ?? []).length, 2);
  assert.equal((html.match(/data-activity-kind="narration"/g) ?? []).length, 2);
});

test("shared conversations use the room projection in both live and durable records", () => {
  // Live, the room gets the plain phrase with the object dropped entirely.
  const live = render({ status: "working" }, { privateConversation: false });
  assert.match(live, /Searching the code/);
  assert.doesNotMatch(live, /private-notes\.md/);
  const roomRead = render(
    { status: "working", entries: [firstActivity] },
    { privateConversation: false },
  );
  assert.match(roomRead, /Reading a file/);
  assert.doesNotMatch(roomRead, /private-notes\.md/);
  // The durable record keeps the native room projection verbatim.
  const settled = render(
    { status: "completed" },
    { privateConversation: false },
  );
  assert.match(settled, /Searching files/);
  assert.doesNotMatch(settled, /private-notes\.md/);
  const missingProjection = render(
    {
      entries: [
        { ...firstActivity, roomText: "" },
        { ...firstNarration, text: "Private narration", roomText: "" },
      ],
    },
    { privateConversation: false },
  );
  assert.doesNotMatch(missingProjection, /private-notes|Private narration/);
});

test("unexpected thought records cannot become narration or enter the disclosure", () => {
  const entries = [
    firstActivity,
    entry("unexpected", 10, "thought", "PRIVATE THOUGHT", "PRIVATE THOUGHT"),
  ];
  for (const status of ["working", "completed"]) {
    const html = render({ status, entries });
    assert.doesNotMatch(html, /PRIVATE THOUGHT/);
    if (status === "completed") assert.match(html, /· 1 step/);
  }
});

test("cancelled, failed and interrupted records report their actual outcomes", () => {
  const summaries = {
    cancelled: "Luca stopped after 8m 19s · 2 steps",
    failed: "Luca&#x27;s work failed after 8m 19s · 2 steps",
    interrupted: "Luca&#x27;s work was interrupted after 8m 19s · 2 steps",
  };
  for (const [status, expected] of Object.entries(summaries)) {
    const html = render({ status });
    assert.ok(html.includes(expected));
    assert.doesNotMatch(
      html,
      /Luca worked for|data-activity-stop|buzz-shimmer/,
    );
  }
  const failedStep = render({
    entries: [{ ...firstActivity, status: "failed" }],
  });
  assert.match(failedStep, /Reading private-notes\.md · failed/);
});

test("identity is opt-in and preserves the caller's profile control beside the activity indicator", () => {
  const html = render(
    { status: "working" },
    {
      showIdentity: true,
      identityNode: React.createElement("button", { type: "button" }, "Sol"),
      residentName: "Sol",
      onStop: () => {},
    },
  );
  assert.match(
    html,
    /data-activity-name="true"><button type="button">Sol<\/button>/,
  );
  assert.match(html, /aria-label="Stop Sol"/);
  assert.doesNotMatch(html, /data-identity|disabled=""/);
  const stopping = render({ status: "working" }, { stopping: true });
  assert.match(stopping, /disabled="" aria-label="Stopping Luca">Stopping/);
});

test("incomplete records disclose the retained lower bound and do not invent timing", () => {
  const html = render({ truncated: true, endedAt: null });
  assert.match(html, /Luca worked · 2\+ steps/);
  assert.match(html, /Earlier activity is no longer retained in this record\./);
  assert.doesNotMatch(html, /worked for|0s/);
});

test("a turn with no activity shows Thinking without an empty narration row", () => {
  const html = render({ status: "working", endedAt: null, entries: [] });
  assert.match(html, /Thinking/);
  assert.doesNotMatch(html, /data-activity-narration/);
  assert.equal((html.match(/<canvas/g) ?? []).length, 1);
  assert.match(html, /data-activity-stop="true"/);
});

test("only a mounted live dispatch gets the terminal settle", () => {
  const live = trace({ status: "working", endedAt: null });
  assert.equal(shouldSettleActivityTrace(null, trace()), false);
  for (const status of ["completed", "cancelled", "failed", "interrupted"]) {
    assert.equal(shouldSettleActivityTrace(live, trace({ status })), true);
  }
  assert.equal(shouldSettleActivityTrace(live, live), false);
  assert.equal(
    shouldSettleActivityTrace(
      live,
      trace({ dispatchReceiptId: "another-dispatch" }),
    ),
    false,
  );
  assert.equal(
    shouldSettleActivityTrace(
      live,
      trace({ residentPubkey: "another-resident" }),
    ),
    false,
  );
  assert.equal(
    shouldSettleActivityTrace(live, trace({ conversationId: "another-room" })),
    false,
  );
  assert.doesNotMatch(render(), /data-activity-settling="true"/);
});

test("a permission decision joins the record with its own mark and never becomes the phrase", () => {
  const allowed = entry(
    "permission-1",
    5,
    "permission",
    "You allowed once: git status",
    "Allowed a command",
  );
  const declined = {
    ...entry(
      "permission-2",
      6,
      "permission",
      "You said no: git push",
      "Declined a command",
    ),
    status: "failed",
  };
  const html = render({ entries: [firstActivity, allowed, declined] });
  assert.equal(
    (html.match(/data-activity-kind="permission"/g) ?? []).length,
    2,
  );
  assert.match(html, /You allowed once: git status/);
  assert.match(html, /You said no: git push · declined/);
  assert.doesNotMatch(html, /You said no: git push · failed/);
  assert.equal((html.match(/resident-activity-record-mark/g) ?? []).length, 2);
  // Decisions are not steps: the count and the live phrase both ignore them.
  assert.match(html, /· 1 step/);
  const live = render({
    status: "working",
    endedAt: null,
    entries: [firstActivity, allowed],
  });
  assert.match(live, /Reading private-notes\.md/);
  assert.doesNotMatch(live, /You allowed once/);
});
