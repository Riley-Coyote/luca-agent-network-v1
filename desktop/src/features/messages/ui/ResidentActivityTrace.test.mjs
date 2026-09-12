import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResidentActivityTrace } from "./ResidentActivityTrace.tsx";

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

test("live status and public narration each replace the preceding entry in place", () => {
  const html = render({ status: "working", endedAt: null });
  assert.match(html, /Searching private-notes\.md/);
  assert.match(html, /I found the section to update\./);
  assert.doesNotMatch(html, /Reading private-notes\.md/);
  assert.doesNotMatch(html, /I am checking the first section\./);
  assert.equal((html.match(/data-activity-status=/g) ?? []).length, 1);
  assert.equal((html.match(/data-activity-narration=/g) ?? []).length, 1);
  assert.match(html, /data-activity-stop="true"/);
  assert.match(html, /aria-label="Stop Luca"/);
  assert.doesNotMatch(html, /<details|data-activity-name|<canvas/);
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
  for (const status of ["working", "completed"]) {
    const html = render({ status }, { privateConversation: false });
    assert.match(html, /Searching files/);
    assert.doesNotMatch(html, /private-notes\.md/);
  }
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

test("identity is opt-in and preserves the caller's profile control without adding a mark", () => {
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
  assert.doesNotMatch(html, /<canvas|data-identity|disabled=""/);
  const stopping = render({ status: "working" }, { stopping: true });
  assert.match(stopping, /disabled="" aria-label="Stopping Luca">Stopping/);
});

test("incomplete records disclose the retained lower bound and do not invent timing", () => {
  const html = render({ truncated: true, endedAt: null });
  assert.match(html, /Luca worked · 2\+ steps/);
  assert.match(html, /Earlier activity is no longer retained in this record\./);
  assert.doesNotMatch(html, /worked for|0s/);
});

test("a turn with no activity keeps a useful status and a stable narration slot", () => {
  const html = render({ status: "working", endedAt: null, entries: [] });
  assert.match(html, /Working on your message/);
  assert.match(
    html,
    /data-activity-narration="true" aria-live="polite" aria-atomic="true"><\/div>/,
  );
  assert.match(html, /data-activity-stop="true"/);
});
