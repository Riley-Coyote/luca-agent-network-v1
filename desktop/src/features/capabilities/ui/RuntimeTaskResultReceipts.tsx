import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  X,
} from "lucide-react";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  getRuntimeTaskResult,
  openRuntimeTaskSession,
  retryRuntimeTaskDelivery,
  type RuntimeTaskProjection,
} from "@/shared/api/tauriRuntimeTasks";
import {
  runtimeTaskNativeHandoff,
  runtimeTaskReceiptLabel,
  runtimeTaskDeliveryLabel,
  runtimeTaskSummaryRetry,
  mergeRuntimeTasks,
} from "../lib/runtimeTaskPresentation";
import { runtimeTasksKey } from "../useRuntimeTasks";

const DISMISSED_KEY = "polyphonic.runtime-task-receipts.dismissed.v1";

function readDismissed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(DISMISSED_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids].slice(-256)));
  } catch {
    // The receipt still dismisses for this session when storage is unavailable.
  }
}

export function RuntimeTaskResultReceipts({
  onRetrySynthesis,
  tasks,
}: {
  onRetrySynthesis: (task: RuntimeTaskProjection) => Promise<void>;
  tasks: RuntimeTaskProjection[];
}) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = React.useState(readDismissed);
  const [expandedTaskId, setExpandedTaskId] = React.useState<string | null>(
    null,
  );
  const [result, setResult] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [retryingSynthesis, setRetryingSynthesis] = React.useState(false);
  const [openingNative, setOpeningNative] = React.useState(false);
  const [actionError, setActionError] = React.useState<{
    taskId: string;
    message: string;
  } | null>(null);
  const task = tasks.find(
    (candidate) =>
      (runtimeTaskNativeHandoff(candidate) ||
        candidate.state === "succeeded" ||
        candidate.state === "stopped") &&
      !dismissed.has(candidate.taskId),
  );
  if (!task) return null;
  const nativeHandoff = runtimeTaskNativeHandoff(task);
  const canReview = !nativeHandoff && task.state === "succeeded";
  const deliveryLabel = runtimeTaskDeliveryLabel(task);
  const summaryRetry = runtimeTaskSummaryRetry(task);
  const expanded = canReview && expandedTaskId === task.taskId;

  const toggle = () => {
    if (!canReview) return;
    if (expanded) {
      setExpandedTaskId(null);
      setResult(null);
      return;
    }
    setExpandedTaskId(task.taskId);
    setLoading(true);
    void getRuntimeTaskResult(task.taskId)
      .then((payload) => setResult(payload.result))
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  };

  return (
    <section
      className="luca-measure pointer-events-auto mb-1.5 rounded-xl border border-border/45 bg-plate/72 px-3 py-2.5"
      data-testid="runtime-task-result-receipt"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground/[0.06]">
          {nativeHandoff ? (
            <ArrowUpRight aria-hidden className="size-3.5" />
          ) : (
            <Check aria-hidden className="size-3.5" />
          )}
        </span>
        <button
          className="min-w-0 flex-1 text-left"
          onClick={toggle}
          type="button"
        >
          <span className="block truncate text-sm font-medium text-ink">
            {task.summary}
          </span>
          <span className="block text-xs text-ink-muted">
            {runtimeTaskReceiptLabel(task)}
          </span>
        </button>
        {nativeHandoff && task.runtimeFamily === "codex" ? (
          <button
            className="flex h-7 items-center gap-1.5 rounded-full px-2 text-xs text-ink-muted hover:bg-foreground/[0.06] hover:text-ink disabled:opacity-45"
            disabled={openingNative}
            onClick={() => {
              setOpeningNative(true);
              setActionError(null);
              void openRuntimeTaskSession(task.taskId)
                .catch((cause: unknown) => {
                  setActionError({
                    taskId: task.taskId,
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "The native session could not be opened.",
                  });
                })
                .finally(() => setOpeningNative(false));
            }}
            type="button"
          >
            {openingNative ? "Opening…" : "Open in Codex"}
          </button>
        ) : null}
        {summaryRetry ? (
          <button
            aria-label={
              summaryRetry === "delivery"
                ? "Retry result summary"
                : "Retry resident synthesis"
            }
            className="flex h-7 items-center gap-1.5 rounded-full px-2 text-xs text-ink-muted hover:bg-foreground/[0.06] hover:text-ink disabled:opacity-45"
            disabled={retryingSynthesis}
            onClick={() => {
              setRetryingSynthesis(true);
              setActionError(null);
              const retry =
                summaryRetry === "delivery"
                  ? retryRuntimeTaskDelivery(task.taskId).then((updated) => {
                      if (
                        updated.taskId !== task.taskId ||
                        updated.conversationId !== task.conversationId
                      ) {
                        throw new Error(
                          "The result summary retry could not be verified.",
                        );
                      }
                      // The command reply is authoritative even if the event
                      // bridge is unavailable. A newer event still wins merge.
                      queryClient.setQueryData<RuntimeTaskProjection[]>(
                        runtimeTasksKey(task.conversationId),
                        (current = []) => mergeRuntimeTasks(current, [updated]),
                      );
                    })
                  : onRetrySynthesis(task);
              void retry
                .catch((cause: unknown) => {
                  setActionError({
                    taskId: task.taskId,
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "The result summary could not be retried.",
                  });
                })
                .finally(() => setRetryingSynthesis(false));
            }}
            type="button"
          >
            <RotateCcw aria-hidden className="size-3.5" />
            {retryingSynthesis
              ? "Retrying…"
              : summaryRetry === "delivery"
                ? "Retry summary"
                : "Retry synthesis"}
          </button>
        ) : null}
        {canReview ? (
          <button
            aria-label={expanded ? "Hide task result" : "Review task result"}
            className="grid size-7 place-items-center rounded-full text-ink-muted hover:bg-foreground/[0.06] hover:text-ink"
            onClick={toggle}
            type="button"
          >
            {expanded ? (
              <ChevronDown aria-hidden className="size-3.5" />
            ) : (
              <ChevronUp aria-hidden className="size-3.5" />
            )}
          </button>
        ) : null}
        <button
          aria-label="Dismiss task receipt"
          className="grid size-7 place-items-center rounded-full text-ink-muted hover:bg-foreground/[0.06] hover:text-ink"
          onClick={() => {
            setDismissed((current) => {
              const next = new Set(current);
              next.add(task.taskId);
              writeDismissed(next);
              return next;
            });
          }}
          type="button"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      {deliveryLabel ? (
        <p className="mt-2 text-xs text-ink-muted" role="status">
          {deliveryLabel}
        </p>
      ) : null}
      {nativeHandoff ? (
        <p className="mt-2 text-xs text-ink-muted">
          {task.targetLabel ? `${task.targetLabel}. ` : ""}
          {task.state === "failed" || task.state === "interrupted"
            ? "Check this exact session before sending again. Delivery could not be confirmed; no automatic retry will run. "
            : "Polyphonic is not observing a verified result for this handoff. "}
          Handle approvals and stopping in{" "}
          {task.runtimeFamily === "codex" ? "Codex" : "Claude Code"}.
        </p>
      ) : null}
      {nativeHandoff && task.error ? (
        <p className="mt-2 text-xs text-ink-muted">{task.error}</p>
      ) : null}
      {actionError?.taskId === task.taskId ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {actionError.message}
        </p>
      ) : null}
      {expanded ? (
        <div className="mt-2 max-h-72 overflow-y-auto border-t border-border/45 pt-2">
          {loading ? (
            <p className="text-sm text-ink-muted">Loading result…</p>
          ) : (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {result ?? "The result is unavailable."}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
