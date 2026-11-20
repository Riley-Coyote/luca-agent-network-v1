import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { BookNote } from "../book";
import { draftKey } from "../drafts";
import { useLoad } from "../MnemosParts";
import { threads, waitingOnYou } from "../notebook";
import { setRoomCounts } from "../placeStore";
import { DIDNT_ANSWER, type RoomProps } from "../roomKit";
import { useSentNotes, wokenWords } from "../TalkRooms";
import { WriteField } from "../WriteField";
import { Cut } from "./Cut";

/**
 * What waits on the person (WP-45; WP-47, Decided 3): the mind's questions,
 * one at a time, each answered in place.
 */
export function WaitingPlate({
  book,
  goTo,
  head,
  mind,
  writes,
}: Pick<RoomProps, "book" | "goTo" | "mind" | "writes"> & {
  /** On the whole board: the head goes to Notes, with how many wait. */
  head?: boolean;
}) {
  const notes = useLoad(() => book.notes(), [book]);
  const sent = useSentNotes();
  const noteList = React.useMemo(
    () => sent.onto(notes.value),
    [notes.value, sent.onto],
  );
  /** The thread the person just answered here, to say where it went. */
  const [answered, setAnswered] = React.useState<{
    thread: string;
    note: BookNote;
  } | null>(null);
  const waiting = React.useMemo(
    () => waitingOnYou(threads(noteList ?? [])),
    [noteList],
  );
  React.useEffect(() => {
    if (noteList) setRoomCounts(mind.id, { notes: noteList.length });
  }, [mind.id, noteList]);
  const [step, setStep] = React.useState(0);
  const ask = waiting[Math.min(step, waiting.length - 1)] ?? null;
  return (
    <Plate
      className={head ? "luca-mnemos-board-waiting" : undefined}
      go={head ? () => goTo("notes") : undefined}
      label="Waiting on you"
      more={
        head && noteList
          ? waiting.length
            ? String(waiting.length)
            : "none"
          : undefined
      }
      testId="mnemos-plate-waiting"
    >
      {notes.failed ? (
        <Quiet>{DIDNT_ANSWER}</Quiet>
      ) : !notes.value ? null : (
        <>
          {answered ? (
            <p
              className="luca-mnemos-sent text-sm"
              data-testid="mnemos-glance-sent"
              role="status"
            >
              Your answer is in Notes; {wokenWords(answered.note)}.{" "}
              <button
                className="luca-mnemos-link"
                onClick={() => goTo("notes", answered.thread)}
                type="button"
              >
                Open it
              </button>
            </p>
          ) : null}
          {!ask ? (
            answered ? null : (
              <Quiet>Nothing is waiting on you.</Quiet>
            )
          ) : (
            <>
              {head ? (
                <Cut className="text-base" lines={4}>
                  {ask.last.text}
                </Cut>
              ) : (
                <p className="luca-mnemos-clamp text-base">{ask.last.text}</p>
              )}
              <WriteField
                draft={draftKey(mind.id, `reply:${ask.last.id}`)}
                key={ask.last.id}
                label="Your answer, in your own words"
                onSend={async (text) => {
                  const note = await writes.reply(ask.last.id, text);
                  sent.add(note);
                  setAnswered({ thread: ask.id, note });
                }}
                sendLabel="Send"
                testId="mnemos-glance-answer"
              />
              <div className="luca-mnemos-plate-foot">
                <button
                  className="luca-mnemos-link text-sm"
                  data-testid="mnemos-open-thread"
                  onClick={() => goTo("notes", ask.id)}
                  type="button"
                >
                  Open the thread
                </button>
                {waiting.length > 1 ? (
                  <span className="luca-mnemos-steps">
                    <button
                      aria-label="The one before"
                      className="luca-mnemos-step"
                      disabled={step === 0}
                      onClick={() => setStep((x) => Math.max(0, x - 1))}
                      type="button"
                    >
                      <ChevronLeft aria-hidden />
                    </button>
                    <span className="text-2xs tabular-nums" aria-live="polite">
                      {Math.min(step, waiting.length - 1) + 1} of{" "}
                      {waiting.length}
                    </span>
                    <button
                      aria-label="The next one"
                      className="luca-mnemos-step"
                      disabled={step >= waiting.length - 1}
                      onClick={() =>
                        setStep((x) => Math.min(waiting.length - 1, x + 1))
                      }
                      type="button"
                    >
                      <ChevronRight aria-hidden />
                    </button>
                  </span>
                ) : null}
              </div>
            </>
          )}
        </>
      )}
    </Plate>
  );
}

/** A plate of the board: its label, and on the whole board a head that
 *  goes to its section, with a quiet word on the right. */
export function Plate({
  children,
  className,
  go,
  label,
  more,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  /** Goes to the plate's section. */
  go?: () => void;
  label: string;
  more?: React.ReactNode;
  testId: string;
}) {
  return (
    <section
      aria-label={label}
      className={
        className ? `luca-mnemos-plate ${className}` : "luca-mnemos-plate"
      }
      data-testid={testId}
    >
      <h2 className="luca-mnemos-plate-label text-xs">
        {go ? (
          <button
            className="luca-mnemos-plate-head"
            data-testid={`${testId}-head`}
            onClick={go}
            type="button"
          >
            <span>{label}</span>
            {more ? (
              <span className="luca-mnemos-plate-more tabular-nums">
                {more}
              </span>
            ) : null}
          </button>
        ) : (
          label
        )}
      </h2>
      {children}
    </section>
  );
}

export function Quiet({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <p className="luca-mnemos-quiet text-sm" data-testid={testId}>
      {children}
    </p>
  );
}
