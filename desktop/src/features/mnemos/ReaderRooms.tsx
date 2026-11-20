import * as React from "react";

import {
  PlaceList,
  PlaceListRow,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { beliefOf, handoffOf } from "./adapt";
import type { BookBelief, BookHandoff } from "./book";
import { longDay, PlaceLine, QuietLine, RoomFrame, Words } from "./MnemosParts";
import { firstLine } from "./notebook";
import { setRoomCounts } from "./placeStore";
import type { RoomProps } from "./roomKit";
import { useReaderSection } from "./useReader";

/** A belief's confidence, as the notebook says it: "held at 72%". */
export const heldAt = (confidence: number | undefined) =>
  confidence === undefined ? null : `held at ${Math.round(confidence * 100)}%`;

/** Beliefs (WP-45, Decided 5), through the old reader: what it believes,
 *  each with how firmly. */
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

/** Carrying forward (WP-45, Decided 5), through the old reader: the notes
 *  it left itself, newest first. */
export function CarryingRoom({ mind, reader }: RoomProps) {
  const handoffs = useReaderSection(reader, "handoffs", handoffOf);
  return (
    <ReaderList<BookHandoff>
      backLabel="Carrying forward"
      count={(n) => setRoomCounts(mind.id, { carrying: n })}
      empty="It hasn’t left itself anything to carry forward."
      items={handoffs.items}
      line={handoffs.line}
      note={(h) => placeNoteTime(h.at)}
      opened={(h) => (
        <article aria-label="Carried forward" data-testid="mnemos-carry-opened">
          <Words text={h.text} />
          <QuietLine parts={[h.at ? `Left ${longDay(h.at)}` : null]} />
        </article>
      )}
      testId="mnemos-carrying"
    />
  );
}

/** A list the old reader gives (its items carry no ids, so what's open is
 *  this room's own, not the address's). */
function ReaderList<T extends { text: string }>({
  backLabel,
  count,
  empty,
  items,
  line,
  note,
  opened,
  testId,
}: {
  backLabel: string;
  count: (n: number) => void;
  empty: string;
  items: T[] | null;
  line: string | null;
  note: (item: T) => string;
  opened: (item: T) => React.ReactNode;
  testId: string;
}) {
  const [open, setOpen] = React.useState<number | null>(null);
  const countRef = React.useRef(count);
  countRef.current = count;
  React.useEffect(() => {
    if (items) countRef.current(items.length);
  }, [items]);
  const item = open === null ? null : (items?.[open] ?? null);
  return (
    <RoomFrame
      backLabel={backLabel}
      first={items?.length ? "0" : null}
      onOpenFirst={() => setOpen(0)}
      openedKey={item ? String(open) : null}
      list={
        line ? (
          <PlaceLine testId="mnemos-reader-line">{line}</PlaceLine>
        ) : !items ? null : items.length === 0 ? (
          <PlaceLine>{empty}</PlaceLine>
        ) : (
          <PlaceList testId={`${testId}-list`}>
            {items.map((each, index) => (
              <PlaceListRow
                aria-current={index === open ? "true" : undefined}
                // biome-ignore lint/suspicious/noArrayIndexKey: the reader gives these no id; the list is read once and never reordered.
                key={index}
                note={note(each)}
                onOpen={() => setOpen(index)}
                title={firstLine(each.text)}
              />
            ))}
          </PlaceList>
        )
      }
      onBack={() => setOpen(null)}
      opened={item ? opened(item) : null}
      testId={testId}
    />
  );
}
