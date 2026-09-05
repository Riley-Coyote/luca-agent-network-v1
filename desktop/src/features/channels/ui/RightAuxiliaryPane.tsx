import type * as React from "react";
import { createPortal } from "react-dom";

import { LayoutGrid } from "lucide-react";

import { PaneDeck } from "@/features/panes/PaneDeck";
import {
  toggleDeck,
  useDeckActive,
  useWidgetPaneEnabled,
} from "@/features/panes/paneState";
import { AUXILIARY_PANEL_MIN_WIDTH_PX } from "@/shared/layout/AuxiliaryPanel";
import { useRightCardsSlot } from "@/shared/layout/RightCardsSlot";
import { usePanelPresence } from "@/shared/layout/PanelPresence";
import { cn } from "@/shared/lib/cn";
import { PANEL_ENTER_MOTION_CLASS } from "@/shared/ui/OverlayPanelBackdrop";

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
  const presence = usePanelPresence();
  // With the deck up, the pane is no longer one card: the two stacked regions
  // inside it are the cards, and the aside is only the frame they sit in.
  const isDeckActive = useDeckActive();
  const isWidgetPaneEnabled = useWidgetPaneEnabled();

  const aside = (
    <aside
      className={cn(
        "group/right-pane relative flex h-full shrink-0 flex-col overflow-hidden",
        // The retained frame animates actual space on both entry and exit.
        // Standalone legacy hosts retain their existing entrance treatment.
        presence === null ? PANEL_ENTER_MOTION_CLASS : "luca-panel-frame",
        !asCard &&
          "bg-background before:pointer-events-none before:absolute before:bottom-0 before:left-0 before:top-0 before:z-50 before:w-px before:bg-border/80 before:content-['']",
      )}
      data-luca-card={asCard && !isDeckActive ? "" : undefined}
      data-luca-inspector
      data-panel-open={presence ?? true}
      inert={presence === false}
      data-testid={testId}
      style={{
        maxWidth:
          constrainToAvailableSpace && !asCard
            ? `calc(100% - ${AUXILIARY_PANEL_MIN_WIDTH_PX}px)`
            : undefined,
        width: presence === false ? 0 : widthPx,
      }}
    >
      <div
        className="relative flex h-full shrink-0 flex-col"
        style={{ width: widthPx }}
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
        {isWidgetPaneEnabled ? (
          // The drawer's header band, clear of the panel's own close action.
          // Preview-flag scaffolding: without the flag this never renders and
          // the deck below it is unreachable.
          <div className="pointer-events-none absolute right-12 top-0 z-50 flex h-(--mn-header-title-row,42px) items-center">
            <button
              className="luca-pane-widgets-toggle pointer-events-auto"
              data-testid="toggle-widgets"
              onClick={toggleDeck}
              title="Widgets"
              type="button"
            >
              <LayoutGrid aria-hidden="true" className="size-3.5" />
              <span className="sr-only">Widgets</span>
            </button>
          </div>
        ) : null}
        <PaneDeck>{children}</PaneDeck>
      </div>
    </aside>
  );

  return asCard ? createPortal(aside, slot) : aside;
}
