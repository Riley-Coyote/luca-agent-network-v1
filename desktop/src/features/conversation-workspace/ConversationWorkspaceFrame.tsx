import * as React from "react";

import { useMainInsetWidth } from "@/shared/layout/MainInsetContext";
import { RightCardsSlotBoundary } from "@/shared/layout/RightCardsSlot";
import { cn } from "@/shared/lib/cn";
import { useConversationWorkspace } from "./ConversationWorkspaceContext";
import { WorkspaceLayoutControlsProvider } from "./WorkspaceLayoutMenu";
import {
  projectWorkspaceLayout,
  type WorkspaceConversationRef,
  type WorkspacePreset,
  type WorkspaceSlotId,
  workspaceSlot,
} from "./workspaceLayout";

const MIN_USABLE_PANE_WIDTH_PX = 440;
const PANE_LOCAL_CONTROL_SELECTOR = "[data-workspace-pane-local-control]";

function presetColumnCount(preset: WorkspacePreset) {
  if (preset === "columns-2" || preset === "three" || preset === "grid-4") {
    return 2;
  }
  return 1;
}

function shouldUseCompactProjection(
  preset: WorkspacePreset,
  shellWidthPx: number,
) {
  if (shellWidthPx <= 0) return false;
  return shellWidthPx / presetColumnCount(preset) < MIN_USABLE_PANE_WIDTH_PX;
}

function gridStyle(
  preset: WorkspacePreset,
  columnRatio: number,
  rowRatio: number,
): React.CSSProperties {
  const columns = `${columnRatio}fr ${100 - columnRatio}fr`;
  const rows = `${rowRatio}fr ${100 - rowRatio}fr`;
  switch (preset) {
    case "single":
      return { gridTemplateColumns: "minmax(0, 1fr)" };
    case "columns-2":
      return {
        gridTemplateColumns: columns,
        gridTemplateRows: "minmax(0, 1fr)",
      };
    case "rows-2":
      return {
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: rows,
      };
    case "three":
      return {
        gridTemplateColumns: columns,
        gridTemplateRows: rows,
      };
    case "grid-4":
      return {
        gridTemplateColumns: columns,
        gridTemplateRows: rows,
      };
  }
}

const MIN_SPLIT_RATIO = 25;
const MAX_SPLIT_RATIO = 75;

function clampSplitRatio(value: number) {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
}

function WorkspaceResizeHandle({
  axis,
  crossStart,
  onChange,
  ratio,
  segment,
}: {
  axis: "horizontal" | "vertical";
  crossStart?: number;
  onChange: (ratio: number) => void;
  ratio: number;
  segment?: "right";
}) {
  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const grid = event.currentTarget.parentElement;
    if (!grid) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    const update = (pointerEvent: PointerEvent) => {
      const bounds = grid.getBoundingClientRect();
      const raw =
        axis === "vertical"
          ? ((pointerEvent.clientX - bounds.left) / bounds.width) * 100
          : ((pointerEvent.clientY - bounds.top) / bounds.height) * 100;
      onChange(clampSplitRatio(raw));
    };
    const finish = () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const nudge = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = 2;
    if (axis === "vertical" && event.key === "ArrowLeft") {
      event.preventDefault();
      onChange(clampSplitRatio(ratio - delta));
    } else if (axis === "vertical" && event.key === "ArrowRight") {
      event.preventDefault();
      onChange(clampSplitRatio(ratio + delta));
    } else if (axis === "horizontal" && event.key === "ArrowUp") {
      event.preventDefault();
      onChange(clampSplitRatio(ratio - delta));
    } else if (axis === "horizontal" && event.key === "ArrowDown") {
      event.preventDefault();
      onChange(clampSplitRatio(ratio + delta));
    }
  };

  return (
    <hr
      aria-label={
        axis === "vertical"
          ? "Resize conversation columns"
          : "Resize conversation rows"
      }
      aria-orientation={axis}
      aria-valuemax={MAX_SPLIT_RATIO}
      aria-valuemin={MIN_SPLIT_RATIO}
      aria-valuenow={Math.round(ratio)}
      className={cn(
        "absolute z-40 touch-none border-0 bg-transparent outline-none before:absolute before:rounded-full before:bg-border-strong before:opacity-0 before:transition-opacity hover:before:opacity-100 focus-visible:before:opacity-100",
        axis === "vertical"
          ? "bottom-[5px] top-[5px] h-auto w-[10px] -translate-x-1/2 cursor-col-resize before:bottom-0 before:left-1/2 before:top-0 before:w-px before:-translate-x-1/2"
          : "left-[5px] right-[5px] h-[10px] -translate-y-1/2 cursor-row-resize before:left-0 before:right-0 before:top-1/2 before:h-px before:-translate-y-1/2",
      )}
      data-testid={`workspace-resize-${axis}${segment ? `-${segment}` : ""}`}
      onKeyDown={nudge}
      onPointerDown={beginResize}
      style={
        axis === "vertical"
          ? { left: `${ratio}%` }
          : {
              left:
                crossStart === undefined
                  ? "5px"
                  : `calc(${crossStart}% + 2.5px)`,
              top: `${ratio}%`,
            }
      }
      tabIndex={0}
    />
  );
}

