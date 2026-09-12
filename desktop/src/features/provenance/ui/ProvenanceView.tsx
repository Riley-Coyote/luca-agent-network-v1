import { ShieldAlert, ShieldCheck } from "lucide-react";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  provenanceDayKey,
  type ProvenanceRecord,
} from "@/features/provenance/lib/provenanceRecord";
import {
  ActivityPageHeader,
  type ActivitySection,
} from "@/features/pulse/ui/ActivityPageHeader";
import { ProvenanceRow } from "@/features/provenance/ui/ProvenanceRow";
import { useAgentProvenanceQuery } from "@/features/provenance/useAgentProvenance";
import type { SearchHit } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { PubKey } from "@/shared/ui/PubKey";
import { Skeleton } from "@/shared/ui/skeleton";
import { UserAvatar } from "@/shared/ui/UserAvatar";

function dayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  const today = provenanceDayKey(Date.now() / 1_000);
  const yesterday = provenanceDayKey(Date.now() / 1_000 - 86_400);

  if (dayKey === today) return "Today";
  if (dayKey === yesterday) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

function groupByDay(records: ProvenanceRecord[]) {
  const groups: { dayKey: string; records: ProvenanceRecord[] }[] = [];
  for (const record of records) {
    const dayKey = provenanceDayKey(record.createdAt);
    const last = groups.at(-1);
    if (last && last.dayKey === dayKey) {
      last.records.push(record);
    } else {
      groups.push({ dayKey, records: [record] });
    }
  }
  return groups;
}

/**
 * The end of the kept trail.
 *
 * Process events (kind 24200) are ephemeral by design — the relay never stores
 * them. Saying so here is the honest version of "never go dark": the silence
 * below this line is a storage decision, not an idle agent.
 */
function TrailEndMarker({ exhausted }: { exhausted: boolean }) {
  return (
    <div className="border-border/50 border-t pt-3 pb-8">
      <p className="mx-auto max-w-md text-center text-2xs text-muted-foreground leading-relaxed">
        {exhausted
          ? "End of the signed record. Tool calls, file edits and shell commands are broadcast live and never stored — that work happened, but nothing kept it."
          : "Older entries are still on the relay."}
      </p>
    </div>
  );
}

/**
 * Which resident's record is being read.
 *
 * Plain text, no box: the page's one underline already belongs to the section
 * tabs above, and a second boxed control here would make the switch between
 * residents look like a heavier choice than the switch between sections. The
 * active name simply comes forward.
 */
function ResidentTab({
  active,
  name,
  onSelect,
}: {
  active: boolean;
  name: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "shrink-0 rounded-sm text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onSelect}
      role="tab"
      type="button"
    >
      {name}
    </button>
  );
}

