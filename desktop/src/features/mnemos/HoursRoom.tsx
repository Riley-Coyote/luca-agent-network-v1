import { placeNoteTime } from "@/app/shell/placeRails/PlacePage";
import { ItemsRoom } from "./ItemsRoom";
import { longDay, QuietLine, Words } from "./MnemosParts";
import { KIND, trailSentence } from "./notebookWords";
import type { RoomProps } from "./roomKit";

/** Hours: its quiet hours, newest first, each with what it did. */
export function HoursRoom(props: RoomProps) {
  const hours = props.notebook?.life.hours ?? null;
  return (
    <ItemsRoom
      backLabel="Hours"
      empty="It hasn’t had a quiet hour yet."
      groups={
        hours && [
          {
            items: hours.map((hour) => ({
              key: hour.id,
              title: KIND[hour.kind] ?? "An hour",
              note: placeNoteTime(hour.start),
              summary: hour.practice ? "practice" : undefined,
              opened: () => (
                <article
                  aria-label="A quiet hour"
                  data-testid="mnemos-hour-opened"
                >
                  {hour.said ? <Words text={hour.said} /> : null}
                  <p className="luca-mnemos-quiet text-sm">
                    {trailSentence(hour)}
                  </p>
                  <QuietLine
                    parts={[
                      longDay(hour.start),
                      hour.minutes !== null
                        ? `${Math.round(hour.minutes)} minutes`
                        : null,
                      hour.modelName || null,
                    ]}
                  />
                </article>
              ),
            })),
          },
        ]
      }
      needs="Hours"
      props={props}
      testId="mnemos-hours"
    />
  );
}