export function ConversationWorkspaceFrame({
  onActivateConversation,
  onPresetChange,
  renderConversation,
}: {
  onActivateConversation: (
    slotId: WorkspaceSlotId,
    conversation: WorkspaceConversationRef,
  ) => void;
  onPresetChange?: (preset: WorkspacePreset) => void;
  renderConversation: (
    conversation: WorkspaceConversationRef,
    focused: boolean,
    slotId: WorkspaceSlotId,
    estimatedWidthPx: number,
  ) => React.ReactNode;
}) {
  const workspace = useConversationWorkspace();
  const shellWidthPx = useMainInsetWidth();
  const [columnRatio, setColumnRatio] = React.useState(50);
  const [rowRatio, setRowRatio] = React.useState(50);
  if (!workspace) return null;

  const compact = shouldUseCompactProjection(
    workspace.layout.preset,
    shellWidthPx,
  );
  const projection = projectWorkspaceLayout(workspace.layout, compact);
  const columns = presetColumnCount(projection.preset);
  const estimatedWidthPx = Math.max(0, shellWidthPx / columns);
  const changePreset = (preset: WorkspacePreset) => {
    if (onPresetChange) onPresetChange(preset);
    else workspace.setPreset(preset);
  };

  return (
    <section
      aria-label="Conversation workspace"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-compact={compact ? "true" : undefined}
      data-luca-workspace-floor
      data-testid="conversation-workspace"
    >
      <div
        className="relative grid min-h-0 min-w-0 flex-1 gap-[5px] p-[5px] pl-px"
        data-testid="conversation-workspace-grid"
        style={gridStyle(projection.preset, columnRatio, rowRatio)}
      >
        {projection.visibleSlotIds.map((slotId, index) => {
          const slot = workspaceSlot(workspace.layout, slotId);
          const focused = slotId === workspace.layout.focusedSlotId;
          const active = slot.activeTab;
          return (
            <article
              aria-label={`Conversation pane ${index + 1}`}
              className={cn(
                "group/workspace-pane relative flex min-h-0 min-w-0 flex-col overflow-hidden",
                workspace.layout.preset === "three" &&
                  slotId === "slot-1" &&
                  "row-span-2",
              )}
              data-luca-card
              data-focused={focused ? "true" : undefined}
              data-testid={`workspace-pane-${slotId}`}
              key={slotId}
              onFocusCapture={(event) => {
                if (focused) return;
                if (
                  event.target instanceof Element &&
                  event.target.closest(PANE_LOCAL_CONTROL_SELECTOR)
                ) {
                  return;
                }
                if (active) onActivateConversation(slotId, active);
                else workspace.focusSlot(slotId);
              }}
              onPointerDownCapture={(event) => {
                if (focused) return;
                if (
                  event.target instanceof Element &&
                  event.target.closest(PANE_LOCAL_CONTROL_SELECTOR)
                ) {
                  return;
                }
                if (active) onActivateConversation(slotId, active);
                else workspace.focusSlot(slotId);
              }}
            >
              <div className="flex min-h-0 min-w-0 flex-1">
                {active ? (
                  <WorkspaceLayoutControlsProvider
                    onPresetChange={changePreset}
                    preset={workspace.layout.preset}
                  >
                    <RightCardsSlotBoundary isolate={!focused}>
                      <div className="flex min-h-0 min-w-0 flex-1">
                        {renderConversation(
                          active,
                          focused,
                          slotId,
                          estimatedWidthPx,
                        )}
                      </div>
                    </RightCardsSlotBoundary>
                  </WorkspaceLayoutControlsProvider>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    Choose a conversation from the sidebar.
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {!compact &&
        (projection.preset === "columns-2" ||
          projection.preset === "three" ||
          projection.preset === "grid-4") ? (
          <WorkspaceResizeHandle
            axis="vertical"
            onChange={setColumnRatio}
            ratio={columnRatio}
          />
        ) : null}
        {!compact &&
        (projection.preset === "rows-2" || projection.preset === "grid-4") ? (
          <WorkspaceResizeHandle
            axis="horizontal"
            crossStart={columnRatio}
            onChange={setRowRatio}
            ratio={rowRatio}
          />
        ) : null}
        {!compact && projection.preset === "three" ? (
          <WorkspaceResizeHandle
            axis="horizontal"
            onChange={setRowRatio}
            ratio={rowRatio}
            segment="right"
          />
        ) : null}
      </div>
      {compact && workspace.layout.preset !== "single" ? (
        <p className="sr-only" role="status">
          Only the focused pane is shown at this window size. The complete
          workspace will return when the window grows.
        </p>
      ) : null}
    </section>
  );
}
