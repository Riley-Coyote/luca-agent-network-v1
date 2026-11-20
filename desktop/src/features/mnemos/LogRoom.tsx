import type * as React from "react";

import { PlaceList, PlaceListRow } from "@/app/shell/placeRails/PlacePage";
import { ItemsRoom } from "./ItemsRoom";
import { sameModel } from "./memoryArrange";
import { firstLine, modelName, titleOf } from "./notebook";
import {
  dayItemKey,
  dayName,
  dayWords,
  type LogDay,
  type LogEvent,
  logDays,
} from "./notebookLog";
import { KIND, question, trailSentence } from "./notebookWords";
import type { RoomProps } from "./roomKit";

/** Formed memories a day lists before saying how many more. */
const FORMED_SHOWN = 12;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const percent = (n: number | null) => `${Math.round((n ?? 0) * 100)}%`;

/**
 * Log: the notebook's days, newest first. A day opened lists, in order, its
 * hours, journal entries, notes, what the mind left itself, questions
 * answered, belief changes and the memories formed; each line opens that
 * thing in its own section.
 */
export function LogRoom(props: RoomProps) {
  const notebook = props.notebook;
  const days = notebook
    ? logDays(notebook.life, notebook.memories.memories)
    : null;
  const who = notebook?.life.identity;
  return (
    <ItemsRoom
      backLabel="Log"
      empty="Nothing yet. As it works with you, learns, writes and rests, its days gather here."
      groups={
        days && [
          {
            items: days.map((day) => ({
              key: dayItemKey(day.day),
              title: dayName(day.at),
              summary: dayWords(day),
              opened: () => (
                <Day
                  day={day}
                  goTo={props.goTo}
                  model={who?.model ?? ""}
                  person={who?.person ?? null}
                />
              ),
            })),
          },
        ]
      }
      needs="The log"
      props={props}
      testId="mnemos-log"
    />
  );
}

function Day({
  day,
  goTo,
  model,
  person,
}: {
  day: LogDay;
  goTo: RoomProps["goTo"];
  model: string;
  person: string | null;
}) {
  const rows: React.ReactNode[] = [];
  const row = (
    key: string,
    at: string,
    kind: string,
    title: string,
    open: () => void,
  ) =>
    rows.push(
      <PlaceListRow
        data-log-event={key}
        key={key}
        note={clock(at)}
        onOpen={open}
        summary={kind}
        testId={`mnemos-log-event-${key}`}
        title={title}
      />,
    );
  for (const event of day.events)
    eventRows(event, { goTo, model, person, row });
  return (
    <article aria-label="A day" data-testid="mnemos-log-day">
      <PlaceList label={dayName(day.at)} testId="mnemos-log-events">
        {rows}
      </PlaceList>
    </article>
  );
}

/** One event's lines, each going to that thing in its own section. */
function eventRows(
  event: LogEvent,
  {
    goTo,
    model,
    person,
    row,
  }: {
    goTo: RoomProps["goTo"];
    model: string;
    person: string | null;
    row: (
      key: string,
      at: string,
      kind: string,
      title: string,
      open: () => void,
    ) => void;
  },
) {
  const colleague = (signed: string) =>
    signed && model && !sameModel(signed, model)
      ? `signed ${modelName(signed)}`
      : null;
  const join = (...parts: (string | null | false)[]) =>
    parts.filter(Boolean).join(" · ");
  switch (event.type) {
    case "hour": {
      const h = event.hour;
      row(
        `hour-${h.id}`,
        event.at,
        join(KIND[h.kind] ?? "An hour", h.practice && "practice"),
        trailSentence(h),
        () => goTo("hours", h.id),
      );
      // What it wrote in the hour, under the hour.
      for (const e of [...event.journal].reverse())
        row(
          `journal-${e.id}`,
          e.at ?? event.at,
          join("Its journal, in the hour", e.mood && `mood: ${e.mood}`),
          titleOf(e.text).title || firstLine(e.text),
          () => goTo("journal", e.id),
        );
      for (const { note, thread } of event.notes)
        row(
          `note-${note.id}`,
          note.at ?? event.at,
          join(
            person
              ? `A note for ${person}, in the hour`
              : "A note for you, in the hour",
            h.practice && "written in practice",
            note.read ? "read" : "not yet read",
          ),
          firstLine(note.text),
          () => goTo("notes", thread),
        );
      return;
    }
    case "journal": {
      const e = event.entry;
      row(
        `journal-${e.id}`,
        event.at,
        join("Journal", e.mood && `mood: ${e.mood}`),
        titleOf(e.text).title || firstLine(e.text),
        () => goTo("journal", e.id),
      );
      return;
    }
    case "note": {
      const n = event.note;
      const mine = n.author === "agent";
      row(
        `note-${n.id}`,
        event.at,
        mine
          ? join(
              person ? `A note for ${person}` : "A note for you",
              n.read ? "read" : "not yet read",
            )
          : `From ${person ?? "you"}`,
        firstLine(n.text),
        () => goTo("notes", event.thread),
      );
      return;
    }
    case "left": {
      // Its notes often open with a signature line; say what comes after.
      const lines = event.left.text.split("\n").filter((l) => l.trim());
      const lead =
        lines.length > 1 && /^left by /i.test(lines[0] ?? "")
          ? lines.slice(1).join("\n")
          : event.left.text;
      row(
        `left-${event.key}`,
        event.at,
        join("Note to itself", colleague(event.left.model ?? "")),
        firstLine(lead),
        () => goTo("carrying", event.key),
      );
      return;
    }
    case "answer":
      row(
        `answer-${event.key}`,
        event.at,
        "Answered its memory",
        question(event.answered.prompt),
        () => goTo("questions", event.key),
      );
      return;
    case "belief": {
      const up = (event.to ?? 0) > (event.from ?? 0);
      row(
        `belief-${event.key}-${event.at}`,
        event.at,
        join(
          up ? "Belief, held more firmly" : "Belief, held less firmly",
          `${percent(event.from)} → ${percent(event.to)}`,
        ),
        firstLine(event.belief.text),
        () => goTo("beliefs", event.key),
      );
      return;
    }
    case "formed": {
      for (const m of event.memories.slice(0, FORMED_SHOWN))
        row(
          `formed-${m.id}`,
          m.born ?? event.at,
          join("Memory formed", m.lesson === true && "a lesson"),
          firstLine(m.content),
          () => goTo("memories", m.id),
        );
      const more = event.memories.length - FORMED_SHOWN;
      if (more > 0)
        row(
          `formed-more-${event.at}`,
          event.at,
          "Memories",
          `and ${more.toLocaleString("en-US")} more, in Memories`,
          () => goTo("memories"),
        );
      return;
    }
  }
}
