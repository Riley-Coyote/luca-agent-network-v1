import * as React from "react";
import { NotebookText } from "lucide-react";

import "./mnemos-place.css";
import { PlacePage } from "@/app/shell/placeRails/PlacePage";
import { PlacePageHead } from "@/app/shell/placeRails/PlacePageHead";
import {
  isMnemosRoom,
  type MnemosRoomId,
} from "@/app/shell/placeRails/placePicks";
import {
  useKeepPickInAddress,
  usePlacePick,
} from "@/app/shell/placeRails/usePlaceRails";
import { useRouterState } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { type Book, bookOf, writesOf } from "./adapt";
import type { PlaceMind } from "./api";
import type { BookLife, BookSummary } from "./book";
import { BeliefsRoom } from "./BeliefsRoom";
import { GlanceRoom } from "./GlanceRoom";
import { HoursRoom } from "./HoursRoom";
import { LogRoom } from "./LogRoom";
import { MemoriesRoom } from "./MemoriesRoom";
import { MindRoom } from "./mind/MindRoom";
import { DIDNT_ANSWER, type NotebookView, type RoomProps } from "./roomKit";
import { PlaceLine } from "./MnemosParts";
import { linkedWords, stateLine } from "./notebook";
import { bookOfNotebook, readerOfNotebook } from "./notebookLoad";
import { letGoMindWordsDrafts } from "./drafts";
import { possessive } from "./notebookWords";
import { loadMinds, setNotebookMemories, setRoomCounts } from "./placeStore";
import { QuestionsRoom } from "./QuestionsRoom";
import { useRailStateSource } from "./railState";
import { CarryingRoom } from "./ReaderRooms";
import { SettingsRoom } from "./SettingsRoom";
import { SharedRoom } from "./SharedRoom";
import { JOURNAL_LAST, JournalRoom, NotesRoom } from "./TalkRooms";
import { useMindInView } from "./useMindInView";
import { type SessionPhase, useMnemosSession } from "./useMnemosSession";
import { useEngine, useNotebook, usePictures } from "./useNotebook";
import { type Reader, useReader } from "./useReader";

const SEARCH_KEYS = ["room", "item", "mind"] as const;

/** Each room, by the rail's row. A room added later is one more line. */
const ROOMS: Record<MnemosRoomId, (props: RoomProps) => React.ReactNode> = {
  glance: GlanceRoom,
  mind: MindRoom,
  log: LogRoom,
  memories: MemoriesRoom,
  shared: SharedRoom,
  beliefs: BeliefsRoom,
  questions: QuestionsRoom,
  journal: JournalRoom,
  notes: NotesRoom,
  carrying: CarryingRoom,
  hours: HoursRoom,
  settings: SettingsRoom,
};

/**
 * The Mnemos place (WP-45): a mind's notebook, read here. Its rail picks
 * the mind and the room; the card is the room, its list beside the thing
 * opened. Reading, and the person's own four writes (WP-47): answer a note,
 * leave one, correct a memory, let one go.
 */
export function MnemosScreen() {
  const { applyPatch, values } = useHistorySearchState(SEARCH_KEYS);
  // Leaving the place lets go of the mind's words, and of every draft made
  // of them.
  React.useEffect(() => letGoMindWordsDrafts, []);
  useKeepPickInAddress("mnemos", applyPatch);
  const { pick } = usePlacePick("mnemos");
  const room: MnemosRoomId = isMnemosRoom(pick) ? pick : "glance";
  const { facts, mind } = useMindInView();
  // An address that names a room or a mind that isn't here falls back, and
  // then says what is really shown, in place, so Back still works.
  const named = useRouterState({
    select: (state) =>
      state.location.pathname === "/mnemos" ? state.location.searchStr : null,
  });
  React.useEffect(() => {
    if (named === null) return;
    // The address's own words (one the route didn't keep isn't in `values`).
    const raw = new URLSearchParams(named);
    const patch: Record<string, string> = {};
    if (raw.has("room") && values.room !== room) patch.room = room;
    if (raw.has("mind") && mind && values.mind !== mind.id)
      patch.mind = mind.id;
    if (Object.keys(patch).length) applyPatch(patch, { replace: true });
  }, [applyPatch, mind, named, room, values.mind, values.room]);

  const openItem = React.useCallback(
    (id: string | null, options?: { replace?: boolean }) => {
      // The room shown follows the rail's pick, a moment behind the
      // address: a room still on screen after the address has gone on to
      // another must not let go of that room's item.
      if (id === null && values.room !== null && values.room !== room) return;
      applyPatch({ item: id }, { replace: options?.replace ?? false });
    },
    [applyPatch, room, values.room],
  );
  const goTo = React.useCallback(
    (next: string, item?: string) =>
      applyPatch({ room: next, item: item ?? null }),
    [applyPatch],
  );

  let body: React.ReactNode;
  if (facts.failed && !facts.minds)
    body = (
      <PlaceLine
        action={{ label: "Try again", run: () => void loadMinds(true) }}
      >
        Polyphonic couldn’t look for Mnemos on this Mac.
      </PlaceLine>
    );
  else if (!facts.minds) body = null;
  else if (!facts.minds.mnemosReady)
    body = (
      <PlaceLine testId="mnemos-state-missing">
        Mnemos isn’t on this Mac.
      </PlaceLine>
    );
  else if (!mind)
    body = (
      <PlaceLine testId="mnemos-state-no-minds">
        Mnemos is installed, but it doesn’t keep a memory on this Mac yet.
      </PlaceLine>
    );

  return (
    <div className="luca-mnemos-place relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PlacePage testId="mnemos-place">
        {mind ? (
          <MindCard
            goTo={goTo}
            item={values.item}
            key={mind.id}
            settled={!isMnemosRoom(values.room) || values.room === room}
            mind={mind}
            openItem={openItem}
            room={room}
          />
        ) : (
          <>
            <PlacePageHead face={<NotebookText />} title="Mnemos" />
            {body}
          </>
        )}
      </PlacePage>
    </div>
  );
}

