import type {
  ManagedPermissionResolutionOutcome,
  ManagedConversationOperationalStatus,
} from "@/shared/api/types";
import type {
  ManagedActivityKind,
  ManagedActivityStatus,
  ManagedPresentationDisplayPhase,
  ManagedPresentationFailure,
  ManagedTurnActivityStep,
  RawManagedPresentationActivity,
} from "@/features/messages/managedPresentationTypes";

export type ManagedOperationalCopy = {
  label: string;
  tone: "quiet" | "attention";
};

/**
 * What happened, and nothing else.
 *
 * Every one of these sentences renders within a hundred pixels of a real Retry
 * button — the shelf puts one on the same line, and the timeline row sits above
 * a shelf that carries it. So a sentence ending in the word "Retry" is not an
 * instruction, it is the button's name printed twice, once on something that
 * cannot be pressed. It read as a dead control and it made "Retry" appear three
 * times inside one 76px block.
 *
 * The one place an instruction survives is `unavailable`, because there the
 * owner has something to do that the button cannot do for them: the resident is
 * not merely stopped, its setup is wrong. That half is kept and the redundant
 * half dropped. Say the outcome; let the control offer the action.
 */
export function managedOperationalCopy(
  phase: ManagedPresentationDisplayPhase,
  failure: ManagedPresentationFailure | null,
  handoffTargetName: string | null = null,
): ManagedOperationalCopy | null {
  if (phase === "finalizing") {
    return { label: "Finalizing response", tone: "quiet" };
  }
  if (phase === "stopped") {
    return {
      label: "Stopped · Response may be incomplete",
      tone: "quiet",
    };
  }
  if (phase !== "failed" && phase !== "needs_attention") return null;
  switch (failure) {
    case "unavailable":
      return {
        label: "Resident unavailable · Check its setup",
        tone: "attention",
      };
    case "publication":
      return {
        label: handoffTargetName
          ? `Couldn’t reach ${handoffTargetName}`
          : "Response couldn’t be published",
        tone: "attention",
      };
    case "runtime":
      return {
        label: "Resident stopped unexpectedly",
        tone: "attention",
      };
    default:
      return { label: "No response arrived", tone: "attention" };
  }
}

/**
 * Mirrors the native exchange mention grammar and retains only the first
 * body-free display name. The response body itself never enters activity
 * state; this name exists solely to attribute a failed A2A handoff honestly.
 */
export function managedHandoffTargetName(text: string): string | null {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") continue;
    const previous = index > 0 ? text[index - 1] : "";
    if (/[A-Za-z0-9_]/.test(previous)) continue;
    let end = index + 1;
    while (end < text.length && /[A-Za-z0-9._-]/.test(text[end])) end += 1;
    const name = text.slice(index + 1, end).replace(/[._-]+$/, "");
    if (name) return name;
  }
  return null;
}

export function dedupeManagedOperationalStatuses(
  statuses: readonly ManagedConversationOperationalStatus[],
): ManagedConversationOperationalStatus[] {
  const seen = new Set<string>();
  return statuses.filter((status) => {
    if (
      status.status !== "interrupted_after_restart" ||
      !status.dispatchReceiptId ||
      seen.has(status.dispatchReceiptId)
    ) {
      return false;
    }
    seen.add(status.dispatchReceiptId);
    return true;
  });
}

export function managedPermissionOutcomeCopy(
  outcome: ManagedPermissionResolutionOutcome,
): string {
  switch (outcome) {
    case "approved":
      return "Permission approved";
    case "rejected":
      return "Permission rejected";
    case "expired":
      return "Permission request expired";
    case "session_replaced":
      return "Permission request closed when the resident restarted";
    case "application_closed":
      return "Permission request closed with Luca";
    case "cancelled":
      return "Permission request cancelled";
  }
}

export function sanitizedAttachmentFailure(): string {
  return "Attachment couldn’t be uploaded. You can keep typing and try the attachment again.";
}

/* -------------------------------------------------------------------------
 * Rich activity: what a resident is doing, in the owner's words.
 *
 * The wire object is optional on every frame and every field inside it is
 * untrusted. Everything below parses defensively — an unknown kind becomes
 * "other", a missing label lets the caller fall back to the phase word, and a
 * malformed object is dropped without disturbing the turn it arrived on.
 * ---------------------------------------------------------------------- */

/** Enough to narrate a long turn; short enough that a chatty runtime cannot
 *  grow one turn's memory without bound. */
