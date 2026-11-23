import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { BookLife, BookMemory } from "../book";
import { dayName, shortDay, when } from "../boardWords";
import { HoursDial } from "../HoursDial";
import { firstLine, titleOf } from "../notebook";
import { plural } from "../notebookWords";
import { PictureView, Thumbs, usePictureView } from "../Pictures";
import type { NotebookView, RoomProps } from "../roomKit";
import {
  asksByKind,
  beliefsHeld,
  beliefsRange,
  carriedBy,
  heldWords,
  memoryNumbers,
  monthMarks,
  newest,
  newestDayKept,
  picturesOf,
  type StripDay,
  stepTo,
} from "./boardFacts";
import { Cut } from "./Cut";
import { Plate, Quiet, WaitingPlate } from "./Plate";
import "../mnemos-board.css";

/** How many thumbnails Made lately shows. */
const THUMBS = 3;

/**
 * At a glance on a newer Mnemos (WP-49, Decided 1): the notebook's whole
 * board, read in its order. What waits on the person · Hours with the dial
 * · the newest day with something kept · Memory · Beliefs · Made lately ·
 * What its memory asks · Journal · Carrying forward. Each plate's head goes
 * to its section; plates in one row rest at one height, and long words are
 * cut with a fade. The memory count is the one large thing.
 */
export function Board(props: RoomProps & { notebook: NotebookView }) {
  const { book, goTo, mind, notebook, writes } = props;
  const { life, memories } = notebook;
  const now = new Date();
  const view = usePictureView();
  const pictures = React.useMemo(() => picturesOf(life), [life]);
  return (
    <>
      <div className="luca-mnemos-board-wrap" hidden={view.open !== null}>
        <div className="luca-mnemos-board" data-testid="mnemos-board">
          <WaitingPlate
            book={book}
            goTo={goTo}
            head
            mind={mind}
            writes={writes}
          />
          <Plate
            className="luca-mnemos-board-hours"
            go={() => goTo("hours")}
            label="Hours"
            more={life.hours.length.toLocaleString("en-US")}
            testId="mnemos-plate-hours"
          >
            <HoursDial life={life} />
          </Plate>
          <DayPlate
            goTo={goTo}
            life={life}
            memories={memories.memories}
            now={now}
          />
          <MemoryPlate
            goTo={goTo}
            life={life}
            memories={memories.memories}
            now={now}
          />
          <BeliefsPlate goTo={goTo} life={life} />
          <Plate
            className="luca-mnemos-board-made"
            go={() => goTo("log")}
            label="Made lately"
            more={
              pictures.length ? plural(pictures.length, "picture") : undefined
            }
            testId="mnemos-plate-made"
          >
            {pictures[0] ? (
              <>
                <Thumbs
                  notebook={notebook}
                  onOpen={(index, opener) => view.show(pictures, index, opener)}
                  pictures={pictures.slice(0, THUMBS)}
                  testId="mnemos-made-thumb"
                />
                <Cut className="luca-mnemos-quiet text-xs" lines={2}>
                  {pictures[0].name} · {when(pictures[0].at, now)}
                </Cut>
              </>
            ) : (
              <Quiet>Nothing made yet.</Quiet>
            )}
          </Plate>
          <AsksPlate goTo={goTo} life={life} now={now} />
          <JournalPlate goTo={goTo} life={life} now={now} />
          <CarryPlate goTo={goTo} life={life} now={now} />
        </div>
      </div>
      {view.open ? (
        <PictureView
          backLabel="At a glance"
          notebook={notebook}
          onClose={view.close}
          onOpenHour={(hour) => goTo("hours", hour)}
          onStep={view.step}
          open={view.open}
        />
      ) : null}
    </>
  );
}

type PlateProps = {
  goTo: RoomProps["goTo"];
  life: BookLife;
  now: Date;
};

/** The newest day with something kept, and what was kept. */
function DayPlate({
  goTo,
  life,
  memories,
  now,
}: PlateProps & { memories: BookMemory[] }) {
  const day = newestDayKept(life, memories, now);
  return (
    <Plate
      className="luca-mnemos-board-day"
      go={() => goTo("log")}
      label={day?.name ?? "Today"}
      more={day ? `${day.kept.toLocaleString("en-US")} kept` : undefined}
      testId="mnemos-plate-day"
    >
      {day ? (
        <Cut className="luca-mnemos-day-cut" lines={9} testId="mnemos-day-rows">
          <ol className="luca-mnemos-day-rows">
            {day.rows.map((r) => (
              <li key={r.key}>
                <span className="luca-mnemos-day-meta text-2xs tabular-nums">
                  {r.time}
                  {r.tag ? <span> · {r.tag}</span> : null}
                </span>
                <Cut className="text-sm" lines={2}>
                  {r.text}
                </Cut>
              </li>
            ))}
          </ol>
        </Cut>
      ) : (
        <Quiet>Nothing kept yet.</Quiet>
      )}
    </Plate>
  );
}

