import type * as React from "react";
import { createPortal } from "react-dom";

import { PaneDeck } from "@/features/panes/PaneDeck";
import { useDeckActive } from "@/features/panes/paneState";
import { AUXILIARY_PANEL_MIN_WIDTH_PX } from "@/shared/layout/AuxiliaryPanel";
import { useRightCardsSlot } from "@/shared/layout/RightCardsSlot";
import { cn } from "@/shared/lib/cn";

type RightAuxiliaryPaneProps = {
  canResetWidth: boolean;
  children: React.ReactNode;
  constrainToAvailableSpace?: boolean;
  onResetWidth: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  testId?: string;
  widthPx: number;
};

export function RightAuxiliaryPane({
  canResetWidth,
  children,
  constrainToAvailableSpace = true,
  onResetWidth,
  onResizeStart,
  testId,
  widthPx,
}: RightAuxiliaryPaneProps) {
  // When the shell offers a slot beside the conversation card, the pane is its
  // own card there (see RightCardsSlot). Without one — narrow layouts, tests
  // that mount the pane alone — it renders inline with its old seam.
  const slot = useRightCardsSlot();
  const asCard = slot !== null;
  // With the deck up, the pane is no longer one card: the two stacked regions
  // inside it are the cards, and the aside is only the frame they sit in.
  const isDeckActive = useDeckActive();

  const aside = (
    <aside
      className={cn(
        "group/right-pane relative flex h-full shrink-0 flex-col overflow-hidden",
        !asCard &&
          "bg-background before:pointer-events-none before:absolute before:bottom-0 before:left-0 before:top-0 before:z-50 before:w-px before:bg-border/80 before:content-['']",
      )}
      data-luca-card={asCard && !isDeckActive ? "" : undefined}
      data-luca-inspector
      data-testid={testId}
      style={{
        maxWidth:
          constrainToAvailableSpace && !asCard
            ? `calc(100% - ${AUXILIARY_PANEL_MIN_WIDTH_PX}px)`
            : undefined,
        width: widthPx,
      }}
    >
      <button
        aria-label="Resize panel"
        className="peer/right-pane-resize group/right-pane-resize absolute inset-y-0 left-0 z-50 w-3 -translate-x-1/2 cursor-col-resize"
        data-testid="right-auxiliary-pane-resize-handle"
        onDoubleClick={canResetWidth ? onResetWidth : undefined}
        onPointerDown={onResizeStart}
        title={
          canResetWidth
            ? "Drag to resize. Double-click to reset width."
            : "Drag to resize."
        }
        type="button"
      >
        <span className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-transparent group-hover/right-pane-resize:bg-border/80 group-focus-visible/right-pane-resize:bg-border/80" />
      </button>
      <PaneDeck>{children}</PaneDeck>
    </aside>
  );

  return asCard ? createPortal(aside, slot) : aside;
}
