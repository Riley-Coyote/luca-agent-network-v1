import {
  PlaceList,
  PlaceListRow,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { beliefOf } from "./adapt";
import type { BookBelief, BookMemory } from "./book";
import { ItemsRoom } from "./ItemsRoom";
import { longDay, QuietLine, Words } from "./MnemosParts";
import { firstLine } from "./notebook";
import { beliefKey } from "./notebookLog";
import { plural, restsOnWords } from "./notebookWords";
import { setRoomCounts } from "./placeStore";
import { heldAt, ReaderList } from "./ReaderRooms";
import type { NotebookView, RoomProps } from "./roomKit";
import { useReaderSection } from "./useReader";

/** Beliefs: what it believes, each with how firmly. From the notebook on a
 *  Mnemos that gives it (with what each rests on, and its history), else
 *  through the old reader. */
export function BeliefsRoom(props: RoomProps) {
  if (props.notebook)
    return <NotebookBeliefs notebook={props.notebook} props={props} />;
  return <ReaderBeliefs {...props} />;
}

function ReaderBeliefs({ mind, reader }: RoomProps) {
  const beliefs = useReaderSection(reader, "beliefs", beliefOf);
  return (
    <ReaderList<BookBelief>
      backLabel="Beliefs"
      count={(n) => setRoomCounts(mind.id, { beliefs: n })}
      empty="It hasn’t formed a belief yet."
      items={beliefs.items}
      line={beliefs.line}
      note={(b) => heldAt(b.confidence) ?? ""}
      opened={(b) => (
        <article aria-label="A belief" data-testid="mnemos-belief-opened">
          <Words text={b.text} />
          <QuietLine
            parts={[
              heldAt(b.confidence),
              b.born ? `since ${longDay(b.born)}` : null,
            ]}
          />
        </article>
      )}
      testId="mnemos-beliefs"
    />
  );
}

const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

function NotebookBeliefs({
  notebook,
  props,
}: {
  notebook: NotebookView;
  props: RoomProps;
}) {
  const { life, memories } = notebook;
  const byId = new Map(memories.memories.map((m) => [m.id, m]));
  // Held most firmly first, the latest revised first among equals; each
  // keeps its place in the notebook's list as its key.
  const held = life.beliefs
    .map((belief) => ({ belief, key: beliefKey(belief) }))
    .sort(
      (a, b) =>
        (b.belief.confidence ?? 0) - (a.belief.confidence ?? 0) ||
        time(b.belief.revised ?? b.belief.born ?? null) -
          time(a.belief.revised ?? a.belief.born ?? null),
    );
  return (
    <ItemsRoom
      backLabel="Beliefs"
      empty="No beliefs yet. One forms only when it says yes to a question its memory asks."
      groups={[
        {
          items: held.map(({ belief, key }) => ({
            key,
            title: firstLine(belief.text, 200),
            note: heldAt(belief.confidence) ?? undefined,
            summary: placeNoteTime(belief.revised ?? belief.born) || undefined,
            opened: () => (
              <BeliefOpened
                belief={belief}
                model={life.identity.model}
                onOpen={(id) => props.goTo("memories", id)}
                restsOn={(belief.supports ?? [])
                  .map((id) => byId.get(id))
                  .filter((m): m is BookMemory => m !== undefined)}
              />
            ),
          })),
        },
      ]}
      needs="Beliefs"
      props={props}
      testId="mnemos-beliefs"
    />
  );
}

function BeliefOpened({
  belief,
  model,
  onOpen,
  restsOn,
}: {
  belief: BookBelief;
  model: string;
  onOpen: (memory: string) => void;
  restsOn: BookMemory[];
}) {
  const firm = Math.round((belief.confidence ?? 0) * 100);
  const history = belief.history ?? [];
  const down = history.filter((h) => (h.to ?? 0) < (h.from ?? 0)).length;
  const up = history.filter((h) => (h.to ?? 0) > (h.from ?? 0)).length;
  const rests = restsOnWords(restsOn, model);
  return (
    <article aria-label="A belief" data-testid="mnemos-belief-opened">
      <Words text={belief.text} />
      <div
        aria-label={`Held at ${firm}%`}
        className="luca-mnemos-held"
        data-testid="mnemos-belief-held"
        role="img"
      >
        <i style={{ width: `${firm}%` }} />
      </div>
      <QuietLine
        parts={[
          `Held at ${firm}%`,
          rests,
          belief.born ? `since ${longDay(belief.born)}` : null,
          down
            ? `lowered ${plural(down, "time")}${up ? ", then raised again" : ""}`
            : null,
        ]}
        testId="mnemos-belief-line"
      />
      {restsOn.length ? (
        <PlaceList
          count={restsOn.length}
          label="What it rests on"
          testId="mnemos-belief-rests"
        >
          {restsOn.map((m) => (
            <PlaceListRow
              key={m.id}
              note={placeNoteTime(m.born)}
              onOpen={() => onOpen(m.id)}
              testId={`mnemos-belief-rests-${m.id}`}
              title={firstLine(m.content)}
            />
          ))}
        </PlaceList>
      ) : null}
      {history.length ? (
        <PlaceList
          count={history.length}
          label="How it has been held"
          testId="mnemos-belief-history"
        >
          {history.map((h, i) => (
            <PlaceListRow
              // biome-ignore lint/suspicious/noArrayIndexKey: a belief's history is the engine's, in order, and never reordered.
              key={i}
              note={placeNoteTime(h.at)}
              title={`From ${Math.round((h.from ?? 0) * 100)}% to ${Math.round((h.to ?? 0) * 100)}%`}
            />
          ))}
        </PlaceList>
      ) : null}
    </article>
  );
}
