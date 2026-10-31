import * as React from "react";
import {
  Bookmark,
  ChevronRight,
  LoaderCircle,
  NotebookPen,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  PermissionAsk,
  QuestionAsk,
  useAskFocusHandoff,
} from "@/app/shell/placeRails/ManagedAsks";
import { useAgentMemoryQuery } from "@/features/agent-memory/hooks";
import {
  formatRelativeAge,
  spaceDocumentLabel,
} from "@/features/agents/documents/documentKinds";
import {
  useResidentDocumentQuery,
  useResidentDocumentsQuery,
} from "@/features/agents/documents/useResidentDocuments";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useManagedPermissions } from "@/features/agents/useManagedPermissions";
import { useArtifactLibrary } from "@/features/artifacts/hooks";
import { ProposalAsk } from "@/features/capabilities/ui/RuntimeTaskProposalConfirmation";
import { useAllRuntimeTaskProposals } from "@/features/capabilities/useAllRuntimeTasks";
import { useManagedInputs } from "@/features/capabilities/useManagedInputs";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useRoomProjects } from "@/features/channels/lib/roomProjects";
import { useCommunities } from "@/features/communities/useCommunities";
import { useSideConversations } from "@/features/exchange/useSideConversations";
import { useProfileQuery } from "@/features/profile/hooks";
import { ResidentHandoffPanel } from "@/features/profile/ui/ResidentContinuityPanel";
import {
  notebookAvailabilityCopy,
  notebookCategoryLabel,
  notebookCountWhenComplete,
  notebookExcerpt,
  notebookTimestamp,
} from "@/features/profile/ui/notebook/notebookPresentation";
import {
  JournalJobStrip,
  NewJournalPageForm,
} from "@/features/profile/ui/notebook/ResidentNotebookPanel";
import { useAgentProvenanceQuery } from "@/features/provenance/useAgentProvenance";
import {
  cancelResidentJournalPage,
  createResidentJournalPage,
  getResidentJournalActivity,
  listResidentNotebookItems,
  retryResidentJournalPage,
  type ResidentJournalJob,
  type ResidentNotebookItem,
  type ResidentNotebookList,
} from "@/shared/api/tauriNotebook";
import {
  getResidentContinuity,
  type ResidentContinuityInspector,
} from "@/shared/api/tauriContinuity";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { AgentMark } from "@/shared/ui/AgentMark";
import { MindChips, MindSection, NewDot } from "./MindPageKit";
import type { MindReadingKind } from "./mindSection";
import {
  buildMindEntries,
  entryTime,
  firstLine,
  groupMindDays,
  MIND_KIND_LABEL,
  type MindEntry,
  dayWhoLine,
  type StreamArtifact,
} from "./mindStream";
import { isNewSince } from "./mindVisits";

const NOTEBOOK_PAGE = 25;

/** Each kind's glyph (WP-33, Decided 8): what they did with you, their own
 *  time, their journal. */
const KIND_GLYPH = {
  you: UserRound,
  own: Sparkles,
  journal: NotebookPen,
  memory: Bookmark,
} as const;

// ── the notebook, read once for the whole page ─────────────────────────

export type NotebookStream = ReturnType<typeof useResidentNotebookStream>;

