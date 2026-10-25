import { isTauri } from "@tauri-apps/api/core";
import * as React from "react";

import type { AppView } from "@/app/AppShell.helpers";
import { SHELL_FRAME_ATTRIBUTE_VALUE } from "@/shared/features/shellFrame";
import { isMacPlatform } from "@/shared/lib/platform";

/** The rail's card is fixed at 220 under the frame (SHELL_SPEC.md, Decided 2):
 *  the stored, dragged width does not apply. */
export const SHELL_FRAME_RAIL_WIDTH = 220;

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

/** The key the frame's tooltips name (SHELL_SPEC.md, "The window"): ⌘ in
 *  the Mac app's own window; Ctrl wherever there are no native lights:
 *  another platform, a browser, the end-to-end tests. */
export function shellShortcutKey(): "⌘" | "Ctrl+" {
  return isMacPlatform() && isTauri() ? "⌘" : "Ctrl+";
}
