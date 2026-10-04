import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  isExistingRuntimeTask,
  mergeRuntimeTasks,
  runtimeTaskAction,
  runtimeTaskNativeHandoff,
  runtimeTaskReceiptLabel,
  runtimeTaskDeliveryLabel,
  runtimeTaskSummaryRetry,
  runtimeTaskTargetForFamily,
  runtimeTaskVisible,
  verifiedRuntimeTaskTarget,
} from "./runtimeTaskPresentation.ts";
import { RuntimeTaskConfirmationCard } from "../ui/RuntimeTaskConfirmationCard.tsx";
import { RuntimeTaskResultReceipts } from "../ui/RuntimeTaskResultReceipts.tsx";

function task(overrides = {}) {
  return {
    taskId: "task-1",
    conversationId: "conversation-1",
    residentPubkey: "synthetic-resident",
    runtimeFamily: "codex",
    summary: "A bounded task",
    workingFolder: "/synthetic/exact-project",
    permissionMode: "normal",
    state: "active",
    providerSessionId: null,
    currentStep: null,
    completedSteps: 0,
    steps: [],
    startedAt: "2026-10-04T12:00:00Z",
    updatedAt: "2026-10-04T12:01:00Z",
    completedAt: null,
    error: null,
    canRetry: false,
    retryOfTaskId: null,
    ...overrides,
  };
}

function confirmation(draft) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RuntimeTaskConfirmationCard, {
        draft: {
          conversationId: "conversation-1",
          residentPubkey: "synthetic-resident",
          residentName: "Luca",
          runtimeFamily: "codex",
          summary: "Use the smaller approach",
          prompt: "Use the smaller approach",
          ...draft,
        },
        onCancel: () => {},
        onConfirm: async () => {},
        onConfirmed: () => {},
      }),
    ),
  );
}

