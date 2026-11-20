import * as React from "react";
import { ChevronDown } from "lucide-react";

import "./mnemos-place.css";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { linkedWords, railLine } from "./notebook";
import { useMindInView } from "./useMindInView";

/**
 * The head of Mnemos's rail (WP-45, Decided 2): the mind in view, named as
 * the link picker names it, and under it who remembers with it (its numbers
 * are the card head's, said once). It is a button that lists the minds on
 * this Mac: each one's name, how many
 * memories, its newest day, and who remembers with it. Never a word of any
 * memory. Under them, quietly, the owner's residents here that remember
 * with nothing yet, each with an offer that opens its own Mnemos page
 * (WP-47, Decided 8); the offer only opens it.
 */
export function MnemosRailMind() {
  const { facts, mind, choose } = useMindInView();
  const { goAgent } = useAppNavigation();
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const head = React.useRef<HTMLButtonElement>(null);
  const refocus = React.useRef(false);
  const minds = facts.minds?.minds ?? [];
  const withoutMemory = facts.minds?.withoutMemory ?? [];
  React.useEffect(() => {
    // Once the list has gone, focus goes back to the head that opened it.
    if (open || !refocus.current) return;
    const frame = requestAnimationFrame(() => {
      refocus.current = false;
      head.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  if (!mind) return null;

  const close = () => {
    refocus.current = true;
    setOpen(false);
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
        aria-label={`${[mind.name, linkedWords(mind)].filter(Boolean).join(", ")}. Show the minds on this Mac`}
        className="luca-mnemos-railmind-head"
        data-rail-focus="home"
        data-testid="mnemos-rail-mind-button"
        onClick={() => setOpen((was) => !was)}
        ref={head}
        type="button"
      >
        <span className="luca-mnemos-railmind-name text-sm">{mind.name}</span>
        {linkedWords(mind) ? (
          <span className="luca-mnemos-railmind-line text-2xs">
            {linkedWords(mind)}
          </span>
        ) : null}
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
          {withoutMemory.length ? (
            <li
              className="luca-mnemos-minds-none"
              data-testid="mnemos-minds-no-memory"
            >
              <p className="luca-mnemos-railmind-line text-2xs">
                No memory yet
              </p>
              <ul aria-label="Residents with no memory yet">
                {withoutMemory.map((resident) => (
                  <li key={resident.pubkey}>
                    <button
                      className="luca-mnemos-minds-row"
                      data-rail-focus="home"
                      data-testid={`mnemos-offer-${resident.pubkey}`}
                      onClick={() => {
                        close();
                        void goAgent(resident.pubkey, {
                          page: { kind: "mnemos" },
                        });
                      }}
                      type="button"
                    >
                      <span className="luca-mnemos-railmind-name text-sm">
                        {resident.name}
                      </span>
                      <span className="luca-mnemos-railmind-line text-2xs">
                        Give {resident.name} a memory
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
