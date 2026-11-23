import * as React from "react";

import "./mnemos-board.css";

import type { BookLife } from "./book";
import { hourState, nextWords, scheduleOf, soonest } from "./boardWords";
import { arcsOf, DIAL, dialSentence, hourOfDay, pointAt, ticks } from "./dial";

/** The dial's now, read again each minute while it is on screen. */
function useMinute(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The dial (WP-49, Decided 3): the day as a 24-hour face, noon at the top,
 * a hairline in the page's own ink. Arcs where its hours fall, a mark for
 * now, its state and its line in the middle, and under it the soonest hour.
 * It doesn't move. Its text alternative says the same in one sentence.
 */
export function HoursDial({
  life,
  testId = "mnemos-dial",
}: {
  life: Pick<BookLife, "hours" | "memory" | "schedule">;
  testId?: string;
}) {
  const now = useMinute();
  const plan = scheduleOf(life.schedule);
  const { word, rest, hour } = hourState(life, now.getTime());
  const arcs = arcsOf(plan, hour?.kind ?? null);
  const next = soonest(plan, now);
  const [nx, ny] = pointAt(hourOfDay(now));
  const sentence = dialSentence({ arcs, life, next, now });
  // "our hour ended 7 days ago": the kind, then when, on two lines.
  const [what, since] = word
    ? (rest.match(/^(.*? ended) (.*)$/)?.slice(1) ?? [rest, ""])
    : [rest, ""];
  return (
    <figure className="luca-mnemos-dial" data-testid={testId}>
      <div
        aria-label={sentence}
        className="luca-mnemos-dial-face"
        data-testid={`${testId}-face`}
        role="img"
      >
        <svg aria-hidden="true" viewBox={`0 0 ${DIAL.size} ${DIAL.size}`}>
          <circle
            className="luca-mnemos-dial-ring"
            cx={DIAL.centre}
            cy={DIAL.centre}
            r={DIAL.radius}
          />
          {ticks().map((t) => (
            <line
              className="luca-mnemos-dial-tick"
              key={`${t.x1},${t.y1}`}
              x1={t.x1}
              x2={t.x2}
              y1={t.y1}
              y2={t.y2}
            />
          ))}
          {arcs.map((a) => (
            <path
              className="luca-mnemos-dial-arc"
              d={a.path}
              data-kind={a.kind}
              data-last={a.last ? "" : undefined}
              key={a.kind}
            />
          ))}
          <circle
            className="luca-mnemos-dial-now"
            cx={nx}
            cy={ny}
            data-testid={`${testId}-now`}
            r={3.5}
          />
        </svg>
        <span
          aria-hidden
          className="luca-mnemos-dial-mark text-2xs"
          data-at="top"
        >
          noon
        </span>
        <span
          aria-hidden
          className="luca-mnemos-dial-mark text-2xs"
          data-at="foot"
        >
          midnight
        </span>
        <span
          aria-hidden
          className="luca-mnemos-dial-mark text-2xs"
          data-at="left"
        >
          6 am
        </span>
        <span
          aria-hidden
          className="luca-mnemos-dial-mark text-2xs"
          data-at="right"
        >
          6 pm
        </span>
        <span aria-hidden className="luca-mnemos-dial-middle">
          {word ? (
            <>
              <span className="luca-mnemos-dial-word text-base">{word}</span>
              <span className="text-2xs">{what}</span>
              {since ? <span className="text-2xs">{since}</span> : null}
            </>
          ) : (
            <span className="text-2xs">no quiet hours yet</span>
          )}
        </span>
      </div>
      <figcaption
        className="luca-mnemos-dial-next text-xs"
        data-testid={`${testId}-next`}
      >
        {nextWords(next)}
      </figcaption>
    </figure>
  );
}
