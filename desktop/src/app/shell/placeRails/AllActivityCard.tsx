import * as React from "react";
import { Activity } from "lucide-react";

import "@/app/shell/shell-activity.css";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  PlaceList,
  PlaceListRow,
  PlacePage,
} from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import { HarnessFace } from "@/app/shell/placeRails/placeFaces";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { clearOpenSide, noteOpenSide } from "@/features/exchange/openSide";
import {
  runtimeLabel,
  sideDays,
  type TaskSide,
} from "@/features/exchange/sideConversations";
import { useSideConversations } from "@/features/exchange/useSideConversations";
import type { ProvenanceRecord } from "@/features/provenance/lib/provenanceRecord";
import { useAllProvenanceQuery } from "@/features/provenance/useAgentProvenance";
import { runtimeRailFamilyFromRuntimeId } from "@/features/runtime-sessions/runtimeRailPreferences";
import type { SearchHit } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { AgentMark } from "@/shared/ui/AgentMark";
import { Button } from "@/shared/ui/button";

/**
 * All activity (BETA14_RELEASE.md WP-34, Decided 10): Activity is the record
 * of what happened. One thread of what every mind and app did, newest first,
 * by day, from the two records the app keeps and nothing else: what each
 * mind signed and the relay stored (the signed record, every mind's read as
 * one), and the runtime tasks the apps ran. Each row opens where it
 * happened; a task, its own page (WP-35).
 */

type Entry = {
  key: string;
  /** When it happened (ms): what orders the thread. */
  at: number;
  face: React.ReactNode;
  title: string;
  summary?: string;
  open: (() => void) | null;
  kind: "record" | "task";
};

/** A sentence's first word lowered, to follow a name: "Posted a message"
 *  under Luca reads "Luca posted a message". */
function following(verb: string) {
  return verb.charAt(0).toLocaleLowerCase() + verb.slice(1);
}

function timeOfDay(at: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(at));
}

export function AllActivityCard() {
  const agentsQuery = useManagedAgentsQuery();
  const agents = React.useMemo(
    () => agentsQuery.data ?? [],
    [agentsQuery.data],
  );
  const pubkeys = React.useMemo(
    () => agents.map((agent) => agent.pubkey),
    [agents],
  );
  const provenance = useAllProvenanceQuery(pubkeys);
  const { items: sideItems, nameOf, roomOf } = useSideConversations();
  const { goAppTask, goChannel, openSearchHit } = useAppNavigation();

  const records = React.useMemo(
    () => provenance.data?.pages.flatMap((page) => page.records) ?? [],
    [provenance.data],
  );
  const nameByKey = React.useMemo(
    () =>
      new Map(
        agents.map((agent) => [normalizePubkey(agent.pubkey), agent.name]),
      ),
    [agents],
  );

  const entries = React.useMemo(() => {
    const openRecord = (record: ProvenanceRecord) => {
      if (!record.channelId) return null;
      const channelId = record.channelId;
      return () => {
        const hit: SearchHit = {
          channelId,
          channelName: roomOf(channelId) || null,
          content: record.event.content,
          createdAt: record.createdAt,
          eventId: record.event.id,
          kind: record.event.kind,
          pubkey: record.event.pubkey,
          score: 0,
        };
        void openSearchHit(hit);
      };
    };
    const fromRecords = records.map((record): Entry => {
      const author = normalizePubkey(record.event.pubkey);
      const name = nameByKey.get(author) ?? nameOf(author);
      const room = record.channelId ? roomOf(record.channelId) : "";
      return {
        at: record.createdAt * 1000,
        face: <AgentMark />,
        key: `record:${record.event.id}`,
        kind: "record",
        open: openRecord(record),
        summary:
          [
            record.object,
            room,
            record.verification === "failed" ? "signature failed" : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        title: `${name} ${following(record.verb)}`,
      };
    });
    const fromTasks = sideItems
      .filter((item): item is TaskSide => item.kind === "task")
      .map(
        (task): Entry => ({
          at: task.at,
          face: <HarnessFace runtimeId={task.runtimeFamily} />,
          key: `task:${task.id}`,
          kind: "task",
          open: () => {
            // A task opens as the work, under its app in the rail (WP-35).
            const family = runtimeRailFamilyFromRuntimeId(task.runtimeFamily);
            if (family) {
              clearOpenSide();
              void goAppTask(family, task.id);
              return;
            }
            noteOpenSide(task);
            void goChannel(task.conversationId);
          },
          summary: [
            task.word,
            `for ${nameOf(task.residentPubkey)}`,
            roomOf(task.conversationId),
          ]
            .filter(Boolean)
            .join(" · "),
          title: `${runtimeLabel(task.runtimeFamily)} · ${task.summary}`,
        }),
      );
    return [...fromRecords, ...fromTasks]
      .filter((entry) => entry.at > 0)
      .sort((a, b) =>
        a.at !== b.at ? b.at - a.at : a.key.localeCompare(b.key),
      );
  }, [
    goAppTask,
    goChannel,
    nameByKey,
    nameOf,
    openSearchHit,
    records,
    roomOf,
    sideItems,
  ]);

  const days = sideDays(entries);
  const loading =
    agentsQuery.isPending || (pubkeys.length > 0 && provenance.isPending);

  return (
    <PlacePage testId="all-activity-card">
      <PlacePageHead
        face={<Activity />}
        state="Everything your minds and apps did, newest first"
        title="All activity"
      />
      {provenance.isError ? (
        <p className="luca-place-page-line" role="status">
          Couldn't reach the relay to read the signed record. The apps' tasks
          are below.
        </p>
      ) : null}
      {entries.length === 0 && !loading ? (
        <p className="luca-place-page-line" data-testid="all-activity-empty">
          Nothing yet. What your minds sign, and what your apps run for them,
          shows here.
        </p>
      ) : (
        days.map((day) => (
          <PlaceList
            count={day.items.length}
            key={day.key}
            label={day.label}
            testId="all-activity-day"
            thread
          >
            {day.items.map((entry) => (
              <PlaceListRow
                data-activity-kind={entry.kind}
                face={entry.face}
                key={entry.key}
                note={timeOfDay(entry.at)}
                onOpen={entry.open ?? undefined}
                openLabel={[entry.title, entry.summary]
                  .filter(Boolean)
                  .join(", ")}
                summary={entry.summary}
                testId={`all-activity-${entry.key}`}
                title={entry.title}
              />
            ))}
          </PlaceList>
        ))
      )}
      {provenance.hasNextPage ? (
        <div className="luca-all-activity-more">
          <Button
            disabled={provenance.isFetchingNextPage}
            onClick={() => void provenance.fetchNextPage()}
            size="sm"
            type="button"
            variant="ghost"
          >
            {provenance.isFetchingNextPage ? "Reading…" : "Read further back"}
          </Button>
        </div>
      ) : null}
    </PlacePage>
  );
}
