import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";

import { connectedBrainInventoryQueryKey } from "@/features/luca/brain/hooks";
import {
  type BackgroundTask,
  dismissBackgroundTask,
  useBackgroundTasks,
} from "@/shared/lib/backgroundTasks";
import { BusyMark } from "@/shared/ui/BusyMark";
import { SidebarCompactActionCard } from "@/shared/ui/sidebar-action-card";

/** How long a finished task's success card lingers before poofing away. */
const SUCCESS_AUTO_DISMISS_MS = 6_000;

function summarize(tasks: BackgroundTask[]): {
  description: string | undefined;
  title: string;
} {
  if (tasks.length === 1) {
    return { description: undefined, title: tasks[0].label };
  }
  return {
    description: tasks.map((task) => task.label).join(" · "),
    title: `${tasks.length} tasks running`,
  };
}

/**
 * The footer's narration of the background-task store: while anything runs
 * the busy mark ticks here, successes linger briefly and poof, failures
 * hold until dismissed. One card, whatever the count — the footer keeps
 * its one-slot discipline.
 */
export function SidebarBackgroundTaskCard({
  className,
}: {
  className?: string;
}) {
  const tasksSnapshot = useBackgroundTasks();
  const queryClient = useQueryClient();
  const running = tasksSnapshot.filter((task) => task.status === "running");
  const failed = tasksSnapshot.filter((task) => task.status === "failed");
  const succeeded = tasksSnapshot.filter((task) => task.status === "succeeded");

  // A settled task can outlive the view that started it, so its query
  // invalidation lands here rather than in an unmounted mutation callback.
  const settledCount = failed.length + succeeded.length;
  React.useEffect(() => {
    if (settledCount === 0) return;
    void queryClient.invalidateQueries({
      queryKey: connectedBrainInventoryQueryKey,
    });
  }, [queryClient, settledCount]);

  // Successes read for a moment, then leave on their own.
  React.useEffect(() => {
    if (succeeded.length === 0) return;
    const timers = succeeded.map((task) =>
      window.setTimeout(
        () => dismissBackgroundTask(task.id),
        SUCCESS_AUTO_DISMISS_MS,
      ),
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [succeeded]);

  if (running.length > 0) {
    const { description, title } = summarize(running);
    return (
      <SidebarCompactActionCard
        actionAriaLabel="Running in the background"
        actionDisabled
        className={className}
        description={description}
        icon={<BusyMark />}
        iconKey="running"
        onAction={() => undefined}
        onDismiss={() => {
          for (const task of running) dismissBackgroundTask(task.id);
        }}
        role="status"
        testId="sidebar-background-task-card"
        title={title}
      />
    );
  }

  if (failed.length > 0) {
    const first = failed[0];
    return (
      <SidebarCompactActionCard
        actionAriaLabel="Dismiss failed task"
        actionTestId="sidebar-background-task-dismiss-failed"
        className={className}
        description={first.error ?? undefined}
        icon={<AlertTriangle aria-hidden="true" className="h-4 w-4" />}
        iconKey="failed"
        onAction={() => {
          for (const task of failed) dismissBackgroundTask(task.id);
        }}
        onDismiss={() => {
          for (const task of failed) dismissBackgroundTask(task.id);
        }}
        role="alert"
        testId="sidebar-background-task-card"
        title={`${first.label} didn't finish`}
      />
    );
  }

  if (succeeded.length > 0) {
    const first = succeeded[0];
    return (
      <SidebarCompactActionCard
        actionAriaLabel="Finished"
        actionDisabled
        className={className}
        icon={<Check aria-hidden="true" className="h-4 w-4" />}
        iconKey="succeeded"
        onAction={() => undefined}
        onDismiss={() => {
          for (const task of succeeded) dismissBackgroundTask(task.id);
        }}
        role="status"
        testId="sidebar-background-task-card"
        title={`${first.label} — done`}
        tone="success"
      />
    );
  }

  return null;
}
