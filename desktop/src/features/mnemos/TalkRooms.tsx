import * as React from "react";

import {
  PlaceList,
  PlaceListRow,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { UNREAD_DOT_CLASS } from "@/features/sidebar/ui/ChatList";
import type { BookNote } from "./book";
import {
  longDay,
  PlaceLine,
  QuietLine,
  RoomFrame,
  useLoad,
  Words,
} from "./MnemosParts";
import {
  firstLine,
  modelName,
  type Thread,
  threads,
  titleOf,
  unread,
  writtenWords,
} from "./notebook";
import { setRoomCounts } from "./placeStore";
import { DIDNT_ANSWER, type RoomProps, useAddressItem } from "./roomKit";

/** How many entries the Journal lists (the notebook's whole journal, to the
 *  place's limit). */
export const JOURNAL_LAST = 500;

/** Journal (WP-45, Decided 5): entries by date, each titled by its own
 *  first sentence with its mood; the whole entry opened. */
export function JournalRoom({ book, mind, item, openItem }: RoomProps) {
  const entries = useLoad(() => book.journal(JOURNAL_LAST), [book]);
  React.useEffect(() => {
    // At the limit the count would undersay it, so the rail shows none.
    if (entries.value && entries.value.length < JOURNAL_LAST)
      setRoomCounts(mind.id, { journal: entries.value.length });
  }, [entries.value, mind.id]);
  const list = entries.value ?? [];
  const opened = useAddressItem(
    mind.id,
    item,
    (id) => list.some((e) => e.id === id),
    entries.value !== null || entries.failed !== null,
    openItem,
  );
  const entry = list.find((e) => e.id === opened) ?? null;
  const title = entry ? titleOf(entry.text) : null;

  return (
    <RoomFrame
      backLabel="Journal"
      first={list[0]?.id ?? null}
      onOpenFirst={(id) => openItem(id, { replace: true })}
      openedKey={entry ? entry.id : null}
      list={
        entries.failed ? (
          <PlaceLine action={{ label: "Try again", run: entries.again }}>
            {DIDNT_ANSWER}
          </PlaceLine>
        ) : !entries.value ? null : list.length === 0 ? (
          <PlaceLine>It hasn’t written in its journal yet.</PlaceLine>
        ) : (
          <PlaceList testId="mnemos-journal-list">
            {list.map((e) => (
              <PlaceListRow
                aria-current={e.id === opened ? "true" : undefined}
                key={e.id}
                note={placeNoteTime(e.at)}
                onOpen={() => openItem(e.id)}
                summary={e.mood ? `mood, in its words: ${e.mood}` : undefined}
                testId={`mnemos-entry-${e.id}`}
                title={titleOf(e.text).title}
              />
            ))}
          </PlaceList>
        )
      }
      onBack={() => openItem(null)}
      opened={
        entry && title ? (
          <article
            aria-label="A journal entry"
            data-testid="mnemos-entry-opened"
          >
            <h2 className="luca-mnemos-title text-base">{title.title}</h2>
            {title.body ? <Words text={title.body} /> : null}
            <QuietLine
              parts={[
                longDay(entry.at),
                entry.mood ? `mood, in its words: ${entry.mood}` : null,
                entry.written ? writtenWords(entry.written) : null,
                entry.model ? `signed ${modelName(entry.model)}` : null,
              ]}
              testId="mnemos-entry-line"
            />
          </article>
        ) : null
      }
      testId="mnemos-journal"
    />
  );
}

/**
 * Notes (WP-45, Decided 5): the notes both ways, gathered into threads by
 * what each answers; what's waiting on you first; a dot on a note of its
 * own you haven't read, by the engine's own record. Reading here marks
 * nothing read, and nothing here writes.
 */
export function NotesRoom({ book, mind, item, openItem }: RoomProps) {
  const notes = useLoad(() => book.notes(), [book]);
  const all = React.useMemo(() => threads(notes.value ?? []), [notes.value]);
  React.useEffect(() => {
    if (notes.value) setRoomCounts(mind.id, { notes: notes.value.length });
  }, [notes.value, mind.id]);
  const waiting = all.filter((t) => t.waits);
  const rest = all.filter((t) => !t.waits);
  const opened = useAddressItem(
    mind.id,
    item,
    (id) => all.some((t) => t.id === id),
    notes.value !== null || notes.failed !== null,
    openItem,
  );
  const thread = all.find((t) => t.id === opened) ?? null;

  const rows = (list: Thread[]) =>
    list.map((t) => (
      <PlaceListRow
        aria-current={t.id === opened ? "true" : undefined}
        key={t.id}
        note={
          <>
            {t.notes.some(unread) ? (
              <span
                aria-label="not read yet"
                className={`${UNREAD_DOT_CLASS} luca-mnemos-dot`}
                data-testid={`mnemos-unread-${t.id}`}
                role="img"
              />
            ) : null}
            {placeNoteTime(t.last.at)}
          </>
        }
        onOpen={() => openItem(t.id)}
        summary={
          t.last.author === "person"
            ? `you wrote last · ${wokenWords(t.last)}`
            : undefined
        }
        testId={`mnemos-thread-${t.id}`}
        title={firstLine(t.last.text)}
      />
    ));

  return (
    <RoomFrame
      backLabel="Notes"
      first={(waiting[0] ?? rest[0])?.id ?? null}
      onOpenFirst={(id) => openItem(id, { replace: true })}
      openedKey={thread ? thread.id : null}
      list={
        notes.failed ? (
          <PlaceLine action={{ label: "Try again", run: notes.again }}>
            {DIDNT_ANSWER}
          </PlaceLine>
        ) : !notes.value ? null : all.length === 0 ? (
          <PlaceLine>
            No notes yet. It leaves one only when it passes the room test:
            something it would say if you walked in right now.
          </PlaceLine>
        ) : (
          <>
            {waiting.length ? (
              <PlaceList
                count={waiting.length}
                label="Waiting on you"
                testId="mnemos-notes-waiting"
              >
                {rows(waiting)}
              </PlaceList>
            ) : null}
            {rest.length ? (
              <PlaceList
                count={rest.length}
                label={waiting.length ? "Earlier" : "Notes"}
                testId="mnemos-notes-earlier"
              >
                {rows(rest)}
              </PlaceList>
            ) : null}
          </>
        )
      }
      onBack={() => openItem(null)}
      opened={
        thread ? (
          <ThreadOpened mindName={mind.name} notes={thread.notes} />
        ) : null
      }
      testId="mnemos-notes"
    />
  );
}

/** Whether the mind has woken with a note of yours (the notebook's own
 *  words): it reaches it, once, when it next wakes. */
export function wokenWords(note: Pick<BookNote, "delivered">): string {
  return note.delivered
    ? `it has woken with this, ${longDay(note.delivered)}`
    : "it wakes with this, once, in its next session";
}

function ThreadOpened({
  mindName,
  notes,
}: {
  mindName: string;
  notes: BookNote[];
}) {
  return (
    <article aria-label="Notes" data-testid="mnemos-thread-opened">
      <ol className="luca-mnemos-thread">
        {notes.map((n) => (
          <li key={n.id}>
            <p className="luca-mnemos-meta text-2xs">
              <span>{n.author === "agent" ? mindName : "You"}</span>
              <span> · {longDay(n.at)}</span>
              {n.author === "agent" && n.model ? (
                <span> · signed {modelName(n.model)}</span>
              ) : null}
              {n.author === "person" ? <span> · {wokenWords(n)}</span> : null}
              {unread(n) ? (
                <span
                  aria-label="not read yet"
                  className={`${UNREAD_DOT_CLASS} luca-mnemos-dot`}
                  role="img"
                />
              ) : null}
            </p>
            <Words text={n.text} />
          </li>
        ))}
      </ol>
    </article>
  );
}
