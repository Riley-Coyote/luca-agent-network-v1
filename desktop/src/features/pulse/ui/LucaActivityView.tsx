import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CircleCheck,
  Clock3,
} from "lucide-react";
import * as React from "react";

import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import type { TranscriptItem } from "@/features/agents/ui/agentSessionTypes";
import {
  managedAgentSummary,
  residentAvailabilityLabel,
} from "@/features/agents/ui/agentLibraryViewModel";
import { useAgentTranscript } from "@/features/agents/ui/useObserverEvents";
import { useOpenAgentActivity } from "@/features/agents/useOpenAgentActivity";
import type { ManagedAgent, RelayAgent } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { UserAvatar } from "@/shared/ui/UserAvatar";

type ActivityResident = {
  managed: ManagedAgent | null;
  name: string;
  pubkey: string;
  relay: RelayAgent | null;
};

type ActivitySummary = {
  detail: string;
  label: string;
  timestamp: string | null;
  tone: "error" | "muted" | "success" | "working";
};

function latestActivityItem(items: TranscriptItem[]) {
  const candidates = [...items]
    .filter(
      (item) =>
        item.type === "tool" ||
        (item.type === "lifecycle" &&
          (item.renderClass === "permission" ||
            item.renderClass === "error" ||
            item.renderClass === "status")),
    )
    .sort((left, right) => {
      const byTime = right.timestamp.localeCompare(left.timestamp);
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
    });
  const latest = candidates[0];
  if (latest?.type === "lifecycle" && latest.renderClass === "status") {
    const terminalTool = candidates.find(
      (item) =>
        item.type === "tool" &&
        item.turnId === latest.turnId &&
        (item.status === "completed" || item.status === "failed"),
    );
    if (terminalTool) return terminalTool;
  }
  return latest;
}

function summarizeActivity(
  item: TranscriptItem | undefined,
): ActivitySummary | null {
  if (!item) return null;
  if (item.type === "tool") {
    if (item.status === "failed" || item.isError) {
      return {
        detail: "An action failed. Open activity for details.",
        label: "Action failed",
        timestamp: item.completedAt ?? item.timestamp,
        tone: "error",
      };
    }
    if (item.status === "completed") {
      return {
        detail: item.descriptor.label || "Resident action completed",
        label: "Action completed",
        timestamp: item.completedAt ?? item.timestamp,
        tone: "success",
      };
    }
    return {
      detail: item.descriptor.label || "Resident action in progress",
      label: "Action update",
      timestamp: item.timestamp,
      tone: "working",
    };
  }
  if (item.type !== "lifecycle") return null;
  if (item.renderClass === "permission") {
    return {
      detail:
        item.outcome ?? "Owner input may be required in the activity feed.",
      label: "Permission update",
      timestamp: item.timestamp,
      tone: item.outcome ? "success" : "working",
    };
  }
  if (item.renderClass === "error") {
    return {
      detail: "The resident reported a problem. Open activity for details.",
      label: "Runtime needs attention",
      timestamp: item.timestamp,
      tone: "error",
    };
  }
  return {
    detail: "The resident shared a status update.",
    label: "Status update",
    timestamp: item.timestamp,
    tone: "muted",
  };
}

