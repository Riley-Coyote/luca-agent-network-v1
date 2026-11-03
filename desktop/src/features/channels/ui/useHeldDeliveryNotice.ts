import * as React from "react";

import type { ManagedResidentActivity } from "@/features/messages/managedPresentationTypes";
import {
  getManagedPresentationTurn,
  subscribeManagedPresentationTurn,
} from "@/features/messages/managedPresentationStore";
import { normalizePubkey } from "@/shared/lib/pubkey";
import type { CancellableManagedTurn } from "@/shared/api/types";

/**
 * The held-delivery notice.
 *
 * Residents run in queue mode: a message sent while a turn is in flight is
 * delivered when that turn finishes — nothing is cancelled silently any
 * more. This hook narrates that hold. At send time it snapshots the turns
 * that were ALREADY live in the conversation (called before the send's own
 * presentation is seeded, so the snapshot can never contain the new turn);
 * while any of them stay live the notice shows, offering an explicit
 * interrupt. When every captured turn ends, the queue has flushed and the
 * notice clears itself.
 *
 * Liveness is tracked against the TURN STORE by uiKey, not the shelf's
 * activity projection: the shelf keeps one slot per resident, so the
 * second send's own seeded turn evicts the captured turn from that map
 * even though it is still running.
 */

const TERMINAL_TURN_PHASES = new Set(["stopped", "failed", "needs_attention"]);
/** Safety valve: never narrate a hold for longer than this. */
const HELD_NOTICE_MAX_MS = 5 * 60_000;

export type HeldDeliveryNotice = {
  residentPubkeys: string[];
  turns: CancellableManagedTurn[];
  /** True when at least one held turn is confirmed (cancellable) — the
   * interrupt button is only honest then. */
  canInterrupt: boolean;
};

function turnIsLive(uiKey: string): boolean {
  const turn = getManagedPresentationTurn(uiKey);
  if (!turn) return false;
  if (turn.finalMessageId !== null) return false;
  if (TERMINAL_TURN_PHASES.has(turn.phase)) return false;
  return true;
}

export function useHeldDeliveryNotice({
  channelId,
  presentationActivity,
}: {
  channelId: string | null;
  presentationActivity: ReadonlyMap<string, ManagedResidentActivity>;
}): {
  notice: HeldDeliveryNotice | null;
  recordSend: () => void;
  dismiss: () => void;
} {
  const [held, setHeld] = React.useState<{
    channelId: string;
    uiKeys: string[];
    residentPubkeys: string[];
  } | null>(null);
  const [, setConfirmationRevision] = React.useState(0);

  /** Call BEFORE dispatching a send into the active channel. */
  const recordSend = React.useCallback(() => {
    if (!channelId) return;
    const live: Array<[string, string]> = [];
    for (const [pubkey, entry] of presentationActivity) {
      if (!entry?.uiKey) continue;
      if (TERMINAL_TURN_PHASES.has(entry.phase)) continue;
      if (!turnIsLive(entry.uiKey)) continue;
      live.push([normalizePubkey(pubkey), entry.uiKey]);
    }
    if (live.length === 0) return;
    setHeld({
      channelId,
      uiKeys: live.map(([, uiKey]) => uiKey),
      residentPubkeys: live.map(([pubkey]) => pubkey),
    });
  }, [channelId, presentationActivity]);

  const dismiss = React.useCallback(() => setHeld(null), []);

  // The hold ends when every captured turn ends (the queue has flushed),
  // when the channel changes, or at the safety valve. Each captured turn is
  // watched directly in the turn store.
  React.useEffect(() => {
    if (!held) return;
    if (held.channelId !== channelId) {
      setHeld(null);
      return;
    }
    let previousSignature = "";
    const evaluate = () => {
      if (!held.uiKeys.some(turnIsLive)) {
        setHeld(null);
        return;
      }
      // Public text can arrive every frame. Only receipt/liveness changes
      // affect this notice; don't rerender the whole channel on every word.
      const signature = held.uiKeys
        .map((key) => {
          const turn = getManagedPresentationTurn(key);
          return turn && turnIsLive(key)
            ? `${key}:${turn.dispatchReceiptId}:${turn.sessionEpoch}`
            : "terminal";
        })
        .join("|");
      if (signature !== previousSignature) {
        previousSignature = signature;
        setConfirmationRevision((revision) => revision + 1);
      }
    };
    evaluate();
    const unsubscribes = held.uiKeys.map((uiKey) =>
      subscribeManagedPresentationTurn(uiKey, evaluate),
    );
    const valve = window.setTimeout(() => setHeld(null), HELD_NOTICE_MAX_MS);
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      window.clearTimeout(valve);
    };
  }, [held, channelId]);

  const notice = ((): HeldDeliveryNotice | null => {
    if (!held) return null;
    const turns = held.uiKeys.flatMap((uiKey) => {
      const turn = getManagedPresentationTurn(uiKey);
      return turn &&
        turnIsLive(uiKey) &&
        turn.sessionEpoch !== 0 &&
        turn.dispatchReceiptId.length > 0
        ? [
            {
              residentPubkey: turn.residentPubkey,
              dispatchReceiptId: turn.dispatchReceiptId,
              sessionEpoch: turn.sessionEpoch,
            },
          ]
        : [];
    });
    return {
      residentPubkeys: held.residentPubkeys,
      turns,
      canInterrupt: turns.length > 0,
    };
  })();

  return { notice, recordSend, dismiss };
}