function MindCard({
  goTo,
  item,
  mind,
  openItem,
  room,
  settled,
}: {
  goTo: RoomProps["goTo"];
  item: string | null;
  mind: PlaceMind;
  openItem: RoomProps["openItem"];
  room: MnemosRoomId;
  /** Whether the address names this room yet: the rail's pick can arrive a
   *  moment before the address's item, and a room shown in between would
   *  see the last room's item and let the new one go. */
  settled: boolean;
}) {
  const { phase, ask, send, retry, visible } = useMnemosSession(mind.id);
  const open = phase.kind === "open";
  // Which Mnemos this is: a newer one gives the whole notebook, and then
  // the older interface's reads and the old reader are never used.
  const engine = useEngine(mind.id, open);
  const newer = engine.kind === "newer";
  const read = useNotebook(ask, open && visible && newer);
  const picture = usePictures(mind.id);
  const oldReader = useReader(mind, engine.kind === "older");
  const { life, memories, summary } = read;
  const notebook = React.useMemo((): NotebookView | null => {
    if (engine.kind !== "newer" || !life || !memories) return null;
    return { hello: engine.hello, life, memories, summary, picture };
  }, [engine, life, memories, summary, picture]);
  const book = React.useMemo(
    () =>
      newer && life && memories
        ? bookOfNotebook(life, memories, ask)
        : bookOf(ask),
    [ask, life, memories, newer],
  );
  const reader = React.useMemo(
    () =>
      newer && life && memories ? readerOfNotebook(life, memories) : oldReader,
    [life, memories, newer, oldReader],
  );
  const writes = React.useMemo(() => writesOf(send, ask), [send, ask]);
  // Hidden, the room and its words go: drafts made of the mind's words too.
  React.useEffect(() => {
    if (!visible) letGoMindWordsDrafts();
  }, [visible]);
  useRoomCounts(
    book,
    reader,
    mind.id,
    open && visible && !newer && engine.kind !== "asking",
  );
  useNotebookCounts(mind.id, newer ? life : null, newer ? summary : null);
  useRailStateSource(mind.id, newer ? life : null);
  const Room = ROOMS[room];
  // A newer Mnemos's rooms wait for the notebook's first reading.
  const waiting = engine.kind === "asking" || (newer && !notebook);
  return (
    <>
      <PlacePageHead
        face={<NotebookText />}
        state={<HeadState mind={mind} />}
        title={mind.name}
      />
      {phase.kind !== "open" ? (
        <PhaseLine mind={mind} phase={phase} retry={retry} />
      ) : waiting ? (
        read.failed && !notebook ? (
          <PlaceLine testId="mnemos-notebook-failed">{DIDNT_ANSWER}</PlaceLine>
        ) : null
      ) : !settled ? null : visible ? (
        // The words live only here, while the window is on screen: hidden,
        // the room goes and its words with it; shown again, it reads again.
        <Room
          book={book}
          goTo={goTo}
          item={item}
          key={room}
          mind={mind}
          notebook={notebook}
          openItem={openItem}
          reader={reader}
          writes={writes}
        />
      ) : null}
    </>
  );
}

/** The head's one line: its numbers, then who remembers with it, each name
 *  a way to that resident's own page (WP-47, Decided 8). */
function HeadState({ mind }: { mind: PlaceMind }) {
  const { goAgent } = useAppNavigation();
  const numbers = stateLine({ ...mind, linked: [] });
  const who = linkedWords(mind);
  if (!who) return numbers;
  const link = (pubkey: string, words: string) => (
    <button
      className="luca-mnemos-link"
      data-testid={`mnemos-head-resident-${pubkey}`}
      key={pubkey}
      onClick={() => void goAgent(pubkey)}
      type="button"
    >
      {words}
    </button>
  );
  const [only] = mind.linked;
  if (mind.linked.length === 1 && only)
    return (
      <>
        {numbers} · {link(only.pubkey, who)}
      </>
    );
  const last = mind.linked.length - 1;
  return (
    <>
      {numbers} ·{" "}
      {mind.linked.map((r, i) => (
        <React.Fragment key={r.pubkey}>
          {i === 0 ? "" : i === last ? " and " : ", "}
          {link(r.pubkey, r.name)}
        </React.Fragment>
      ))}{" "}
      remember with this
    </>
  );
}