function formatActivityTime(timestamp: string | null) {
  if (!timestamp) return "No recorded activity";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "Recorded activity";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function runtimeLabel(resident: ActivityResident) {
  if (resident.managed) {
    const { availability } = managedAgentSummary(resident.managed);
    return availability === "idle"
      ? "Stopped"
      : residentAvailabilityLabel(availability);
  }
  switch (resident.relay?.status) {
    case "online":
      return "Relay online";
    case "away":
      return "Relay away";
    default:
      return "Relay offline";
  }
}

function idleDetail(resident: ActivityResident) {
  if (!resident.managed) return "No recent activity";
  switch (managedAgentSummary(resident.managed).availability) {
    case "started":
      return "Connection not yet verified";
    case "ready":
      return "Ready for a conversation";
    case "idle":
      return "You can start this resident in Agents";
    case "failed":
    case "degraded":
      return "Open Agents to check this resident's setup";
    default:
      return "Not currently available";
  }
}

function ResidentActivityCard({ resident }: { resident: ActivityResident }) {
  const working = useAgentWorking(resident.pubkey);
  const transcript = useAgentTranscript(
    resident.managed?.status === "running" ||
      resident.managed?.status === "deployed",
    resident.pubkey,
  );
  const { canOpenAgentActivity, openAgentActivity } = useOpenAgentActivity();
  const lastItem = latestActivityItem(transcript);
  const published = summarizeActivity(lastItem);
  const activity = working.working
    ? {
        detail:
          working.channels.length === 1
            ? "Working in one conversation"
            : `Working in ${working.channels.length} conversations`,
        label: "Working now",
        timestamp: lastItem?.timestamp ?? null,
        tone: "working" as const,
      }
    : published;
  const canOpen = canOpenAgentActivity(resident.pubkey);
  const runtimeError =
    resident.managed?.lastError !== null &&
    resident.managed?.lastError !== undefined;
  const activityGroup = working.working
    ? "active"
    : activity
      ? "recent"
      : "idle";

  if (!activity) {
    return (
      <article
        className="order-[6] rounded-xl border border-border/55 bg-background/35 p-3 transition-colors hover:border-border"
        data-activity-group={activityGroup}
        data-activity-state="idle"
        data-testid={`owner-activity-resident-${normalizePubkey(resident.pubkey)}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <UserAvatar
            avatarUrl={resident.managed?.avatarUrl ?? null}
            displayName={resident.name}
            size="sm"
          />
          <div className="min-w-32 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-medium text-foreground">
                {resident.name}
              </h2>
              <Badge variant="secondary">{runtimeLabel(resident)}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {idleDetail(resident)}
            </p>
          </div>
          <Button
            className="shrink-0"
            disabled={!canOpen}
            onClick={() => openAgentActivity(resident.pubkey)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <span>
              {canOpen ? "Open activity" : "No accessible conversation"}
            </span>
            <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "rounded-xl border border-border/60 bg-background/45 p-4 transition-colors hover:border-border",
        activityGroup === "active" ? "order-[2]" : "order-[4]",
      )}
      data-activity-group={activityGroup}
      data-activity-state={
        working.working ? "working" : (activity?.tone ?? "idle")
      }
      data-has-recorded-activity="true"
      data-testid={`owner-activity-resident-${normalizePubkey(resident.pubkey)}`}
    >
      <div className="flex items-start gap-3">
        <UserAvatar
          avatarUrl={resident.managed?.avatarUrl ?? null}
          displayName={resident.name}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-medium text-foreground">
              {resident.name}
            </h2>
            <Badge variant={working.working ? "default" : "secondary"}>
              {working.working ? "Working" : runtimeLabel(resident)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {runtimeError ? "Runtime needs attention" : runtimeLabel(resident)}
          </p>
        </div>
      </div>

      <div className="mt-4 min-h-24 rounded-lg border border-border/50 bg-muted/15 px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          {activity.tone === "error" ? (
            <AlertTriangle
              aria-hidden
              className="h-3.5 w-3.5 text-destructive"
            />
          ) : activity.tone === "success" ? (
            <CircleCheck aria-hidden className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Clock3 aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span>{activity.label}</span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {activity.detail}
        </p>
        <p className="mt-2 font-mono text-2xs text-ink-faint">
          {formatActivityTime(activity.timestamp)}
        </p>
      </div>

      <Button
        className="mt-3 w-full justify-between"
        disabled={!canOpen}
        onClick={() => openAgentActivity(resident.pubkey)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <span>{canOpen ? "Open activity" : "No accessible conversation"}</span>
        <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
      </Button>
    </article>
  );
}

function ActivityGroupHeading({
  group,
  title,
}: {
  group: "active" | "idle" | "recent";
  title: string;
}) {
  return (
    <div
      className={cn(
        "col-span-full hidden items-center gap-3",
        group === "active" &&
          "order-[1] group-has-[[data-activity-group=active]]/activity:flex",
        group === "recent" &&
          "order-[3] group-has-[[data-activity-group=recent]]/activity:flex",
        group === "idle" &&
          "order-[5] group-has-[[data-activity-group=idle]]/activity:flex",
      )}
      data-testid={`owner-activity-group-${group}`}
    >
      <h2 className="font-mono text-2xs uppercase tracking-caps-wide text-ink-faint">
        {title}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-border/50" />
    </div>
  );
}

function QuietActivityState() {
  return (
    <div
      className="order-[0] col-span-full rounded-xl border border-dashed border-border/70 px-5 py-10 text-center group-has-[[data-activity-group=active]]/activity:hidden group-has-[[data-activity-group=recent]]/activity:hidden"
      data-testid="owner-activity-empty-history"
    >
      <Clock3 aria-hidden className="mx-auto h-5 w-5 text-muted-foreground" />
      <h2 className="mt-3 text-sm font-medium">No resident activity yet</h2>
      <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
        When a resident starts working, live updates will appear here. Completed
        work will move into Recent automatically.
      </p>
    </div>
  );
}

function mergeResidents(
  managed: ManagedAgent[],
  relay: RelayAgent[],
): ActivityResident[] {
  const residents = new Map<string, ActivityResident>();
  for (const agent of relay) {
    const key = normalizePubkey(agent.pubkey);
    residents.set(key, {
      managed: null,
      name: agent.name,
      pubkey: agent.pubkey,
      relay: agent,
    });
  }
  for (const agent of managed) {
    const key = normalizePubkey(agent.pubkey);
    const current = residents.get(key);
    residents.set(key, {
      managed: agent,
      name: agent.name || current?.name || "Resident",
      pubkey: agent.pubkey,
      relay: current?.relay ?? null,
    });
  }
  return [...residents.values()].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });
    return byName !== 0 ? byName : left.pubkey.localeCompare(right.pubkey);
  });
}

export function LucaActivityView() {
  const managedQuery = useManagedAgentsQuery();
  const relayQuery = useRelayAgentsQuery();
  const residents = React.useMemo(
    () => mergeResidents(managedQuery.data ?? [], relayQuery.data ?? []),
    [managedQuery.data, relayQuery.data],
  );
  const loading = managedQuery.isLoading || relayQuery.isLoading;
  const error = managedQuery.error ?? relayQuery.error;

  return (
    <main
      className="flex min-h-0 flex-1 overflow-hidden bg-background"
      data-luca-floor-host
      data-testid="owner-activity-view"
    >
      <div
        className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
        data-luca-conversation-surface
      >
        <div
          className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
          data-testid="owner-activity-scroll"
        >
          <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8 sm:py-8">
            <header className="border-b border-border/60 pb-5">
              <div className="flex items-center gap-2 font-mono text-2xs uppercase tracking-widest text-muted-foreground">
                <Bot aria-hidden className="h-3.5 w-3.5" />
                Your agents at work
              </div>
              <h1 className="mt-2 text-2xl font-light tracking-tight text-foreground">
                Activity
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                See what your residents are doing and catch up on recent work.
                Open activity to follow along in the conversation.
              </p>
            </header>

            {loading ? (
              <div
                className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-3"
                data-testid="owner-activity-loading"
              >
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton className="h-56 rounded-xl" key={key} />
                ))}
              </div>
            ) : error ? (
              <section className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-8 text-center">
                <AlertTriangle
                  aria-hidden
                  className="mx-auto h-5 w-5 text-destructive"
                />
                <h2 className="mt-3 text-sm font-medium">
                  Activity is unavailable
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Luca could not load your residents' activity. Try again after
                  the connection recovers.
                </p>
              </section>
            ) : residents.length === 0 ? (
              <section
                className="mt-6 rounded-xl border border-dashed border-border/70 px-5 py-12 text-center"
                data-testid="owner-activity-empty"
              >
                <Bot
                  aria-hidden
                  className="mx-auto h-5 w-5 text-muted-foreground"
                />
                <h2 className="mt-3 text-sm font-medium">No residents yet</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add or import a resident to see their activity here.
                </p>
              </section>
            ) : (
              <section
                aria-label="Resident activity"
                className="group/activity mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-3"
                data-testid="owner-activity-list"
              >
                <QuietActivityState />
                <ActivityGroupHeading group="active" title="Active now" />
                <ActivityGroupHeading group="recent" title="Recent" />
                <ActivityGroupHeading group="idle" title="No recent activity" />
                {residents.map((resident) => (
                  <ResidentActivityCard
                    key={normalizePubkey(resident.pubkey)}
                    resident={resident}
                  />
                ))}
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
