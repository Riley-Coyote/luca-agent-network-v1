import * as React from "react";

import type {
  ActivityTrace,
  ActivityTraceEntry,
} from "@/features/messages/activity/activityTraceTypes";
import { Shimmer } from "@/shared/ui/Shimmer";
import { SandpileActivityIndicator } from "@/shared/ui/SandpileActivityIndicator";
import { TurnContextReceipt } from "./TurnContextReceipt";

import "./ResidentActivityTrace.css";

/** Public activity presented inside the resident's existing message row. */
export type ResidentActivityTraceProps = {
  trace: ActivityTrace;
  residentName: string;
  privateConversation: boolean;
  onStop?: () => void;
  stopping?: boolean;
  /** The enclosing MessageRow normally owns the identity header and mark. */
  showIdentity?: boolean;
  /** Preserve the enclosing row's profile popover when displaying its name. */
  identityNode?: React.ReactNode;
};

function elapsedLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
}

function summaryLabel(
  trace: ActivityTrace,
  residentName: string,
  stepCount: number,
): string {
  const duration =
    trace.endedAt === null
      ? null
      : elapsedLabel(trace.endedAt - trace.startedAt);
  const steps = `${stepCount}${trace.truncated ? "+" : ""} ${stepCount === 1 && !trace.truncated ? "step" : "steps"}`;
  switch (trace.status) {
    case "cancelled":
      return `${residentName} stopped${duration ? ` after ${duration}` : ""} · ${steps}`;
    case "failed":
      return `${residentName}'s work failed${duration ? ` after ${duration}` : ""} · ${steps}`;
    case "interrupted":
      return `${residentName}'s work was interrupted${duration ? ` after ${duration}` : ""} · ${steps}`;
    default:
      return `${residentName} worked${duration ? ` for ${duration}` : ""} · ${steps}`;
  }
}

function entryText(
  entry: ActivityTraceEntry,
  privateConversation: boolean,
): string {
  // Never fall back to owner-visible text if a room projection is absent.
  return privateConversation ? entry.text : entry.roomText;
}

type TraceTransition = Pick<
  ActivityTrace,
  "conversationId" | "residentPubkey" | "dispatchReceiptId" | "status"
>;

/** A restored terminal record has no transition to animate. */
export function shouldSettleActivityTrace(
  previous: TraceTransition | null,
  next: TraceTransition,
): boolean {
  return (
    previous !== null &&
    previous.conversationId === next.conversationId &&
    previous.residentPubkey === next.residentPubkey &&
    previous.dispatchReceiptId === next.dispatchReceiptId &&
    previous.status === "working" &&
    next.status !== "working"
  );
}

function useVisibleActivityClock(live: boolean) {
  const elementRef = React.useRef<HTMLDivElement>(null);
  const [inView, setInView] = React.useState(false);
  const [pageVisible, setPageVisible] = React.useState(false);
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!live) return;
    const updateVisibility = () => {
      setPageVisible(document.visibilityState !== "hidden");
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const updateMotionPreference = () => {
      setReducedMotion(motionPreference.matches);
    };
    updateMotionPreference();
    motionPreference.addEventListener("change", updateMotionPreference);
    const element = elementRef.current;
    const observer =
      element && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            setInView(entry?.isIntersecting ?? false);
          })
        : null;
    if (element && observer) observer.observe(element);
    else setInView(true);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      motionPreference.removeEventListener("change", updateMotionPreference);
      observer?.disconnect();
    };
  }, [live]);

  const active = live && inView && pageVisible;
  React.useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active]);

  return { animate: active && !reducedMotion, elementRef, now };
}

/**
 * The live activity indicator, approved line, public voice and settled trace.
 * The enclosing row suppresses its identity mark while this indicator is live.
 */