/** Memory: how many it can reach (the board's one large number), how many
 *  were let go, the days with something kept, and the strip of days. */
function MemoryPlate({
  goTo,
  life,
  memories,
  now,
}: PlateProps & { memories: BookMemory[] }) {
  const n = memoryNumbers(life, memories, now);
  return (
    <Plate
      className="luca-mnemos-board-memory"
      go={() => goTo("memories")}
      label="Memory"
      more={`${n.letGo.toLocaleString("en-US")} let go`}
      testId="mnemos-plate-memory"
    >
      <div className="luca-mnemos-board-figure">
        <p className="luca-mnemos-count">
          <span className="text-4xl tabular-nums" data-testid="mnemos-count">
            {n.reach.toLocaleString("en-US")}
          </span>
          <span className="text-sm"> it can reach</span>
        </p>
        <p
          className="luca-mnemos-quiet text-xs tabular-nums"
          data-testid="mnemos-memory-days"
        >
          {n.since
            ? `${plural(n.days, "day")} with something kept, since ${n.since}`
            : "Nothing kept yet"}
        </p>
      </div>
      <DayStrip since={n.since} strip={n.strip} />
    </Plate>
  );
}

/** The strip of days: the last six months, a thin tick for each day that
 *  kept something, as tall as how many, a dot for a day that kept none,
 *  and the months named under it. */
