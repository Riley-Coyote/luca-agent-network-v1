import * as React from "react";

import type { AppView } from "@/app/AppShell.helpers";
import { SHELL_FRAME_ATTRIBUTE_VALUE } from "@/shared/features/shellFrame";

/** The rail's card is fixed at 220 under the frame (SHELL_SPEC.md, Decided 2):
 *  the stored, dragged width does not apply. */
export const SHELL_FRAME_RAIL_WIDTH = 220;

/** The frame's motion: the rail opens and closes over 460 ms, and what rides
 *  with it (the conversation's card, the huddle's band) keeps the same time
 *  (SHELL_SPEC.md, "Motion"; `--luca-frame-slide` in shell-frame.css). */
export const SHELL_FRAME_SLIDE_MS = 460;

export const shellFrameSidebarStyle = {
  "--sidebar-width": `${SHELL_FRAME_RAIL_WIDTH}px`,
  "--sidebar-rail-width": `${SHELL_FRAME_RAIL_WIDTH}px`,
} as React.CSSProperties;

/** `<html data-luca-frame="solid">` while the frame is drawn: every rule of
 *  `shell-frame.css` keys on it. */
export function useShellFrameRootAttribute(enabled: boolean) {
  React.useLayoutEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.setAttribute("data-luca-frame", SHELL_FRAME_ATTRIBUTE_VALUE);
    return () => root.removeAttribute("data-luca-frame");
  }, [enabled]);
}

/** A page's own name, said in the lip when no conversation is open. */
export function shellFramePageName(view: AppView): string {
  switch (view) {
    case "artifacts":
      return "Library";
    case "agents":
      return "Agents";
    case "pulse":
      return "Activity";
    case "brain":
      return "Brain";
    case "inbox":
      return "Inbox";
    case "messages":
      return "New conversation";
    case "workflows":
      return "Workflows";
    case "projects":
      return "Projects";
    default:
      return "Conversations";
  }
}
