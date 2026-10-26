import * as React from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";

import { useAgentMemoryQuery } from "@/features/agent-memory/hooks";
import { ResidentPlaceSection } from "@/features/agents/place/ResidentPlaceSection";
import { useManagedPermissions } from "@/features/agents/useManagedPermissions";
import { ManagedPermissionCard } from "@/features/agents/ui/ManagedPermissionCard";
import type { ResidentSummaryViewModel } from "@/features/agents/ui/agentLibraryViewModel";
import { useArtifactCanvas } from "@/features/artifacts/ArtifactCanvasProvider";
import { useArtifactLibrary } from "@/features/artifacts/hooks";
import { ManagedInputCard } from "@/features/capabilities/ui/ManagedInputCard";
import { useManagedInputs } from "@/features/capabilities/useManagedInputs";
import { useChannelsQuery } from "@/features/channels/hooks";
import { ResidentHandoffPanel } from "@/features/profile/ui/ResidentContinuityPanel";
import { ResidentNotebookDetailView } from "@/features/profile/ui/notebook/ResidentNotebookDetailView";
import {
  JournalJobStrip,
  NewJournalPageForm,
} from "@/features/profile/ui/notebook/ResidentNotebookPanel";
import { useAgentProvenanceQuery } from "@/features/provenance/useAgentProvenance";
import {
  cancelResidentJournalPage,
  createResidentJournalPage,
  getResidentJournalActivity,
  getResidentNotebookItem,
  listResidentNotebookItems,
  retryResidentJournalPage,
  type ResidentJournalJob,
  type ResidentNotebookDetail,
  type ResidentNotebookList,
} from "@/shared/api/tauriNotebook";
import type { ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { MadeThumb } from "./MadeThumb";
import {
  MIND_FILTERS,
  MIND_KIND_LABEL,
  buildMindEntries,
  entryTime,
  groupMindDays,
  presentKinds,
  type MindEntry,
  type MindFilter,
  type StreamArtifact,
} from "./mindStream";

const NOTEBOOK_PAGE = 25;

/**
 * Notebook: their days (Decided 3). Their own words, what they're asking
 * you, then one stream, newest first, of what they did for you and in their
 * own time, their journal, what they kept, and what they made. Today's
 * notebook actions stay here: a new journal page, opening a page or a note
 * (to annotate, correct, archive or forget it), and the saved handoff.
 */
export function MindNotebook({
  managedAgent,
  resident,
}: {
  managedAgent: ManagedAgent | null;
  resident: ResidentSummaryViewModel;
}) {
  const pubkey = resident.pubkey;
  const name = resident.displayName;
  const onThisMac = managedAgent?.backend.type === "local";
  const notebook = useResidentNotebookStream(
    managedAgent ? managedAgent.pubkey : null,
  );
  const [detail, setDetail] = React.useState<ResidentNotebookDetail | null>(
    null,
  );
  const [creating, setCreating] = React.useState(false);
  const [handoffOpen, setHandoffOpen] = React.useState(false);
  const [openError, setOpenError] = React.useState<string | null>(null);
  // New page's form can open below the fold: bring it into view (WP-13
  // flows, item 20), at once under Reduce Motion.
  const formRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!creating) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    formRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "nearest",
    });
  }, [creating]);
  const journalBusy =
    notebook.job?.state === "pending" || notebook.job?.state === "running";

  if (detail?.item && managedAgent) {
    return (
      <ResidentNotebookDetailView
        detail={detail}
        onBack={() => setDetail(null)}
        onChanged={async (next) => {
          setDetail(next.item ? next : null);
          await notebook.refresh();
        }}
        residentPubkey={managedAgent.pubkey}
        voice={{ residentName: name }}
      />
    );
  }

  return (
    <div className="luca-mind-notebook" data-testid="mind-notebook">
      {managedAgent && onThisMac ? (
        <ResidentPlaceSection
          residentName={name}
          residentPubkey={managedAgent.pubkey}
          variant="space"
        />
      ) : null}
      {pubkey ? <MindAsks residentPubkey={pubkey} /> : null}
      {notebook.job ? (
        <JournalJobStrip
          job={notebook.job}
          onCancel={async () => {
            await cancelResidentJournalPage(notebook.job?.jobId ?? "");
            await notebook.refresh();
          }}
          onRetry={async () => {
            await retryResidentJournalPage(notebook.job?.jobId ?? "");
            await notebook.refresh();
          }}
        />
      ) : null}
      {creating && managedAgent ? (
        <div ref={formRef}>
          <NewJournalPageForm
            residentName={name}
            busy={journalBusy}
            onCancel={() => setCreating(false)}
            onCreate={async (input) => {
              try {
                const job = await createResidentJournalPage({
                  residentPubkey: managedAgent.pubkey,
                  ownerPrompt: input.prompt || null,
                  selectedEventIds: input.eventIds,
                  selectedPageIds: input.pageIds,
                });
                notebook.setJob(job);
                setCreating(false);
                toast.success("Private journal request started.");
              } catch (cause) {
                setOpenError(
                  cause instanceof Error ? cause.message : String(cause),
                );
              }
            }}
          />
        </div>
      ) : null}
      {openError ? (
        <p className="luca-mind-error" role="alert">
          {openError}
        </p>
      ) : null}
      <MindDays
        actions={
          managedAgent ? (
            <div className="luca-mind-actions">
              <button
                className="luca-mind-action"
                disabled={journalBusy}
                onClick={() => setCreating(true)}
                type="button"
              >
                <Plus aria-hidden /> New page
              </button>
              <button
                aria-expanded={handoffOpen}
                className="luca-mind-action"
                data-testid="mind-handoff-toggle"
                onClick={() => setHandoffOpen((open) => !open)}
                type="button"
              >
                Saved handoff
              </button>
            </div>
          ) : null
        }
        afterToolbar={
          handoffOpen && managedAgent ? (
            <div className="luca-mind-handoff-body" data-testid="mind-handoff">
              <ResidentHandoffPanel residentPubkey={managedAgent.pubkey} />
            </div>
          ) : null
        }
        notebook={notebook}
        onOpenItem={async (itemId) => {
          if (!managedAgent) return;
          setOpenError(null);
          try {
            const next = await getResidentNotebookItem(
              managedAgent.pubkey,
              itemId,
            );
            if (next.item) setDetail(next);
            else setOpenError("That notebook item is no longer available.");
          } catch (cause) {
            setOpenError(
              cause instanceof Error ? cause.message : String(cause),
            );
          }
        }}
        pubkey={pubkey}
        readMemory={Boolean(managedAgent)}
      />
    </div>
  );
}

