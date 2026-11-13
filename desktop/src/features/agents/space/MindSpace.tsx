import * as React from "react";
import { useRouter } from "@tanstack/react-router";
import { CircleAlert, Play, RotateCcw, Settings } from "lucide-react";

import "@/app/shell/shell-mind-space.css";
import { takeHistoryStep } from "@/app/navigation/leaveGuard";
import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import {
  mindStateLabel,
  useMindState,
} from "@/features/agents/lib/useMindState";
import { useRunningRuntimeTask } from "@/features/capabilities/useAllRuntimeTasks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  namesAsList,
  runtimeLabel,
} from "@/features/exchange/sideConversations";
import { useSideConversations } from "@/features/exchange/useSideConversations";
import { AgentInboxMenu } from "@/features/exchange/ui/AgentInboxMenu";
import { ResidentNotebookDetailView } from "@/features/profile/ui/notebook/ResidentNotebookDetailView";
import { LogsSheet } from "@/features/agents/ui/AgentLibraryWorkspace";
import type { ResidentSummaryViewModel } from "@/features/agents/ui/agentLibraryViewModel";
import { setCompanionWork } from "@/shared/api/companion";
import {
  getResidentNotebookItem,
  type ResidentNotebookDetail,
} from "@/shared/api/tauriNotebook";
import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import { AgentDendrite } from "@/shared/ui/dendrite/AgentDendrite";
import {
  awayOn,
  awayReason,
  followedWork,
  hasAwareness,
  isNoticing,
  namesAnd,
  useCompanionOperate,
  useMindCompanion,
} from "./mindCompanion";
import {
  MindMadePage,
  MindMadeSection,
  MindPiecePage,
  pinnedFirst,
} from "./MindMade";
import {
  MindAsks,
  MindDaysSection,
  MindNotebookSection,
  useMadeBy,
  useMindEntries,
  useResidentNotebookStream,
} from "./MindNotebook";
import { MindPlaceProvider, useMindPlace } from "./mindPlaceContext";
import { harnessLabel } from "./mindRunsOn";
import {
  mindBackLabel,
  mindPageDepth,
  mindPageParent,
  mindPageWord,
  type MindPage,
} from "./mindSection";
import { MindSettingsPage } from "./MindSettings";
import { MindMnemos } from "./MindMnemos";
import { MindRow } from "./MindPageKit";
import { setMindPageTitle } from "./mindPageTitle";
import { arrivedByStep, useArrivalPlacement } from "./mindScroll";
import { lastVisitOf, recordVisit } from "./mindVisits";

/** The specimen's box, for the lab's 52 body (WP-40): it draws its body at
 *  29 of 40 of its box. */
const MARK_SIZE = 72;

type Actions = {
  actionErrorMessage: string | null;
  actionNoticeMessage: string | null;
  channels: Array<{ id: string; name: string }>;
  isActionPending: boolean;
  managedAgent: ManagedAgent | null;
  onEdit: () => void;
  onMessage: () => void;
  onOpenChannel: (channelId: string) => void;
  /** Restarts them; the page shows it pending until it settles. */
  onRestart: () => Promise<unknown> | undefined;
  /** Their restart is under way (WP-43, round 3). */
  restarting?: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleStartOnLaunch: (enabled: boolean) => void;
  persona: AgentPersona | null;
  resident: ResidentSummaryViewModel;
};

/**
 * A mind's two places (BETA14_RELEASE.md WP-43): their page is theirs (what
 * they write, make and do); Settings is yours (everything you decide).
 * Everything else is a page that slides in over their page, in the same
 * frame, with a back link naming where you came from; the address holds
 * where you are, so the title bar's arrows, Esc, ⌘[ and ⌘] walk it.
 */
export function MindSpace({
  onPage,
  page,
  ...props
}: Actions & {
  onPage: (page: MindPage, options?: { replace?: boolean }) => void;
  page: MindPage;
}) {
  return (
    <MindPlaceProvider
      residentPubkey={
        props.managedAgent?.backend.type === "local"
          ? props.managedAgent.pubkey
          : null
      }
    >
      <MindFrame onPage={onPage} page={page} {...props} />
    </MindPlaceProvider>
  );
}

