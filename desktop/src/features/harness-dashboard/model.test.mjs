import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canStopHarnessTask,
  findInitialHarnessRow,
  harnessDraftKey,
  harnessComposerAudience,
  harnessTaskUsage,
  isHarnessRowOpen,
  projectHarnessRows,
  reconcileHarnessSelection,
  taskPresentation,
} from "./model.ts";
import {
  captureHarnessDispatch,
  createHarnessRequestGate,
  harnessSnapshotForKey,
  isHarnessSelectionCurrent,
} from "./requestGuard.ts";
import { resolveFixedAudience } from "../messages/ui/fixedAudiencePlan.ts";

function task(overrides = {}) {
  return {
    taskId: "task-a",
    conversationId: "conversation-a",
    residentPubkey: "resident-a",
    runtimeFamily: "claude_code",
    summary: "Check the focused fixture",
    workingFolder: "/synthetic/project",
    permissionMode: "normal",
    state: "active",
    providerSessionId: "provider-session-a",
    currentStep: null,
    completedSteps: 0,
    steps: [],
    startedAt: "2026-11-07T10:00:00Z",
    updatedAt: "2026-11-07T10:01:00Z",
    completedAt: null,
    error: null,
    canRetry: false,
    retryOfTaskId: null,
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    selectionKey: "stable-native-a",
    sessionId: "short-lived-session-a",
    title: "Claude Code session",
    workspace: "project",
    workingFolder: "/synthetic/project",
    updatedAt: "2026-11-07T10:01:00Z",
    routing: "saved_claude",
    liveState: "saved",
    canSend: false,
    canContinue: true,
    latestTaskId: null,
    reason: null,
    ...overrides,
  };
}

function catalogue(sessions) {
  return {
    runtimeFamily: "claude_code",
    sourceId: "source-a",
    sessions,
    truncated: false,
    notice: null,
  };
}

describe("harness workspace projection", () => {
  it("uses the canonical initiating resident as a valid fixed composer audience", () => {
    const resident = "a".repeat(64);
    assert.deepEqual(resolveFixedAudience(harnessComposerAudience(resident)), [
      resident,
    ]);
    assert.throws(
      () => resolveFixedAudience(harnessComposerAudience(null)),
      /valid fixed recipient/,
    );
    assert.throws(
      () => resolveFixedAudience(harnessComposerAudience("invalid")),
      /valid fixed recipient/,
    );
  });
  it("never infers live work from a recently modified transcript", () => {
    const [row] = projectHarnessRows(
      "claude_code",
      catalogue([session({ updatedAt: "2099-01-01T00:00:00Z" })]),
      [],
    );
    assert.equal(row.state, "saved");
    assert.match(row.activity, /Saved session/);
    assert.equal(isHarnessRowOpen(row), false);
  });

  it("does not put unknown activity or old completed receipts under Open now", () => {
    const rows = projectHarnessRows(
      "claude_code",
      catalogue([session({ liveState: "unknown" })]),
      [task({ state: "succeeded" })],
    );
    assert.equal(rows.some(isHarnessRowOpen), false);
    const [live] = projectHarnessRows(
      "claude_code",
      catalogue([session({ liveState: "live" })]),
      [],
    );
    assert.equal(isHarnessRowOpen(live), true);
  });

  it("shows only the selected runtime and keeps similarly named targets separate", () => {
    const rows = projectHarnessRows(
      "claude_code",
      catalogue([session({ title: "Check the focused fixture" })]),
      [task(), task({ taskId: "codex-task", runtimeFamily: "codex" })],
    );
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.session)?.task, null);
    assert.ok(!rows.some((row) => row.task?.runtimeFamily === "codex"));
  });

  it("joins only a natively resolved exact task and uses its real lifecycle", () => {
    const rows = projectHarnessRows(
      "claude_code",
      catalogue([session({ latestTaskId: "task-a" })]),
      [task({ state: "stopping" })],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].task.taskId, "task-a");
    assert.equal(rows[0].activity, "Stopping this task…");
  });

  it("preserves row and draft identity when dispatch leases rotate", () => {
    assert.notEqual(
      harnessDraftKey(
        "claude_code",
        "same-dm",
        "luca",
        "same-session",
        "owner:relay-a",
      ),
      harnessDraftKey(
        "claude_code",
        "same-dm",
        "luca",
        "same-session",
        "owner:relay-b",
      ),
    );
    const first = projectHarnessRows(
      "claude_code",
      catalogue([session()]),
      [],
    )[0];
    const refreshed = projectHarnessRows(
      "claude_code",
      catalogue([session({ sessionId: "new-lease-a" })]),
      [],
    )[0];
    assert.equal(first.id, refreshed.id);
    assert.equal(
      harnessDraftKey("claude_code", "home-a", "luca", first.id),
      harnessDraftKey("claude_code", "home-a", "luca", refreshed.id),
    );
    assert.notEqual(
      harnessDraftKey("claude_code", "home-a", "luca", first.id),
      harnessDraftKey("codex", "home-a", "luca", first.id),
    );
    assert.notEqual(
      harnessDraftKey("claude_code", "home-a", "luca", first.id),
      harnessDraftKey("claude_code", "home-b", "luca", first.id),
    );
  });

  it("resolves exact Home deep links without falling back to another row", () => {
    const rows = projectHarnessRows(
      "claude_code",
      catalogue([session({ latestTaskId: "task-a" })]),
      [task()],
    );
    assert.equal(
      findInitialHarnessRow(rows, "task-a")?.session.selectionKey,
      "stable-native-a",
    );
    assert.equal(
      findInitialHarnessRow(rows, undefined, "short-lived-session-a")?.id,
      rows[0].id,
    );
    assert.equal(
      findInitialHarnessRow(rows, undefined, "stable-native-a")?.id,
      rows[0].id,
    );
    assert.equal(findInitialHarnessRow(rows, "missing"), null);
  });

  it("retains a selected receipt when its exact native session arrives later", () => {
    const initial = projectHarnessRows("claude_code", null, [task()]);
    const refreshed = projectHarnessRows(
      "claude_code",
      catalogue([session({ latestTaskId: "task-a" })]),
      [task()],
    );
    assert.equal(
      reconcileHarnessSelection(refreshed, initial[0].id, initial[0])?.id,
      "session:stable-native-a",
    );
    assert.equal(
      reconcileHarnessSelection(refreshed, "missing", initial[0]),
      null,
    );
    assert.equal(reconcileHarnessSelection(refreshed, null, initial[0]), null);
  });

  it("does not represent native queue acceptance as completion or local stop control", () => {
    const native = task({
      state: "awaiting_native",
      controlOwner: "native_app",
    });
    assert.equal(taskPresentation(native).state, "waiting");
    assert.match(taskPresentation(native).activity, /not complete/);
    assert.equal(canStopHarnessTask(native), false);
    assert.equal(canStopHarnessTask(task()), true);
    assert.equal(canStopHarnessTask(task({ state: "stopping" })), false);
    assert.equal(canStopHarnessTask(task({ state: "succeeded" })), false);
  });

  it("reports only known owned durations and no inferred account usage", () => {
    const usage = harnessTaskUsage(
      [
        task({ state: "succeeded", completedAt: "2026-11-07T10:02:00Z" }),
        task({
          taskId: "native",
          controlOwner: "native_app",
          state: "awaiting_native",
        }),
        task({ taskId: "unknown", state: "interrupted", completedAt: null }),
        task({ taskId: "invalid", state: "succeeded", completedAt: "invalid" }),
      ],
      Date.parse("2026-11-07T10:20:00Z"),
    );
    assert.equal(usage.total, 4);
    assert.equal(usage.durationMs, 120_000);
    assert.equal(usage.timedTasks, 1);
    assert.equal(usage.working, 0);
    assert.equal("cost" in usage, false);
    assert.equal("allowance" in usage, false);
  });
});

