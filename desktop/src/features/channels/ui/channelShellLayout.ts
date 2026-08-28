import { AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX } from "@/shared/layout/AuxiliaryPanel";

export const PROJECT_NAVIGATOR_COMPACT_MAX_VIEWPORT_PX = 1180;

const HEADER_ACTIONS_COMPACT_BREAKPOINT_PX = 760;
const PROJECT_NAVIGATOR_COMPACT_WIDTH_PX = 274;
const PROJECT_NAVIGATOR_WIDE_WIDTH_PX = 304;

export function resolveChannelShellLayout({
  hasAuxiliaryPanel,
  hasProjectNavigator,
  isCompactProjectNavigator,
  isForum,
  isMobileViewport,
  mainInsetWidthPx,
}: {
  hasAuxiliaryPanel: boolean;
  hasProjectNavigator: boolean;
  isCompactProjectNavigator: boolean;
  isForum: boolean;
  isMobileViewport: boolean;
  mainInsetWidthPx: number;
}) {
  // These fixed widths mirror conversation-shell.css. Crucially, the right
  // drawer is not an input: mounting it can never change this decision.
  const projectNavigatorWidthPx =
    hasProjectNavigator && !isMobileViewport
      ? isCompactProjectNavigator
        ? PROJECT_NAVIGATOR_COMPACT_WIDTH_PX
        : PROJECT_NAVIGATOR_WIDE_WIDTH_PX
      : 0;
  const stableConversationWidthPx = Math.max(
    0,
    mainInsetWidthPx - projectNavigatorWidthPx,
  );
  const hasMeasuredWidth = stableConversationWidthPx > 0;

  return {
    shouldCompactHeaderActions:
      hasAuxiliaryPanel &&
      hasMeasuredWidth &&
      stableConversationWidthPx < HEADER_ACTIONS_COMPACT_BREAKPOINT_PX,
    stableConversationWidthPx,
    useSinglePanel:
      hasAuxiliaryPanel &&
      !isForum &&
      hasMeasuredWidth &&
      stableConversationWidthPx < AUXILIARY_PANEL_SINGLE_COLUMN_BREAKPOINT_PX,
  };
}
