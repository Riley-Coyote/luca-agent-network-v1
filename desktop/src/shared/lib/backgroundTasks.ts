import * as React from "react";

/**
 * Background tasks — the store behind the loading rule.
 *
 * Any operation that can outlive its surface (a Brain source connect, an
 * export, an index rebuild) registers here with its promise; the sidebar
 * footer narrates the store's contents so nothing runs invisibly. The
 * store owns the promise settle, so a task completes correctly even after
 * the view that started it unmounts.
 *
 * Module-level singleton — reset via `resetBackgroundTasks()` on
 * community switch (see `resetCommunityState`).
 */

export type BackgroundTaskStatus = "running" | "succeeded" | "failed";

export type BackgroundTask = {
  id: string;
  /** Short human label — "Connecting Files", "Rebuilding index". */
  label: string;
  status: BackgroundTaskStatus;
  /** Readable failure text, set when status is "failed". */
  error: string | null;
};

let tasks: BackgroundTask[] = [];
let nextTaskId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function patchTask(id: string, patch: Partial<BackgroundTask>) {
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return;
  tasks = tasks.slice();
  tasks[index] = { ...tasks[index], ...patch };
  emit();
}

/**
 * Register a task. The store settles it from the promise: resolve →
 * succeeded, reject → failed with `describeError(reason)`.
 */
export function startBackgroundTask(
  label: string,
  promise: Promise<unknown>,
  describeError: (reason: unknown) => string,
): string {
  const id = `task-${nextTaskId++}`;
  tasks = [...tasks, { id, label, status: "running", error: null }];
  emit();
  promise.then(
    () => patchTask(id, { status: "succeeded" }),
    (reason) =>
      patchTask(id, { status: "failed", error: describeError(reason) }),
  );
  return id;
}

export function dismissBackgroundTask(id: string) {
  const next = tasks.filter((task) => task.id !== id);
  if (next.length === tasks.length) return;
  tasks = next;
  emit();
}

export function resetBackgroundTasks() {
  if (tasks.length === 0) return;
  tasks = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): BackgroundTask[] {
  return tasks;
}

export function useBackgroundTasks(): BackgroundTask[] {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