function DayStrip({
  since,
  strip,
}: {
  since: string | null;
  strip: StripDay[];
}) {
  const most = Math.max(1, ...strip.map((d) => d.count));
  const busiest = strip.reduce((a, b) => (b.count > a.count ? b : a));
  const at = (i: number) => `${(((i + 0.5) / strip.length) * 100).toFixed(3)}%`;
  return (
    <figure className="luca-mnemos-strip" data-testid="mnemos-day-strip">
      <div
        aria-label={`Memories kept each day, the last six months${
          since ? `, since ${since}` : ""
        }${
          busiest.count
            ? `; the most, ${busiest.count}, on ${busiest.date.toLocaleString(
                "en-US",
                { weekday: "long", month: "long", day: "numeric" },
              )}`
            : ""
        }`}
        className="luca-mnemos-ticks"
        role="img"
      >
        {strip.map((d) => (
          <span
            data-count={d.count}
            key={d.key}
            style={
              d.count
                ? {
                    height: `${(18 + 82 * Math.sqrt(d.count / most)).toFixed(1)}%`,
                  }
                : undefined
            }
          />
        ))}
      </div>
      <div aria-hidden className="luca-mnemos-months text-2xs">
        {monthMarks(strip).map((m) => (
          <span key={m.index} style={{ left: at(m.index) }}>
            {m.name}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Beliefs: a bar each, as tall as it is held; one picked, stepped
 *  through with the arrows or the keys. */
function BeliefsPlate({ goTo, life }: Omit<PlateProps, "now">) {
  const list = beliefsHeld(life.beliefs);
  const [picked, setPicked] = React.useState(0);
  const i = Math.min(picked, Math.max(0, list.length - 1));
  const belief = list[i];
  const step = (delta: number) => setPicked(stepTo(i, delta, list.length));
  return (
    <Plate
      className="luca-mnemos-board-beliefs"
      go={() => goTo("beliefs")}
      label="Beliefs"
      more={beliefsRange(list)}
      testId="mnemos-plate-beliefs"
    >
      {belief ? (
        <>
          <div
            aria-label="Its beliefs, each as tall as it’s held"
            aria-valuemax={list.length}
            aria-valuemin={1}
            aria-valuenow={i + 1}
            aria-valuetext={`${heldWords(belief)}: ${firstLine(belief.text, 120)}`}
            className="luca-mnemos-bars"
            data-testid="mnemos-belief-bars"
            onKeyDown={(event) => {
              const to =
                event.key === "ArrowLeft" || event.key === "ArrowDown"
                  ? i - 1
                  : event.key === "ArrowRight" || event.key === "ArrowUp"
                    ? i + 1
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? list.length - 1
                        : null;
              if (to === null) return;
              event.preventDefault();
              setPicked(stepTo(to, 0, list.length));
            }}
            role="slider"
            tabIndex={0}
          >
            {list.map((b, j) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the slider around it takes the keys.
              // biome-ignore lint/a11y/noStaticElementInteractions: a bar is picked by pointer; the slider is its keyboard way.
              <span
                data-on={j === i ? "" : undefined}
                key={`${b.born ?? ""}:${b.text}`}
                onClick={() => setPicked(j)}
                style={{ height: `${Math.max(4, (b.confidence ?? 0) * 100)}%` }}
              />
            ))}
          </div>
          <div className="luca-mnemos-plate-foot">
            <p className="text-xs" data-testid="mnemos-belief-held">
              <span className="luca-mnemos-held">{heldWords(belief)}</span>
              <span className="luca-mnemos-quiet tabular-nums">
                {" "}
                · {i + 1} of {list.length}
              </span>
            </p>
            {list.length > 1 ? (
              <span className="luca-mnemos-steps">
                <button
                  aria-label="The belief before"
                  className="luca-mnemos-step"
                  data-testid="mnemos-belief-before"
                  disabled={i === 0}
                  onClick={() => step(-1)}
                  type="button"
                >
                  <ChevronLeft aria-hidden />
                </button>
                <button
                  aria-label="The next belief"
                  className="luca-mnemos-step"
                  data-testid="mnemos-belief-next"
                  disabled={i === list.length - 1}
                  onClick={() => step(1)}
                  type="button"
                >
                  <ChevronRight aria-hidden />
                </button>
              </span>
            ) : null}
          </div>
          <Cut className="text-sm" lines={4} testId="mnemos-belief-words">
            {belief.text}
          </Cut>
        </>
      ) : (
        <Quiet>It holds no beliefs yet.</Quiet>
      )}
    </Plate>
  );
}

/** What its memory asks: how many are open, by kind. */
function AsksPlate({ goTo, life, now }: PlateProps) {
  const q = life.questions;
  const kinds = asksByKind(q);
  const last = newest(q.answered);
  return (
    <Plate
      className="luca-mnemos-board-asks"
      go={() => goTo("questions")}
      label="What its memory asks"
      more={`${q.open.toLocaleString("en-US")} open`}
      testId="mnemos-plate-asks"
    >
      {kinds.length ? (
        <dl className="luca-mnemos-kinds">
          {kinds.map((k) => (
            <div key={k.kind}>
              <dt className="luca-mnemos-quiet text-2xs">{k.title}</dt>
              <dd className="text-base tabular-nums">
                {k.count.toLocaleString("en-US")}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <Quiet>Nothing is open.</Quiet>
      )}
      <Cut className="luca-mnemos-quiet text-xs" lines={2}>
        {last?.at
          ? `Its latest answer, ${latestDay(new Date(last.at), now)}`
          : "It has answered none yet"}
      </Cut>
    </Plate>
  );
}

/** Journal: the newest entry, titled by its own first sentence. */
function JournalPlate({ goTo, life, now }: PlateProps) {
  const entry = newest(life.journal);
  const title = entry ? titleOf(entry.text) : null;
  return (
    <Plate
      className="luca-mnemos-board-journal"
      go={() => goTo("journal")}
      label="Journal"
      more={life.journal.length.toLocaleString("en-US")}
      testId="mnemos-plate-journal"
    >
      {entry && title ? (
        <>
          <Cut className="luca-mnemos-board-title text-sm" lines={2}>
            {title.title}
          </Cut>
          {entry.mood ? (
            <Cut className="luca-mnemos-quiet text-xs" lines={2}>
              mood, in its words: {entry.mood}
            </Cut>
          ) : null}
          {title.body ? (
            <Cut className="luca-mnemos-quiet text-sm" lines={2}>
              {firstLine(title.body, 220)}
            </Cut>
          ) : null}
          <p className="luca-mnemos-quiet text-xs">{when(entry.at, now)}</p>
        </>
      ) : (
        <Quiet>It hasn’t written in its journal yet.</Quiet>
      )}
    </Plate>
  );
}

/** Carrying forward: the newest note it left, and who left it. */
function CarryPlate({ goTo, life, now }: PlateProps) {
  const h = newest(life.handoffs);
  return (
    <Plate
      className="luca-mnemos-board-carry"
      go={() => goTo("carrying")}
      label="Carrying forward"
      more={h ? when(h.at, now) : undefined}
      testId="mnemos-plate-carrying"
    >
      {h ? (
        <>
          <Cut className="text-sm" lines={4} testId="mnemos-carry-words">
            {h.text}
          </Cut>
          <p className="luca-mnemos-quiet text-xs">
            {carriedBy(h, life.identity.model)}
          </p>
        </>
      ) : (
        <Quiet>No note left for its next session.</Quiet>
      )}
    </Plate>
  );
}

/** "today", "yesterday" or "Nov 15": when its latest answer came. */
function latestDay(at: Date, now: Date): string {
  const name = dayName(at, now);
  return name === "Today" || name === "Yesterday"
    ? name.toLowerCase()
    : shortDay(at, now);
}