function MindFrame({
  onPage,
  page,
  ...props
}: Actions & {
  onPage: (page: MindPage, options?: { replace?: boolean }) => void;
  page: MindPage;
}) {
  const { managedAgent, resident } = props;
  const name = resident.displayName;
  const router = useRouter();
  const [logsOpen, setLogsOpen] = React.useState(false);
  // A restart shows while it's under way, wherever you started it: the
  // button says so and the status line too, then both settle.
  const [restarting, setRestarting] = React.useState(false);
  const runRestart = props.onRestart;
  const onRestart = React.useCallback(async () => {
    setRestarting(true);
    try {
      await runRestart();
    } finally {
      setRestarting(false);
    }
  }, [runRestart]);
  const actions = { ...props, onRestart, restarting };
  const word = mindPageWord(page) ?? "";
  const pubkey = resident.pubkey;

  // New since your last visit (Decided 8): the time you last looked is read
  // once, as this visit begins; the visit itself is kept at once, so the
  // rail's dot goes while this page's dots stay until the next visit.
  const { activeCommunity } = useCommunities();
  const scope = activeCommunity?.id ?? null;
  const [since, setSince] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!scope || !pubkey) return;
    setSince(lastVisitOf(scope, pubkey));
    recordVisit(scope, pubkey);
  }, [pubkey, scope]);

  // Which pages were pushed from their parent in this visit: the back link
  // then walks the same history the title bar's arrows walk; a page reached
  // straight from the address goes to its parent in place.
  const pushed = React.useRef(new Map<string, string>());
  const go = React.useCallback(
    (next: MindPage) => {
      const nextWord = mindPageWord(next) ?? "";
      pushed.current.set(nextWord, word);
      onPage(next);
    },
    [onPage, word],
  );
  const back = React.useCallback(() => {
    const parent = mindPageParent(page);
    if (!parent) return;
    const parentWord = mindPageWord(parent) ?? "";
    if (pushed.current.get(word) === parentWord)
      takeHistoryStep((options) => router.history.back(options));
    else onPage(parent, { replace: true });
  }, [onPage, page, router.history, word]);

  // Esc goes back, as ⌘[ does (the app's own keys walk the history); never
  // while a dialog, a menu or a sheet holds the key.
  const backOnEscape = React.useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (mindPageDepth(page) === 0) return;
    if (
      document.querySelector(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      )
    )
      return;
    event.preventDefault();
    back();
  });
  React.useEffect(() => {
    const listener = (event: KeyboardEvent) => backOnEscape(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // The push (Decided 2): deeper slides in from the right, shallower from
  // the left; on arrival the page's title takes focus, and the scroll comes
  // back to where it was on a page you return to.
  const depth = mindPageDepth(page);
  const lastDepth = React.useRef(depth);
  const direction =
    depth > lastDepth.current
      ? "forward"
      : depth < lastDepth.current
        ? "back"
        : "none";
  const titleRef = React.useRef<HTMLHeadingElement | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const arrived = React.useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `word` names the page; each new one's title takes focus.
  React.useLayoutEffect(() => {
    lastDepth.current = depth;
    if (arrived.current) titleRef.current?.focus({ preventScroll: true });
    arrived.current = true;
  }, [depth, word]);

  // Fresh moves start at the top, steps come back to where the page was,
  // and a fresh arrival's title takes focus (mindScroll.ts, round 4).
  const rememberHere = useArrivalPlacement(scrollerRef, titleRef);

  // The title bar says where you are (BETA14_RELEASE.md WP-43, the title
  // bar): "{name}" on their page, "{name} · {this page's title}" on a page
  // pushed from it, read from the title this page draws, as it arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `word` names the page; a new one is read afresh.
  React.useEffect(() => {
    if (!pubkey || page.kind === "place") {
      setMindPageTitle(null);
      return;
    }
    const read = () => {
      const text = titleRef.current?.textContent?.trim();
      setMindPageTitle(text ? { pubkey, title: text } : null);
    };
    read();
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new MutationObserver(read);
    observer.observe(scroller, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [page.kind, pubkey, word]);
  React.useEffect(() => () => setMindPageTitle(null), []);

  return (
    <div
      className="luca-place-page luca-mind"
      data-mind-page={page.kind}
      data-testid="mind-space"
      onScroll={(event) => rememberHere(event.currentTarget.scrollTop)}
      ref={scrollerRef}
    >
      <div className="luca-place-page-axis">
        <div className="luca-mind-push" data-dir={direction} key={word}>
          {page.kind === "place" ? (
            <MindPlace
              {...actions}
              notebook={page.notebook ?? null}
              onGo={go}
              since={since}
              titleRef={titleRef}
            />
          ) : page.kind === "mnemos" ? (
            <MindMnemos
              key={managedAgent?.pubkey ?? "none"}
              name={name}
              onBack={back}
              resident={
                managedAgent?.backend.type === "local"
                  ? managedAgent.pubkey
                  : null
              }
              titleRef={titleRef}
            />
          ) : page.kind === "made" || page.kind === "piece" ? (
            <MindMadePages
              back={back}
              backLabel={mindBackLabel(page, name) ?? name}
              go={go}
              page={page}
              resident={resident}
              since={since}
              titleRef={titleRef}
            />
          ) : (
            <MindSettingsPage
              {...actions}
              backLabel={mindBackLabel(page, name) ?? name}
              onBack={back}
              onGo={go}
              onOpenLogs={() => setLogsOpen(true)}
              page={page}
              titleRef={titleRef}
            />
          )}
        </div>
      </div>
      {managedAgent ? (
        <LogsSheet
          agent={managedAgent}
          onOpenChange={setLogsOpen}
          open={logsOpen}
        />
      ) : null}
    </div>
  );
}

/** Made and a piece read the same list as their page's tiles. */
function MindMadePages({
  back,
  backLabel,
  go,
  page,
  resident,
  since,
  titleRef,
}: {
  back: () => void;
  backLabel: string;
  go: (page: MindPage) => void;
  page: Extract<MindPage, { kind: "made" | "piece" }>;
  resident: ResidentSummaryViewModel;
  since: number | null;
  titleRef: React.Ref<HTMLHeadingElement>;
}) {
  const made = useMadeBy(resident.pubkey);
  const place = useMindPlace()?.place ?? null;
  if (page.kind === "made")
    return (
      <MindMadePage
        name={resident.displayName}
        onBack={back}
        onOpenPiece={(artifactId) =>
          go({ kind: "piece", artifactId, from: "made" })
        }
        pieces={made.pieces}
        place={place}
        since={since}
        titleRef={titleRef}
      />
    );
  const ordered = pinnedFirst(made.pieces, place);
  const found = ordered.find(({ piece }) => piece.id === page.artifactId);
  if (!found && !made.settled) return null;
  return (
    <MindPiecePage
      backLabel={backLabel}
      name={resident.displayName}
      onBack={back}
      piece={found?.piece ?? null}
      pinned={Boolean(found?.pinned)}
      residentPubkey={resident.pubkey}
      titleRef={titleRef}
    />
  );
}

/**
 * Their page (Decided 4–9): one header, what they ask you or what's wrong,
 * their words, then Made, Notebook and Days, built alike. A new mind with
 * nothing yet gets one box in place of the three.
 */
function MindPlace({
  notebook: notebookAt,
  onGo,
  since,
  titleRef,
  ...props
}: Actions & {
  /** A way in that names their Notebook: brought into view, on Pages when
   *  it says so. */
  notebook: "open" | "pages" | null;
  onGo: (page: MindPage) => void;
  since: number | null;
  titleRef: React.Ref<HTMLHeadingElement>;
}) {
  const { managedAgent, resident } = props;
  const name = resident.displayName;
  const pubkey = resident.pubkey;
  const notebook = useResidentNotebookStream(managedAgent?.pubkey ?? null);
  const made = useMadeBy(pubkey);
  const days = useMindEntries({
    made,
    notebook,
    pubkey,
    readMemory: Boolean(managedAgent),
  });
  const placeState = useMindPlace();
  const place = placeState?.place ?? null;
  const [detail, setDetail] = React.useState<ResidentNotebookDetail | null>(
    null,
  );
  const [openError, setOpenError] = React.useState<string | null>(null);

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

  // Brought into view once it is drawn.
  const notebookSeen = React.useRef(false);
  React.useEffect(() => {
    if (!notebookAt || notebookSeen.current) return;
    // A step back to it comes back to where it was instead.
    if (arrivedByStep()) {
      notebookSeen.current = true;
      return;
    }
    const section = document.querySelector('[data-testid="mind-notebook"]');
    if (!section) return;
    notebookSeen.current = true;
    section.scrollIntoView({ block: "start" });
  });

  const intro = place?.content.introduction.trim() ?? "";
  const exploring = place?.content.exploration.trim() ?? "";
  const written = notebook.items.some((item) => item.status === "active");
  const nothingYet =
    days.settled &&
    !placeState?.loading &&
    !intro &&
    !exploring &&
    !place?.content.selectedWork &&
    made.pieces.length === 0 &&
    !written &&
    days.entries.length === 0;

  const header = <MindHeader {...props} onGo={onGo} titleRef={titleRef} />;

  if (detail?.item && managedAgent)
    return (
      <>
        {header}
        <div className="luca-mind-detail">
          <ResidentNotebookDetailView
            detail={detail}
            onBack={() => {
              setDetail(null);
              void notebook.refresh();
            }}
            onChanged={async (next) => {
              setDetail(next.item ? next : null);
              await notebook.refresh();
            }}
            residentPubkey={managedAgent.pubkey}
            voice={{ residentName: name }}
          />
        </div>
      </>
    );

  return (
    <div data-testid="mind-place">
      {header}
      <MindUnder {...props} />
      {props.actionErrorMessage ? (
        <div className="luca-mind-alert" role="alert">
          <CircleAlert aria-hidden />
          <span>{props.actionErrorMessage}</span>
        </div>
      ) : props.actionNoticeMessage ? (
        <p className="luca-mind-quiet" role="status">
          {props.actionNoticeMessage}
        </p>
      ) : null}
      {placeState ? (
        <MindWords
          editing={Boolean(place?.residentEditingEnabled)}
          exploring={exploring}
          intro={intro}
          name={name}
          onLetThem={() => void placeState.toggleEditing()}
          onWrite={() => onGo({ kind: "pane", pane: "words" })}
          ready={Boolean(place)}
        />
      ) : null}
      {openError ? (
        <p className="luca-mind-error" role="alert">
          {openError}
        </p>
      ) : null}
      {nothingYet ? (
        <MindEmptyPlace
          harness={harnessLabel(resident)}
          managedAgent={managedAgent}
          name={name}
          onMessage={props.onMessage}
          onStart={props.onStart}
        />
      ) : (
        <div className="luca-mind-parts">
          <MindMadeSection
            name={name}
            onOpenAll={() => onGo({ kind: "made" })}
            onOpenPiece={(artifactId) =>
              onGo({ kind: "piece", artifactId, from: "place" })
            }
            pieces={made.pieces}
            place={place}
            settled={made.settled}
            since={since}
          />
          <MindNotebookSection
            managedAgent={managedAgent}
            name={name}
            notebook={notebook}
            onOpenItem={(itemId) => void openItem(itemId)}
            onOpenReading={(doc) => onGo({ kind: "reading", doc })}
            openOnPages={notebookAt === "pages"}
            since={since}
          />
          <MindDaysSection
            days={days}
            managedAgent={managedAgent}
            name={name}
            onOpenItem={(itemId) => void openItem(itemId)}
            onOpenPiece={(artifactId) =>
              onGo({ kind: "piece", artifactId, from: "place" })
            }
            pubkey={pubkey}
            since={since}
          />
        </div>
      )}
      {managedAgent?.backend.type === "local" ? (
        <MindRow
          label="Mnemos"
          help="Read this resident’s memory."
          onOpen={() => onGo({ kind: "mnemos" })}
          testId="mind-open-mnemos"
        />
      ) : null}
    </div>
  );
}

/** Their words (Decided 6): the introduction in ink, then what they're
 *  exploring; with none, the line that says how one gets written. */
function MindWords({
  editing,
  exploring,
  intro,
  name,
  onLetThem,
  onWrite,
  ready,
}: {
  editing: boolean;
  exploring: string;
  intro: string;
  name: string;
  onLetThem: () => void;
  onWrite: () => void;
  ready: boolean;
}) {
  if (!ready) return null;
  return (
    <div className="luca-mind-words" data-testid="mind-words">
      {intro ? (
        <p
          className="luca-mind-intro-text"
          data-testid="resident-place-introduction"
        >
          {intro}
        </p>
      ) : (
        <p className="luca-mind-help" data-testid="mind-no-intro">
          {name} hasn't written an introduction yet.{" "}
          <button className="luca-mind-inline" onClick={onWrite} type="button">
            Write one
          </button>
          {editing ? (
            "."
          ) : (
            <>
              {" or "}
              <button
                className="luca-mind-inline"
                data-testid="mind-let-them-write"
                onClick={onLetThem}
                type="button"
              >
                let {name} write it
              </button>
              .
            </>
          )}
        </p>
      )}
      {exploring ? (
        <p
          className="luca-mind-exploring"
          data-testid="resident-place-exploration"
        >
          <span className="type-eyebrow luca-mind-eyebrow">Exploring</span>
          <span>{exploring}</span>
        </p>
      ) : null}
    </div>
  );
}

/** A new mind with nothing yet (Decided 9): one box in place of the three
 *  sections, and two ways to begin. */
function MindEmptyPlace({
  harness,
  managedAgent,
  name,
  onMessage,
  onStart,
}: {
  harness: string;
  managedAgent: ManagedAgent | null;
  name: string;
  onMessage: () => void;
  onStart: () => void;
}) {
  const companion = useMindCompanion(managedAgent?.pubkey ?? null);
  const { error, operate, pending } = useCompanionOperate(
    managedAgent?.pubkey ?? null,
  );
  const [reviewing, setReviewing] = React.useState(false);
  const loaded = companion.data;
  const already = Boolean(loaded && awayOn(loaded));
  // The real reason, in the header's words, and the fix beside it (WP-43,
  // round 3): when it can't be used it isn't the main action.
  const reason = awayReason({
    channelAvailable: Boolean(loaded?.work.nativeChannelAvailable),
    harness,
    managed: Boolean(managedAgent),
    name,
    running:
      managedAgent?.status === "running" || managedAgent?.status === "deployed",
  });
  const giveTime = !already && reason.kind === "ready" && Boolean(loaded);
  return (
    <div
      className="luca-mind-box luca-mind-empty-place"
      data-testid="mind-empty-place"
    >
      <p className="luca-mind-empty-title">{name}'s place is empty for now</p>
      <p className="luca-mind-help">
        What {name} makes, writes and does will live here: things they make on
        their own or for you, their journal, and their days.
      </p>
      {reviewing && loaded ? (
        <div className="luca-mind-consent" data-testid="mind-away-review">
          <p className="luca-mind-help">
            Allow bounded local creations and private inquiries? Work may use
            your existing harness allowance. There is no required output quota.
          </p>
          <div className="luca-mind-actions">
            <button
              className="luca-mind-button"
              disabled={pending}
              onClick={() =>
                void operate((resident, data) =>
                  setCompanionWork(resident, data.work, true, false),
                ).then(() => setReviewing(false))
              }
              type="button"
            >
              Allow background work
            </button>
            <button
              className="luca-mind-inline"
              onClick={() => setReviewing(false)}
              type="button"
            >
              Not now
            </button>
          </div>
        </div>
      ) : giveTime ? (
        <div className="luca-mind-actions">
          <button
            className="luca-mind-button"
            data-testid="mind-give-time"
            disabled={pending}
            onClick={() => setReviewing(true)}
            type="button"
          >
            Give {name} time of their own
          </button>
          <button
            className="luca-mind-inline"
            data-testid="mind-start-conversation"
            onClick={onMessage}
            type="button"
          >
            or start a conversation
          </button>
        </div>
      ) : (
        <>
          <div className="luca-mind-actions">
            {managedAgent ? (
              <button
                className="luca-mind-button"
                data-testid="mind-start-conversation"
                onClick={onMessage}
                type="button"
              >
                Start a conversation
              </button>
            ) : null}
            {reason.kind === "setup" ? (
              <button
                className="luca-mind-button"
                data-testid="mind-away-fix"
                onClick={onStart}
                type="button"
              >
                {reason.action}
              </button>
            ) : null}
          </div>
          {!already && reason.kind !== "ready" ? (
            <p
              className="luca-mind-meta luca-mind-away-reason"
              data-reason={reason.kind}
              data-testid="mind-away-reason"
            >
              {reason.text}
              {reason.kind === "stopped" ? (
                <>
                  {" "}
                  <button
                    className="luca-mind-inline"
                    data-testid="mind-away-fix"
                    onClick={onStart}
                    type="button"
                  >
                    {reason.action}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p className="luca-mind-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Under the header (Decided 5): their asks in one thin border, and when
 *  something's wrong, one notice with Restart or Retry. */
function MindUnder({ managedAgent, onRestart, onStart, resident }: Actions) {
  const name = resident.displayName;
  const isRunning =
    managedAgent?.status === "running" || managedAgent?.status === "deployed";
  const wrong = managedAgent?.lastError || managedAgent?.needsRestart;
  const restartFirst =
    managedAgent?.needsRestart &&
    managedAgent.backend.type === "local" &&
    isRunning;
  return (
    <>
      {resident.pubkey ? (
        <MindAsks name={name} residentPubkey={resident.pubkey} />
      ) : null}
      {wrong ? (
        <div
          className="luca-mind-box luca-mind-notice"
          data-testid="mind-notice"
          role="alert"
        >
          <CircleAlert aria-hidden />
          <span className="luca-mind-notice-words">
            {managedAgent?.lastError ??
              `A change waits for ${name} to restart.`}
          </span>
          <button
            className="luca-mind-button"
            onClick={restartFirst ? onRestart : onStart}
            type="button"
          >
            <RotateCcw aria-hidden />
            {restartFirst ? "Restart" : "Retry"}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** "12 min", "2 h": how long something has run. */
function runningFor(startedAt: string, now: number = Date.now()): string {
  const at = Date.parse(startedAt);
  if (Number.isNaN(at)) return "";
  const minutes = Math.max(1, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/**
 * The header (Decided 4): their fingerprint and name; one status line of
 * what they're doing, with the breathing dot while they're live; a
 * companion at rest adds what it keeps up with; the harness under it; Talk
 * and Settings at the right.
 */
function MindHeader({
  isActionPending,
  managedAgent,
  onGo,
  onMessage,
  onStart,
  resident,
  restarting,
  titleRef,
}: Actions & {
  onGo: (page: MindPage) => void;
  titleRef: React.Ref<HTMLHeadingElement>;
}) {
  const agentWorking = useAgentWorking(resident.pubkey);
  const channelsQuery = useChannelsQuery();
  const task = useRunningRuntimeTask(resident.pubkey);
  const state = useMindState(resident.pubkey, {
    availability: resident.availability,
    lastError: managedAgent?.lastError,
    waking: Boolean(managedAgent?.waking),
  });
  const side = useSideConversations();
  const companion = useMindCompanion(managedAgent?.pubkey ?? null);
  const key = resident.pubkey?.toLowerCase() ?? null;
  const talk =
    state === "talking" && key
      ? (side.items.find(
          (item) =>
            item.kind === "exchange" &&
            item.live &&
            (item.openedBy === key || item.members.includes(key)),
        ) ?? null)
      : null;
  const now = React.useMemo(() => {
    const members = new Set(
      (channelsQuery.data ?? [])
        .filter((channel) => channel.isMember)
        .map((channel) => channel.id),
    );
    // Their own work is work in a room you aren't in: the one rule the
    // stream tells their own from yours by (mindStream.forYouOrOwn).
    const theirOwn = (conversationId: string | null | undefined) =>
      Boolean(conversationId) && !members.has(conversationId as string);
    if (state === "working") {
      if (agentWorking.working && agentWorking.channels.length > 0) {
        const ids = agentWorking.channels.map((each) => each.channelId);
        const own = ids.every((id) => theirOwn(id));
        if (ids.length > 1)
          return `${own ? "On their own · " : ""}Working in ${ids.length} conversations`;
        const channel = channelsQuery.data?.find((each) => each.id === ids[0]);
        const where = channel
          ? `Working in ${channel.name}`
          : "Working in one conversation";
        return own ? `On their own · ${where}` : where;
      }
      if (task) {
        if (theirOwn(task.conversationId))
          return ["On their own", task.summary, runningFor(task.startedAt)]
            .filter(Boolean)
            .join(" · ");
        return `Working with ${runtimeLabel(task.runtimeFamily)} · ${task.summary}`;
      }
    }
    if (talk && talk.kind === "exchange" && key) {
      const others = [talk.openedBy, ...talk.members]
        .filter(
          (member, index, all) =>
            member !== key && all.indexOf(member) === index,
        )
        .map(side.nameOf);
      const room = side.roomOf(talk.conversationId);
      return `Talking with ${namesAsList(others)}${room ? ` · ${room}` : ""}`;
    }
    return mindStateLabel(state);
  }, [agentWorking, channelsQuery.data, key, side, state, talk, task]);
  const shown = restarting ? `Restarting ${resident.displayName}…` : now;
  const live = restarting || state === "working" || state === "talking";
  const space = shown.indexOf(" ");
  const firstWord = space < 0 ? shown : shown.slice(0, space);
  const restWords = space < 0 ? "" : shown.slice(space);

  // A companion at rest says what it keeps up with: a quiet way to
  // Settings › Keeps up with.
  const followed = followedWork(companion.data);
  const keepingUp =
    state === "resting" &&
    hasAwareness(companion.data) &&
    isNoticing(companion.data) &&
    followed.length > 0;

  const runs = [
    harnessLabel(resident),
    managedAgent || resident.modelLabel
      ? (resident.modelLabel ?? "Default model")
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className="luca-mind-head" data-testid="mind-head">
      <span aria-hidden={!resident.pubkey} className="luca-mind-mark">
        {resident.pubkey ? (
          <AgentDendrite
            residentKey={resident.pubkey}
            size={MARK_SIZE}
            working={state === "working"}
          />
        ) : (
          <span className="luca-mind-initial">
            {resident.displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <div className="luca-mind-who">
        <h1
          className="luca-mind-name"
          data-testid="mind-page-title"
          ref={titleRef}
          tabIndex={-1}
        >
          {resident.displayName}
        </h1>
        <p
          className="luca-mind-now"
          data-live={live ? "true" : undefined}
          data-mind-state={state}
          data-testid="mind-now"
          data-working={state === "working" ? "true" : undefined}
        >
          <span>
            {live ? (
              // The breathing dot travels with its sentence, held to the
              // first word so it is never alone on a line (WP-43, round 4).
              <span className="luca-mind-lead">
                <span aria-hidden className="luca-mind-dot" />
                {firstWord}
              </span>
            ) : (
              firstWord
            )}
            {restWords}
          </span>
          {keepingUp && !restarting ? (
            <>
              <span aria-hidden className="luca-mind-sep">
                ·
              </span>
              <button
                className="luca-mind-quietlink"
                data-testid="mind-keeping-up"
                title={`Keeping up with ${namesAnd(followed)}`}
                onClick={() => onGo({ kind: "pane", pane: "keeps" })}
                type="button"
              >
                Keeping up with {namesAnd(followed)}
              </button>
            </>
          ) : null}
        </p>
        {runs ? (
          <p className="luca-mind-runs" data-testid="mind-runs">
            {runs}
          </p>
        ) : null}
      </div>
      <div className="luca-mind-head-actions">
        {resident.pubkey ? (
          <AgentInboxMenu residentPubkey={resident.pubkey} />
        ) : null}
        {managedAgent ? (
          <button
            className="luca-mind-talk"
            data-testid="mind-talk"
            disabled={isActionPending}
            onClick={onMessage}
            type="button"
          >
            Talk
          </button>
        ) : (
          <button
            className="luca-mind-talk"
            disabled={isActionPending}
            onClick={onStart}
            type="button"
          >
            <Play aria-hidden /> Set up
          </button>
        )}
        <button
          className="luca-mind-button"
          data-testid="mind-open-settings"
          onClick={() => onGo({ kind: "settings" })}
          type="button"
        >
          <Settings aria-hidden />
          Settings
        </button>
      </div>
    </header>
  );
}
