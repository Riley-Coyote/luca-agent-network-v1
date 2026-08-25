import * as React from "react";

import {
  LIP_STEP_PX,
  WIDGET_MAX_HEIGHT_PX,
  WIDGET_MIN_HEIGHT_PX,
  clampWidgetHeightWithin,
  setWidgetHeightPx,
} from "./paneState";

type PaneLipProps = {
  /**
   * The deck element. The lip writes the widget height straight onto it as a
   * custom property while dragging, so the resize is a style write per frame
   * rather than a React render per frame; the store is updated once, on
   * release, which is what the rest of the app reads.
   */
  deckRef: React.RefObject<HTMLDivElement | null>;
  heightPx: number;
  isDeckOpen: boolean;
};

/**
 * The divider between the drawer's own card and the widget card.
 *
 * At rest it is a plain hairline in the same value as the card borders — the
 * deck should read as two cards with a seam, not as a control panel. The
 * grabber only appears when the seam is actually being addressed: hover, drag,
 * or keyboard focus.
 */
export function PaneLip({ deckRef, heightPx, isDeckOpen }: PaneLipProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const dragRef = React.useRef<{ startY: number; startHeight: number } | null>(
    null,
  );

  // The live height during a drag: written to the deck as a style, mirrored
  // here only so `aria-valuenow` keeps up for assistive tech.
  const [dragHeightPx, setDragHeightPx] = React.useState<number | null>(null);
  const currentHeightPx = dragHeightPx ?? heightPx;

  const applyHeight = React.useCallback(
    (nextPx: number) => {
      const deck = deckRef.current;
      if (!deck) return nextPx;
      const clamped = clampWidgetHeightWithin(
        nextPx,
        deck.getBoundingClientRect().height,
      );
      deck.style.setProperty("--luca-widget-h", `${clamped}px`);
      return clamped;
    },
    [deckRef],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startY: event.clientY, startHeight: currentHeightPx };
    setDragHeightPx(currentHeightPx);
    setIsDragging(true);
    // The open/close transition would otherwise ease every frame of the drag,
    // so the seam would lag the pointer by a fifth of a second.
    if (deckRef.current) deckRef.current.dataset.lipDragging = "true";
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Up is bigger: the widget sits below the seam, so lifting the seam gives
    // it room.
    const next = drag.startHeight + (drag.startY - event.clientY);
    setDragHeightPx(applyHeight(next));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
    if (deckRef.current) deckRef.current.dataset.lipDragging = "false";
    if (dragHeightPx !== null) setWidgetHeightPx(dragHeightPx);
    setDragHeightPx(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowUp" ? LIP_STEP_PX : -LIP_STEP_PX;
    setWidgetHeightPx(applyHeight(currentHeightPx + delta));
  };

  // A window-splitter separator is focusable and value-bearing by design —
  // that is exactly the widget form of the ARIA `separator` role, and an <hr>
  // can be neither focusable nor a container for the grabber.
  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> cannot take focus, arrow keys, or aria-valuenow.
    <div
      aria-label="Resize widget pane"
      aria-orientation="horizontal"
      aria-valuemax={WIDGET_MAX_HEIGHT_PX}
      aria-valuemin={WIDGET_MIN_HEIGHT_PX}
      aria-valuenow={Math.round(currentHeightPx)}
      className="luca-pane-lip"
      data-dragging={isDragging ? "true" : "false"}
      data-testid="pane-lip"
      onKeyDown={handleKeyDown}
      onLostPointerCapture={endDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      role="separator"
      tabIndex={isDeckOpen ? 0 : -1}
    >
      <span aria-hidden="true" className="luca-pane-lip-grabber" />
    </div>
  );
}
