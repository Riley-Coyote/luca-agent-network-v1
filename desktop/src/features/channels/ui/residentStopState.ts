import type { ConversationActivityState } from "./conversationAgentActivityShelf";

type StopPhase = "stopping" | "stopped" | "needs-attention";

/** Transient UI ownership only; never a native cancellation capability. */
export type ResidentStopRequest = {
  readonly token: symbol;
  readonly targets: readonly string[];
};

/**
 * Ephemeral Stop presentation, owned by one mounted conversation incarnation.
 * Native cancellation keeps its exact receipts; this model grants no authority.
 * A new incarnation gets a new model, even for A → B → A navigation.
 */
export class ResidentStopState {
  private entries = new Map<
    string,
    { token: symbol; phase: StopPhase; workKey: string | undefined }
  >();
  private states: ReadonlyMap<string, ConversationActivityState> = new Map();

  /** Immutable-by-convention projection; its identity changes only on transition. */
  get snapshot() {
    return this.states;
  }

  private publish() {
    this.states = new Map(
      [...this.entries].map(([key, entry]) => [key, entry.phase]),
    );
  }

  /** Synchronously admit each resident at most once until settlement or replacement. */
  begin(
    keys: readonly string[],
    workKeys: ReadonlyMap<string, string> = new Map(),
  ): ResidentStopRequest | null {
    const targets = [...new Set(keys)].filter(
      (key) => this.entries.get(key)?.phase !== "stopping",
    );
    if (targets.length === 0) return null;
    const token = Symbol("resident-stop");
    for (const key of targets) {
      this.entries.set(key, {
        token,
        phase: "stopping",
        workKey: workKeys.get(key),
      });
    }
    this.publish();
    return { token, targets };
  }

  /** Ignore obsolete requests, repeated settlements and nonterminal outcomes. */
  settle(
    request: ResidentStopRequest,
    outcomes: ReadonlyMap<string, ConversationActivityState>,
  ): ReadonlyMap<string, ConversationActivityState> {
    const accepted = new Map<string, ConversationActivityState>();
    for (const key of request.targets) {
      const entry = this.entries.get(key);
      const phase = outcomes.get(key);
      if (
        entry?.token !== request.token ||
        entry.phase !== "stopping" ||
        (phase !== "stopped" && phase !== "needs-attention")
      )
        continue;
      this.entries.set(key, { ...entry, phase });
      accepted.set(key, phase);
    }
    if (accepted.size > 0) this.publish();
    return accepted;
  }

  /** Forget presentation and invalidate any pending local completion. */
  clear(key: string) {
    if (this.entries.delete(key)) this.publish();
  }

  /** A replacement turn is independently stoppable, even while the old Stop awaits native I/O. */
  retireReplaced(workKeys: ReadonlyMap<string, string>): string[] {
    const retired: string[] = [];
    for (const [key, entry] of this.entries) {
      const current = workKeys.get(key);
      if (
        entry.workKey === undefined ||
        current === undefined ||
        current === entry.workKey
      )
        continue;
      this.entries.delete(key);
      retired.push(key);
    }
    if (retired.length > 0) this.publish();
    return retired;
  }

  /** Expire only the same settled request, not a newer identical-looking phase. */
  expire(request: ResidentStopRequest, key: string) {
    const entry = this.entries.get(key);
    if (entry?.token !== request.token || entry.phase === "stopping") return;
    this.clear(key);
  }
}