type NotebookStream = ReturnType<typeof useResidentNotebookStream>;

/** The resident's notebook, paged, and its journal job (`ResidentNotebookPanel`'s reads). */
function useResidentNotebookStream(residentPubkey: string | null) {
  const [list, setList] = React.useState<ResidentNotebookList | null>(null);
  const [job, setJob] = React.useState<ResidentJournalJob | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const generation = React.useRef(0);

  const refresh = React.useCallback(async () => {
    if (!residentPubkey) return;
    const own = ++generation.current;
    try {
      const [next, nextJob] = await Promise.all([
        listResidentNotebookItems(residentPubkey, 0, NOTEBOOK_PAGE),
        getResidentJournalActivity(residentPubkey),
      ]);
      if (own !== generation.current) return;
      setList(next);
      setJob(nextJob);
    } catch {
      // The notebook may be locked or unavailable: its part of the stream hides.
      if (own === generation.current) setList(null);
    }
  }, [residentPubkey]);

  React.useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  React.useEffect(() => {
    if (job?.state !== "pending" && job?.state !== "running") return;
    const timeout = window.setTimeout(() => void refresh(), 2_500);
    return () => window.clearTimeout(timeout);
  }, [job, refresh]);

  const loadMore = React.useCallback(async () => {
    if (!residentPubkey || !list || list.nextCursor === null || loadingMore)
      return;
    setLoadingMore(true);
    const own = generation.current;
    try {
      const next = await listResidentNotebookItems(
        residentPubkey,
        list.nextCursor,
        NOTEBOOK_PAGE,
      );
      if (own !== generation.current) return;
      const seen = new Set(list.items.map((item) => item.itemId));
      setList({
        ...next,
        items: [
          ...list.items,
          ...next.items.filter((item) => !seen.has(item.itemId)),
        ],
      });
    } catch {
      // Keep what is shown; the next scroll asks again.
    } finally {
      setLoadingMore(false);
    }
  }, [list, loadingMore, residentPubkey]);

  return {
    hasMore: list?.nextCursor !== null && list?.nextCursor !== undefined,
    items: list?.items ?? [],
    job,
    loadMore,
    loadingMore,
    refresh,
    setJob,
  };
}

/** What they're asking you (Decided 3; the study's `.shell-mind-ask`): one
 *  line each, its question and Answer. Answer opens today's card in place
 *  under the line, so it is still answered here. */
