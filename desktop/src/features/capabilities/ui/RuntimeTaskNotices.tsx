import * as React from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import type { RuntimeTaskProjection } from "@/shared/api/tauriRuntimeTasks";
import {
  TASK_NOTICE_KEY,
  dismissTaskNotices,
  readTaskNoticeMemory,
  taskNoticeTitle,
  taskNoticeRevision,
  visibleTaskNotices,
  writeTaskNoticeMemory,
} from "../lib/runtimeTaskNotices";
import { RuntimeTaskResultReceipt } from "./RuntimeTaskResultReceipts";

/** One quiet, scoped notice. Opening/closing it never controls execution. */
export function RuntimeTaskNotices({
  scope,
  tasks,
  onRetrySynthesis,
}: {
  scope: string;
  tasks: RuntimeTaskProjection[];
  onRetrySynthesis: (task: RuntimeTaskProjection) => Promise<void>;
}) {
  const [memory, setMemory] = React.useState(() =>
    readTaskNoticeMemory(localStorage, scope, Date.now()),
  );
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const detailsId = React.useId();
  const storageKey = `${TASK_NOTICE_KEY}:${scope}`;

  React.useEffect(() => {
    // Reuse the first window's rollout boundary; don't reset it on navigation.
    const saved = readTaskNoticeMemory(localStorage, scope, memory.since);
    setMemory(saved);
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // Session acknowledgement still works without durable browser storage.
    }
    const changed = (event: StorageEvent) => {
      if (event.key?.startsWith(storageKey) || event.key === null)
        setMemory(readTaskNoticeMemory(localStorage, scope, memory.since));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [scope, storageKey, memory.since]);

  const notices = React.useMemo(
    () => visibleTaskNotices(tasks, memory),
    [tasks, memory],
  );
  const selected =
    notices.find((task) => task.taskId === selectedId) ?? notices[0];
  const keyFor = (task: RuntimeTaskProjection) =>
    JSON.stringify([
      task.conversationId,
      task.taskId,
      taskNoticeRevision(task),
    ]);
  const selectedKey = selected ? keyFor(selected) : null;
  const expanded = selectedKey !== null && expandedKey === selectedKey;
  const dismiss = (batch: RuntimeTaskProjection[]) => {
    // Merge the latest other-window acknowledgements before writing ours.
    const latest = readTaskNoticeMemory(localStorage, scope, memory.since);
    const next = dismissTaskNotices(
      { ...latest, dismissed: { ...memory.dismissed, ...latest.dismissed } },
      batch,
    );
    try {
      writeTaskNoticeMemory(localStorage, scope, next);
      window.dispatchEvent(
        new CustomEvent("polyphonic:runtime-task-notices-changed", {
          detail: { scope },
        }),
      );
    } catch {
      // Never let storage failure turn dismissal into task cancellation.
    }
    setMemory(next);
  };

  if (!selected) return null;
  return (
    <section
      className="luca-task-notice luca-measure"
      data-testid="runtime-task-notice"
      aria-label="Task needs attention"
    >
      <div className="luca-task-notice__row">
        <button
          className="luca-task-notice__disclosure"
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label="Review task notices"
          onClick={() => setExpandedKey(expanded ? null : selectedKey)}
        >
          <span role="status">
            {notices.length === 1
              ? taskNoticeTitle(selected)
              : `${notices.length} tasks need attention`}
          </span>
          {expanded ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
        </button>
        <button
          type="button"
          className="luca-task-notice__dismiss"
          aria-label="Dismiss task notices"
          onClick={() => {
            dismiss(notices);
            setExpandedKey(null);
          }}
        >
          <X aria-hidden />
        </button>
      </div>
      {expanded ? (
        <div className="luca-task-notice__details" id={detailsId}>
          {notices.length > 1 ? (
            <fieldset
              className="luca-task-notice__choices"
              aria-label="Tasks needing attention"
            >
              {notices.map((task) => (
                <button
                  type="button"
                  key={task.taskId}
                  aria-pressed={task.taskId === selected.taskId}
                  onClick={() => {
                    setSelectedId(task.taskId);
                    setExpandedKey(keyFor(task));
                  }}
                >
                  {taskNoticeTitle(task)}
                  {Number.isFinite(Date.parse(task.startedAt))
                    ? ` · ${new Date(task.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                    : ""}
                </button>
              ))}
            </fieldset>
          ) : null}
          <RuntimeTaskResultReceipt
            key={JSON.stringify([selected.conversationId, selected.taskId])}
            task={selected}
            onRetrySynthesis={onRetrySynthesis}
            onDismiss={() => dismiss([selected])}
          />
        </div>
      ) : null}
    </section>
  );
}
