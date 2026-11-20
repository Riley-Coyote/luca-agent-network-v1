import {
  PlaceList,
  PlaceListRow,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import type { BookMemory } from "./book";
import { readingsOf } from "./memoryArrange";
import { firstLine } from "./notebook";
import { answeredKey, beliefKey } from "./notebookLog";
import { ASK, KIND, putTo, question, RELATION } from "./notebookWords";
import type { NotebookView, RoomProps } from "./roomKit";

/** Ties an opened memory lists before saying how many more. */
const TIES_SHOWN = 24;

const two = (n: number) => n.toFixed(2);

/**
 * What a newer Mnemos's notebook says about one memory, under its quiet
 * line, as the notebook's page shows it: its readings in one small row, its
 * ties (each opens that memory), the beliefs resting on it, the hours it
 * appeared in, and the questions its memory asked about it, with any
 * answers. Each opens the thing in its own section.
 */
export function MemoryDetail({
  goTo,
  memory,
  notebook,
  onOpenMemory,
  part,
}: {
  goTo: RoomProps["goTo"];
  memory: BookMemory;
  notebook: NotebookView;
  onOpenMemory: (id: string) => void;
  /** Its readings (under its quiet line, above its acts), or what it is
   *  related to (below them), as the notebook's page orders them. */
  part: "readings" | "related";
}) {
  const { life } = notebook;
  const all = notebook.memories.memories;
  const byId = new Map(all.map((m) => [m.id, m]));
  const read = readingsOf(memory, new Set(byId.keys()));
  const ties = (memory.ties ?? []).filter((t) => byId.has(t[0]));
  const beliefs = life.beliefs
    .map((belief, index) => ({ belief, key: beliefKey(index) }))
    .filter(({ belief }) => (belief.supports ?? []).includes(memory.id));
  const hours = life.hours.filter((h) =>
    [...h.trail.woke, ...h.trail.waiting, ...h.trail.reached].includes(
      memory.id,
    ),
  );
  const asked = life.questions.asked.filter((q) => q.about === memory.id);
  const answered = life.questions.answered
    .map((q, index) => ({ q, key: answeredKey(index) }))
    .filter(({ q }) => q.about === memory.id);
  if (part === "readings")
    return (
      <p
        className="luca-mnemos-readings text-2xs"
        data-testid="mnemos-memory-readings"
      >
        {(
          [
            ["strength", two(read.strength)],
            ["stability", two(read.stability)],
            ["reach", two(read.reach)],
            ["links", read.links.toLocaleString("en-US")],
            ["recalled", `${read.recalled.toLocaleString("en-US")}×`],
          ] as const
        ).map(([name, value]) => (
          <span key={name}>
            <i>{name}</i>
            {value}
          </span>
        ))}
      </p>
    );
  if (
    !ties.length &&
    !beliefs.length &&
    !hours.length &&
    !asked.length &&
    !answered.length
  )
    return null;
  return (
    <div className="luca-mnemos-detail" data-testid="mnemos-memory-detail">
      {ties.length ? (
        <PlaceList
          count={ties.length}
          label="Tied to"
          testId="mnemos-memory-ties"
        >
          {ties.slice(0, TIES_SHOWN).map(([id, relation]) => {
            const other = byId.get(id) as BookMemory;
            return (
              <PlaceListRow
                key={id}
                note={placeNoteTime(other.born)}
                onOpen={() => onOpenMemory(id)}
                summary={RELATION[relation] ?? relation}
                testId={`mnemos-memory-tie-${id}`}
                title={firstLine(other.content)}
              />
            );
          })}
          {ties.length > TIES_SHOWN ? (
            <PlaceListRow
              title={`and ${(ties.length - TIES_SHOWN).toLocaleString("en-US")} more`}
            />
          ) : null}
        </PlaceList>
      ) : null}
      {beliefs.length ? (
        <PlaceList
          count={beliefs.length}
          label="Beliefs resting on it"
          testId="mnemos-memory-beliefs"
        >
          {beliefs.map(({ belief, key }) => (
            <PlaceListRow
              key={key}
              note={
                belief.confidence === undefined
                  ? undefined
                  : `held at ${Math.round(belief.confidence * 100)}%`
              }
              onOpen={() => goTo("beliefs", key)}
              title={firstLine(belief.text)}
            />
          ))}
        </PlaceList>
      ) : null}
      {hours.length ? (
        <PlaceList
          count={hours.length}
          label="In its hours"
          testId="mnemos-memory-hours"
        >
          {hours.map((h) => (
            <PlaceListRow
              key={h.id}
              note={placeNoteTime(h.start)}
              onOpen={() => goTo("hours", h.id)}
              summary={h.practice ? "practice" : undefined}
              title={`${KIND[h.kind] ?? "An hour"}: ${
                h.trail.reached.includes(memory.id)
                  ? "reached for it"
                  : h.trail.waiting.includes(memory.id)
                    ? "found it waiting, as a question"
                    : "woke with it in hand"
              }`}
            />
          ))}
        </PlaceList>
      ) : null}
      {asked.length || answered.length ? (
        <PlaceList
          count={asked.length + answered.length}
          label="What its memory asks about it"
          testId="mnemos-memory-questions"
        >
          {asked.map((q) => (
            <PlaceListRow
              key={q.id}
              note={putTo(q.shown)}
              onOpen={() => goTo("questions", q.id)}
              summary={ASK[q.kind]?.[0]}
              title={question(q.prompt)}
            />
          ))}
          {answered.map(({ q, key }) => (
            <PlaceListRow
              key={key}
              note={placeNoteTime(q.at)}
              onOpen={() => goTo("questions", key)}
              summary={q.answer ? `Its answer: ${q.answer}` : undefined}
              title={question(q.prompt)}
            />
          ))}
        </PlaceList>
      ) : null}
    </div>
  );
}