describe("runtime task presentation", () => {
  it("routes only controls owned by the exact root state", () => {
    assert.equal(
      runtimeTaskAction({ state: "active", canRetry: false }),
      "stop",
    );
    assert.equal(
      runtimeTaskAction({ state: "failed", canRetry: true }),
      "retry",
    );
    assert.equal(
      runtimeTaskAction({ state: "interrupted", canRetry: false }),
      "dismiss",
    );
    assert.equal(
      runtimeTaskAction({ state: "succeeded", canRetry: false }),
      null,
    );
  });

  it("retires success after four seconds and never leaves stopped work active", () => {
    const now = Date.parse("2026-09-01T12:00:04.000Z");
    const base = {
      taskId: "task-1",
      state: "succeeded",
      completedAt: "2026-09-01T12:00:00.001Z",
    };
    assert.equal(runtimeTaskVisible(base, new Set(), now), true);
    assert.equal(
      runtimeTaskVisible(
        { ...base, completedAt: "2026-09-01T12:00:00.000Z" },
        new Set(),
        now,
      ),
      false,
    );
    assert.equal(
      runtimeTaskVisible({ ...base, state: "stopped" }, new Set(), now),
      false,
    );
    assert.equal(runtimeTaskVisible(base, new Set(["task-1"]), now), false);
  });

  it("accepts only supported runtime families reported for the resident", () => {
    assert.equal(runtimeTaskTargetForFamily("codex"), "codex");
    assert.equal(runtimeTaskTargetForFamily("claude_code"), "claude_code");
    assert.equal(runtimeTaskTargetForFamily("hermes"), null);
    assert.equal(runtimeTaskTargetForFamily(null), null);
  });

  it("never substitutes a different ready runtime for the resident target", () => {
    assert.equal(
      verifiedRuntimeTaskTarget("codex", ["codex", "claude_code"]),
      "codex",
    );
    assert.equal(
      verifiedRuntimeTaskTarget("claude_code", ["codex", "claude_code"]),
      "claude_code",
    );
    assert.equal(verifiedRuntimeTaskTarget("codex", ["claude_code"]), null);
    assert.equal(verifiedRuntimeTaskTarget(null, ["claude_code"]), null);
  });

  it("keeps legacy records as new Polyphonic-owned tasks", () => {
    assert.equal(isExistingRuntimeTask(undefined), false);
    assert.equal(isExistingRuntimeTask("new_task"), false);
    assert.equal(runtimeTaskNativeHandoff(task()), false);
    assert.equal(runtimeTaskAction(task()), "stop");
    assert.equal(
      runtimeTaskReceiptLabel(task({ state: "succeeded" })),
      "Completed with Codex",
    );
    const html = confirmation({});
    assert.equal((html.match(/<select/g) ?? []).length, 2);
    assert.match(html, /Full Access/);
    assert.match(html, />Run<\/button>/);
  });

  it("locks exact-session confirmations without exposing opaque refs or Full Access", () => {
    for (const operation of ["send_message", "continue_session"]) {
      const html = confirmation({
        operation,
        sourceId: "opaque-source-ref",
        sessionId: "opaque-session-ref",
        targetWorkingFolder: "/synthetic/exact-project",
        targetLabel: "The requested native session",
        workingFolder: "/synthetic/wrong-fallback",
      });
      assert.equal((html.match(/<select/g) ?? []).length, 1);
      assert.match(html, /<select[^>]*disabled/);
      assert.match(
        html,
        /<button[^>]*disabled[^>]*><svg[\s\S]*?\/synthetic\/exact-project/,
      );
      assert.match(html, /Keep this session&#x27;s native permissions/);
      assert.doesNotMatch(
        html,
        /Full Access|opaque-source-ref|opaque-session-ref|wrong-fallback/,
      );
      assert.match(
        html,
        operation === "send_message"
          ? />Send<\/button>/
          : />Continue<\/button>/,
      );
      if (operation === "continue_session") {
        assert.match(
          html,
          /confirm this exact saved CLI session is not running in another client/,
        );
        assert.match(
          html,
          /File metadata and Polyphonic&#x27;s local lease do not prove that it is idle everywhere/,
        );
      } else {
        assert.doesNotMatch(html, /saved CLI session|idle everywhere/);
        assert.match(html, /Delivery is not work completion/);
      }
    }
  });

  it("never dispatches an existing-session confirmation with missing target metadata", () => {
    for (const missing of [
      { sourceId: null },
      { sessionId: "" },
      { targetWorkingFolder: null },
    ]) {
      const html = confirmation({
        operation: "send_message",
        sourceId: "opaque-source-ref",
        sessionId: "opaque-session-ref",
        targetWorkingFolder: "/synthetic/exact-project",
        ...missing,
      });
      assert.match(html, /no work will be sent/);
      assert.match(html, /<button[^>]*disabled[^>]*>Send<\/button>/);
      assert.doesNotMatch(
        html,
        /Choose a project or working folder<\/span><\/button><[\s\S]*>Run<\/button>/,
      );
    }
  });

  it("native handoffs never offer cancellation, retry, results or completion labels", () => {
    for (const state of [
      "queued",
      "active",
      "awaiting_native",
      "failed",
      "interrupted",
      "succeeded",
      "stopped",
    ]) {
      const native = task({
        state,
        controlOwner: "native_app",
        canRetry: true,
        deliveryState: "retryable",
        deliveryCanRetry: true,
      });
      assert.equal(runtimeTaskAction(native), null);
      assert.equal(runtimeTaskVisible(native, new Set(), Date.now()), false);
      const html = renderToStaticMarkup(
        createElement(RuntimeTaskResultReceipts, {
          tasks: [native],
          onRetrySynthesis: async () => {
            throw new Error("Must not run for a native handoff");
          },
        }),
      );
      assert.match(html, /Open in Codex/);
      assert.doesNotMatch(
        html,
        /Completed with|Stopped with|Review task result|Retry synthesis|Retry summary|Loading result|Resident summary/,
      );
      if (state === "awaiting_native")
        assert.match(html, /Queued in Codex — work is not complete/);
      if (state === "failed" || state === "interrupted") {
        assert.match(html, /Delivery uncertain/);
        assert.match(html, /no automatic retry will run/);
      }
    }
    assert.equal(runtimeTaskAction(task({ state: "awaiting_native" })), null);
    assert.equal(
      runtimeTaskVisible(
        task({ state: "awaiting_native" }),
        new Set(),
        Date.now(),
      ),
      false,
    );
  });

  it("confirmation authorizes one result summary only for run and continuation", () => {
    for (const operation of [undefined, "new_task", "continue_session"]) {
      const html = confirmation({ operation });
      assert.match(
        html,
        /authorizes this exact task and one result summary by Luca back into this same conversation/,
      );
      assert.match(html, /does not authorize another provider task/);
    }
    const queued = confirmation({ operation: "send_message" });
    assert.doesNotMatch(queued, /one result summary|authorizes another/);
    assert.match(queued, /Delivery is not work completion/);
  });

  it("delivery phases never equate prepared or submitted with publication", () => {
    const expected = new Map([
      ["awaiting_result", /Waiting for the task result/],
      ["pending_synthesis", /summary queued/],
      ["synthesizing", /Preparing the resident summary/],
      ["prepared", /prepared; not yet submitted/],
      ["submitted", /publication is not yet confirmed/],
      ["published", /summary published in this conversation/],
      ["retryable", /summary needs attention/],
      ["rejected", /delivery was rejected/],
      ["cancelled", /delivery was cancelled/],
      ["blocked", /delivery is blocked/],
    ]);
    for (const [deliveryState, label] of expected) {
      const receipt = task({
        state: "succeeded",
        deliveryState,
        deliveryCanRetry: false,
      });
      assert.match(runtimeTaskDeliveryLabel(receipt), label);
      const html = renderToStaticMarkup(
        createElement(RuntimeTaskResultReceipts, {
          tasks: [receipt],
          onRetrySynthesis: async () => {
            throw new Error("No owner message for native delivery");
          },
        }),
      );
      assert.match(html, label);
      assert.doesNotMatch(
        html,
        /Retry resident synthesis|Retry result summary/,
      );
      if (deliveryState !== "published")
        assert.doesNotMatch(html, /Resident summary published/);
    }
  });

  it("summary retry requires native authority and cannot fall back to an owner message", () => {
    const complete = task({ state: "succeeded" });
    assert.equal(runtimeTaskSummaryRetry(complete), "manual");
    assert.equal(
      runtimeTaskSummaryRetry({ ...complete, deliveryState: null }),
      "manual",
    );
    assert.equal(
      runtimeTaskSummaryRetry({
        ...complete,
        deliveryState: "retryable",
        deliveryCanRetry: true,
      }),
      "delivery",
    );
    for (const deliveryState of [
      "awaiting_result",
      "pending_synthesis",
      "synthesizing",
      "published",
    ]) {
      assert.equal(
        runtimeTaskSummaryRetry({
          ...complete,
          deliveryState,
          deliveryCanRetry: true,
        }),
        null,
      );
    }
    for (const deliveryState of [
      "prepared",
      "submitted",
      "retryable",
      "rejected",
      "cancelled",
      "blocked",
    ]) {
      assert.equal(
        runtimeTaskSummaryRetry({
          ...complete,
          deliveryState,
          deliveryCanRetry: false,
        }),
        null,
      );
    }
    for (const overrides of [
      { controlOwner: "native_app" },
      { state: "awaiting_native" },
      { operation: "send_message" },
      { state: "failed" },
      { state: "active" },
    ]) {
      assert.equal(
        runtimeTaskSummaryRetry({
          ...complete,
          deliveryState: "retryable",
          deliveryCanRetry: true,
          ...overrides,
        }),
        null,
      );
    }
    assert.equal(
      runtimeTaskDeliveryLabel({
        ...complete,
        controlOwner: "native_app",
        deliveryState: "published",
      }),
      null,
    );
    assert.equal(
      runtimeTaskDeliveryLabel({
        ...complete,
        operation: "send_message",
        deliveryState: "published",
      }),
      null,
    );
    const html = renderToStaticMarkup(
      createElement(RuntimeTaskResultReceipts, {
        tasks: [
          { ...complete, deliveryState: "retryable", deliveryCanRetry: true },
        ],
        onRetrySynthesis: async () => {},
      }),
    );
    assert.match(html, /Retry result summary/);
    assert.doesNotMatch(html, /Retry resident synthesis/);
  });

  it("published delivery evidence survives stale and legacy list backfills", () => {
    const published = task({
      state: "succeeded",
      deliveryState: "published",
      deliveryCanRetry: false,
    });
    const [legacyBackfill] = mergeRuntimeTasks(
      [published],
      [task({ state: "succeeded" })],
    );
    assert.equal(legacyBackfill.deliveryState, "published");
    assert.equal(legacyBackfill.deliveryCanRetry, false);
    const [latePending] = mergeRuntimeTasks(
      [published],
      [
        task({
          state: "succeeded",
          deliveryState: "pending_synthesis",
          deliveryCanRetry: true,
          updatedAt: "2026-10-04T12:02:00Z",
        }),
      ],
    );
    assert.equal(latePending.deliveryState, "published");
    assert.equal(runtimeTaskSummaryRetry(latePending), null);
  });

  it("list backfills and stale events do not regress task evidence", () => {
    const complete = task({
      state: "succeeded",
      updatedAt: "2026-10-04T12:03:00Z",
    });
    assert.deepEqual(mergeRuntimeTasks([complete], [task()]), [complete]);
    assert.deepEqual(
      mergeRuntimeTasks(
        [complete],
        [task({ updatedAt: "2026-10-04T12:04:00Z" })],
      ),
      [complete],
    );
    const queued = task({
      state: "awaiting_native",
      controlOwner: "native_app",
    });
    assert.deepEqual(
      mergeRuntimeTasks(
        [queued],
        [task({ updatedAt: "2026-10-04T12:02:00Z" })],
      ),
      [queued],
    );
    const stopping = task({ state: "stopping" });
    assert.deepEqual(mergeRuntimeTasks([stopping], [task()]), [stopping]);
    const newer = task({ taskId: "task-2", startedAt: "2026-10-04T12:05:00Z" });
    assert.deepEqual(mergeRuntimeTasks([complete, newer], [task()]), [
      newer,
      complete,
    ]);
    assert.deepEqual(
      mergeRuntimeTasks([complete], [task({ updatedAt: "not-a-timestamp" })]),
      [complete],
    );
    assert.deepEqual(
      mergeRuntimeTasks(
        [complete],
        [task({ state: "failed", updatedAt: complete.updatedAt })],
      ),
      [complete],
    );
    const nativeFailure = task({
      state: "failed",
      controlOwner: "native_app",
      targetSessionRef: "opaque-target",
    });
    const [backfilled] = mergeRuntimeTasks(
      [nativeFailure],
      [task({ state: "failed" })],
    );
    assert.equal(backfilled.controlOwner, "native_app");
    assert.equal(backfilled.targetSessionRef, "opaque-target");
    assert.equal(runtimeTaskAction(backfilled), null);
  });

  it("bounds merged receipts after sorting newest first", () => {
    const receipts = Array.from({ length: 520 }, (_, index) =>
      task({
        taskId: `task-${index}`,
        startedAt: new Date(
          Date.parse("2026-10-04T12:00:00Z") + index * 1000,
        ).toISOString(),
      }),
    );
    const merged = mergeRuntimeTasks([], receipts);
    assert.equal(merged.length, 512);
    assert.equal(merged[0].taskId, "task-519");
    assert.equal(merged.at(-1).taskId, "task-8");
  });
});
