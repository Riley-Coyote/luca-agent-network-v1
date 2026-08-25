import * as React from "react";

import { PaneLip } from "./PaneLip";
import {
  DECK_COLLAPSE_FALLBACK_MS,
  finishDeckCollapse,
  setDockedSlot,
  useDeckActive,
  usePaneState,
} from "./paneState";

/**
 * The vertical split inside the right auxiliary drawer.
 *
 * Closed, this is the single column the drawer has always been — the same
 * element with the same classes, so nothing downstream can tell the deck
 * exists. Open, it becomes two stacked cards with a draggable seam between
 * them: the drawer's own content keeps the top, the widget takes the bottom.
 *
 * The open/close is a `grid-template-rows` transition rather than a height
 * animation, because only the widget track should move — the drawer content
 * above it stays a `1fr` track and simply gets a smaller share, so its own
 * scroll position and layout are never animated.
 */
export function PaneDeck({ children }: { children: React.ReactNode }) {
  const isActive = useDeckActive();
  const { isDeckOpen, widgetHeightPx } = usePaneState();
  const deckRef = React.useRef<HTMLDivElement | null>(null);

  // The open geometry has to be applied a frame AFTER the deck mounts,
  // otherwise the widget row's first computed value is already its full height
  // and there is nothing for the transition to move between.
  const [hasEntered, setHasEntered] = React.useState(false);
  React.useEffect(() => {
    if (!isActive || !isDeckOpen) {
      setHasEntered(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setHasEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [isActive, isDeckOpen]);

  // The widget's React content comes down only once the collapse has actually
  // finished. `transitionend` is the real signal; the timer is there for the
  // cases where no transition runs at all (reduced motion, a background tab).
  React.useEffect(() => {
    if (!isActive || isDeckOpen) return;
    const deck = deckRef.current;
    const timer = window.setTimeout(
      finishDeckCollapse,
      DECK_COLLAPSE_FALLBACK_MS,
    );
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== deck) return;
      if (event.propertyName !== "grid-template-rows") return;
      window.clearTimeout(timer);
      finishDeckCollapse();
    };
    deck?.addEventListener("transitionend", handleTransitionEnd);
    return () => {
      window.clearTimeout(timer);
      deck?.removeEventListener("transitionend", handleTransitionEnd);
    };
  }, [isActive, isDeckOpen]);

  // Nothing is registered while the deck is down, so the floating layer has no
  // stale element to dock back into.
  React.useEffect(() => {
    if (isActive) return;
    setDockedSlot(null);
  }, [isActive]);

  // One element in both modes, carrying the same classes — inactive, the deck
  // is byte-for-byte the column the drawer rendered before it existed.
  if (!isActive) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {children}
      </div>
    );
  }

  return (
    <div
      className="luca-pane-deck"
      data-deck-open={isDeckOpen && hasEntered ? "true" : "false"}
      data-testid="pane-deck"
      ref={deckRef}
      style={
        { "--luca-widget-h": `${widgetHeightPx}px` } as React.CSSProperties
      }
    >
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        data-luca-card
        data-testid="pane-deck-drawer-region"
      >
        {children}
      </div>
      <PaneLip
        deckRef={deckRef}
        heightPx={widgetHeightPx}
        isDeckOpen={isDeckOpen}
      />
      <div
        className="luca-pane-deck-widget"
        data-luca-card
        data-testid="pane-deck-widget-region"
      >
        <div className="luca-pane-docked-slot" ref={setDockedSlot} />
      </div>
    </div>
  );
}
