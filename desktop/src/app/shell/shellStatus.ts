import { shouldShowSidebarUpdateCard } from "@/features/settings/sidebarUpdateCardVisibility";

/**
 * THE STATUS, SAID ONCE (docs/luca/rail-system/SHELL_SPEC.md, "The footer's
 * status cards", Decided 4). The rail's card says a connection problem and an
 * available update with its footer cards; while the rail is closed they are
 * dots, the connection's on the avatar and the update's on Settings. All three
 * read the state from here, so the cards and the dots never disagree.
 *
 * The derivations are pure. The store holds the connection problem, published
 * once by the app's shell from the one relay card hook it already runs, and
 * whether the owner dismissed the update card. It clears itself when the shell
 * unmounts (a community switch remounts it), so one relay's trouble never
 * shows in the next community.
 */

/** The relay card hook's answer, as far as the cards and dots need it. */
export type ConnectionCardState = {
  hasRelayUnreachableError: boolean;
  isRelayConnectionSuccess: boolean;
  showSidebarRelayConnectionCard: boolean;
};

export type ConnectionCards = {
  /** The relay answered badly (an auth refusal, a 404): the status card. */
  statusCard: boolean;
  /** The relay can't be reached, or has just come back: the relay card. */
  relayCard: boolean;
  /** Either card is saying something is wrong (not the brief "Connected"). */
  problem: boolean;
};

/** Which connection card the rail's footer shows, and whether it is trouble.
 *  The two cards share one slot; the hook never shows both. */
export function connectionCardsOf(
  card: ConnectionCardState,
  errorMessage: string | undefined,
): ConnectionCards {
  const statusCard = Boolean(errorMessage) && !card.hasRelayUnreachableError;
  const relayCard = card.showSidebarRelayConnectionCard;
  return {
    statusCard,
    relayCard,
    problem: statusCard || (relayCard && !card.isRelayConnectionSuccess),
  };
}

/** An update is available while the card could show and was not dismissed.
 *  A window without the updater (a pop-out) has none. */
export function updateAvailableOf(
  status: { state: string } | null | undefined,
  dismissed: boolean,
): boolean {
  return status ? shouldShowSidebarUpdateCard(status) && !dismissed : false;
}

export type ShellStatusSnapshot = {
  connectionProblem: boolean;
  updateDismissed: boolean;
};

const INITIAL: ShellStatusSnapshot = {
  connectionProblem: false,
  updateDismissed: false,
};

let snapshot: ShellStatusSnapshot = INITIAL;
const listeners = new Set<() => void>();

function patch(next: Partial<ShellStatusSnapshot>) {
  const merged = { ...snapshot, ...next };
  if (
    merged.connectionProblem === snapshot.connectionProblem &&
    merged.updateDismissed === snapshot.updateDismissed
  ) {
    return;
  }
  snapshot = merged;
  for (const listener of listeners) listener();
}

export function subscribeShellStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getShellStatusSnapshot(): ShellStatusSnapshot {
  return snapshot;
}

export function publishConnectionProblem(problem: boolean) {
  patch({ connectionProblem: problem });
}

export function dismissShellUpdate() {
  patch({ updateDismissed: true });
}

/** The update card may show again (no update is showable any more). */
export function clearShellUpdateDismissal() {
  patch({ updateDismissed: false });
}

export function resetShellStatus() {
  patch(INITIAL);
}
