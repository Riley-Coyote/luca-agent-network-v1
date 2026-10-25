import * as React from "react";

import {
  type ConnectionCardState,
  clearShellUpdateDismissal,
  connectionCardsOf,
  dismissShellUpdate,
  getShellStatusSnapshot,
  publishConnectionProblem,
  resetShellStatus,
  subscribeShellStatus,
  updateAvailableOf,
} from "@/app/shell/shellStatus";
import { useOptionalUpdaterContext } from "@/features/settings/hooks/UpdaterProvider";
import { shouldShowSidebarUpdateCard } from "@/features/settings/sidebarUpdateCardVisibility";

export type ShellStatus = {
  /** The rail's connection card is saying something is wrong. */
  connectionProblem: boolean;
  /** An update is ready and its card was not dismissed. */
  updateAvailable: boolean;
  /** Dismiss the update's card (and with it, the dot on Settings). */
  dismissUpdate: () => void;
};

/**
 * The status the rail's footer cards say, for the cards themselves, the
 * avatar's connection dot and the update dot on Settings (shellStatus.ts).
 */
export function useShellStatus(): ShellStatus {
  const state = React.useSyncExternalStore(
    subscribeShellStatus,
    getShellStatusSnapshot,
    getShellStatusSnapshot,
  );
  const updater = useOptionalUpdaterContext();
  const status = updater?.status ?? null;
  const showable = status ? shouldShowSidebarUpdateCard(status) : false;
  // As the card's own dismissal did: once no update can show, the next one
  // may show again.
  React.useEffect(() => {
    if (!showable && state.updateDismissed) clearShellUpdateDismissal();
  }, [showable, state.updateDismissed]);
  return {
    connectionProblem: state.connectionProblem,
    updateAvailable: updateAvailableOf(status, state.updateDismissed),
    dismissUpdate: dismissShellUpdate,
  };
}

/**
 * Published once, by the app's shell, from the relay card hook it runs for
 * the rail: whether the connection card is saying something is wrong. Clears
 * on unmount, so a community switch starts clean.
 */
export function usePublishShellConnection(
  card: ConnectionCardState,
  errorMessage: string | undefined,
) {
  const { problem } = connectionCardsOf(card, errorMessage);
  React.useLayoutEffect(() => {
    publishConnectionProblem(problem);
  }, [problem]);
  React.useLayoutEffect(() => resetShellStatus, []);
}
