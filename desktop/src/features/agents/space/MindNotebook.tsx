import * as React from "react";
import {
  Bookmark,
  LoaderCircle,
  NotebookPen,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  PlaceRowFace,
  PlaceSectionLabel,
} from "@/app/shell/placeRails/PlacePage";
import {
  PermissionAsk,
  QuestionAsk,
  useAskFocusHandoff,
} from "@/app/shell/placeRails/ManagedAsks";
import { useAgentMemoryQuery } from "@/features/agent-memory/hooks";
import { ResidentPlaceSection } from "@/features/agents/place/ResidentPlaceSection";
import { useManagedPermissions } from "@/features/agents/useManagedPermissions";
import type { ResidentSummaryViewModel } from "@/features/agents/ui/agentLibraryViewModel";
import { useArtifactCanvas } from "@/features/artifacts/ArtifactCanvasProvider";
import { useArtifactLibrary } from "@/features/artifacts/hooks";
import { ProposalAsk } from "@/features/capabilities/ui/RuntimeTaskProposalConfirmation";
import { useAllRuntimeTaskProposals } from "@/features/capabilities/useAllRuntimeTasks";
import { useManagedInputs } from "@/features/capabilities/useManagedInputs";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useRoomProjects } from "@/features/channels/lib/roomProjects";
import { useCommunities } from "@/features/communities/useCommunities";
import { useSideConversations } from "@/features/exchange/useSideConversations";
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
import { useIdentityQuery } from "@/shared/api/hooks";
import type { ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { AgentMark } from "@/shared/ui/AgentMark";
import { MadeThumb } from "./MadeThumb";
import {
  MIND_FILTERS,
  MIND_KIND_LABEL,
  buildMindEntries,
  emptyDaysLine,
  entryTime,
  groupMindDays,
  presentKinds,
  type MindEntry,
  type MindFilter,
  type MindKind,
  type StreamArtifact,
} from "./mindStream";

const NOTEBOOK_PAGE = 25;

/** Each kind's glyph (BETA14_RELEASE.md WP-33, Decided 8): what they did
 *  for you, their own time, their journal, what they kept. The filters wear
 *  the same glyphs. */
const KIND_GLYPH: Record<MindKind, typeof UserRound> = {
  you: UserRound,
  own: Sparkles,
  journal: NotebookPen,
  memory: Bookmark,
};

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
        name={name}
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
  // Whose notebook has answered at least once (or failed to): until then its
  // part of the stream is still on its way.
  const [settledFor, setSettledFor] = React.useState<string | null>(null);
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
      setSettledFor(residentPubkey);
    } catch {
      // The notebook may be locked or unavailable: its part of the stream hides.
      if (own === generation.current) {
        setList(null);
        setSettledFor(residentPubkey);
      }
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
    settled: residentPubkey === null || settledFor === residentPubkey,
  };
}

/** What they're asking you (Decided 3), each ask in the one row Needs you
 *  uses (WP-09b, Decided 1), answered in place the same way. The space is
 *  theirs, so the line under an ask says only where it was asked. */
