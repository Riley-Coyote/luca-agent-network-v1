import { beliefOf } from "./adapt";
import type { BookBelief } from "./book";
import { longDay, QuietLine, Words } from "./MnemosParts";
import { setRoomCounts } from "./placeStore";
import { heldAt, ReaderList } from "./ReaderRooms";
import type { RoomProps } from "./roomKit";
import { useReaderSection } from "./useReader";

/** Beliefs (WP-45, Decided 5): what it believes, each with how firmly. From
 *  the notebook on a Mnemos that gives it, else through the old reader. */
export function BeliefsRoom({ mind, reader }: RoomProps) {
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
