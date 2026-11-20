import * as React from "react";

import "./mnemos-board.css";

import { placeNoteTime } from "@/app/shell/placeRails/PlacePage";
import type { Book } from "./adapt";
import { beliefOf, handoffOf } from "./adapt";
import { Board } from "./glance/Board";
import { Plate, Quiet, WaitingPlate } from "./glance/Plate";
import { longDay, useLoad } from "./MnemosParts";
import {
  countPerDay,
  dayLine,
  firstLine,
  newestFirst,
  newestFirstPage,
  titleOf,
} from "./notebook";
import { setRoomCounts } from "./placeStore";
import { heldAt } from "./ReaderRooms";
import { DIDNT_ANSWER, type RoomProps } from "./roomKit";
import { useReaderSection } from "./useReader";

/** Days the strip shows: the last six months. */
const STRIP_DAYS = 182;
/** A page of the strip's sweep (the place's largest). */
const SWEEP_PAGE = 100;

/**
 * At a glance. On a newer Mnemos, the notebook's whole board (WP-49,
 * Decided 1: `glance/Board.tsx`); on an older one, the board as WP-45 made
 * it, with one quiet line at its foot.
 */
export function GlanceRoom(props: RoomProps) {
  if (props.notebook) return <Board {...props} notebook={props.notebook} />;
  return (
    <>
      <OlderBoard {...props} />
      <p
        className="luca-mnemos-board-foot luca-mnemos-quiet text-xs"
        data-testid="mnemos-board-newer"
      >
        A newer Mnemos shows more here.
      </p>
    </>
  );
}

/**
 * At a glance on an older Mnemos (WP-45, Decided 5): plates of real numbers
 * and the newest words, each from its own source; a plate whose source
 * isn't here says so in one line.
 */