export function ProvenanceView({
  onSectionChange,
}: {
  onSectionChange: (section: ActivitySection) => void;
}) {
  const managedAgentsQuery = useManagedAgentsQuery();
  const channelsQuery = useChannelsQuery();
  const agents = React.useMemo(
    () => managedAgentsQuery.data ?? [],
    [managedAgentsQuery.data],
  );

  const [selectedPubkey, setSelectedPubkey] = React.useState<string | null>(
    null,
  );
  const activePubkey = selectedPubkey ?? agents[0]?.pubkey ?? null;
  const activeAgent =
    agents.find(
      (agent) =>
        normalizePubkey(agent.pubkey) === normalizePubkey(activePubkey ?? ""),
    ) ?? null;

  const provenanceQuery = useAgentProvenanceQuery(activePubkey);

  const channelLabels = React.useMemo(() => {
    const labels = new Map<string, string>();
    for (const channel of channelsQuery.data ?? []) {
      labels.set(channel.id, channel.name);
    }
    return labels;
  }, [channelsQuery.data]);

  const records = React.useMemo(
    () => provenanceQuery.data?.pages.flatMap((page) => page.records) ?? [],
    [provenanceQuery.data],
  );
  const groups = React.useMemo(() => groupByDay(records), [records]);
  const failedCount = React.useMemo(
    () => records.filter((record) => record.verification === "failed").length,
    [records],
  );

  const { openSearchHit } = useAppNavigation();
  const openInConversation = React.useCallback(
    (record: ProvenanceRecord) => {
      if (!record.channelId) return;
      const hit: SearchHit = {
        channelId: record.channelId,
        channelName: channelLabels.get(record.channelId) ?? null,
        content: record.event.content,
        createdAt: record.createdAt,
        eventId: record.event.id,
        kind: record.event.kind,
        pubkey: record.event.pubkey,
        score: 0,
      };
      void openSearchHit(hit);
    },
    [channelLabels, openSearchHit],
  );

  return (
    <div
      className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-luca-conversation-surface
    >
      <div className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]">
        <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8 sm:py-8">
          <ActivityPageHeader
            description="Everything these residents signed and the relay kept, checked against their own keys."
            onSectionChange={onSectionChange}
            section="record"
          />

          <div className="mt-6 flex items-center gap-3">
            <UserAvatar
              avatarUrl={activeAgent?.avatarUrl ?? null}
              displayName={activeAgent?.name ?? "Resident"}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-medium text-base text-foreground">
                {activeAgent?.name ?? "No resident"}
              </h2>
              <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <ShieldCheck aria-hidden className="h-3 w-3" />
                <span>signed by</span>
                {activePubkey ? (
                  <PubKey className="text-2xs" pubkey={activePubkey} />
                ) : (
                  <span>—</span>
                )}
              </div>
            </div>
            <span className="shrink-0 text-2xs text-muted-foreground">
              <span className="font-mono tabular-nums">{records.length}</span>
              {provenanceQuery.hasNextPage ? " loaded" : " records"}
            </span>
          </div>

          {failedCount > 0 ? (
            <p className="mt-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/[0.07] px-2.5 py-1.5 text-destructive text-xs">
              <ShieldAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
              {failedCount === 1
                ? "1 record failed signature verification."
                : `${failedCount} records failed signature verification.`}
            </p>
          ) : null}

          {agents.length > 1 ? (
            <div
              aria-label="Residents"
              className="-mx-1 mt-4 flex items-center gap-4 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="tablist"
            >
              {agents.map((agent) => (
                <ResidentTab
                  active={
                    normalizePubkey(agent.pubkey) ===
                    normalizePubkey(activePubkey ?? "")
                  }
                  key={agent.pubkey}
                  name={agent.name}
                  onSelect={() => setSelectedPubkey(agent.pubkey)}
                />
              ))}
            </div>
          ) : null}

          {provenanceQuery.isPending ? (
            <div className="space-y-2 pt-6">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-4/5" />
              <Skeleton className="h-8 w-3/5" />
            </div>
          ) : null}

          {provenanceQuery.isError ? (
            <p className="pt-8 text-center text-muted-foreground text-sm">
              Couldn't reach the relay to read this resident's record.
            </p>
          ) : null}

          {!provenanceQuery.isPending &&
          !provenanceQuery.isError &&
          records.length === 0 ? (
            <p className="pt-10 text-center text-muted-foreground text-sm">
              Nothing signed by this resident has been stored yet.
            </p>
          ) : null}

          {groups.map((group) => (
            <section key={group.dayKey}>
              <h3 className="flex items-center gap-3 pt-5 pb-1">
                <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wide">
                  {dayLabel(group.dayKey)}
                </span>
                <span aria-hidden className="h-px flex-1 bg-border/45" />
              </h3>
              <ul className="mb-2">
                {group.records.map((record) => (
                  <ProvenanceRow
                    channelLabel={
                      record.channelId
                        ? (channelLabels.get(record.channelId) ?? null)
                        : null
                    }
                    key={record.event.id}
                    onOpenInConversation={
                      record.channelId
                        ? () => openInConversation(record)
                        : null
                    }
                    record={record}
                  />
                ))}
              </ul>
            </section>
          ))}

          {records.length > 0 ? (
            <>
              {provenanceQuery.hasNextPage ? (
                <div className="flex justify-center py-4">
                  <Button
                    disabled={provenanceQuery.isFetchingNextPage}
                    onClick={() => void provenanceQuery.fetchNextPage()}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {provenanceQuery.isFetchingNextPage
                      ? "Reading…"
                      : "Read further back"}
                  </Button>
                </div>
              ) : null}
              <TrailEndMarker exhausted={!provenanceQuery.hasNextPage} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
