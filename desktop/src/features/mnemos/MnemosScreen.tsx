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
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { bookOf, writesOf } from "./adapt";
import type { PlaceMind } from "./api";
import { GlanceRoom } from "./GlanceRoom";
import { MemoriesRoom } from "./MemoriesRoom";
import { PlaceLine } from "./MnemosParts";
import { linkedWords, stateLine } from "./notebook";
import { loadMinds, setRoomCounts } from "./placeStore";
import { BeliefsRoom, CarryingRoom } from "./ReaderRooms";
import type { RoomProps } from "./roomKit";
import { JOURNAL_LAST, JournalRoom, NotesRoom } from "./TalkRooms";
import { useMindInView } from "./useMindInView";
import { type SessionPhase, useMnemosSession } from "./useMnemosSession";
import { type Reader, useReader } from "./useReader";
import type { Book } from "./adapt";

const SEARCH_KEYS = ["room", "item", "mind"] as const;

/** Each room, by the rail's row. A room added later is one more line. */
const ROOMS: Record<MnemosRoomId, (props: RoomProps) => React.ReactNode> = {
  glance: GlanceRoom,
  memories: MemoriesRoom,
  journal: JournalRoom,
  notes: NotesRoom,
  beliefs: BeliefsRoom,
  carrying: CarryingRoom,
};

/**
 * The Mnemos place (WP-45): a mind's notebook, read here. Its rail picks
 * the mind and the room; the card is the room, its list beside the thing
 * opened. Reading, and the person's own four writes (WP-47): answer a note,
 * leave one, correct a memory, let one go.
 */
export function MnemosScreen() {
  const { applyPatch, values } = useHistorySearchState(SEARCH_KEYS);
  useKeepPickInAddress("mnemos", applyPatch);
  const { pick } = usePlacePick("mnemos");
  const room: MnemosRoomId = isMnemosRoom(pick) ? pick : "glance";
  const { facts, mind } = useMindInView();

  const openItem = React.useCallback(
    (id: string | null, options?: { replace?: boolean }) =>
      applyPatch({ item: id }, { replace: options?.replace ?? false }),
    [applyPatch],
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
}: {
  goTo: RoomProps["goTo"];
  item: string | null;
  mind: PlaceMind;
  openItem: RoomProps["openItem"];
  room: MnemosRoomId;
}) {
  const { phase, ask, send, retry, visible } = useMnemosSession(mind.id);
  const book = React.useMemo(() => bookOf(ask), [ask]);
  const writes = React.useMemo(() => writesOf(send), [send]);
  const reader = useReader(mind);
  useRoomCounts(book, reader, mind.id, phase.kind === "open" && visible);
  const Room = ROOMS[room];
  return (
    <>
      <PlacePageHead
        face={<NotebookText />}
        state={<HeadState mind={mind} />}
        title={mind.name}
      />
      {phase.kind !== "open" ? (
        <PhaseLine mind={mind} phase={phase} retry={retry} />
      ) : visible ? (
        // The words live only here, while the window is on screen: hidden,
        // the room goes and its words with it; shown again, it reads again.
        <Room
          book={book}
          goTo={goTo}
          item={item}
          key={room}
          mind={mind}
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
      className="luca-mnemos-headlink"
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
        {mind.name}’s memory isn’t shown here. Nothing was read.
      </PlaceLine>
    );
  const code = phase.code;
  if (code === "mind_changed")
    return (
      <PlaceLine
        action={{ label: "Show it here", run: () => retry(true) }}
        testId="mnemos-state-changed"
      >
        {mind.name}’s memory file was moved or replaced since you said to show
        it, so nothing was read.
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
        {mind.name}’s memory isn’t on this Mac anymore.
      </PlaceLine>
    );
  return (
    <PlaceLine
      action={{ label: "Try again", run: () => retry() }}
      testId="mnemos-state-failed"
    >
      Mnemos couldn’t open {mind.name}’s memory.
    </PlaceLine>
  );
}