/** The resident's notebook, paged, and its journal job (`ResidentNotebookPanel`'s reads). */
export function useResidentNotebookStream(residentPubkey: string | null) {
  const [list, setList] = React.useState<ResidentNotebookList | null>(null);
  const [job, setJob] = React.useState<ResidentJournalJob | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  // Whose notebook has answered at least once (or failed to): until then its
  // part of the page is still on its way.
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
      // The notebook may be locked or unavailable: its part of the page hides.
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
      // Keep what is shown; the next ask tries again.
    } finally {
      setLoadingMore(false);
    }
  }, [list, loadingMore, residentPubkey]);

  const countOf = React.useCallback(
    (kind: ResidentNotebookItem["kind"]) =>
      list
        ? notebookCountWhenComplete(
            list.items,
            list.nextCursor,
            (item) => item.kind === kind && item.status === "active",
          )
        : null,
    [list],
  );

  return {
    availability: list?.availability ?? null,
    countOf,
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

// ── what they made, newest first ───────────────────────────────────────

const ACTIVE_ARTIFACTS = {
  deletedState: "active",
  kind: "all",
  query: "",
} as const;

/** A piece they made, with whether it was made on their own: in a room you
 *  aren't in, by the stream's one rule (`forYouOrOwn`). */
export type MadePiece = StreamArtifact & { own: boolean; at: number };

/** Everything they made, newest first, from the Library's own list. */
export function useMadeBy(pubkey: string | null) {
  const artifacts = useArtifactLibrary(ACTIVE_ARTIFACTS);
  const channels = useChannelsQuery();
  const pieces = React.useMemo(() => {
    const key = pubkey ? normalizePubkey(pubkey) : null;
    if (!key) return [];
    const members = new Set(
      (channels.data ?? [])
        .filter((channel) => channel.isMember)
        .map((channel) => channel.id),
    );
    return (artifacts.data?.pages ?? [])
      .flatMap((page) => page.artifacts)
      .filter(
        (artifact) =>
          artifact.provenance.residentPubkey &&
          normalizePubkey(artifact.provenance.residentPubkey) === key,
      )
      .map(
        (artifact): MadePiece => ({
          at: Date.parse(artifact.createdAt) || 0,
          conversationId: artifact.provenance.conversationId,
          createdAt: artifact.createdAt,
          currentVersion: artifact.currentVersion,
          id: artifact.id,
          kind: artifact.kind,
          own: !(
            artifact.provenance.conversationId &&
            members.has(artifact.provenance.conversationId)
          ),
          summary: artifact.summary,
          title: artifact.title,
        }),
      )
      .sort((left, right) => right.at - left.at);
  }, [artifacts.data, channels.data, pubkey]);
  return {
    hasMore: Boolean(artifacts.hasNextPage),
    loadMore: () => void artifacts.fetchNextPage(),
    loadingMore: artifacts.isFetchingNextPage,
    pieces,
    settled: artifacts.status !== "pending" && channels.status !== "pending",
  };
}

// ── their days, one stream ─────────────────────────────────────────────

/** Their days as one stream (mindStream.ts), from what the app holds. */
export function useMindEntries({
  notebook,
  made,
  pubkey,
  readMemory,
}: {
  notebook: NotebookStream;
  made: ReturnType<typeof useMadeBy>;
  pubkey: string | null;
  readMemory: boolean;
}) {
  const provenance = useAgentProvenanceQuery(pubkey);
  const memory = useAgentMemoryQuery(pubkey, { enabled: readMemory });
  const channels = useChannelsQuery();
  const entries = React.useMemo(() => {
    const memberChannelIds = new Set(
      (channels.data ?? [])
        .filter((channel) => channel.isMember)
        .map((channel) => channel.id),
    );
    const channelNames = new Map(
      (channels.data ?? []).map((channel) => [channel.id, channel.name]),
    );
    const listing = memory.data;
    return buildMindEntries({
      artifacts: made.pieces,
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
    channels.data,
    made.pieces,
    memory.data,
    notebook.items,
    provenance.data,
  ]);
  const settled =
    notebook.settled &&
    made.settled &&
    channels.status !== "pending" &&
    (!pubkey || provenance.status !== "pending") &&
    (!(readMemory && pubkey) || memory.status !== "pending");
  const hasMore =
    notebook.hasMore || Boolean(provenance.hasNextPage) || made.hasMore;
  const loading =
    notebook.loadingMore || provenance.isFetchingNextPage || made.loadingMore;
  const more = () => {
    if (loading) return;
    if (notebook.hasMore) void notebook.loadMore();
    if (provenance.hasNextPage) void provenance.fetchNextPage();
    if (made.hasMore) made.loadMore();
  };
  return { entries, hasMore, loading, more, settled };
}

// ── under the header: what they're asking you ──────────────────────────

/** What they're asking you (Decided 5): today's ask rows, each answered in
 *  place as Needs you answers it, in one thin border. Nothing waiting, it
 *  isn't there. */
export function MindAsks({
  name,
  residentPubkey,
}: {
  name: string;
  residentPubkey: string;
}) {
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
      aria-label={`${name} is asking`}
      className="luca-mind-asks luca-mind-box"
      data-testid="mind-asks"
    >
      <p className="type-eyebrow luca-mind-eyebrow luca-mind-asks-label">
        {name} is asking
        {keys.length > 1 ? (
          <span className="luca-mind-count">{keys.length}</span>
        ) : null}
      </p>
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

// ── Notebook: Journal · Pages · Notes ──────────────────────────────────

type NotebookView = "journal" | "pages" | "notes";

/** The pages they write (Decided 7): who they're becoming, what they know
 *  about you, and their lessons. */
const READING_KINDS: MindReadingKind[] = ["selfModel", "userModel", "lessons"];

/**
 * Notebook (Decided 7): their journal, the pages they write, and their
 * continuity notes, one at a time under chips. Today's notebook actions stay
 * here: a new journal page, and opening a page or a note to read, correct,
 * annotate, archive or forget it.
 */
export function MindNotebookSection({
  managedAgent,
  name,
  notebook,
  onOpenItem,
  onOpenReading,
  openOnPages,
  since,
}: {
  managedAgent: ManagedAgent | null;
  name: string;
  notebook: NotebookStream;
  onOpenItem: (itemId: string) => void;
  onOpenReading: (kind: MindReadingKind) => void;
  openOnPages: boolean;
  since: number | null;
}) {
  const documents = useResidentDocumentsQuery(managedAgent?.pubkey ?? null);
  const written = READING_KINDS.filter(
    (kind) =>
      documents.data?.documents.find((each) => each.kind === kind)?.exists,
  ).length;
  const journalCount = notebook.countOf("journal_page");
  const notesCount = notebook.countOf("memory_note");
  const hasJournal = notebook.items.some(
    (item) => item.kind === "journal_page" && item.status === "active",
  );
  const [chosen, setChosen] = React.useState<NotebookView | null>(
    openOnPages ? "pages" : null,
  );
  // It opens on Journal when there are entries, otherwise on Pages.
  const view: NotebookView =
    chosen ?? (notebook.settled && !hasJournal ? "pages" : "journal");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const journalBusy =
    notebook.job?.state === "pending" || notebook.job?.state === "running";
  return (
    <MindSection
      control={
        managedAgent ? (
          <MindChips<NotebookView>
            label="Notebook"
            onChange={setChosen}
            options={[
              { id: "journal", label: "Journal", count: journalCount },
              {
                id: "pages",
                label: "Pages",
                count: documents.data ? written : null,
              },
              { id: "notes", label: "Notes", count: notesCount },
            ]}
            testIdPrefix="mind-view"
            value={view}
          />
        ) : null
      }
      testId="mind-notebook"
      title="Notebook"
    >
      {!managedAgent ? (
        <p className="luca-mind-help" data-testid="mind-notebook-empty">
          {name}'s journal, the pages they write and their notes will gather
          here once they're set up on this Mac.
        </p>
      ) : view === "pages" ? (
        <ul className="luca-mind-rows" data-testid="mind-pages">
          {READING_KINDS.map((kind) => (
            <ReadingRow
              entry={documents.data?.documents.find(
                (each) => each.kind === kind,
              )}
              key={kind}
              kind={kind}
              onOpen={() => onOpenReading(kind)}
              pending={documents.isPending}
              residentName={name}
              residentPubkey={managedAgent.pubkey}
            />
          ))}
        </ul>
      ) : (
        <>
          {view === "journal" && notebook.job ? (
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
          <NotebookItems
            kind={view === "notes" ? "memory_note" : "journal_page"}
            name={name}
            notebook={notebook}
            onOpen={onOpenItem}
            since={since}
          />
          {view === "journal" ? (
            creating ? (
              <div className="luca-mind-form">
                <NewJournalPageForm
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
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      );
                    }
                  }}
                  residentName={name}
                />
              </div>
            ) : (
              <button
                className="luca-mind-link"
                data-testid="mind-new-page"
                disabled={journalBusy}
                onClick={() => setCreating(true)}
                type="button"
              >
                <Plus aria-hidden /> Ask {name} for a journal page
              </button>
            )
          ) : null}
          {error ? (
            <p className="luca-mind-error" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </MindSection>
  );
}

/** One page they write: its name, one line of what it says, when it
 *  changed. Opens its reading page. */
function ReadingRow({
  entry,
  kind,
  onOpen,
  pending,
  residentName,
  residentPubkey,
}: {
  entry: { exists: boolean; modifiedAt: number | null } | undefined;
  kind: MindReadingKind;
  onOpen: () => void;
  pending: boolean;
  residentName: string;
  residentPubkey: string;
}) {
  const ownerName = useProfileQuery(true).data?.displayName;
  const exists = Boolean(entry?.exists);
  const target = React.useMemo(() => ({ kind }), [kind]);
  const document = useResidentDocumentQuery(
    exists ? residentPubkey : null,
    exists ? target : null,
  );
  const line = exists ? firstLine(document.data?.content ?? "", 220) : "";
  return (
    <li>
      <button
        className="luca-mind-entry-row luca-mind-journal-row"
        data-testid={`mind-page-${kind}`}
        onClick={onOpen}
        type="button"
      >
        <span className="luca-mind-entry-words">
          <span className="luca-mind-entry-title">
            {spaceDocumentLabel(kind, ownerName)}
          </span>
          <span className="luca-mind-two-lines">
            {line ||
              (pending || (exists && document.isPending)
                ? " "
                : exists
                  ? "Written, with no text yet"
                  : `Not written yet. ${residentName} writes this over time.`)}
          </span>
        </span>
        <span className="luca-mind-date">
          {exists && entry?.modifiedAt
            ? formatRelativeAge(entry.modifiedAt * 1000, Date.now())
            : ""}
        </span>
      </button>
    </li>
  );
}

/** "Today", "Yesterday", else the date. */
function dayWord(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.valueOf())) return "";
  const today = new Date();
  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).valueOf();
  const days = Math.round((start(today) - start(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return notebookTimestamp(value);
}

/**
 * Journal entries or continuity notes: a journal entry is its title, two
 * lines of it and its date; a note keeps its kind, its words, who wrote it,
 * its revision and its sources. Each opens, as the classic Notebook's rows
 * do, to be read, corrected, annotated, archived or forgotten.
 */
function NotebookItems({
  kind,
  name,
  notebook,
  onOpen,
  since,
}: {
  kind: "memory_note" | "journal_page";
  name: string;
  notebook: NotebookStream;
  onOpen: (itemId: string) => void;
  since: number | null;
}) {
  const items = notebook.items.filter(
    (item) => item.kind === kind && item.status === "active",
  );
  const isPage = kind === "journal_page";
  if (!notebook.settled) return <div className="luca-mind-more" />;
  if (items.length === 0) {
    const copy =
      notebook.availability === "locked" ||
      notebook.availability === "unavailable"
        ? notebookAvailabilityCopy(
            notebook.availability,
            isPage ? "pages" : "notes",
          ).body
        : isPage
          ? `${name}'s journal will gather here: pages they write for themselves, when you ask for one.`
          : `After a meaningful exchange, ${name} may keep a short note, with where it came from, for later conversations.`;
    return (
      <p
        className="luca-mind-help luca-mind-empty-line"
        data-testid={`mind-${isPage ? "journal" : "notes"}-empty`}
      >
        {copy}
      </p>
    );
  }
  return (
    <>
      <ul
        className="luca-mind-rows"
        data-testid={`mind-${isPage ? "journal" : "notes"}`}
      >
        {items.map((item) => {
          const fresh = isNewSince(Date.parse(item.createdAt), since);
          if (isPage)
            return (
              <li key={item.itemId}>
                <button
                  className="luca-mind-entry-row luca-mind-journal-row"
                  data-new={fresh ? "true" : undefined}
                  data-testid="mind-notebook-item"
                  onClick={() => onOpen(item.itemId)}
                  type="button"
                >
                  <span className="luca-mind-entry-words">
                    <span className="luca-mind-entry-title">
                      {fresh ? <NewDot /> : null}
                      {item.title || firstLine(item.body) || "Untitled page"}
                    </span>
                    {item.body.trim() ? (
                      <span className="luca-mind-two-lines">
                        {notebookExcerpt(item.body, 240)}
                      </span>
                    ) : null}
                  </span>
                  <time className="luca-mind-date" dateTime={item.updatedAt}>
                    {dayWord(item.updatedAt)}
                  </time>
                </button>
              </li>
            );
          const sources =
            item.sourceEventIds.length + item.sourcePageIds.length;
          const meta = [
            item.authorship === "owner"
              ? "Written by you"
              : `Written by ${name}`,
            item.pinnedOwnerCorrection ? "pinned" : null,
            `revision ${item.revision}`,
            sources > 0 ? `${sources} source${sources === 1 ? "" : "s"}` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={item.itemId}>
              <button
                className="luca-mind-entry-row luca-mind-journal-row"
                data-new={fresh ? "true" : undefined}
                data-testid="mind-notebook-item"
                onClick={() => onOpen(item.itemId)}
                type="button"
              >
                <span className="luca-mind-entry-words">
                  <span className="type-eyebrow luca-mind-eyebrow">
                    {fresh ? <NewDot /> : null}
                    {notebookCategoryLabel(item.category)}
                  </span>
                  <span className="luca-mind-entry-text">
                    {notebookExcerpt(item.body, 280)}
                  </span>
                  <span className="luca-mind-meta">{meta}</span>
                </span>
                <time className="luca-mind-date" dateTime={item.updatedAt}>
                  {dayWord(item.updatedAt)}
                </time>
              </button>
            </li>
          );
        })}
      </ul>
      {notebook.hasMore ? (
        <button
          className="luca-mind-link"
          disabled={notebook.loadingMore}
          onClick={() => void notebook.loadMore()}
          type="button"
        >
          {notebook.loadingMore ? (
            <LoaderCircle aria-hidden className="animate-spin" />
          ) : null}
          Load older
        </button>
      ) : null}
    </>
  );
}

// ── Days: where they left off, then their days ─────────────────────────

type DaysFilter = "all" | "own" | "you";

/** Who an entry was for: with you, or on their own (their journal and
 *  what they keep are). */
const withYou = (entry: MindEntry) => entry.kind === "you";

/**
 * Days (Decided 7): "Where {name} left off" first, then the three latest
 * days, each entry its glyph, its words, on their own or with you, and the
 * time. Something made opens its piece; a conversation opens its room.
 * Continuity notes live in Notebook › Notes, so they aren't repeated here.
 */
export function MindDaysSection({
  days: stream,
  managedAgent,
  name,
  onOpenItem,
  onOpenPiece,
  pubkey,
  since,
}: {
  days: ReturnType<typeof useMindEntries>;
  managedAgent: ManagedAgent | null;
  name: string;
  onOpenItem: (itemId: string) => void;
  onOpenPiece: (artifactId: string) => void;
  /** Whose days these are, so a room's other minds leave them out. */
  pubkey: string | null;
  since: number | null;
}) {
  const [filter, setFilter] = React.useState<DaysFilter>("all");
  const [earlier, setEarlier] = React.useState(false);
  const { goChannel } = useAppNavigation();
  // Who else was in a room (Riley's call on Works with): the other minds
  // among its members, by the names the app gives them.
  const channels = useChannelsQuery();
  const agents = useManagedAgentsQuery();
  const othersIn = React.useMemo(() => {
    const self = pubkey ? normalizePubkey(pubkey) : null;
    const minds = new Map(
      (agents.data ?? []).map((agent) => [
        normalizePubkey(agent.pubkey),
        agent.name,
      ]),
    );
    return new Map(
      (channels.data ?? []).map((channel) => [
        channel.id,
        [
          ...new Set(
            [...channel.memberPubkeys, ...channel.participantPubkeys].map(
              normalizePubkey,
            ),
          ),
        ]
          .filter((key) => key !== self && minds.has(key))
          .map((key) => minds.get(key) as string),
      ]),
    );
  }, [agents.data, channels.data, pubkey]);
  // Their continuity notes live in Notebook › Notes, so they aren't said
  // again here; what they keep in their own memory (the relay's) is.
  const done = stream.entries.filter((entry) => !entry.id.startsWith("note:"));
  const shown = done.filter((entry) =>
    filter === "all"
      ? true
      : filter === "you"
        ? withYou(entry)
        : !withYou(entry),
  );
  const days = groupMindDays(shown, "all");
  const visible = earlier ? days : days.slice(0, 3);
  const hasEarlier = days.length > 3 || stream.hasMore;

  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const more = React.useEffectEvent(() => stream.more());
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !earlier || !stream.hasMore) return;
    const observer = new IntersectionObserver(
      (seen) => {
        if (seen.some((each) => each.isIntersecting)) more();
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [earlier, stream.hasMore]);

  return (
    <MindSection
      control={
        <MindChips<DaysFilter>
          label="Show"
          onChange={setFilter}
          options={[
            { id: "all", label: "All" },
            { id: "own", label: "On their own" },
            { id: "you", label: "With you" },
          ]}
          testIdPrefix="mind-filter"
          value={filter}
        />
      }
      testId="mind-days"
      title="Days"
    >
      {managedAgent ? (
        <MindHandoff name={name} residentPubkey={managedAgent.pubkey} />
      ) : null}
      {shown.length === 0 && stream.settled ? (
        <p
          className="luca-mind-help luca-mind-empty-line"
          data-testid="mind-days-empty"
        >
          {filter === "all"
            ? `${name}'s days will gather here: what they do with you and on their own.`
            : filter === "own"
              ? `Nothing ${name} did on their own yet.`
              : `Nothing ${name} did with you yet.`}
        </p>
      ) : null}
      {visible.map((day) => (
        <section aria-label={day.label} className="luca-mind-day" key={day.key}>
          <h3 className="type-eyebrow luca-mind-eyebrow">{day.label}</h3>
          <ul className="luca-mind-rows">
            {day.entries.map((entry) => (
              <DayRow
                entry={entry}
                fresh={isNewSince(entry.at, since)}
                key={entry.id}
                others={
                  entry.id.startsWith("talk:") && entry.channelId
                    ? (othersIn.get(entry.channelId) ?? [])
                    : []
                }
                onOpen={
                  entry.made
                    ? () => onOpenPiece((entry.made as StreamArtifact).id)
                    : entry.notebookItemId
                      ? () => onOpenItem(entry.notebookItemId as string)
                      : entry.channelId
                        ? () => void goChannel(entry.channelId as string)
                        : undefined
                }
              />
            ))}
          </ul>
        </section>
      ))}
      {hasEarlier && !earlier ? (
        <button
          className="luca-mind-link"
          data-testid="mind-earlier-days"
          onClick={() => setEarlier(true)}
          type="button"
        >
          Earlier days <ChevronRight aria-hidden />
        </button>
      ) : null}
      {earlier && stream.hasMore ? (
        <div aria-hidden className="luca-mind-more" ref={sentinelRef}>
          {stream.loading ? <LoaderCircle className="animate-spin" /> : null}
        </div>
      ) : null}
    </MindSection>
  );
}

/** A day entry's words: what they made and wrote, said as what happened;
 *  the rest is the record's own line. */
function dayWords(entry: MindEntry): string {
  if (entry.made) return `Made “${entry.made.title}”`;
  if (entry.kind === "journal")
    return `Wrote in their journal: “${entry.text}”`;
  return entry.text;
}

function DayRow({
  entry,
  fresh,
  onOpen,
  others,
}: {
  entry: MindEntry;
  fresh: boolean;
  onOpen?: () => void;
  /** The other minds in the room a talk entry happened in: plain words,
   *  since the whole row is one button. */
  others: readonly string[];
}) {
  const Glyph = KIND_GLYPH[entry.kind];
  const who = dayWhoLine(withYou(entry), others);
  const body = (
    <>
      <span
        aria-label={MIND_KIND_LABEL[entry.kind]}
        className="luca-mind-glyph"
        role="img"
      >
        <Glyph aria-hidden />
      </span>
      <span className="luca-mind-entry-words">
        <span className="luca-mind-entry-title">
          {fresh ? <NewDot /> : null}
          {dayWords(entry)}
        </span>
        <span className="luca-mind-meta">{who}</span>
      </span>
      <time
        className="luca-mind-date"
        dateTime={new Date(entry.at).toISOString()}
      >
        {entryTime(entry.at)}
      </time>
    </>
  );
  return (
    <li data-kind={entry.kind} data-testid="mind-entry">
      {onOpen ? (
        <button
          className="luca-mind-entry-row luca-mind-day-row"
          data-new={fresh ? "true" : undefined}
          onClick={onOpen}
          type="button"
        >
          {body}
        </button>
      ) : (
        <div
          className="luca-mind-entry-row luca-mind-day-row"
          data-new={fresh ? "true" : undefined}
        >
          {body}
        </div>
      )}
    </li>
  );
}

/**
 * Where they left off (Decided 7): the saved handoff as an opener, a row
 * that says when it was saved, with Show and a chevron that turns, opening
 * to its parts and today's controls (correct, forget, its sources, the
 * switch).
 */
function MindHandoff({
  name,
  residentPubkey,
}: {
  name: string;
  residentPubkey: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<ResidentContinuityInspector | null>(
    null,
  );
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    getResidentContinuity(residentPubkey)
      .then((next) => {
        if (live) setData(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [residentPubkey]);
  const handoff = data?.handoff ?? null;
  const line = handoff
    ? `Saved ${savedWhen(handoff.updatedAt)} · revision ${handoff.revision}${handoff.pinnedOwnerCorrection ? " · corrected by you" : ""}`
    : failed
      ? "Couldn't read the saved handoff."
      : !data
        ? " "
        : data.enabled
          ? `Nothing saved yet. ${name} keeps one after real work.`
          : `Off. ${name} keeps no handoff.`;
  const panelId = `mind-handoff-${residentPubkey}`;
  return (
    <div className="luca-mind-box luca-mind-leftoff">
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className="luca-mind-opener"
        data-testid="mind-handoff-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="luca-mind-entry-words">
          <span className="luca-mind-row-title">Where {name} left off</span>
          <span className="luca-mind-meta" data-testid="mind-handoff-line">
            {line}
          </span>
        </span>
        <span className="luca-mind-opener-end">
          {open ? "Hide" : "Show"}
          <ChevronRight aria-hidden />
        </span>
      </button>
      {open ? (
        <div
          className="luca-mind-opened"
          data-testid="mind-handoff"
          id={panelId}
        >
          <ResidentHandoffPanel
            onData={setData}
            residentPubkey={residentPubkey}
            variant="space"
          />
        </div>
      ) : null}
    </div>
  );
}

/** "today at 7:58 AM", "yesterday at 9:12 PM", else the date and time. */
function savedWhen(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.valueOf())) return "recently";
  const time = at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const word = dayWord(value);
  if (word === "Today") return `today at ${time}`;
  if (word === "Yesterday") return `yesterday at ${time}`;
  return `${word} at ${time}`;
}