/** The rail's counts from a newer Mnemos's summary and notebook. */
function useNotebookCounts(
  mind: string,
  life: BookLife | null,
  summary: BookSummary | null,
) {
  React.useEffect(() => {
    if (!summary) return;
    const c = summary.counts;
    const states = life?.memory.states;
    // One number for the head and the rail: what the notebook says it can
    // reach (the summary's count until its life is read).
    const memories = states ? states.active + states.dormant : c.memories;
    if (memories !== undefined) setNotebookMemories(mind, memories);
    setRoomCounts(mind, {
      shared: c.shared,
      beliefs: c.beliefs,
      questions: c.questions,
      journal: c.journal,
      notes: c.notes === undefined ? undefined : c.notes + (c.replies ?? 0),
      carrying: c.carrying,
      hours: c.hours,
    });
  }, [life, mind, summary]);
}

/** The rail's counts for the mind in view, once it is open: numbers only.
 *  A count that can't be read is left off rather than guessed. */
function useRoomCounts(book: Book, reader: Reader, mind: string, on: boolean) {
  React.useEffect(() => {
    if (!on) return;
    let current = true;
    (async () => {
      const facts = await book.facts();
      if (!current) return;
      setRoomCounts(mind, {
        memories: facts.states.active + facts.states.dormant,
      });
      const notes = await book.notes();
      if (current) setRoomCounts(mind, { notes: notes.length });
      const journal = await book.journal(JOURNAL_LAST);
      if (current && journal.length < JOURNAL_LAST)
        setRoomCounts(mind, { journal: journal.length });
    })().catch(() => {
      // The card says why when Mnemos doesn't answer; the rail just has
      // no number.
    });
    return () => {
      current = false;
    };
  }, [book, mind, on]);
  React.useEffect(() => {
    if (reader.kind !== "ready") return;
    let current = true;
    reader.counts().then(
      (counts) => {
        if (current)
          setRoomCounts(mind, {
            beliefs: counts.beliefs,
            carrying: counts.handoffs,
          });
      },
      () => {
        // No number where the old reader can't count.
      },
    );
    return () => {
      current = false;
    };
  }, [mind, reader]);
}

/** The card's one line for a mind not open, by why. */
function PhaseLine({
  mind,
  phase,
  retry,
}: {
  mind: PlaceMind;
  phase: Exclude<SessionPhase, { kind: "open" }>;
  retry: (askAgain?: boolean) => void;
}) {
  if (phase.kind === "opening")
    return mind.linked.length ? null : (
      <PlaceLine testId="mnemos-state-asking">
        Polyphonic is asking whether to show {mind.name} here.
      </PlaceLine>
    );
  if (phase.kind === "declined")
    return (
      <PlaceLine
        action={{ label: "Show it here", run: () => retry() }}
        testId="mnemos-state-declined"
      >
        {possessive(mind.name)} memory isn’t shown here. Nothing was read.
      </PlaceLine>
    );
  const code = phase.code;
  if (code === "mind_changed")
    return (
      <PlaceLine
        action={{ label: "Show it here", run: () => retry(true) }}
        testId="mnemos-state-changed"
      >
        {possessive(mind.name)} memory file was moved or replaced since you said
        to show it, so nothing was read.
      </PlaceLine>
    );
  if (code === "mnemos_too_old")
    return (
      <PlaceLine testId="mnemos-state-too-old">
        This Mnemos is too old to be read here. Updating Mnemos brings it.
      </PlaceLine>
    );
  if (code === "mnemos_timeout")
    return (
      <PlaceLine
        action={{ label: "Try again", run: () => retry() }}
        testId="mnemos-state-timeout"
      >
        Mnemos didn’t answer in time.
      </PlaceLine>
    );
  if (code === "mnemos_unavailable")
    return (
      <PlaceLine testId="mnemos-state-gone">
        Mnemos isn’t installed on this Mac anymore.
      </PlaceLine>
    );
  if (code === "mind_unavailable")
    return (
      <PlaceLine
        action={{ label: "Look again", run: () => void loadMinds(true) }}
        testId="mnemos-state-mind-gone"
      >
        {possessive(mind.name)} memory isn’t on this Mac anymore.
      </PlaceLine>
    );
  return (
    <PlaceLine
      action={{ label: "Try again", run: () => retry() }}
      testId="mnemos-state-failed"
    >
      Mnemos couldn’t open {possessive(mind.name)} memory.
    </PlaceLine>
  );
}
