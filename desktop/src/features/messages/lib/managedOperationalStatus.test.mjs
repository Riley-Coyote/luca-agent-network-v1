import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_MANAGED_ACTIVITY_STEPS,
  activityBareDomain,
  dedupeManagedOperationalStatuses,
  managedActivityRunSummary,
  managedActivityStepDetail,
  managedActivityStepIsMono,
  managedActivityStepLabel,
  managedElapsedReadout,
  managedOperationalCopy,
  managedPermissionOutcomeCopy,
  mergeManagedActivityStep,
  parseManagedActivityStep,
  sanitizedAttachmentFailure,
  settleManagedActivitySteps,
  truncateActivityPathFront,
} from "./managedOperationalStatus.ts";

function step(overrides = {}) {
  return {
    count: null,
    detail: null,
    kind: "other",
    label: "Working",
    status: "active",
    step: 1,
    ...overrides,
  };
}

describe("managed operational presentation", () => {
  it("maps typed failures without protocol terminology", () => {
    assert.deepEqual(managedOperationalCopy("failed", "runtime"), {
      label: "Resident stopped unexpectedly",
      tone: "attention",
    });
    assert.equal(
      managedOperationalCopy("failed", "publication").label,
      "Response couldn’t be published",
    );
    assert.equal(
      managedOperationalCopy("finalizing", null).label,
      "Finalizing response",
    );
  });

  it("states the outcome and never names the control beside it", () => {
    for (const failure of ["runtime", "publication", "unavailable", null]) {
      const copy = managedOperationalCopy("failed", failure);
      assert.ok(copy, `expected copy for ${failure}`);
      // Every one of these renders next to a real Retry button. A sentence
      // that ends in the button's own name reads as a control that does not
      // work — the defect this rule exists to stop coming back.
      assert.doesNotMatch(
        copy.label,
        /retry/i,
        `"${copy.label}" repeats the Retry control in prose`,
      );
    }
  });

  it("dedupes only body-free restart interruptions", () => {
    assert.deepEqual(
      dedupeManagedOperationalStatuses([
        { dispatchReceiptId: "one", status: "interrupted_after_restart" },
        { dispatchReceiptId: "one", status: "interrupted_after_restart" },
        { dispatchReceiptId: "two", status: "interrupted_after_restart" },
      ]),
      [
        { dispatchReceiptId: "one", status: "interrupted_after_restart" },
        { dispatchReceiptId: "two", status: "interrupted_after_restart" },
      ],
    );
  });

  it("keeps permission and attachment feedback safe and concise", () => {
    assert.equal(
      managedPermissionOutcomeCopy("session_replaced"),
      "Permission request closed when the resident restarted",
    );
    const attachment = sanitizedAttachmentFailure();
    assert.match(attachment, /keep typing/);
    assert.doesNotMatch(attachment, /path|stack|token|credential|relay/i);
  });
});

