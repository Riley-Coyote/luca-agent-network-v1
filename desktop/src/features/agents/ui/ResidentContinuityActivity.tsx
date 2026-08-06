import * as React from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";

import {
  getResidentContinuityActivity,
  type ResidentContinuityActivity as ContinuityActivity,
} from "@/shared/api/tauriContinuity";
import { cn } from "@/shared/lib/cn";

const POLL_MS = 2_500;
const RECENT_COMPLETION_MS = 60_000;

type ActivityPresentation = {
  label: string;
  tone: "quiet" | "active" | "fault";
};

export function continuityActivityPresentation(
  activity: ContinuityActivity | null,
  recentOnly: boolean,
  now = Date.now(),
): ActivityPresentation | null {
  if (!activity?.enabled) return null;
  const job = activity.job;
  if (!job)
    return recentOnly ? null : { label: "Continuity ready", tone: "quiet" };
  if (job.state === "pending") {
    return { label: "Handoff queued", tone: "active" };
  }
  if (job.state === "running") {
    return { label: "Updating handoff", tone: "active" };
  }
  if (job.state === "failed") {
    return { label: "Handoff needs attention", tone: "fault" };
  }
  if (job.state === "completed") {
    const updatedAt = new Date(job.updatedAt).valueOf();
    if (
      recentOnly &&
      (Number.isNaN(updatedAt) || now - updatedAt > RECENT_COMPLETION_MS)
    ) {
      return null;
    }
    return { label: "Handoff updated", tone: "quiet" };
  }
  return recentOnly ? null : { label: "Continuity ready", tone: "quiet" };
}

function useResidentContinuityActivity(residentPubkey: string) {
  const [activity, setActivity] = React.useState<ContinuityActivity | null>(
    null,
  );

  React.useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await getResidentContinuityActivity(residentPubkey);
        if (active) setActivity(next);
      } catch {
        if (active) setActivity(null);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [residentPubkey]);

  return activity;
}

export function ResidentContinuityActivity({
  className,
  name,
  onOpen,
  recentOnly = false,
  residentPubkey,
}: {
  className?: string;
  name?: string;
  onOpen?: () => void;
  recentOnly?: boolean;
  residentPubkey: string;
}) {
  const activity = useResidentContinuityActivity(residentPubkey);
  const presentation = continuityActivityPresentation(activity, recentOnly);
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
    "inline-flex min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground",
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

export function ConversationContinuityActivity({
  agents,
  channelId,
  onOpenAgentSession,
}: {
  agents: Array<{ name: string; pubkey: string }>;
  channelId: string | null;
  onOpenAgentSession: (pubkey: string, channelId?: string | null) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <section
      aria-label="Conversation continuity activity"
      className="flex min-h-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/40 px-4 py-1.5 empty:hidden"
    >
      {agents.map((agent) => (
        <ResidentContinuityActivity
          key={agent.pubkey}
          name={agents.length > 1 ? agent.name : undefined}
          onOpen={() => onOpenAgentSession(agent.pubkey, channelId)}
          recentOnly
          residentPubkey={agent.pubkey}
        />
      ))}
    </section>
  );
}
