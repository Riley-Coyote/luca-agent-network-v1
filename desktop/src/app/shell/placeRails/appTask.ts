import type {
  RuntimeTaskProjection,
  RuntimeTaskStep,
} from "@/shared/api/tauriRuntimeTasks";

/**
 * An app's task, as the work (BETA14_RELEASE.md WP-35): what its page says,
 * from the task's own projection only. Pure, so it is unit-tested under
 * node; `AppTaskCard` draws it.
 */

/** Where a connected app's pages live: `/apps/<family>`, and one of its
 *  tasks at `/apps/<family>/tasks/<taskId>`. Null off those addresses. */
export function appPathOf(
  pathname: string,
): { family: string; taskId: string | null } | null {
  const match = /^\/apps\/([^/]+)(?:\/tasks\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return null;
  return {
    family: decodeURIComponent(match[1]),
    taskId: match[2] ? decodeURIComponent(match[2]) : null,
  };
}

/** Working, as the rail says it: queued, active or stopping. */
export function taskIsLive(task: Pick<RuntimeTaskProjection, "state">) {
  return (
    task.state === "queued" ||
    task.state === "active" ||
    task.state === "stopping"
  );
}

/**
 * Whether the task carries a session the app can open: the native handoff
 * (`open_runtime_task_native_session`) opens only a Codex chat that a send
 * to it left behind, by its own session id. Claude Code has none today.
 */
export function taskCanOpenNative(
  task: Pick<
    RuntimeTaskProjection,
    "runtimeFamily" | "controlOwner" | "operation" | "providerSessionId"
  >,
): boolean {
  return (
    task.runtimeFamily === "codex" &&
    task.controlOwner === "native_app" &&
    task.operation === "send_message" &&
    Boolean(task.providerSessionId)
  );
}

/** The app's name for the task's family, as the rail's Apps names it. */
export function taskAppName(
  task: Pick<RuntimeTaskProjection, "runtimeFamily">,
): string {
  return task.runtimeFamily === "codex" ? "Codex" : "Claude Code";
}

/** A folder's own name: its last part. */
export function folderName(folder: string): string {
  const parts = folder.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? folder;
}

const withoutTrailingSlash = (path: string) =>
  path.length > 1 ? path.replace(/\/+$/, "") : path;

/**
 * The project a folder belongs to: the one whose own folder holds it (the
 * deepest, if several do), or null.
 */
export function projectOfFolder(
  folder: string,
  projects: readonly { label: string; folder: string | null }[],
): string | null {
  const target = withoutTrailingSlash(folder);
  let best: { label: string; depth: number } | null = null;
  for (const project of projects) {
    if (!project.folder) continue;
    const root = withoutTrailingSlash(project.folder);
    if (target !== root && !target.startsWith(`${root}/`)) continue;
    if (!best || root.length > best.depth)
      best = { label: project.label, depth: root.length };
  }
  return best?.label ?? null;
}

/** The task's state, in a word, where it isn't working or done: the
 *  rail's own words (`taskWord`). */
const STATE_WORDS: Partial<Record<RuntimeTaskProjection["state"], string>> = {
  awaiting_native: "in the app",
  failed: "failed",
  interrupted: "interrupted",
  stopped: "stopped",
};

/**
 * The head's state line: who it is for, where it happens (the project its
 * folder belongs to, or the folder itself), and when: "working since …",
 * "finished …", or the failure in a word.
 */
export function taskStateLine(
  task: Pick<RuntimeTaskProjection, "state" | "startedAt" | "completedAt">,
  {
    forName,
    where,
    timeOf,
  }: {
    forName: string;
    where: string | null;
    /** A time as the page's notes say it ("3:42 PM", "Oct 25"). */
    timeOf: (iso: string | null) => string;
  },
): string {
  let when = "";
  if (taskIsLive(task)) {
    const since = timeOf(task.startedAt);
    when = since ? `working since ${since}` : "working";
  } else if (task.state === "succeeded") {
    const at = timeOf(task.completedAt);
    when = at ? `finished ${at}` : "finished";
  } else {
    when = STATE_WORDS[task.state] ?? "";
  }
  return [forName ? `For ${forName}` : "", where ?? "", when]
    .filter(Boolean)
    .join(" · ");
}

/** A step's state, said for a screen reader beside its glyph. */
export function stepStateLabel(state: RuntimeTaskStep["state"]): string {
  switch (state) {
    case "done":
      return "Done";
    case "active":
      return "Working";
    case "queued":
      return "Queued";
    case "failed":
      return "Failed";
  }
}
