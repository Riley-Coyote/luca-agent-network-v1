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
} from "./conversationAgentActivityShelf";
import {
  ResidentStopState,
  type ResidentStopRequest,
} from "./residentStopState";

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
  // The model's identity is the conversation incarnation, not just its ID.
  // Old commands may finish, but A → B → A must not revive A's old controls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: channelId deliberately creates a fresh transient lifecycle.
  const { lifecycle, terminalTimers } = React.useMemo(
    () => ({
      lifecycle: new ResidentStopState(),
      terminalTimers: new Map<string, number>(),
    }),
    [channelId],
  );
  const currentLifecycle = React.useRef<ResidentStopState | null>(lifecycle);
  const [view, setView] = React.useState(() => ({
    lifecycle,
    states: lifecycle.snapshot,
  }));
  const localStates =
    view.lifecycle === lifecycle ? view.states : lifecycle.snapshot;

  React.useLayoutEffect(() => {
    currentLifecycle.current = lifecycle;
    return () => {
      if (currentLifecycle.current === lifecycle)
        currentLifecycle.current = null;
      for (const timer of terminalTimers.values()) window.clearTimeout(timer);
      terminalTimers.clear();
    };
  }, [lifecycle, terminalTimers]);

  const publish = React.useCallback(() => {
    setView({ lifecycle, states: lifecycle.snapshot });
  }, [lifecycle]);

  const clearTimer = React.useCallback(
    (key: string) => {
      const timer = terminalTimers.get(key);
      if (timer !== undefined) window.clearTimeout(timer);
      terminalTimers.delete(key);
    },
    [terminalTimers],
  );

  const workKeys = React.useMemo(() => {
    const keys = new Map<string, string>();
    for (const [key, activity] of presentationActivity) {
      const turn = getManagedPresentationTurn(activity.uiKey);
      if (turn)
        keys.set(
          key,
          JSON.stringify([
            turn.dispatchReceiptId,
            turn.sessionEpoch,
            turn.turnId,
          ]),
        );
    }
    return keys;
  }, [presentationActivity]);

  React.useLayoutEffect(() => {
    const retired = lifecycle.retireReplaced(workKeys);
    if (retired.length === 0) return;
    for (const key of retired) clearTimer(key);
    publish();
  }, [clearTimer, lifecycle, publish, workKeys]);

  const applyOutcomes = React.useCallback(
    (
      request: ResidentStopRequest,
      updates: ReadonlyMap<string, ConversationActivityState>,
    ) => {
      if (currentLifecycle.current !== lifecycle)
        return new Map<string, ConversationActivityState>();
      const accepted = lifecycle.settle(request, updates);
      if (accepted.size === 0) return accepted;
      publish();
      for (const key of accepted.keys()) {
        clearTimer(key);
        const timer = window.setTimeout(() => {
          if (terminalTimers.get(key) !== timer) return;
          terminalTimers.delete(key);
          if (currentLifecycle.current !== lifecycle) return;
          lifecycle.expire(request, key);
          publish();
        }, TERMINAL_SETTLE_MS);
        terminalTimers.set(key, timer);
      }
      return accepted;
    },
    [clearTimer, lifecycle, publish, terminalTimers],
  );
  const clearLocalState = React.useCallback(
    (pubkey: string) => {
      if (currentLifecycle.current !== lifecycle) return;
      const key = normalizePubkey(pubkey);
      clearTimer(key);
      lifecycle.clear(key);
      publish();
    },
    [clearTimer, lifecycle, publish],
  );

  const stopResidents = React.useCallback(
    async (
      residentKeys: readonly string[],
      capturedTurns?: readonly CancellableManagedTurn[],
    ) => {
      if (!channelId || currentLifecycle.current !== lifecycle) return;
      const request = lifecycle.begin(
        residentKeys.map(normalizePubkey),
        workKeys,
      );
      if (!request) return;
      const { targets } = request;
      for (const key of targets) clearTimer(key);
      publish();

      let cancellable: CancellableManagedTurn[] = [];
      let inspectionFailed = false;
      try {
        cancellable = capturedTurns
          ? [...capturedTurns]
          : await listCancellableManagedTurns(channelId);
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
      // A queued-message interrupt is bound to the earlier captured receipts.
      // Never broaden it to the resident's newly queued or replacement turn.
      for (const key of capturedTurns ? [] : targets) {
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
        const accepted = applyOutcomes(
          request,
          new Map(targets.map((key) => [key, "needs-attention"] as const)),
        );
        if (accepted.size > 0)
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
      const settlements = new Map<
        string,
        ReturnType<typeof activityStopOutcome>["result"]
      >();

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
        settlements.set(key, outcome.result);
      }
      const accepted = applyOutcomes(request, nextStates);
      let stopped = 0;
      let ambiguous = 0;
      let failed = 0;
      for (const key of accepted.keys()) {
        const result = settlements.get(key);
        if (result === "ambiguous") ambiguous += 1;
        else if (result === "failed") failed += 1;
        else stopped += 1;
      }

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
    [
      applyOutcomes,
      channelId,
      clearTimer,
      lifecycle,
      presentationActivity,
      publish,
      workKeys,
    ],
  );

  return { localStates, stopResidents, clearLocalState };
}
