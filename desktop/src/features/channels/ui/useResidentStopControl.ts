import * as React from "react";
import { toast } from "sonner";

import { cancelActiveAgentTurn } from "@/features/agents/activeAgentTurnsStore";
import {
  cancelManagedPresentation,
  getManagedPresentationTurn,
} from "@/features/messages/managedPresentationStore";
import type { ManagedResidentActivity } from "@/features/messages/managedPresentationTypes";
import {
  cancelManagedAgentTurn,
  listCancellableManagedTurns,
} from "@/shared/api/agentControl";
import type { CancellableManagedTurn } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  type ConversationActivityState,
  activityStopOutcome,
  isTerminalConversationActivity,
} from "./conversationAgentActivityShelf";

const TERMINAL_SETTLE_MS = 800;

/**
 * Owner-initiated Stop for residents working in one conversation.
 *
 * Owns the transient per-resident states the owner's own action produces —
 * `stopping` while the cancel is in flight, then the terminal outcome for a
 * settle beat — and resolves each Stop to an exact cancellation receipt only
 * when pressed. Shared by the room activity shelf and the direct-conversation
 * reply row, so a Stop means the same thing wherever it sits.
 */
export function useResidentStopControl({
  channelId,
  presentationActivity,
}: {
  channelId: string | null;
  /** Keyed by normalized resident pubkey. */
  presentationActivity: ReadonlyMap<string, ManagedResidentActivity>;
}) {
  const [localStates, setLocalStates] = React.useState<
    Map<string, ConversationActivityState>
  >(() => new Map());
  const terminalTimers = React.useRef(new Map<string, number>());

  React.useEffect(
    () => () => {
      for (const timer of terminalTimers.current.values()) {
        window.clearTimeout(timer);
      }
      terminalTimers.current.clear();
    },
    [],
  );

  const applyStates = React.useCallback(
    (updates: ReadonlyMap<string, ConversationActivityState>) => {
      setLocalStates((current) => {
        const next = new Map(current);
        for (const [key, state] of updates) next.set(key, state);
        return next;
      });
      for (const [key, state] of updates) {
        const priorTimer = terminalTimers.current.get(key);
        if (priorTimer !== undefined) window.clearTimeout(priorTimer);
        if (!isTerminalConversationActivity(state)) continue;
        terminalTimers.current.set(
          key,
          window.setTimeout(() => {
            terminalTimers.current.delete(key);
            setLocalStates((current) => {
              if (current.get(key) !== state) return current;
              const next = new Map(current);
              next.delete(key);
              return next;
            });
          }, TERMINAL_SETTLE_MS),
        );
      }
    },
    [],
  );

  const clearLocalState = React.useCallback((pubkey: string) => {
    const key = normalizePubkey(pubkey);
    const timer = terminalTimers.current.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    terminalTimers.current.delete(key);
    setLocalStates((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }, []);

  const stopResidents = React.useCallback(
    async (residentKeys: readonly string[]) => {
      if (!channelId || residentKeys.length === 0) return;
      const targets = [...new Set(residentKeys.map(normalizePubkey))];
      applyStates(new Map(targets.map((key) => [key, "stopping"] as const)));

      let cancellable: CancellableManagedTurn[] = [];
      let inspectionFailed = false;
      try {
        cancellable = await listCancellableManagedTurns(channelId);
      } catch {
        inspectionFailed = true;
      }

      const targetSet = new Set(targets);
      const exactTurns = cancellable.filter((turn) =>
        targetSet.has(normalizePubkey(turn.residentPubkey)),
      );
      const exactReceipts = new Set(
        exactTurns.map(
          (turn) =>
            `${normalizePubkey(turn.residentPubkey)}:${turn.dispatchReceiptId}:${turn.sessionEpoch}`,
        ),
      );
      for (const key of targets) {
        const activity = presentationActivity.get(key);
        const turn = activity
          ? getManagedPresentationTurn(activity.uiKey)
          : null;
        if (
          !turn ||
          turn.sessionEpoch === 0 ||
          turn.dispatchReceiptId.length === 0
        ) {
          continue;
        }
        const receiptKey = `${key}:${turn.dispatchReceiptId}:${turn.sessionEpoch}`;
        if (exactReceipts.has(receiptKey)) continue;
        exactReceipts.add(receiptKey);
        exactTurns.push({
          dispatchReceiptId: turn.dispatchReceiptId,
          residentPubkey: key,
          sessionEpoch: turn.sessionEpoch,
        });
      }
      if (inspectionFailed && exactTurns.length === 0) {
        applyStates(
          new Map(targets.map((key) => [key, "needs-attention"] as const)),
        );
        toast.error("Active resident work could not be inspected.");
        return;
      }
      const commands = exactTurns.map((turn) => ({
        key: normalizePubkey(turn.residentPubkey),
        promise: cancelManagedAgentTurn(turn.residentPubkey, channelId, turn),
        turn,
      }));
      const results = await Promise.allSettled(
        commands.map((command) => command.promise),
      );
      const nextStates = new Map<string, ConversationActivityState>();
      let stopped = 0;
      let ambiguous = 0;
      let failed = 0;

      for (const key of targets) {
        const indices = commands.flatMap((command, index) =>
          command.key === key ? [index] : [],
        );
        const residentResults = indices.map((index) => results[index]);
        for (const index of indices) {
          const result = results[index];
          const command = commands[index];
          if (
            !result ||
            !command ||
            result.status === "rejected" ||
            result.value.status === "already_terminal"
          ) {
            continue;
          }
          const presentation = cancelManagedPresentation(
            command.turn.residentPubkey,
            command.turn.dispatchReceiptId,
            channelId,
          );
          cancelActiveAgentTurn(
            command.turn.residentPubkey,
            channelId,
            presentation?.turnId,
          );
        }
        const outcome = activityStopOutcome(
          residentResults.map((result) => {
            if (!result || result.status === "rejected") return "failed";
            return result.value.status === "publication_ambiguous"
              ? "ambiguous"
              : "stopped";
          }),
        );
        nextStates.set(key, outcome.state);
        if (outcome.result === "ambiguous") ambiguous += 1;
        else if (outcome.result === "failed") failed += 1;
        else stopped += 1;
      }
      applyStates(nextStates);

      if (stopped > 0) {
        toast.success(
          stopped === 1
            ? "Stopped the active resident."
            : `Stopped ${stopped} active residents.`,
        );
      }
      if (ambiguous > 0) {
        toast.warning(
          ambiguous === 1
            ? "One in-flight final response may still arrive."
            : `${ambiguous} in-flight final responses may still arrive.`,
        );
      }
      if (failed > 0) {
        toast.error(
          failed === 1
            ? "One resident could not be stopped."
            : `${failed} residents could not be stopped.`,
        );
      }
    },
    [applyStates, channelId, presentationActivity],
  );

  return { localStates, stopResidents, clearLocalState };
}