function MindAsks({ residentPubkey }: { residentPubkey: string }) {
  const key = normalizePubkey(residentPubkey);
  const allInputs = useManagedInputs();
  const allPermissions = useManagedPermissions();
  const inputs = React.useMemo(
    () =>
      allInputs.filter(
        (each) => normalizePubkey(each.request.residentPubkey) === key,
      ),
    [allInputs, key],
  );
  const permissions = React.useMemo(
    () =>
      allPermissions.filter(
        (each) => normalizePubkey(each.request.residentPubkey) === key,
      ),
    [allPermissions, key],
  );
  // Every ask the mind makes, its proposals too (WP-22, 7): newest first,
  // after the requests that hold a turn open now, as Needs you orders them.
  const allProposals = useAllRuntimeTaskProposals();
  const proposals = React.useMemo(
    () =>
      allProposals
        .filter((each) => normalizePubkey(each.residentPubkey) === key)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [allProposals, key],
  );
  // A proposal is answered as in its room: its project's sources name the
  // working folder (NeedsYouCard).
  const channels = useChannelsQuery().data;
  const { activeCommunity } = useCommunities();
  const owner = useIdentityQuery().data?.pubkey;
  const projects = useRoomProjects(
    channels ?? [],
    owner,
    activeCommunity?.relayUrl,
  );
  const { nameOf, roomOf } = useSideConversations();
  const { goChannel } = useAppNavigation();
  const keys = React.useMemo(
    () => [
      ...permissions.map((each) => `permission:${each.pendingId}`),
      ...inputs.map((each) => `question:${each.pendingId}`),
      ...proposals.map((each) => `proposal:${each.proposalId}`),
    ],
    [inputs, permissions, proposals],
  );
  const { listRef, onFocus } = useAskFocusHandoff(keys);
  if (keys.length === 0) return null;
  const common = (kind: string, pendingId: string, conversationId: string) => ({
    "data-ask-key": `${kind}:${pendingId}`,
    "data-ask-kind": kind,
    "data-testid": `mind-ask-${kind}:${pendingId}`,
    face: <AgentMark />,
    note: "now",
    onOpen: () => void goChannel(conversationId),
    openTestId: "mind-ask-open",
  });
  const where = (conversationId: string) =>
    roomOf(conversationId) || "Asks you";
  return (
    <section
      aria-label="What they're asking you"
      className="luca-mind-asks"
      data-testid="mind-asks"
    >
      <PlaceSectionLabel count={keys.length} label="Asks you" />
      <ul
        className="luca-ask-list luca-place-plate"
        onFocus={onFocus}
        ref={listRef}
      >
        {permissions.map((pending) => (
          <PermissionAsk
            common={common(
              "permission",
              pending.pendingId,
              pending.request.conversationId,
            )}
            key={pending.pendingId}
            pending={pending}
            summary={where(pending.request.conversationId)}
          />
        ))}
        {inputs.map((pending) => (
          <QuestionAsk
            common={common(
              "question",
              pending.pendingId,
              pending.request.conversationId,
            )}
            key={pending.pendingId}
            pending={pending}
            summary={where(pending.request.conversationId)}
          />
        ))}
        {proposals.map((proposal) => (
          <ProposalAsk
            common={common(
              "proposal",
              proposal.proposalId,
              proposal.conversationId,
            )}
            key={proposal.proposalId}
            projectSourceIds={
              projects.get(proposal.conversationId)?.sourceIds ?? []
            }
            proposal={proposal}
            summary={where(proposal.conversationId)}
            who={nameOf(normalizePubkey(proposal.residentPubkey))}
          />
        ))}
      </ul>
    </section>
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
  name,
  notebook,
  onOpenItem,
  pubkey,
  readMemory,
}: {
  /** Today's notebook actions, at the end of the filters' row. */
  actions: React.ReactNode;
  /** What an action opens, under that row. */
  afterToolbar: React.ReactNode;
  /** Whose days these are, for the line an empty Notebook says. */
  name: string;
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

  // Nothing in their days yet, and every source has answered (BETA14_RELEASE.md
  // WP-37, Decided 2): one quiet line says what the Notebook holds. Never
  // while a source is still on its way, so it can't flash; gone the moment a
  // day arrives.
  const settled =
    notebook.settled &&
    channels.status !== "pending" &&
    artifacts.status !== "pending" &&
    (!pubkey || provenance.status !== "pending") &&
    (!(readMemory && pubkey) || memory.status !== "pending");
  const empty =
    entries.length === 0 && settled ? (
      <div className="luca-place-plate" data-testid="mind-notebook-empty">
        <p className="luca-mind-empty">{emptyDaysLine(name)}</p>
      </div>
    ) : null;

  if (entries.length === 0 && !actions) {
    return empty ? (
      <section aria-label="Their days" className="luca-mind-days">
        {empty}
      </section>
    ) : null;
  }

  return (
    <section aria-label="Their days" className="luca-mind-days">
      <div className="luca-mind-toolbar">
        {filters.length > 1 ? (
          <fieldset aria-label="Show" className="luca-mind-filters">
            {filters.map((each) => {
              const Glyph = each.id === "all" ? null : KIND_GLYPH[each.id];
              return (
                <button
                  aria-pressed={shown === each.id}
                  className="luca-mind-filter"
                  data-selected={shown === each.id ? "true" : undefined}
                  data-testid={`mind-filter-${each.id}`}
                  key={each.id}
                  onClick={() => setFilter(each.id)}
                  type="button"
                >
                  {Glyph ? <Glyph aria-hidden /> : null}
                  {each.label}
                </button>
              );
            })}
          </fieldset>
        ) : (
          <span />
        )}
        {actions}
      </div>
      {afterToolbar}
      {empty}
      {days.map((day) => (
        <section aria-label={day.label} className="luca-mind-day" key={day.key}>
          <PlaceSectionLabel count={day.entries.length} label={day.label} />
          <ul className="luca-place-plate" data-thread="true">
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
  const Glyph = KIND_GLYPH[entry.kind];
  return (
    <li
      className="luca-place-row luca-mind-day-row"
      data-kind={entry.kind}
      data-testid="mind-entry"
    >
      <PlaceRowFace label={MIND_KIND_LABEL[entry.kind]}>
        <Glyph />
      </PlaceRowFace>
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
      <time
        className="luca-place-row-note"
        dateTime={new Date(entry.at).toISOString()}
      >
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
