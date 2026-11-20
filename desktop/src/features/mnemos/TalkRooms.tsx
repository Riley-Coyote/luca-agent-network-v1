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
  withNote,
  writtenWords,
} from "./notebook";
import { setRoomCounts } from "./placeStore";
import { DIDNT_ANSWER, type RoomProps, useAddressItem } from "./roomKit";
import { draftKey, readDraft } from "./drafts";
import { WriteField } from "./WriteField";

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
      addressed={item}
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
 * Notes (WP-45, Decided 5; WP-47, Decided 1 and 2; WP-48, 0a): first, a row
 * to leave a note of your own, which opens its field beside the list; then
 * the notes both ways, gathered into threads by what each
 * answers, what's waiting on you first; a dot on a note of its own you
 * haven't read, by the engine's own record. An opened thread ends in a field
 * for your answer. Reading here marks nothing read; answering does, as the
 * engine does.
 */
export function NotesRoom({ book, mind, item, openItem, writes }: RoomProps) {
  const notes = useLoad(() => book.notes(), [book]);
  const sent = useSentNotes();
  const list = React.useMemo(
    () => sent.onto(notes.value),
    [notes.value, sent.onto],
  );
  const all = React.useMemo(() => threads(list ?? []), [list]);
  React.useEffect(() => {
    if (list) setRoomCounts(mind.id, { notes: list.length });
  }, [list, mind.id]);
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
  // Leaving a note is the list's first row; opened, its field is the thing
  // opened. It isn't in the address: the address names only the engine's.
  const [leaving, setLeaving] = React.useState(false);
  React.useEffect(() => {
    if (item !== null) setLeaving(false);
  }, [item]);
  const leave = () => {
    setLeaving(true);
    if (item !== null) openItem(null, { replace: true });
  };

  const rows = (group: Thread[]) =>
    group.map((t) => (
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
      addressed={item}
      backLabel="Notes"
      first={(waiting[0] ?? rest[0])?.id ?? null}
      onOpenFirst={(id) => openItem(id, { replace: true })}
      openedKey={leaving ? "leave" : thread ? thread.id : null}
      list={
        <>
          {notes.value ? (
            <PlaceList testId="mnemos-leave">
              <PlaceListRow
                aria-current={leaving ? "true" : undefined}
                onOpen={leave}
                summary={
                  readDraft(draftKey(mind.id, "note"))
                    ? "Your note isn’t sent yet."
                    : "It wakes with it, once, in its next session."
                }
                testId="mnemos-leave-row"
                title={`Leave ${mind.name} a note`}
              />
            </PlaceList>
          ) : null}
          {notes.failed ? (
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
          )}
        </>
      }
      onBack={() => (leaving ? setLeaving(false) : openItem(null))}
      opened={
        leaving ? (
          <article aria-label="A note for it" data-testid="mnemos-leave-opened">
            <h2 className="luca-mnemos-title text-base">
              Leave {mind.name} a note
            </h2>
            <p className="luca-mnemos-quiet text-sm">
              It wakes with it, once, in its next session. Write it the way
              you’d say it.
            </p>
            <WriteField
              draft={draftKey(mind.id, "note")}
              hideLabel
              label={`Leave ${mind.name} a note`}
              onSend={async (text) => {
                const note = await writes.note(text);
                sent.add(note);
                // The note's own thread opens; leaving ends when the address
                // names it, so nothing else opens in between.
                openItem(note.id);
              }}
              sendLabel="Leave note"
              testId="mnemos-leave-note"
            />
          </article>
        ) : thread ? (
          <ThreadOpened
            mindId={mind.id}
            mindName={mind.name}
            onAnswer={async (noteId, text) =>
              sent.add(await writes.reply(noteId, text))
            }
            thread={thread}
          />
        ) : null
      }
      testId="mnemos-notes"
    />
  );
}

/** The person's notes sent from this room, laid onto what the engine last
 *  gave, so each is in its thread at once and kept once. */
export function useSentNotes() {
  const [sent, setSent] = React.useState<BookNote[]>([]);
  const add = React.useCallback(
    (note: BookNote) => setSent((before) => withNote(before, note)),
    [],
  );
  const onto = React.useCallback(
    (base: BookNote[] | null) =>
      base ? sent.reduceRight((acc, note) => withNote(acc, note), base) : null,
    [sent],
  );
  return { add, onto };
}

/** Whether the mind has woken with a note of yours (the notebook's own
 *  words): it reaches it, once, when it next wakes. */
export function wokenWords(note: Pick<BookNote, "delivered">): string {
  return note.delivered
    ? `it has woken with this, ${longDay(note.delivered)}`
    : "it wakes with this, once, in its next session";
}

function ThreadOpened({
  mindId,
  mindName,
  onAnswer,
  thread,
}: {
  mindId: string;
  mindName: string;
  onAnswer: (noteId: string, text: string) => Promise<void>;
  thread: Thread;
}) {
  // An answer answers the mind's last word here. Once you have answered,
  // the thread waits on it, not you, so the field goes until it writes.
  const answers = thread.last.author === "agent" ? thread.last : null;
  return (
    <article aria-label="Notes" data-testid="mnemos-thread-opened">
      <ol className="luca-mnemos-thread">
        {thread.notes.map((n) => (
          <li data-note={n.id} key={n.id}>
            <p className="luca-mnemos-meta text-2xs">
              <span>{n.author === "agent" ? mindName : "You"}</span>
              <span> · {longDay(n.at)}</span>
              {n.author === "agent" && n.model ? (
                <span> · signed {modelName(n.model)}</span>
              ) : null}
              {n.author === "person" ? (
                <span data-testid="mnemos-note-woken"> · {wokenWords(n)}</span>
              ) : null}
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
      {answers ? (
        <WriteField
          draft={draftKey(mindId, `reply:${answers.id}`)}
          key={thread.id}
          label="Your answer, in your own words"
          onSend={(text) => onAnswer(answers.id, text)}
          sendLabel="Send"
          testId="mnemos-answer"
        />
      ) : null}
    </article>
  );
}