describe("harness async selection guards", () => {
  it("drops an old transcript response after rapid A to B to A selection", async () => {
    const gate = createHarnessRequestGate();
    const firstA = gate.begin();
    const b = gate.begin();
    const secondA = gate.begin();
    await Promise.resolve();
    assert.equal(firstA(), false);
    assert.equal(b(), false);
    assert.equal(secondA(), true);
  });

  it("invalidates reads on refresh, hidden view or unmount", () => {
    const gate = createHarnessRequestGate();
    const reading = gate.begin();
    gate.invalidate();
    assert.equal(reading(), false);
    const next = gate.begin();
    gate.dispose();
    assert.equal(next(), false);
  });

  it("hides mismatched data in the frame before effect cleanup", () => {
    const a = {
      key: "session:a",
      value: { messages: ["A"] },
      error: null,
      loading: false,
    };
    assert.equal(harnessSnapshotForKey(a, "session:b").value, null);
    assert.equal(harnessSnapshotForKey(a, "session:a").value.messages[0], "A");
  });

  it("cannot submit an unmounted or switched composer to the new selection", () => {
    assert.equal(
      isHarnessSelectionCurrent("session:a", "session:b", true),
      false,
    );
    assert.equal(
      isHarnessSelectionCurrent("session:a", "session:a", false),
      false,
    );
    assert.equal(
      isHarnessSelectionCurrent("session:a", "session:a", true),
      true,
    );
  });

  it("freezes exact runtime, native handles and folder before async dispatch", async () => {
    const input = {
      conversationId: "home-a",
      residentPubkey: "luca",
      runtimeFamily: "claude_code",
      prompt: "Follow up",
      summary: "Follow up",
      workingFolder: "/synthetic/a",
      permissionMode: "normal",
      operation: "send_message",
      sourceId: "source-a",
      sessionId: "session-a",
    };
    const captured = captureHarnessDispatch(input);
    input.runtimeFamily = "codex";
    input.sourceId = "source-b";
    input.sessionId = "session-b";
    input.workingFolder = "/synthetic/b";
    await Promise.resolve();
    assert.equal(captured.runtimeFamily, "claude_code");
    assert.equal(captured.sourceId, "source-a");
    assert.equal(captured.sessionId, "session-a");
    assert.equal(captured.workingFolder, "/synthetic/a");
    assert.equal(Object.isFrozen(captured), true);
  });
});