export const MAX_MANAGED_ACTIVITY_STEPS = 24;
/** The emitter's own bounds, in `luca-protocol`. Kept in step so a legal line
 *  is never needlessly clipped, and an illegal one is clipped on both sides. */
const MAX_ACTIVITY_LABEL_CHARS = 160;
const MAX_ACTIVITY_DETAIL_CHARS = 512;

/**
 * An activity line renders beside the owner's own text. A runtime echoing a
 * crafted tool title must not be able to reorder, hide, or overwrite what sits
 * next to it, so control characters and bidirectional overrides disqualify the
 * text outright. The emitter enforces this too; this side does not assume it.
 */
const UNSAFE_DISPLAY_TEXT =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

const ACTIVITY_KINDS = new Set<ManagedActivityKind>([
  "web",
  "file",
  "command",
  "search",
  "thinking",
  "other",
]);
const ACTIVITY_STATUSES = new Set<ManagedActivityStatus>([
  "active",
  "done",
  "failed",
]);

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || UNSAFE_DISPLAY_TEXT.test(trimmed)) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Turn one wire activity object into a step line, or null when there is
 * nothing showable. `fallbackStep` orders a frame that omitted its ordinal:
 * arrival order is the only honest answer when the producer gave none.
 */
export function parseManagedActivityStep(
  value: RawManagedPresentationActivity | undefined,
  fallbackStep: number,
  fallbackLabel: string,
): ManagedTurnActivityStep | null {
  if (!value || typeof value !== "object") return null;
  const ownLabel = boundedText(value.label, MAX_ACTIVITY_LABEL_CHARS);
  const label =
    ownLabel ?? boundedText(fallbackLabel, MAX_ACTIVITY_LABEL_CHARS);
  if (!label) return null;
  const ownKind =
    typeof value.kind === "string" &&
    ACTIVITY_KINDS.has(value.kind as ManagedActivityKind)
      ? (value.kind as ManagedActivityKind)
      : null;
  const status =
    typeof value.status === "string" &&
    ACTIVITY_STATUSES.has(value.status as ManagedActivityStatus)
      ? (value.status as ManagedActivityStatus)
      : "active";
  const count =
    typeof value.count === "number" &&
    Number.isSafeInteger(value.count) &&
    value.count >= 0
      ? value.count
      : null;
  const ownStep =
    typeof value.step === "number" &&
    Number.isFinite(value.step) &&
    value.step > 0
      ? value.step
      : null;
  const detail = boundedText(value.detail, MAX_ACTIVITY_DETAIL_CHARS);
  // An activity object that resolved to nothing but the phase word — no label
  // of its own, no kind, no detail, no count, no ordinal — has told us only
  // what the frame already said. Making a line out of it would add a step to
  // the history for every frame while saying nothing.
  if (!ownLabel && !ownKind && !detail && count === null && ownStep === null) {
    return null;
  }
  return {
    count,
    detail,
    kind: ownKind ?? "other",
    label,
    status,
    step: ownStep ?? fallbackStep,
  };
}

/**
 * Fold one step into a turn's list. A repeated ordinal updates its line where
 * it already sits — that is how "active" becomes "done" without the line
 * moving. A new ordinal is inserted at its numeric place, so the sequence
 * reads in step order while no line already on screen changes its neighbours.
 * Returns the same array reference when nothing changed, so subscribers that
 * compare by identity stay quiet.
 */
export function mergeManagedActivityStep(
  steps: readonly ManagedTurnActivityStep[],
  next: ManagedTurnActivityStep,
): readonly ManagedTurnActivityStep[] {
  const existingIndex = steps.findIndex((step) => step.step === next.step);
  if (existingIndex >= 0) {
    const current = steps[existingIndex];
    if (
      current.kind === next.kind &&
      current.label === next.label &&
      current.detail === next.detail &&
      current.status === next.status &&
      current.count === next.count
    ) {
      return steps;
    }
    const merged = [...steps];
    merged[existingIndex] = next;
    return merged;
  }
  if (steps.length >= MAX_MANAGED_ACTIVITY_STEPS) return steps;
  const insertAt = steps.findIndex((step) => step.step > next.step);
  if (insertAt === -1) return [...steps, next];
  return [...steps.slice(0, insertAt), next, ...steps.slice(insertAt)];
}

/**
 * A run that finished cleanly finished its last step too, whether or not a
 * closing frame said so. Only the *successful* end may settle a line: a turn
 * that was stopped or that died mid-step leaves its line unfinished, and the
 * shelf marks it as such rather than claiming a completion that never happened.
 */
