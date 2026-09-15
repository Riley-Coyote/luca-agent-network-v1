import assert from "node:assert/strict";
import test from "node:test";

import {
  createRateLimiter,
  describeError,
  firstStackFrames,
  formatConsoleArguments,
  formatCrashReport,
  formatErrorLine,
} from "./appLog.helpers.ts";

test("createRateLimiter_allowsTheBudgetThenGoesQuiet", () => {
  const limiter = createRateLimiter(20);
  for (let index = 0; index < 20; index += 1) {
    assert.deepEqual(limiter.admit(1000), { allow: true, droppedBefore: 0 });
  }
  assert.deepEqual(limiter.admit(1000), { allow: false });
  assert.deepEqual(limiter.admit(1999), { allow: false });
});

test("createRateLimiter_reportsTheLossOnceOnTheNextWindow", () => {
  const limiter = createRateLimiter(2);
  limiter.admit(0);
  limiter.admit(0);
  limiter.admit(0);
  limiter.admit(0);
  limiter.admit(0);

  assert.deepEqual(limiter.admit(1000), { allow: true, droppedBefore: 3 });
  assert.deepEqual(limiter.admit(1000), { allow: true, droppedBefore: 0 });
});

test("createRateLimiter_startsAFreshWindowWhenTheAppIsQuiet", () => {
  const limiter = createRateLimiter(1);
  assert.deepEqual(limiter.admit(0), { allow: true, droppedBefore: 0 });
  assert.deepEqual(limiter.admit(10), { allow: false });
  assert.deepEqual(limiter.admit(5000), { allow: true, droppedBefore: 1 });
});

test("firstStackFrames_keepsThreeFramesOnOneLine", () => {
  const stack = [
    "TypeError: nope",
    "    at ConversationPane (index.js:12:3)",
    "    at AppShell (index.js:44:9)",
    "    at App (index.js:80:1)",
    "    at root (index.js:99:1)",
  ].join("\n");

  const frames = firstStackFrames(stack);
  assert.equal(frames.split(" | ").length, 3);
  assert.ok(frames.startsWith("at ConversationPane"));
  assert.ok(!frames.includes("at root"));
  assert.ok(!frames.includes("\n"));
});

test("firstStackFrames_fallsBackWhenFramesAreNotAtPrefixed", () => {
  const stack = ["nope@app.js:1:1", "render@app.js:2:2"].join("\n");
  assert.equal(firstStackFrames(stack), "render@app.js:2:2");
  assert.equal(firstStackFrames(undefined), "");
});

test("describeError_survivesNonErrorThrows", () => {
  assert.deepEqual(describeError("plain string"), {
    message: "plain string",
    frames: "",
  });
  assert.equal(describeError({ code: 7 }).message, '{"code":7}');
  const described = describeError(new RangeError("out of range"));
  assert.equal(described.message, "RangeError: out of range");
});

test("formatErrorLine_namesTheContextAndTheError", () => {
  const error = new Error("boom");
  error.stack = "Error: boom\n    at a (x.js:1:1)";
  assert.equal(
    formatErrorLine("window.onerror", error),
    "window.onerror: Error: boom — at a (x.js:1:1)",
  );
});

test("formatConsoleArguments_flattensMixedArguments", () => {
  const error = new Error("nope");
  error.stack = "Error: nope\n    at a (x.js:1:1)";
  assert.equal(
    formatConsoleArguments(["relay failed", error, { attempt: 2 }]),
    'relay failed Error: nope — at a (x.js:1:1) {"attempt":2}',
  );
});

test("formatCrashReport_carriesTheErrorTheVersionAndTheLog", () => {
  const error = new TypeError("render exploded");
  error.stack = "TypeError: render exploded\n    at Pane (pane.tsx:3:1)";

  const report = formatCrashReport({
    appVersion: "0.5.0-beta.7",
    capturedAt: "2026-09-15T08:12:03.123Z",
    error,
    logLines: "2026-09-15T08:12:02.000Z info buzz_lib::relay [relay] phase=boot",
    screen: "Conversation",
  });

  assert.ok(report.includes("Polyphonic crash report"));
  assert.ok(report.includes("screen: Conversation"));
  assert.ok(report.includes("app version: 0.5.0-beta.7"));
  assert.ok(report.includes("error: TypeError: render exploded"));
  assert.ok(report.includes("stack: at Pane (pane.tsx:3:1)"));
  assert.ok(report.includes("--- recent log ---"));
  assert.ok(report.includes("[relay] phase=boot"));
});

test("formatCrashReport_saysSoWhenThereIsNoLog", () => {
  const report = formatCrashReport({
    appVersion: "unknown",
    capturedAt: "2026-09-15T08:12:03.123Z",
    error: "something broke",
    logLines: "   ",
    screen: "Settings",
  });

  assert.ok(report.includes("(no log lines available)"));
  assert.ok(!report.includes("stack:"));
});
