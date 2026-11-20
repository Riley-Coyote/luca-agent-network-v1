import * as React from "react";
import { ChevronDown } from "lucide-react";

import "./mnemos-place.css";
import { linkedWords, railLine } from "./notebook";
import { useMindInView } from "./useMindInView";

/**
 * The head of Mnemos's rail (WP-45, Decided 2): the mind in view, named as
 * the link picker names it, with one line of its real numbers. It is a
 * button that lists the minds on this Mac: each one's name, how many
 * memories, its newest day, and who remembers with it. Never a word of any
 * memory.
 */
export function MnemosRailMind() {
  const { facts, mind, choose } = useMindInView();
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const head = React.useRef<HTMLButtonElement>(null);
  const minds = facts.minds?.minds ?? [];
  if (!mind) return null;

  const close = () => {
    setOpen(false);
    head.current?.focus();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the list of minds, from whichever row has focus.
    <div
      className="luca-mnemos-railmind"
      data-testid="mnemos-rail-mind"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-label={`${mind.name}, ${railLine(mind)}. Show the minds on this Mac`}
        className="luca-mnemos-railmind-head"
        data-rail-focus="home"
        data-testid="mnemos-rail-mind-button"
        onClick={() => setOpen((was) => !was)}
        type="button"
      >
        <span className="luca-mnemos-railmind-name text-sm">{mind.name}</span>
        <span className="luca-mnemos-railmind-line text-2xs">
          {railLine(mind)}
        </span>
        <ChevronDown aria-hidden className="luca-mnemos-railmind-chev" />
      </button>
      {open ? (
        <ul
          aria-label="Minds on this Mac"
          className="luca-mnemos-minds"
          data-testid="mnemos-minds-list"
          id={listId}
        >
          {minds.map((each) => {
            const who = linkedWords(each);
            return (
              <li key={each.id}>
                <button
                  aria-current={each.id === mind.id ? "true" : undefined}
                  className="luca-mnemos-minds-row"
                  data-rail-focus="home"
                  data-testid={`mnemos-mind-${each.id}`}
                  onClick={() => {
                    choose(each.id);
                    close();
                  }}
                  type="button"
                >
                  <span className="luca-mnemos-railmind-name text-sm">
                    {each.name}
                  </span>
                  <span className="luca-mnemos-railmind-line text-2xs">
                    {railLine(each)}
                  </span>
                  {who ? (
                    <span className="luca-mnemos-railmind-line text-2xs">
                      {who}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
