import * as React from "react";

import {
  PlaceList,
  PlaceListRow,
  placeNoteTime,
} from "@/app/shell/placeRails/PlacePage";
import { handoffOf } from "./adapt";
import type { BookHandoff } from "./book";
import { longDay, PlaceLine, QuietLine, RoomFrame, Words } from "./MnemosParts";
import { ItemsRoom } from "./ItemsRoom";
import { sameModel } from "./memoryArrange";
import { firstLine, modelName } from "./notebook";
import { leftKey } from "./notebookLog";
import { setRoomCounts } from "./placeStore";
import type { NotebookView, RoomProps } from "./roomKit";
import { useReaderSection } from "./useReader";

/** A belief's confidence, as the notebook says it: "held at 72%". */
export const heldAt = (confidence: number | undefined) =>
  confidence === undefined ? null : `held at ${Math.round(confidence * 100)}%`;

/** Carrying forward: the notes it left itself, newest first. From the
 *  notebook's own list (`life.handoffs`) on a Mnemos that gives it, with
 *  who signed each; else through the old reader. */
export function CarryingRoom(props: RoomProps) {
  if (props.notebook)
    return <NotebookCarrying notebook={props.notebook} props={props} />;
  return <ReaderCarrying {...props} />;
}

function NotebookCarrying({
  notebook,
  props,
}: {
  notebook: NotebookView;
  props: RoomProps;
}) {
  const { handoffs, identity } = notebook.life;
  const left = handoffs
    .map((handoff) => ({ handoff, key: leftKey(handoff) }))
    .sort((a, b) => time(b.handoff.at ?? null) - time(a.handoff.at ?? null));
  const signed = (model: string | undefined) =>
    !model
      ? null
      : sameModel(model, identity.model)
        ? "the note it left itself"
        : `left by ${modelName(model)}, a colleague`;
  return (
    <ItemsRoom
      backLabel="Carrying forward"
      empty="It hasn’t left itself anything to carry forward."
      groups={[
        {
          items: left.map(({ handoff, key }) => ({
            key,
            title: firstLine(handoff.text),
            note: placeNoteTime(handoff.at),
            summary: signed(handoff.model) ?? undefined,
            opened: () => (
              <article
                aria-label="Carried forward"
                data-testid="mnemos-carry-opened"
              >
                <Words text={handoff.text} />
                <QuietLine
                  parts={[
                    handoff.at ? `Left ${longDay(handoff.at)}` : null,
                    signed(handoff.model),
                  ]}
                  testId="mnemos-carry-line"
                />
              </article>
            ),
          })),
        },
      ]}
      needs="Carrying forward"
      props={props}
      testId="mnemos-carrying"
    />
  );
}

const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

function ReaderCarrying({ mind, reader }: RoomProps) {
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
export function ReaderList<T extends { text: string }>({
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
