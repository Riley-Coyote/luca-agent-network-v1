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
import {
  notebookAvailabilityCopy,
  notebookCategoryLabel,
  notebookCountWhenComplete,
  notebookExcerpt,
  notebookTimestamp,
} from "@/features/profile/ui/notebook/notebookPresentation";
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
  const [view, setView] = React.useState<NotebookView>("notes");
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

  const openItem = async (itemId: string) => {
    if (!managedAgent) return;
    setOpenError(null);
    try {
      const next = await getResidentNotebookItem(managedAgent.pubkey, itemId);
      if (next.item) setDetail(next);
      else setOpenError("That notebook item is no longer available.");
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // Continuity notes, journal pages, their days (BETA14_RELEASE.md WP-40,
  // Decided 3): notes and pages are the notebook's, so a mind not on this
  // Mac has only its days.
  const views: { id: NotebookView; label: string; count?: number | null }[] =
    managedAgent
      ? [
          {
            id: "notes",
            label: "Continuity notes",
            count: notebook.countOf("memory_note"),
          },
          {
            id: "journal",
            label: "Journal pages",
            count: notebook.countOf("journal_page"),
          },
          { id: "days", label: "Their days" },
        ]
      : [{ id: "days", label: "Their days" }];
  const shown = views.some((each) => each.id === view) ? view : "days";

  return (
    <div className="luca-mind-notebook" data-testid="mind-notebook">
      <p className="luca-mind-intro">
        What {name} keeps between conversations. A saved note is there for
        later; each turn's receipt says what {name} actually used.
      </p>
      {managedAgent && onThisMac ? (
        <ResidentPlaceSection
          residentName={name}
          residentPubkey={managedAgent.pubkey}
          variant="space"
        />
      ) : null}
      {pubkey ? <MindAsks name={name} residentPubkey={pubkey} /> : null}
      {managedAgent ? (
        <MindHandoff name={name} residentPubkey={managedAgent.pubkey} />
      ) : null}
      <section aria-label="Notes and pages" className="luca-mind-section">
        <div className="luca-mind-subbar">
          <div
            aria-label="Notebook"
            className="luca-mind-subtabs"
            role="tablist"
          >
            {views.map((each, index) => (
              <button
                aria-selected={shown === each.id}
                className="luca-mind-subtab"
                data-selected={shown === each.id ? "true" : undefined}
                data-testid={`mind-view-${each.id}`}
                key={each.id}
                onClick={() => setView(each.id)}
                onKeyDown={(event) => {
                  const step =
                    event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  if (!step) return;
                  event.preventDefault();
                  const next =
                    views[(index + step + views.length) % views.length];
                  if (!next) return;
                  setView(next.id);
                  const bar = event.currentTarget.parentElement;
                  bar
                    ?.querySelector<HTMLButtonElement>(
                      `[data-testid="mind-view-${next.id}"]`,
                    )
                    ?.focus();
                }}
                role="tab"
                tabIndex={shown === each.id ? 0 : -1}
                type="button"
              >
                {each.label}
                {typeof each.count === "number" ? (
                  <span className="luca-mind-count">{each.count}</span>
                ) : null}
              </button>
            ))}
          </div>
          {managedAgent && shown === "journal" ? (
            <button
              className="luca-mind-button"
              data-testid="mind-new-page"
              disabled={journalBusy}
              onClick={() => setCreating(true)}
              type="button"
            >
              <Plus aria-hidden /> New page
            </button>
          ) : null}
        </div>
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
          <div className="luca-mind-form" ref={formRef}>
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
        <div
          role="tabpanel"
          aria-label={views.find((each) => each.id === shown)?.label}
        >
          {shown === "days" ? (
            <MindDays
              name={name}
              notebook={notebook}
              onOpenItem={(itemId) => void openItem(itemId)}
              pubkey={pubkey}
              readMemory={Boolean(managedAgent)}
            />
          ) : (
            <NotebookItems
              kind={shown === "notes" ? "memory_note" : "journal_page"}
              name={name}
              notebook={notebook}
              onOpen={(itemId) => void openItem(itemId)}
            />
          )}
        </div>
      </section>
    </div>
  );
}

type NotebookView = "notes" | "journal" | "days";

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
 * Continuity notes or journal pages (WP-40, Decided 3), each entry its kind
 * as a label, its words, a line of who wrote it, its revision and its
 * sources, and a date. Each opens, as the classic Notebook's rows do, to be
 * read, corrected, annotated, archived or forgotten.
 */
function NotebookItems({
  kind,
  name,
  notebook,
  onOpen,
}: {
  kind: "memory_note" | "journal_page";
  name: string;
  notebook: NotebookStream;
  onOpen: (itemId: string) => void;
}) {
  const items = notebook.items.filter((item) => item.kind === kind);
  const isPage = kind === "journal_page";
  if (!notebook.settled) return <div className="luca-mind-more" />;
  if (items.length === 0) {
    const copy =
      notebook.availability === "locked" ||
      notebook.availability === "unavailable"
        ? notebookAvailabilityCopy(
            notebook.availability,
            isPage ? "pages" : "notes",
          )
        : isPage
          ? {
              title: "No journal pages yet",
              body: `Pages ${name} writes for themselves, when you ask for one. They stay out of your conversations unless you choose one.`,
            }
          : {
              title: "No continuity notes yet",
              body: `After a meaningful exchange, ${name} may keep a short note, with where it came from, for later conversations.`,
            };
    return (
      <div
        className="luca-mind-empty"
        data-testid={`mind-${isPage ? "journal" : "notes"}-empty`}
      >
        <p className="luca-mind-empty-title">{copy.title}</p>
        <p className="luca-mind-help">{copy.body}</p>
      </div>
    );
  }
  const Glyph = isPage ? NotebookPen : Bookmark;
  return (
    <>
      <ul
        className="luca-mind-rows"
        data-testid={`mind-${isPage ? "journal" : "notes"}`}
      >
        {items.map((item) => {
          const sources =
            item.sourceEventIds.length + item.sourcePageIds.length;
          const meta = [
            item.authorship === "owner"
              ? "Written by you"
              : `Written by ${name}`,
            item.pinnedOwnerCorrection ? "pinned" : null,
            `revision ${item.revision}`,
            sources > 0 ? `${sources} source${sources === 1 ? "" : "s"}` : null,
            item.status !== "active" ? item.status : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={item.itemId}>
              <button
                className="luca-mind-entry-row"
                data-testid="mind-notebook-item"
                onClick={() => onOpen(item.itemId)}
                type="button"
              >
                <span aria-hidden className="luca-mind-glyph">
                  <Glyph />
                </span>
                <span className="luca-mind-entry-words">
                  <span className="type-eyebrow luca-mind-eyebrow">
                    {isPage
                      ? "Journal page"
                      : notebookCategoryLabel(item.category)}
                  </span>
                  {isPage ? (
                    <>
                      <span className="luca-mind-entry-title">
                        {item.title || "Untitled page"}
                      </span>
                      {item.body.trim() ? (
                        <span className="luca-mind-excerpt">
                          {notebookExcerpt(item.body, 180)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="luca-mind-entry-text">
                      {notebookExcerpt(item.body, 280)}
                    </span>
                  )}
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
          className="luca-mind-button luca-mind-older"
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

/**
 * The saved handoff, as an opener (WP-40, Decided 3): a row that says when
 * it was saved, with Show and a chevron that turns, opening to its parts
 * and today's controls (correct, forget, its sources, the switch).
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
        ? "\u00a0"
        : data.enabled
          ? `Nothing saved yet. ${name} keeps one after real work.`
          : `Off. ${name} keeps no handoff.`;
  const panelId = `mind-handoff-${residentPubkey}`;
  return (
    <section aria-label="Saved handoff" className="luca-mind-section">
      <div className="luca-mind-box">
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className="luca-mind-opener"
          data-testid="mind-handoff-toggle"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span aria-hidden className="luca-mind-glyph">
            <Bookmark />
          </span>
          <span className="luca-mind-entry-words">
            <span className="luca-mind-row-title">Saved handoff</span>
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
    </section>
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

  const countOf = React.useCallback(
    (kind: ResidentNotebookItem["kind"]) =>
      list
        ? notebookCountWhenComplete(
            list.items,
            list.nextCursor,
            (item) => item.kind === kind,
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

/** What they're asking you (Decided 3), each ask in the one row Needs you
 *  uses (WP-09b, Decided 1), answered in place the same way. The space is
 *  theirs, so the line under an ask says only where it was asked. */
function MindAsks({
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
  // Nothing waiting: the part says what it will hold (WP-40, Decided 3).
  if (keys.length === 0)
    return (
      <section
        aria-label="What they're asking you"
        className="luca-mind-section"
        data-testid="mind-asks"
      >
        <h2 className="luca-mind-h2">Asks you</h2>
        <div className="luca-mind-empty" data-testid="mind-asks-empty">
          <p className="luca-mind-empty-title">Nothing waiting on you</p>
          <p className="luca-mind-help">
            When {name} needs an answer or your go-ahead, the question waits
            here and in Needs you.
          </p>
        </div>
      </section>
    );
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
      className="luca-mind-section luca-mind-asks"
      data-testid="mind-asks"
    >
      <h2 className="luca-mind-h2">
        Asks you <span className="luca-mind-count">{keys.length}</span>
      </h2>
      <ul
        className="luca-ask-list luca-place-plate luca-mind-box"
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
  name,
  notebook,
  onOpenItem,
  pubkey,
  readMemory,
}: {
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
      <div className="luca-mind-empty" data-testid="mind-notebook-empty">
        <p className="luca-mind-empty-title">Nothing in their days yet</p>
        <p className="luca-mind-help">{emptyDaysLine(name)}</p>
      </div>
    ) : null;

  return (
    <div className="luca-mind-days">
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
      ) : null}
      {empty}
      {days.map((day) => (
        <section aria-label={day.label} className="luca-mind-day" key={day.key}>
          <h3 className="type-eyebrow luca-mind-eyebrow">
            {day.label}
            <span className="luca-mind-count">{day.entries.length}</span>
          </h3>
          <ul className="luca-mind-rows">
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
    </div>
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
      className="luca-mind-entry-row luca-mind-day-row"
      data-kind={entry.kind}
      data-testid="mind-entry"
    >
      <span
        aria-label={MIND_KIND_LABEL[entry.kind]}
        className="luca-mind-glyph"
        role="img"
      >
        <Glyph aria-hidden />
      </span>
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
        <span className="luca-mind-meta">{MIND_KIND_LABEL[entry.kind]}</span>
      </div>
      <time
        className="luca-mind-date"
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
