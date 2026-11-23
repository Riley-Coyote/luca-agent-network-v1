import type * as React from "react";

import "./mnemos-board.css";

import {
  PlaceList,
  PlaceListRow,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import type { BookHour, BookMemory } from "./book";
import { clock, tempWord, temperature, when } from "./boardWords";
import { picturesMadeBy } from "./glance/boardFacts";
import { HoursDial } from "./HoursDial";
import { ItemsRoom } from "./ItemsRoom";
import { NeedsNewer } from "./MnemosParts";
import { firstLine, modelName, threads, titleOf } from "./notebook";
import { KIND, KIND_LONG, plural, trailSentence } from "./notebookWords";
import { PictureView, Thumbs, usePictureView } from "./Pictures";
import type { NotebookView, RoomProps } from "./roomKit";

/** An hour's state in a word: how warm it still is, or why it didn't run
 *  as it should (its own words). */
function stateOf(hour: BookHour, now: number): string {
  if (hour.status && hour.status !== "done") return hour.reason || hour.status;
  if (hour.reason) return hour.reason;
  return tempWord(temperature(hour, now), hour).toLowerCase();
}

/**
 * Hours (WP-49, Decided 4): its quiet hours, newest first, under the dial
 * and the notebook's own sentence for what they are. An hour opened says
 * when it ran, how warm it still is, what it ran as and what it refused;
 * its name, what it did, what it wrote, the notes it left, what it made,
 * what it said as it ended, and the memories on its trail, each a way to
 * where it lives.
 */
export function HoursRoom(props: RoomProps) {
  const { goTo, mind, notebook, openItem } = props;
  const view = usePictureView();
  if (!notebook) return <NeedsNewer what="Hours" />;
  const { life } = notebook;
  const name = life.identity.name || mind.name;
  const now = Date.now();
  return (
    <div className="luca-mnemos-hours" data-testid="mnemos-hours-section">
      <div hidden={view.open !== null}>
        <div className="luca-mnemos-hours-head">
          <HoursDial life={life} testId="mnemos-hours-dial" />
          <p
            className="luca-mnemos-quiet text-sm"
            data-testid="mnemos-hours-subtitle"
          >
            Time between conversations that’s {name}’s own: an hour to itself,
            half an hour for the day’s work, a short time each night to dream.
          </p>
        </div>
        <ItemsRoom
          backLabel="Hours"
          empty="No quiet hour has run yet. When hours are turned on, each one appears here as soon as it ends."
          groups={[
            {
              items: life.hours.map((hour) => ({
                key: hour.id,
                title: [
                  KIND[hour.kind] ?? hour.kind,
                  hour.practice ? "practice" : null,
                  stateOf(hour, now),
                ]
                  .filter(Boolean)
                  .join(" · "),
                note: placeNoteTime(hour.start),
                summary: trailSentence(hour),
                opened: () => (
                  <HourOpened
                    goTo={goTo}
                    hour={hour}
                    notebook={notebook}
                    onPicture={view.show}
                  />
                ),
              })),
            },
          ]}
          needs="Hours"
          props={props}
          testId="mnemos-hours"
        />
      </div>
      {view.open ? (
        <PictureView
          backLabel="Hours"
          notebook={notebook}
          onClose={view.close}
          onOpenHour={(id) => {
            view.close();
            openItem(id);
          }}
          onStep={view.step}
          open={view.open}
        />
      ) : null}
    </div>
  );
}

function HourOpened({
  goTo,
  hour,
  notebook,
  onPicture,
}: {
  goTo: RoomProps["goTo"];
  hour: BookHour;
  notebook: NotebookView;
  onPicture: ReturnType<typeof usePictureView>["show"];
}) {
  const { life, memories } = notebook;
  const now = new Date();
  const byId = new Map(memories.memories.map((m) => [m.id, m]));
  const threadOf = (noteId: string) =>
    threads(life.notes).find((t) => t.notes.some((n) => n.id === noteId))?.id ??
    noteId;
  const refused = [...new Set(hour.refused)];
  const made = picturesMadeBy(life, hour);
  const end = hour.end ? new Date(hour.end) : null;
  const head = [
    `${when(hour.start, now)}${end && !Number.isNaN(end.getTime()) ? ` to ${clock(end)}` : ""}`,
    stateOf(hour, now.getTime()).replace(/^./, (c) => c.toUpperCase()),
    hour.modelName || hour.model
      ? `ran as ${hour.modelName || modelName(hour.model)}`
      : null,
    refused.length
      ? `${plural(refused.length, "tool")} refused`
      : "nothing refused",
    hour.practice ? "practice, on a copy of its memory" : null,
  ].filter(Boolean);
  return (
    <article aria-label="A quiet hour" data-testid="mnemos-hour-opened">
      <p className="luca-mnemos-meta text-xs" data-testid="mnemos-hour-head">
        {head.join(" · ")}
      </p>
      <h2
        className="luca-mnemos-title text-base"
        data-testid="mnemos-hour-name"
      >
        {KIND_LONG[hour.kind] ?? KIND[hour.kind] ?? hour.kind}
        {hour.practice ? ", a practice run" : ""}
      </h2>
      <p className="luca-mnemos-words text-base">{trailSentence(hour)}</p>

      {hour.journal.length ? (
        <HourPart label="What it wrote in its journal">
          {hour.journal.map((j) => (
            <button
              className="luca-mnemos-plate-open luca-mnemos-hour-link"
              data-testid={`mnemos-hour-journal-${j.id}`}
              key={j.id}
              onClick={() => goTo("journal", j.id)}
              type="button"
            >
              <span className="luca-mnemos-board-title text-sm">
                {titleOf(j.text).title}
              </span>
              {j.mood ? (
                <span className="luca-mnemos-quiet text-xs">
                  mood, in its words: {j.mood}
                </span>
              ) : null}
            </button>
          ))}
        </HourPart>
      ) : null}

      {hour.notes.length ? (
        <HourPart label="The notes it left">
          {hour.notes.map((n) => (
            <button
              className="luca-mnemos-plate-open luca-mnemos-hour-link"
              data-testid={`mnemos-hour-note-${n.id}`}
              key={n.id}
              onClick={() => goTo("notes", threadOf(n.id))}
              type="button"
            >
              <span className="text-sm">{firstLine(n.text, 200)}</span>
            </button>
          ))}
        </HourPart>
      ) : null}

      {made.length ? (
        <HourPart label="What it made">
          <Thumbs
            notebook={notebook}
            onOpen={(index, opener) => onPicture(made, index, opener)}
            pictures={made}
            testId="mnemos-hour-thumb"
          />
        </HourPart>
      ) : null}

      {hour.said ? (
        <HourPart label="What it said when the hour ended">
          <Said text={hour.said} />
        </HourPart>
      ) : null}

      <div className="luca-mnemos-trail">
        <Trail
          byId={byId}
          goTo={goTo}
          ids={hour.trail.woke}
          label="Woke with, in hand"
          testId="mnemos-trail-woke"
        />
        <Trail
          byId={byId}
          goTo={goTo}
          ids={hour.trail.waiting}
          label="Found waiting, as questions"
          testId="mnemos-trail-waiting"
        />
        <Trail
          byId={byId}
          goTo={goTo}
          ids={hour.trail.reached}
          label="Reached for"
          testId="mnemos-trail-reached"
        />
      </div>
    </article>
  );
}

function HourPart({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section aria-label={label} className="luca-mnemos-hour-part">
      <h3 className="luca-place-section-label">{label}</h3>
      {children}
    </section>
  );
}

/** One quiet group of the memories on its trail, each opening in Memories. */
function Trail({
  byId,
  goTo,
  ids,
  label,
  testId,
}: {
  byId: Map<string, BookMemory>;
  goTo: RoomProps["goTo"];
  ids: string[];
  label: string;
  testId: string;
}) {
  const found = [...new Set(ids)]
    .map((id) => byId.get(id))
    .filter((m): m is BookMemory => Boolean(m));
  if (!found.length) return null;
  return (
    <PlaceList count={found.length} label={label} testId={testId}>
      {found.map((m) => (
        <PlaceListRow
          key={m.id}
          note={placeNoteTime(m.born)}
          onOpen={() => goTo("memories", m.id)}
          testId={`${testId}-${m.id}`}
          title={firstLine(m.content)}
        />
      ))}
    </PlaceList>
  );
}

/** What it said as the hour ended, its **bold** kept bold. */
function Said({ text }: { text: string }) {
  const parts = text.split(/\n\s*\n/).filter((p) => p.trim());
  return (
    <div className="luca-mnemos-words text-base" data-testid="mnemos-hour-said">
      {parts.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of one fixed text, never reordered.
        <p key={i}>
          {part
            .replace(/`([^`\n]+)`/g, "$1")
            .split(/\*\*(.+?)\*\*/g)
            .map((bit, j) =>
              j % 2 ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed paragraph.
                <b key={j}>{bit}</b>
              ) : (
                bit
              ),
            )}
        </p>
      ))}
    </div>
  );
}