export function ResidentActivityTrace({
  trace,
  residentName,
  privateConversation,
  onStop,
  stopping = false,
  showIdentity = false,
  identityNode,
}: ResidentActivityTraceProps) {
  const live = trace.status === "working";
  const { animate, elementRef, now } = useVisibleActivityClock(live);
  const {
    conversationId,
    residentPubkey,
    dispatchReceiptId,
    status: traceStatus,
  } = trace;
  const previousTrace = React.useRef<TraceTransition | null>(null);
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [settlingReceipt, setSettlingReceipt] = React.useState<string | null>(
    null,
  );
  React.useLayoutEffect(() => {
    const next: TraceTransition = {
      conversationId,
      residentPubkey,
      dispatchReceiptId,
      status: traceStatus,
    };
    const previous = previousTrace.current;
    previousTrace.current = next;
    if (!shouldSettleActivityTrace(previous, next)) {
      setSettlingReceipt(null);
      return;
    }
    setSettlingReceipt(dispatchReceiptId);
    const timeout = window.setTimeout(() => {
      setSettlingReceipt((current) =>
        current === dispatchReceiptId ? null : current,
      );
    }, 320);
    return () => window.clearTimeout(timeout);
  }, [conversationId, residentPubkey, dispatchReceiptId, traceStatus]);
  const entries = React.useMemo(
    () =>
      trace.entries
        .filter(
          (entry) => entry.kind === "activity" || entry.kind === "narration",
        )
        .slice()
        .sort((left, right) => left.sequence - right.sequence),
    [trace.entries],
  );
  const activities = entries.filter((entry) => entry.kind === "activity");
  const latestActivity = activities.at(-1);
  const latestNarration = [...entries]
    .reverse()
    .find((entry) => entry.kind === "narration");
  const status =
    (latestActivity && entryText(latestActivity, privateConversation)) ||
    "Thinking";
  const narration = latestNarration
    ? entryText(latestNarration, privateConversation)
    : "";
  const identity = showIdentity ? (
    <span
      className="resident-activity-name text-sm leading-none"
      data-activity-name
    >
      {identityNode ?? residentName}
    </span>
  ) : null;

  return (
    <div
      className="resident-activity-trace"
      data-activity-trace={trace.dispatchReceiptId}
      data-activity-state={trace.status}
      data-activity-animating={animate ? "true" : "false"}
      data-activity-settling={
        !live && settlingReceipt === trace.dispatchReceiptId
          ? "true"
          : undefined
      }
      ref={elementRef}
    >
      {live ? (
        <>
          <div className="resident-activity-header">
            <span className="resident-activity-indicator" aria-hidden="true">
              <SandpileActivityIndicator
                seed={`${residentPubkey}:activity`}
                size="100%"
              />
            </span>
            {identity}
            <div
              className="resident-activity-status text-base leading-normal"
              data-activity-status
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {animate ? (
                <Shimmer className="resident-activity-shimmer">
                  {status}
                </Shimmer>
              ) : (
                <span className="resident-activity-status-text">{status}</span>
              )}
            </div>
            <span className="resident-activity-controls">
              <span
                className="resident-activity-elapsed text-xs leading-none tabular-nums"
                data-activity-elapsed
                role="timer"
                aria-label={`Elapsed ${elapsedLabel(now - trace.startedAt)}`}
              >
                {elapsedLabel(now - trace.startedAt)}
              </span>
              <button
                className="resident-activity-stop text-xs leading-none"
                data-activity-stop
                type="button"
                onClick={onStop}
                disabled={stopping || !onStop}
                aria-label={`${stopping ? "Stopping" : "Stop"} ${residentName}`}
              >
                {stopping ? "Stopping" : "Stop"}
              </button>
            </span>
          </div>
          {narration ? (
            <div
              className="resident-activity-narration text-base"
              data-activity-narration
              aria-live="polite"
              aria-atomic="true"
            >
              {narration}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {showIdentity ? (
            <div className="resident-activity-header">{identity}</div>
          ) : null}
          <details
            className="resident-activity-disclosure"
            key={trace.dispatchReceiptId}
            onToggle={(event) => {
              if (event.target === event.currentTarget) {
                setRecordOpen(event.currentTarget.open);
              }
            }}
          >
            <summary
              className="resident-activity-summary text-xs"
              data-activity-trace-summary
            >
              {summaryLabel(trace, residentName, activities.length)}
            </summary>
            <ol
              className="resident-activity-record"
              data-activity-trace-list
              aria-label={`${residentName}'s work record`}
            >
              {entries.map((entry) => {
                const text = entryText(entry, privateConversation);
                if (!text) return null;
                return (
                  <li
                    className="resident-activity-record-entry text-xs"
                    data-activity-kind={entry.kind}
                    key={entry.id}
                  >
                    {text}
                    {entry.status === "failed" ? " · failed" : null}
                  </li>
                );
              })}
            </ol>
            {trace.truncated ? (
              <p className="resident-activity-record-note text-xs">
                Earlier activity is no longer retained in this record.
              </p>
            ) : null}
            {recordOpen && privateConversation ? (
              <TurnContextReceipt
                input={{ conversationId, residentPubkey, dispatchReceiptId }}
                privateConversation={privateConversation}
              />
            ) : null}
          </details>
        </>
      )}
    </div>
  );
}
