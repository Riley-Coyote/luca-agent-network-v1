import * as React from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";

import {
  getResidentContinuityActivity,
  type ResidentContinuityActivity as ContinuityActivity,
} from "@/shared/api/tauriContinuity";
import { cn } from "@/shared/lib/cn";

const POLL_MS = 2_500;
type ActivityPresentation = {
  label: string;
  tone: "quiet" | "active" | "fault";
};

export function continuityActivityPresentation(
  activity: ContinuityActivity | null,
): ActivityPresentation | null {
  if (!activity?.enabled) return null;
  const job = activity.job;
  if (!job) return { label: "Continuity ready", tone: "quiet" };
  if (job.state === "pending") {
    return { label: "Saving continuity", tone: "active" };
  }
  if (job.state === "running") {
    return { label: "Saving continuity", tone: "active" };
  }
  if (job.state === "failed") {
    return { label: "Continuity needs attention", tone: "fault" };
  }
  if (job.state === "completed") {
    return { label: "Continuity current", tone: "quiet" };
  }
  return { label: "Continuity ready", tone: "quiet" };
}

export function shouldPollContinuityActivity(
  activity: ContinuityActivity | null,
): boolean {
  const state = activity?.job?.state;
  return state === "pending" || state === "running";
}

function useResidentContinuityActivity(residentPubkey: string) {
  const [activity, setActivity] = React.useState<ContinuityActivity | null>(
    null,
  );

  React.useEffect(() => {
    let active = true;
    let timeout: number | undefined;
    const refresh = async () => {
      try {
        const next = await getResidentContinuityActivity(residentPubkey);
        if (!active) return;
        setActivity(next);
        if (shouldPollContinuityActivity(next)) {
          timeout = window.setTimeout(() => void refresh(), POLL_MS);
        }
      } catch {
        if (active) setActivity(null);
      }
    };
    void refresh();
    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [residentPubkey]);

  return activity;
}

export function ResidentContinuityActivity({
  className,
  name,
  onOpen,
  residentPubkey,
}: {
  className?: string;
  name?: string;
  onOpen?: () => void;
  residentPubkey: string;
}) {
  const activity = useResidentContinuityActivity(residentPubkey);
  const presentation = continuityActivityPresentation(activity);
  if (!presentation) return null;

  const Icon =
    presentation.tone === "active"
      ? LoaderCircle
      : presentation.tone === "fault"
        ? AlertCircle
        : CheckCircle2;
  const content = (
    <>
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3 shrink-0",
          presentation.tone === "active" &&
            "animate-spin motion-reduce:animate-none",
        )}
      />
      <span className="truncate">
        {name ? `${name} · ` : ""}
        {presentation.label}
      </span>
    </>
  );
  const classes = cn(
    "inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
    presentation.tone === "fault" && "text-destructive",
    className,
  );

  return onOpen ? (
    <button
      className={cn(
        classes,
        "rounded-md outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
      )}
      onClick={onOpen}
      type="button"
    >
      {content}
    </button>
  ) : (
    <span className={classes}>{content}</span>
  );
}