describe("rich activity", () => {
  it("parses a well-formed activity object", () => {
    assert.deepEqual(
      parseManagedActivityStep(
        {
          count: 8,
          detail: "nodejs.org",
          kind: "web",
          label: "Searching the web",
          status: "done",
          step: 2,
        },
        99,
        "Thinking",
      ),
      {
        count: 8,
        detail: "nodejs.org",
        kind: "web",
        label: "Searching the web",
        status: "done",
        step: 2,
      },
    );
  });

  it("degrades defensively rather than dropping the turn", () => {
    const unknown = parseManagedActivityStep(
      { kind: "telepathy", label: "Doing a thing", status: "vibing" },
      3,
      "Working",
    );
    assert.equal(unknown.kind, "other");
    assert.equal(unknown.status, "active");
    assert.equal(
      unknown.step,
      3,
      "a frame with no ordinal falls back to arrival",
    );

    const unlabelled = parseManagedActivityStep({ kind: "file" }, 1, "Working");
    assert.equal(
      unlabelled.label,
      "Working",
      "a missing label falls back to the phase word",
    );

    assert.equal(parseManagedActivityStep(undefined, 1, "Working"), null);
    assert.equal(parseManagedActivityStep({}, 1, ""), null);
    assert.equal(
      parseManagedActivityStep({ label: "   " }, 1, ""),
      null,
      "whitespace is not a label",
    );
    assert.equal(
      parseManagedActivityStep({ label: "x", count: -4 }, 1, "").count,
      null,
    );
    assert.equal(
      parseManagedActivityStep({ label: "x", step: 0 }, 7, "").step,
      7,
    );
  });

  it("bounds untrusted text so one frame cannot flood the shelf", () => {
    const parsed = parseManagedActivityStep(
      { detail: "d".repeat(900), label: "l".repeat(900) },
      1,
      "",
    );
    assert.ok(parsed.label.length <= 160);
    assert.ok(parsed.detail.length <= 512);
    assert.ok(parsed.label.endsWith("…"));
  });

  it("refuses text that could rewrite the line beside it", () => {
    assert.equal(
      parseManagedActivityStep(
        { kind: "file", label: "Reading\u202egnp.txt" },
        1,
        "",
      ),
      null,
      "a bidirectional override must not reach the shelf",
    );
    assert.equal(
      parseManagedActivityStep(
        { kind: "file", label: "Reading\nsecrets" },
        1,
        "",
      ),
      null,
    );
    const droppedDetail = parseManagedActivityStep(
      { kind: "file", label: "Reading a file", detail: "safe\u0007path" },
      1,
      "",
    );
    assert.equal(
      droppedDetail.detail,
      null,
      "an unsafe detail is dropped without taking the line with it",
    );
  });

  it("updates a repeated ordinal in place and never reorders", () => {
    const first = mergeManagedActivityStep([], step({ step: 1 }));
    const second = mergeManagedActivityStep(
      first,
      step({ label: "Reading", step: 2 }),
    );
    const settledFirst = mergeManagedActivityStep(
      second,
      step({ status: "done", step: 1 }),
    );
    assert.deepEqual(
      settledFirst.map((entry) => [entry.step, entry.status]),
      [
        [1, "done"],
        [2, "active"],
      ],
    );
    assert.equal(
      mergeManagedActivityStep(settledFirst, step({ status: "done", step: 1 })),
      settledFirst,
      "an unchanged step keeps the array identity",
    );

    const late = mergeManagedActivityStep(
      settledFirst,
      step({ label: "Late", step: 0.5 * 3 }),
    );
    assert.deepEqual(
      late.map((entry) => entry.step),
      [1, 1.5, 2],
      "a new ordinal lands at its numeric place",
    );
  });

  it("refuses to grow without bound", () => {
    let steps = [];
    for (let index = 1; index <= MAX_MANAGED_ACTIVITY_STEPS + 5; index += 1) {
      steps = mergeManagedActivityStep(steps, step({ step: index }));
    }
    assert.equal(steps.length, MAX_MANAGED_ACTIVITY_STEPS);
  });

  it("settles only on the successful end of a run", () => {
    const running = [step({ step: 1, status: "done" }), step({ step: 2 })];
    assert.deepEqual(
      settleManagedActivitySteps(running).map((entry) => entry.status),
      ["done", "done"],
    );
    const finished = [step({ step: 1, status: "failed" })];
    assert.equal(settleManagedActivitySteps(finished), finished);
  });

  it("reads present tense while live and past tense once done", () => {
    assert.equal(
      managedActivityStepLabel(step({ label: "Searching the web" })),
      "Searching the web",
    );
    assert.equal(
      managedActivityStepLabel(
        step({
          count: 8,
          kind: "web",
          label: "Searching the web",
          status: "done",
        }),
      ),
      "Searched the web — 8 results",
    );
    assert.equal(
      managedActivityStepLabel(
        step({
          count: 1,
          kind: "file",
          label: "Reading files",
          status: "done",
        }),
      ),
      "Read files — 1 file",
    );
    assert.equal(
      managedActivityStepLabel(
        step({
          count: 3,
          kind: "command",
          label: "Running pnpm test",
          status: "done",
        }),
      ),
      "Ran pnpm test — 3",
      "an unnamed unit is never invented",
    );
    assert.equal(
      managedActivityStepLabel(
        step({ label: "Consulting the oracle", status: "done" }),
      ),
      "Consulting the oracle",
      "an unrecognised verb is left verbatim rather than guessed at",
    );
    assert.equal(
      managedActivityStepLabel(
        step({ label: "Running build", status: "failed" }),
      ),
      "Ran build — failed",
    );
  });

  it("shows the bare domain and keeps the filename", () => {
    assert.equal(
      activityBareDomain("https://user:pw@www.Nodejs.org:8443/docs/api?q=1#x"),
      "nodejs.org",
    );
    assert.equal(activityBareDomain("nodejs.org"), "nodejs.org");
    assert.equal(
      truncateActivityPathFront(
        "desktop/src/features/messages/MessageRow.tsx",
        36,
      ),
      "…/features/messages/MessageRow.tsx",
    );
    assert.equal(truncateActivityPathFront("short.ts", 36), "short.ts");
    assert.match(
      truncateActivityPathFront(`${"x".repeat(80)}.tsx`, 20),
      /^…x+\.tsx$/,
    );
  });

  it("routes only objects to the mono face", () => {
    assert.equal(managedActivityStepIsMono("file"), true);
    assert.equal(managedActivityStepIsMono("command"), true);
    assert.equal(managedActivityStepIsMono("web"), false);
    assert.equal(managedActivityStepIsMono("thinking"), false);
    assert.equal(
      managedActivityStepDetail(
        step({ detail: "https://a.example.com/x", kind: "web" }),
      ),
      "a.example.com",
    );
    assert.equal(managedActivityStepDetail(step({ detail: null })), null);
  });

  it("collapses a finished run to one persistent summary", () => {
    assert.equal(managedActivityRunSummary([]), null);
    assert.equal(
      managedActivityRunSummary([step()]),
      null,
      "nothing has settled yet",
    );
    assert.equal(
      managedActivityRunSummary([
        step({
          count: 8,
          kind: "web",
          label: "Searching the web",
          status: "done",
        }),
      ]),
      "Searched the web — 8 results",
    );
    assert.equal(
      managedActivityRunSummary([
        step({ status: "done", step: 1 }),
        step({ status: "done", step: 2 }),
        step({ status: "failed", step: 3 }),
      ]),
      "2 steps · 1 failed",
    );
  });

  it("reads the wait as a fixed-width clock", () => {
    assert.equal(managedElapsedReadout(0), "0:00");
    assert.equal(managedElapsedReadout(-500), "0:00");
    assert.equal(managedElapsedReadout(9_400), "0:09");
    assert.equal(managedElapsedReadout(65_000), "1:05");
    assert.equal(managedElapsedReadout(600_000), "10:00");
  });
});
