import { Check, ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import * as React from "react";

import {
  getRuntimeTaskResult,
  type RuntimeTaskProjection,
} from "@/shared/api/tauriRuntimeTasks";

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

function providerLabel(task: RuntimeTaskProjection) {
  return task.runtimeFamily === "codex" ? "Codex" : "Claude Code";
}

export function RuntimeTaskResultReceipts({
  onRetrySynthesis,
  tasks,
}: {
  onRetrySynthesis: (task: RuntimeTaskProjection) => Promise<void>;
  tasks: RuntimeTaskProjection[];
}) {
  const [dismissed, setDismissed] = React.useState(readDismissed);
  const [expandedTaskId, setExpandedTaskId] = React.useState<string | null>(
    null,
  );
  const [result, setResult] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [retryingSynthesis, setRetryingSynthesis] = React.useState(false);
  const [retryError, setRetryError] = React.useState<string | null>(null);
  const task = tasks.find(
    (candidate) =>
      (candidate.state === "succeeded" || candidate.state === "stopped") &&
      !dismissed.has(candidate.taskId),
  );
  if (!task) return null;
  const expanded = expandedTaskId === task.taskId;
  const canReview = task.state === "succeeded";

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
          <Check aria-hidden className="size-3.5" />
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
            {task.state === "succeeded" ? "Completed" : "Stopped"} with{" "}
            {providerLabel(task)}
          </span>
        </button>
        {canReview ? (
          <button
            aria-label="Retry resident synthesis"
            className="flex h-7 items-center gap-1.5 rounded-full px-2 text-xs text-ink-muted hover:bg-foreground/[0.06] hover:text-ink disabled:opacity-45"
            disabled={retryingSynthesis}
            onClick={() => {
              setRetryingSynthesis(true);
              setRetryError(null);
              void onRetrySynthesis(task)
                .catch((cause: unknown) => {
                  setRetryError(
                    cause instanceof Error
                      ? cause.message
                      : "Resident synthesis could not be retried.",
                  );
                })
                .finally(() => setRetryingSynthesis(false));
            }}
            type="button"
          >
            <RotateCcw aria-hidden className="size-3.5" />
            {retryingSynthesis ? "Retrying…" : "Retry synthesis"}
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
      {retryError ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {retryError}
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
