import {
  Columns2,
  Grid2X2,
  LayoutPanelLeft,
  Rows2,
  Square,
  X,
} from "lucide-react";
import type * as React from "react";

import { useMainInsetWidth } from "@/shared/layout/MainInsetContext";
import { RightCardsSlotBoundary } from "@/shared/layout/RightCardsSlot";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { useConversationWorkspace } from "./ConversationWorkspaceContext";
import {
  projectWorkspaceLayout,
  type WorkspaceConversationRef,
  type WorkspacePreset,
  type WorkspaceSlotId,
  workspaceConversationEquals,
  workspaceSlot,
} from "./workspaceLayout";

const MIN_USABLE_PANE_WIDTH_PX = 440;

const PRESET_CONTROLS: Array<{
  preset: WorkspacePreset;
  label: string;
  icon: typeof Square;
}> = [
  { preset: "single", label: "Single pane", icon: Square },
  { preset: "columns-2", label: "Two columns", icon: Columns2 },
  { preset: "rows-2", label: "Two rows", icon: Rows2 },
  { preset: "three", label: "Three panes", icon: LayoutPanelLeft },
  { preset: "grid-4", label: "Four panes", icon: Grid2X2 },
];

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

function gridStyle(preset: WorkspacePreset): React.CSSProperties {
  switch (preset) {
    case "single":
      return { gridTemplateColumns: "minmax(0, 1fr)" };
    case "columns-2":
      return {
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gridTemplateRows: "minmax(0, 1fr)",
      };
    case "rows-2":
      return {
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: "repeat(2, minmax(0, 1fr))",
      };
    case "three":
      return {
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        gridTemplateRows: "repeat(2, minmax(0, 1fr))",
      };
    case "grid-4":
      return {
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gridTemplateRows: "repeat(2, minmax(0, 1fr))",
      };
  }
}

export function ConversationWorkspaceFrame({
  channelLabels,
  onActivateConversation,
  renderConversation,
}: {
  channelLabels: ReadonlyMap<string, string>;
  onActivateConversation: (
    slotId: WorkspaceSlotId,
    conversation: WorkspaceConversationRef,
  ) => void;
  renderConversation: (
    conversation: WorkspaceConversationRef,
    focused: boolean,
    slotId: WorkspaceSlotId,
    estimatedWidthPx: number,
  ) => React.ReactNode;
}) {
  const workspace = useConversationWorkspace();
  const shellWidthPx = useMainInsetWidth();
  if (!workspace) return null;

  const compact = shouldUseCompactProjection(
    workspace.layout.preset,
    shellWidthPx,
  );
  const projection = projectWorkspaceLayout(workspace.layout, compact);
  const columns = presetColumnCount(projection.preset);
  const estimatedWidthPx = Math.max(0, shellWidthPx / columns);

  return (
    <section
      aria-label="Conversation workspace"
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-sidebar"
      data-compact={compact ? "true" : undefined}
      data-testid="conversation-workspace"
    >
      <div
        aria-label="Workspace layout"
        className="absolute right-4 top-3 z-50 flex items-center gap-0.5 rounded-lg border border-border/55 bg-background/90 p-0.5 shadow-sm backdrop-blur"
        role="toolbar"
      >
        {PRESET_CONTROLS.map(({ icon: Icon, label, preset }) => (
          <Tooltip key={preset}>
            <TooltipTrigger asChild>
              <Button
                aria-label={label}
                aria-pressed={workspace.layout.preset === preset}
                className="size-7"
                data-testid={`workspace-preset-${preset}`}
                onClick={() => workspace.setPreset(preset)}
                size="icon"
                type="button"
                variant={
                  workspace.layout.preset === preset ? "secondary" : "ghost"
                }
              >
                <Icon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div
        className="grid min-h-0 min-w-0 flex-1 gap-px bg-border/45"
        data-testid="conversation-workspace-grid"
        style={gridStyle(projection.preset)}
      >
        {projection.visibleSlotIds.map((slotId, index) => {
          const slot = workspaceSlot(workspace.layout, slotId);
          const focused = slotId === workspace.layout.focusedSlotId;
          const active = slot.activeTab;
          return (
            <article
              aria-label={`Conversation pane ${index + 1}`}
              className={cn(
                "group/workspace-pane relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar",
                workspace.layout.preset === "three" &&
                  slotId === "slot-1" &&
                  "row-span-2",
              )}
              data-focused={focused ? "true" : undefined}
              data-testid={`workspace-pane-${slotId}`}
              key={slotId}
              onFocusCapture={(event) => {
                if (focused) return;
                if (
                  event.target instanceof Element &&
                  event.target.closest("[data-workspace-tab]")
                ) {
                  workspace.focusSlot(slotId);
                  return;
                }
                if (active) onActivateConversation(slotId, active);
                else workspace.focusSlot(slotId);
              }}
              onPointerDownCapture={(event) => {
                if (focused) return;
                if (
                  event.target instanceof Element &&
                  event.target.closest("[data-workspace-tab]")
                ) {
                  workspace.focusSlot(slotId);
                  return;
                }
                if (active) onActivateConversation(slotId, active);
                else workspace.focusSlot(slotId);
              }}
            >
              <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/45 bg-background/70 px-2 pr-36">
                {slot.conversations.length === 0 ? (
                  <span className="px-2 text-xs text-muted-foreground">
                    Empty pane
                  </span>
                ) : (
                  <div
                    aria-label={`Pane ${index + 1} tabs`}
                    className="flex min-w-0 items-center gap-1 overflow-x-auto"
                    role="tablist"
                  >
                    {slot.conversations.map((conversation) => {
                      const selected = workspaceConversationEquals(
                        conversation,
                        active,
                      );
                      const label =
                        channelLabels.get(conversation.channelId) ??
                        "Conversation";
                      return (
                        <div
                          className={cn(
                            "group/tab flex h-7 min-w-0 max-w-48 items-center rounded-md",
                            selected
                              ? "bg-foreground/8 text-foreground"
                              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                          )}
                          data-workspace-tab
                          key={`${conversation.projectId ?? ""}:${conversation.channelId}`}
                        >
                          <button
                            aria-selected={selected}
                            className="min-w-0 flex-1 truncate px-2 text-left text-xs"
                            data-testid={`workspace-tab-${slotId}-${conversation.channelId}`}
                            onClick={() =>
                              onActivateConversation(slotId, conversation)
                            }
                            role="tab"
                            type="button"
                          >
                            {label}
                          </button>
                          <button
                            aria-label={`Close ${label}`}
                            className="mr-0.5 flex size-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-foreground/10 focus-visible:opacity-100 group-hover/tab:opacity-100"
                            onClick={(event) => {
                              event.stopPropagation();
                              workspace.dispatch({
                                type: "close-tab",
                                conversation,
                                slotId,
                              });
                            }}
                            type="button"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex min-h-0 min-w-0 flex-1">
                {active ? (
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
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    Choose a conversation from the sidebar.
                  </div>
                )}
              </div>
            </article>
          );
        })}
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
