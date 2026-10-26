import * as React from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";

import {
  recordEntry,
  type SettingsEntries,
  stepsOutOfSettings,
} from "@/app/shell/settingsHistory";

/**
 * Closing Settings (Escape, ⌘,) while its sections are history steps
 * (settingsHistory.ts): under the shell's frame, back past every Settings
 * entry to where you came from, or to Chats when that was never seen.
 * Without the frame a section replaces its entry, so `close` (one step
 * back) already leaves.
 */
export function useSettingsClose({
  close,
  framed,
  goChats,
  settingsOpen,
}: {
  close: () => void;
  framed: boolean;
  goChats: () => void;
  settingsOpen: boolean;
}) {
  const router = useRouter();
  const index = useRouterState({
    select: (state) =>
      (state.location.state as { __TSR_index?: number }).__TSR_index ?? 0,
  });
  const entries = React.useRef<SettingsEntries>(new Map());
  // An entry the router didn't make (an address typed or set by hand) has
  // no index: it is never recorded, so closing past it goes to Chats.
  React.useEffect(() => {
    if (Number.isFinite(index))
      recordEntry(entries.current, index, settingsOpen);
  }, [index, settingsOpen]);
  return React.useCallback(() => {
    if (!framed) {
      close();
      return;
    }
    const steps = Number.isFinite(index)
      ? stepsOutOfSettings(entries.current, index)
      : null;
    if (steps === null) {
      goChats();
      return;
    }
    router.history.go(steps);
  }, [close, framed, goChats, index, router.history]);
}