function MindAsks({ residentPubkey }: { residentPubkey: string }) {
  const key = normalizePubkey(residentPubkey);
  const inputs = useManagedInputs().filter(
    (each) => normalizePubkey(each.request.residentPubkey) === key,
  );
  const permissions = useManagedPermissions().filter(
    (each) => normalizePubkey(each.request.residentPubkey) === key,
  );
  if (inputs.length === 0 && permissions.length === 0) return null;
  return (
    <section
      aria-label="What they're asking you"
      className="luca-mind-asks"
      data-testid="mind-asks"
    >
      {inputs.map((pending) => (
        <MindAsk
          card={<ManagedInputCard compact pending={pending} />}
          key={pending.pendingId}
          question={pending.request.message}
        />
      ))}
      {permissions.map((pending) => (
        <MindAsk
          card={<ManagedPermissionCard compact pending={pending} />}
          key={pending.pendingId}
          question={
            pending.request.protocol === "luca.managed.permission.v2"
              ? pending.request.operation
              : pending.request.title
          }
        />
      ))}
    </section>
  );
}

function MindAsk({
  card,
  question,
}: {
  card: React.ReactNode;
  question: string;
}) {
  const [open, setOpen] = React.useState(false);
  const cardId = React.useId();
  return (
    <div className="luca-mind-ask" data-open={open ? "true" : undefined}>
      <div className="luca-mind-ask-line">
        <span className="luca-mind-kind">Asks you</span>
        <p>{question}</p>
        <button
          aria-controls={cardId}
          aria-expanded={open}
          className="luca-mind-answer"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? "Hide" : "Answer"}
        </button>
      </div>
      {open ? (
        <div className="luca-mind-ask-card" id={cardId}>
          {card}
        </div>
      ) : null}
    </div>
  );
}

const ACTIVE_ARTIFACTS = {
  deletedState: "active",
  kind: "all",
  query: "",
} as const;