export function settleManagedActivitySteps(
  steps: readonly ManagedTurnActivityStep[],
): readonly ManagedTurnActivityStep[] {
  if (!steps.some((step) => step.status === "active")) return steps;
  return steps.map((step) =>
    step.status === "active" ? { ...step, status: "done" } : step,
  );
}

/** Gerunds the contract itself uses. Anything unrecognised is left verbatim
 *  rather than guessed at — a wrong tense is worse than a present one. */
const SETTLED_VERBS = new Map([
  ["Analyzing", "Analyzed"],
  ["Browsing", "Browsed"],
  ["Building", "Built"],
  ["Checking", "Checked"],
  ["Downloading", "Downloaded"],
  ["Editing", "Edited"],
  ["Fetching", "Fetched"],
  ["Loading", "Loaded"],
  ["Opening", "Opened"],
  ["Reading", "Read"],
  ["Running", "Ran"],
  ["Searching", "Searched"],
  ["Thinking", "Thought"],
  ["Writing", "Wrote"],
]);

function countSuffix(step: ManagedTurnActivityStep): string {
  if (step.count === null) return "";
  if (step.kind === "file") {
    return ` — ${step.count} ${step.count === 1 ? "file" : "files"}`;
  }
  // Only web and search results are known to be *results*. For a command or a
  // thought the number is real but its unit is not ours to name.
  if (step.kind === "web" || step.kind === "search") {
    return ` — ${step.count} ${step.count === 1 ? "result" : "results"}`;
  }
  return ` — ${step.count}`;
}

/** The line as it should read right now: present tense live, past once done. */
export function managedActivityStepLabel(
  step: ManagedTurnActivityStep,
): string {
  if (step.status === "active") return step.label;
  const [first, ...rest] = step.label.split(" ");
  const settledVerb = SETTLED_VERBS.get(first ?? "");
  const label = settledVerb ? [settledVerb, ...rest].join(" ") : step.label;
  if (step.status === "failed") return `${label} — failed`;
  return `${label}${countSuffix(step)}`;
}

/** Paths and commands are read from the end; prose is read from the start. */
export function managedActivityStepIsMono(kind: ManagedActivityKind): boolean {
  return kind === "file" || kind === "command";
}

/**
 * Keep the filename. A path truncated at the tail hides the one part of it
 * the owner is actually reading.
 */
export function truncateActivityPathFront(path: string, max = 36): string {
  if (path.length <= max) return path;
  const segments = path.split("/").filter((segment) => segment.length > 0);
  for (let index = 1; index < segments.length; index += 1) {
    const tail = segments.slice(index).join("/");
    if (tail.length + 2 <= max) return `…/${tail}`;
  }
  return `…${path.slice(path.length - (max - 1))}`;
}

/** The bare host, with no scheme, path, port, credentials, or query — the
 *  smallest true statement about where a resident went. */
export function activityBareDomain(detail: string): string {
  const withoutScheme = detail.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const host = withoutScheme.split(/[/?#]/)[0] ?? "";
  const withoutCredentials = host.split("@").pop() ?? host;
  const withoutPort = withoutCredentials.split(":")[0] ?? withoutCredentials;
  const bare = withoutPort.replace(/^www\./i, "").toLowerCase();
  return bare.length > 0 ? bare : detail;
}

/** The detail as it should render for its kind, or null when there is none. */
export function managedActivityStepDetail(
  step: ManagedTurnActivityStep,
): string | null {
  if (!step.detail) return null;
  if (step.kind === "web") return activityBareDomain(step.detail);
  if (step.kind === "file") return truncateActivityPathFront(step.detail);
  return step.detail;
}

/**
 * One line for a finished multi-step run, kept after the answer lands so the
 * work is not thrown away with the indicator that announced it.
 */
export function managedActivityRunSummary(
  steps: readonly ManagedTurnActivityStep[],
): string | null {
  const finished = steps.filter((step) => step.status !== "active");
  if (finished.length === 0) return null;
  if (finished.length === 1) return managedActivityStepLabel(finished[0]);
  const failed = finished.filter((step) => step.status === "failed").length;
  const done = finished.length - failed;
  const steps_ = `${done} ${done === 1 ? "step" : "steps"}`;
  return failed > 0 ? `${steps_} · ${failed} failed` : steps_;
}

/**
 * Elapsed wait as m:ss. Deliberately not the `formatElapsed` "1m 5s" form: this
 * number sits under a live answer and changes every second, and a fixed-width
 * clock reading stops the line reflowing beneath the eye.
 */
export function managedElapsedReadout(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
