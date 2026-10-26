import * as React from "react";

import {
  type AgentStateInput,
  agentStateWord,
  type MindStateWord,
} from "@/app/shell/placeRails/placePicks";
import { useWorkingChannels } from "@/features/agents/agentWorkingSignal";
import { useRuntimeWorkingPubkeys } from "@/features/capabilities/useAllRuntimeTasks";
import { useAllExchanges } from "@/features/exchange/exchangeStore";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * A mind's one state (SHELL_BUILD.md WP-18, Decided 2): working, talking,
 * waking, needs attention or resting, decided once from
 *   - the live turn (a turn of theirs running in a conversation);
 *   - their running runtime tasks (Claude Code or Codex working for them);
 *   - their live side conversations (an exchange still talking);
 *   - their errors (and waking, from the agent itself).
 * The Agents rail, a mind's head, its profile card and Now all read it, so
 * Atlas talking with Luca reads talking in all four.
 */

export type MindSignals = {
  /** Minds a turn of theirs is running for. */
  turn: ReadonlySet<string>;
  /** Minds a runtime task of theirs is running for. */
  runtime: ReadonlySet<string>;
  /** Minds in an exchange still talking: who opened it and who it asked. */
  talking: ReadonlySet<string>;
};

/** What the agent itself says: its readiness, its error, whether it wakes. */
export type MindSelf = Pick<
  AgentStateInput,
  "availability" | "lastError" | "waking"
>;

/** The live signals every mind's state is read from, kept live. */
export function useMindSignals(): MindSignals {
  const channels = useWorkingChannels();
  const runtime = useRuntimeWorkingPubkeys();
  const exchanges = useAllExchanges();
  const turn = React.useMemo(
    () =>
      new Set(
        channels.flatMap((summary) =>
          summary.agentPubkeys.map(normalizePubkey),
        ),
      ),
    [channels],
  );
  const talking = React.useMemo(
    () =>
      new Set(
        exchanges
          .filter((entry) => entry.phase === "open")
          .flatMap((entry) => [entry.record.openedBy, ...entry.record.members])
          .map(normalizePubkey),
      ),
    [exchanges],
  );
  return React.useMemo(
    () => ({ runtime, talking, turn }),
    [runtime, talking, turn],
  );
}

/** A mind's state from the signals and what the agent itself says. */
export function mindStateOf(
  signals: MindSignals,
  pubkey: string | null | undefined,
  self: MindSelf,
): MindStateWord {
  const key = pubkey ? normalizePubkey(pubkey) : null;
  return agentStateWord({
    ...self,
    talking: key ? signals.talking.has(key) : false,
    working: key ? signals.turn.has(key) || signals.runtime.has(key) : false,
  });
}

/** One mind's state, kept live. */
export function useMindState(
  pubkey: string | null | undefined,
  self: MindSelf,
): MindStateWord {
  const signals = useMindSignals();
  return mindStateOf(signals, pubkey, self);
}

/** A state word as a line or a label begins it: "Talking". */
export function mindStateLabel(word: MindStateWord): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
