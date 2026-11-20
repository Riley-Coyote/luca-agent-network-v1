import { placeNoteTime } from "@/app/shell/placeRails/PlacePage";
import { ItemsRoom } from "./ItemsRoom";
import { longDay, QuietLine, Words } from "./MnemosParts";
import { firstLine, modelName } from "./notebook";
import type { RoomProps } from "./roomKit";

/** Shared: the notebook it keeps with you, newest first. */
export function SharedRoom(props: RoomProps) {
  const rows = props.notebook?.life.shared.rows ?? null;
  return (
    <ItemsRoom
      backLabel="Shared"
      empty="Nothing is in the shared notebook yet."
      groups={
        rows && [
          {
            items: rows.map((row) => ({
              key: row.id,
              title: firstLine(row.content),
              note: placeNoteTime(row.born),
              opened: () => (
                <article
                  aria-label="A shared memory"
                  data-testid="mnemos-shared-opened"
                >
                  <Words text={row.content} />
                  <QuietLine
                    parts={[
                      row.born ? `Kept ${longDay(row.born)}` : null,
                      row.author === "person"
                        ? "in your words"
                        : row.model
                          ? `signed ${modelName(row.model)}`
                          : null,
                    ]}
                  />
                </article>
              ),
            })),
          },
        ]
      }
      needs="Shared"
      props={props}
      testId="mnemos-shared"
    />
  );
}