/** Their days: one stream, its filters, and more as you scroll. */
function MindDays({
  actions,
  afterToolbar,
  notebook,
  onOpenItem,
  pubkey,
  readMemory,
}: {
  /** Today's notebook actions, at the end of the filters' row. */
  actions: React.ReactNode;
  /** What an action opens, under that row. */
  afterToolbar: React.ReactNode;
  notebook: NotebookStream;
  onOpenItem: (itemId: string) => void;
  pubkey: string | null;
  readMemory: boolean;
}) {
  const [filter, setFilter] = React.useState<MindFilter>("all");
  const provenance = useAgentProvenanceQuery(pubkey);
  const memory = useAgentMemoryQuery(pubkey, { enabled: readMemory });
  const artifacts = useArtifactLibrary(ACTIVE_ARTIFACTS);
  const channels = useChannelsQuery();
  const { openArtifact } = useArtifactCanvas();

  const entries = React.useMemo(() => {
    const key = pubkey ? normalizePubkey(pubkey) : null;
    const memberChannelIds = new Set(
      (channels.data ?? [])
        .filter((channel) => channel.isMember)
        .map((channel) => channel.id),
    );
    const channelNames = new Map(
      (channels.data ?? []).map((channel) => [channel.id, channel.name]),
    );
    const made: StreamArtifact[] = key
      ? (artifacts.data?.pages ?? [])
          .flatMap((page) => page.artifacts)
          .filter(
            (artifact) =>
              artifact.provenance.residentPubkey &&
              normalizePubkey(artifact.provenance.residentPubkey) === key,
          )
          .map((artifact) => ({
            conversationId: artifact.provenance.conversationId,
            createdAt: artifact.createdAt,
            currentVersion: artifact.currentVersion,
            id: artifact.id,
            kind: artifact.kind,
            summary: artifact.summary,
            title: artifact.title,
          }))
      : [];
    const listing = memory.data;
    return buildMindEntries({
      artifacts: made,
      channelNames,
      engrams: listing
        ? [...(listing.core ? [listing.core] : []), ...listing.memories]
        : [],
      memberChannelIds,
      notebook: notebook.items,
      records: (provenance.data?.pages ?? [])
        .flatMap((page) => page.records)
        .map((record) => ({
          channelId: record.channelId,
          createdAt: record.createdAt,
          family: record.family,
          id: record.event.id,
          object: record.object,
          verb: record.verb,
        })),
    });
  }, [
    artifacts.data,
    channels.data,
    memory.data,
    notebook.items,
    provenance.data,
    pubkey,
  ]);

  const kinds = presentKinds(entries);
  const filters = MIND_FILTERS.filter(
    (each) => each.id === "all" || kinds.has(each.id),
  );
  const shown = filter === "all" || kinds.has(filter) ? filter : "all";
  const days = groupMindDays(entries, shown);

  const hasMore =
    notebook.hasMore ||
    Boolean(provenance.hasNextPage) ||
    Boolean(artifacts.hasNextPage);
  const loading =
    notebook.loadingMore ||
    provenance.isFetchingNextPage ||
    artifacts.isFetchingNextPage;
  const more = React.useEffectEvent(() => {
    if (loading) return;
    if (notebook.hasMore) void notebook.loadMore();
    if (provenance.hasNextPage) void provenance.fetchNextPage();
    if (artifacts.hasNextPage) void artifacts.fetchNextPage();
  });
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (seen) => {
        if (seen.some((each) => each.isIntersecting)) more();
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  if (entries.length === 0 && !actions) return null;

  return (
    <section aria-label="Their days" className="luca-mind-days">
      <div className="luca-mind-toolbar">
        {filters.length > 1 ? (
          <fieldset aria-label="Show" className="luca-mind-filters">
            {filters.map((each) => (
              <button
                aria-pressed={shown === each.id}
                className="luca-mind-filter"
                data-selected={shown === each.id ? "true" : undefined}
                data-testid={`mind-filter-${each.id}`}
                key={each.id}
                onClick={() => setFilter(each.id)}
                type="button"
              >
                {each.label}
              </button>
            ))}
          </fieldset>
        ) : (
          <span />
        )}
        {actions}
      </div>
      {afterToolbar}
      {days.map((day) => (
        <section aria-label={day.label} className="luca-mind-day" key={day.key}>
          <h2 className="type-eyebrow">{day.label}</h2>
          <ul>
            {day.entries.map((entry) => (
              <MindEntryRow
                entry={entry}
                key={entry.id}
                onOpenItem={onOpenItem}
                onOpenMade={(made) =>
                  openArtifact({
                    artifactId: made.id,
                    conversationId: made.conversationId,
                    previewSessionId: null,
                    residentPubkey: pubkey,
                    source: "library",
                    turnId: null,
                    version: made.currentVersion,
                  })
                }
              />
            ))}
          </ul>
        </section>
      ))}
      {hasMore ? (
        <div aria-hidden className="luca-mind-more" ref={sentinelRef}>
          {loading ? <LoaderCircle className="animate-spin" /> : null}
        </div>
      ) : null}
    </section>
  );
}

function MindEntryRow({
  entry,
  onOpenItem,
  onOpenMade,
}: {
  entry: MindEntry;
  onOpenItem: (itemId: string) => void;
  onOpenMade: (made: StreamArtifact) => void;
}) {
  const itemId = entry.notebookItemId;
  const words = (
    <>
      {entry.text ? <p className="luca-mind-line">{entry.text}</p> : null}
      {entry.excerpt ? (
        <p className="luca-mind-page-lines">{entry.excerpt}</p>
      ) : null}
    </>
  );
  return (
    <li data-kind={entry.kind} data-testid="mind-entry">
      <span className="luca-mind-kind">{MIND_KIND_LABEL[entry.kind]}</span>
      <div className="luca-mind-entry">
        {itemId ? (
          <button
            className="luca-mind-entry-open"
            onClick={() => onOpenItem(itemId)}
            type="button"
          >
            {words}
          </button>
        ) : (
          words
        )}
        {entry.annotations?.map((note) => (
          <p className="luca-mind-annotation" key={note}>
            {note}
          </p>
        ))}
        {entry.made ? (
          <MadeReceipt
            made={entry.made}
            onOpen={() => onOpenMade(entry.made as StreamArtifact)}
            titled={entry.text !== entry.made.title}
          />
        ) : null}
      </div>
      <time dateTime={new Date(entry.at).toISOString()}>
        {entryTime(entry.at)}
      </time>
    </li>
  );
}

/** What they made, as a receipt: the piece's picture when it's an image,
 *  else its kind's mark. Opens in the Canvas. */
function MadeReceipt({
  made,
  onOpen,
  titled,
}: {
  made: StreamArtifact;
  onOpen: () => void;
  /** Its title beside the picture, unless the row's line already is it. */
  titled: boolean;
}) {
  return (
    <button
      aria-label={`Open in Canvas: ${made.title}`}
      className="luca-mind-made"
      data-testid="mind-made"
      onClick={onOpen}
      type="button"
    >
      <MadeThumb
        artifactId={made.id}
        kind={made.kind}
        title={made.title}
        version={made.currentVersion}
      />
      {titled ? <span>{made.title}</span> : null}
    </button>
  );
}