function OlderBoard({ book, mind, goTo, reader, writes }: RoomProps) {
  const facts = useLoad(() => book.facts(), [book]);
  const states = facts.value?.states ?? null;
  const total = states ? states.active + states.dormant : null;
  React.useEffect(() => {
    if (total !== null) setRoomCounts(mind.id, { memories: total });
  }, [mind.id, total]);
  const lately = useLoad(async () => {
    if (total === null) return null;
    const slice = newestFirstPage(total, 0, 5);
    if (!slice) return [];
    return newestFirst((await book.memories(slice)).memories);
  }, [book, total]);
  const journal = useLoad(() => book.journal(1), [book]);
  const handoffs = useReaderSection(reader, "handoffs", handoffOf);
  const beliefs = useReaderSection(reader, "beliefs", beliefOf);
  const entry = journal.value?.[0] ?? null;

  return (
    <div className="luca-mnemos-glance" data-testid="mnemos-glance">
      <WaitingPlate book={book} goTo={goTo} mind={mind} writes={writes} />

      <Plate label="Memory" testId="mnemos-plate-memory">
        {facts.failed ? (
          <Quiet>{DIDNT_ANSWER}</Quiet>
        ) : !states ? null : (
          <>
            <p className="luca-mnemos-count">
              <span
                className="text-3xl tabular-nums"
                data-testid="mnemos-count"
              >
                {(states.active + states.dormant).toLocaleString()}
              </span>
              <span className="text-sm"> it can reach</span>
            </p>
            <p className="luca-mnemos-quiet text-xs tabular-nums">
              {states.dormant.toLocaleString()} of them gone quiet ·{" "}
              {states.archived.toLocaleString()} let go
            </p>
            <DayStrip book={book} total={total ?? 0} />
          </>
        )}
      </Plate>

      <Plate label="Lately" testId="mnemos-plate-lately">
        {lately.failed ? (
          <Quiet>{DIDNT_ANSWER}</Quiet>
        ) : !lately.value ? null : lately.value.length === 0 ? (
          <Quiet>It hasn’t kept a memory yet.</Quiet>
        ) : (
          <ul className="luca-mnemos-lately">
            {lately.value.map((m) => (
              <li key={m.id}>
                <button
                  className="luca-mnemos-lately-row"
                  onClick={() => goTo("memories", m.id)}
                  type="button"
                >
                  <span className="luca-mnemos-clamp text-sm">
                    {firstLine(m.content)}
                  </span>
                  <span className="text-2xs tabular-nums">
                    {placeNoteTime(m.born)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Plate>

      <Plate label="Journal" testId="mnemos-plate-journal">
        {journal.failed ? (
          <Quiet>{DIDNT_ANSWER}</Quiet>
        ) : !journal.value ? null : !entry ? (
          <Quiet>It hasn’t written in its journal yet.</Quiet>
        ) : (
          <button
            className="luca-mnemos-plate-open"
            onClick={() => goTo("journal", entry.id)}
            type="button"
          >
            <span className="luca-mnemos-clamp text-base">
              {titleOf(entry.text).title}
            </span>
            <span className="luca-mnemos-quiet text-2xs">
              {[
                entry.mood ? `mood, in its words: ${entry.mood}` : null,
                longDay(entry.at),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
        )}
      </Plate>

      <Plate label="Carrying forward" testId="mnemos-plate-carrying">
        {handoffs.line ? (
          <Quiet testId="mnemos-plate-line">{handoffs.line}</Quiet>
        ) : !handoffs.items ? null : !handoffs.items[0] ? (
          <Quiet>It hasn’t left itself anything to carry forward.</Quiet>
        ) : (
          <button
            className="luca-mnemos-plate-open"
            onClick={() => goTo("carrying")}
            type="button"
          >
            <span className="luca-mnemos-clamp text-sm">
              {handoffs.items[0].text}
            </span>
            <span className="luca-mnemos-quiet text-2xs">
              {longDay(handoffs.items[0].at)}
            </span>
          </button>
        )}
      </Plate>

      <Plate label="Beliefs" testId="mnemos-plate-beliefs">
        {beliefs.line ? (
          <Quiet testId="mnemos-plate-line">{beliefs.line}</Quiet>
        ) : !beliefs.items ? null : !beliefs.items[0] ? (
          <Quiet>It hasn’t formed a belief yet.</Quiet>
        ) : (
          <button
            className="luca-mnemos-plate-open"
            onClick={() => goTo("beliefs")}
            type="button"
          >
            <span className="luca-mnemos-quiet text-2xs tabular-nums">
              {beliefs.items.length.toLocaleString()}{" "}
              {beliefs.items.length === 1 ? "belief" : "beliefs"}
            </span>
            <span className="luca-mnemos-clamp text-sm">
              {beliefs.items[0].text}
            </span>
            {beliefs.items[0].confidence !== undefined ? (
              <span className="luca-mnemos-quiet text-2xs">
                {heldAt(beliefs.items[0].confidence)}
              </span>
            ) : null}
          </button>
        )}
      </Plate>
    </div>
  );
}

/**
 * How many memories it kept each day, the last six months: swept in the
 * background, a page at a time, keeping counts only, never a word.
 */
function DayStrip({ book, total }: { book: Book; total: number }) {
  const [days, setDays] = React.useState<Map<string, number> | null>(null);
  React.useEffect(() => {
    let current = true;
    (async () => {
      const counts = new Map<string, number>();
      for (let offset = 0; offset < total && current; offset += SWEEP_PAGE) {
        const page = await book.memories({ limit: SWEEP_PAGE, offset });
        countPerDay(page.memories, counts);
      }
      if (current) setDays(counts);
    })().catch(() => {
      if (current) setDays(null);
    });
    return () => {
      current = false;
    };
  }, [book, total]);
  if (!days) return null;
  const line = dayLine(days).slice(-STRIP_DAYS);
  const most = Math.max(1, ...line.map((d) => d.count));
  const busiest = line.reduce((a, b) => (b.count > a.count ? b : a), {
    key: "",
    count: 0,
  });
  return (
    <figure className="luca-mnemos-strip" data-testid="mnemos-day-strip">
      <div
        aria-label={`Memories kept each day, the last six months${
          busiest.count
            ? `; the most, ${busiest.count}, on ${longDay(`${busiest.key}T12:00:00`)}`
            : ""
        }`}
        className="luca-mnemos-strip-days"
        role="img"
      >
        {line.map((d) => (
          <span
            data-count={d.count}
            key={d.key}
            style={{ height: `${d.count ? 12 + (88 * d.count) / most : 4}%` }}
          />
        ))}
      </div>
      <figcaption className="luca-mnemos-quiet text-2xs">
        Kept each day, the last six months
      </figcaption>
    </figure>
  );
}
