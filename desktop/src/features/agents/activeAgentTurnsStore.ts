import * as React from "react";

import {
  subscribeAgentObserverStore,
  getAgentObserverSnapshot,
  compareObserverEvents,
} from "@/features/agents/observerRelayStore";
import {
  type AgentActivity,
  deriveActivity,
} from "@/features/agents/lib/activityPhase";
import { normalizePubkey } from "@/shared/lib/pubkey";
import type { ObserverEvent } from "./ui/agentSessionTypes";

/** Harness emits turn_liveness every ~10s (BUZZ_ACP_TURN_LIVENESS_SECS). */
const LIVENESS_INTERVAL_MS = 10_000;
/** Remove a turn after this long with no activity. Tolerates one fully dropped
 * liveness ping plus slack before pruning a turn whose host died without
 * unwinding (kill -9 / crash) — the only case that reaches this bound, since
 * graceful exits clear via turn_completed and working turns refresh on every
 * stream event. Derived from the interval so it tracks if the interval changes. */
const REMOVE_AFTER_MS = LIVENESS_INTERVAL_MS * 2.5;
/** Pause pruning for an agent once ALL of its tracked turns have gone this long
 * without activity — the "all at once" signature of that agent's frame stream
 * being down. Set below REMOVE_AFTER_MS so the pause engages before the 25s
 * prune would wipe badges. */
const FRAME_GAP_PAUSE_MS = LIVENESS_INTERVAL_MS * 2;
/** A silent agent is treated as dead after this bounded prune pause. */
const PRUNE_PAUSE_MAX_MS = 3 * 60_000;
/** Maximum concurrent active turns tracked per agent (matches pool size). */
const MAX_TURNS_PER_AGENT = 4;
/** Cap on per-agent terminal tombstones (A's resurrection guard). Only the
 * most recently completed turns can be raced by a late liveness frame; older
 * ones are already below the watermark, so a small multiple of the live cap is
 * ample and keeps the map from growing across a long session. */
const MAX_TERMINAL_TOMBSTONES = MAX_TURNS_PER_AGENT * 4;
/** Interval for pruning stale/expired turns. */
const PRUNE_INTERVAL_MS = 5_000;

type ActiveTurn = {
  turnId: string;
  channelId: string;
  startedAt: number;
  lastActivityAt: number;
  /** What the resident is doing right now, derived from the same observer
   *  frames this store already consumes. Null until the first ACP frame of the
   *  turn arrives — a turn can be live for a beat before it says anything. */
  activity: AgentActivity | null;
};

/** One working channel surfaced to the UI, anchored to the desktop clock. */
export type ActiveTurnSummary = {
  channelId: string;
  anchorAt: number;
};

/** One channel with active agent work, aggregated across agents. */
export type ActiveChannelTurnSummary = {
  channelId: string;
  anchorAt: number;
  agentCount: number;
  agentPubkeys: string[];
  agentNames?: string[];
};

// Module-level state: agentPubkey → turnId → ActiveTurn
const activeTurnsByAgent = new Map<string, Map<string, ActiveTurn>>();
const listeners = new Set<() => void>();

// Per-agent clock offset: the desktop clock minus the agent-host clock, in
// milliseconds. Estimated as the running minimum of
// (Date.now() - Date.parse(event.timestamp)) across that agent's events. The
// minimum converges on true skew minus the smallest network/processing delay
// seen — a monotonically tightening estimate immune to per-event jitter. While
// true skew is constant or shrinking it is conservative: elapsed under-reports
// by the minimum delay and never inflates. The minimum never loosens, so under
// GROWING skew (an NTP step forward, or the host clock drifting further behind
// mid-session) the stored estimate goes stale-too-small and elapsed can over-
// report — bounded by how far the skew grows, sub-second over a session. A
// turn's badge anchor is startedAt + offset: the agent's own start, translated
// into desktop-clock terms. Anchors are derived at read time so a later, tighter
// offset retroactively corrects every live turn — distinct agent starts then
// yield distinct anchors (no lockstep) and a turn started long ago anchors into
// the past (large elapsed) instead of resetting to Date.now().
const clockOffsetByAgent = new Map<string, number>();

// Cached snapshots for useSyncExternalStore reference stability.
// Only regenerated when the underlying turn map for an agent actually changes.
const cachedTurnSummaries = new Map<string, ActiveTurnSummary[]>();
let cachedChannelTurnSummaries: ActiveChannelTurnSummary[] | null = null;
const cachedChannelActivity = new Map<string, ChannelAgentActivity[]>();

// Composite watermark per agent: the newest observer event processed, by
// (timestamp, seq) ordering. An event is processed only if it is strictly
// newer than this — making full-buffer replays idempotent and post-restart
// streams (seq resets to 1, timestamp keeps climbing) handled for free.
const lastProcessed = new Map<string, ObserverEvent>();

// Per-agent record of when each turn terminally ended (turnId →
// terminal-event timestamp, in agent-host clock ms). endTurn hard-deletes a
// turn with no surviving record, so without this a late liveness frame for an
// already-completed turn would resurrect a dead badge. Resurrection (A) checks
// this: a turn is revived only if the recovered liveness is strictly newer
// than its recorded terminal timestamp.
const terminalAtByAgent = new Map<string, Map<string, number>>();

let pruneInterval: ReturnType<typeof setInterval> | null = null;

function invalidateCache(agentKey: string) {
  cachedTurnSummaries.delete(agentKey);
  cachedChannelTurnSummaries = null;
  cachedChannelActivity.clear();
}

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Refine this agent's clock-offset estimate from one observer event. Samples
 * Date.now() - Date.parse(timestamp) and keeps the running minimum. When the
 * minimum tightens, every live anchor for the agent shifts, so the cache is
 * invalidated. Events with an unparseable timestamp contribute no sample.
 * Returns true when the offset changed.
 */
function sampleClockOffset(agentKey: string, timestamp: string): boolean {
  const sample = Date.now() - Date.parse(timestamp);
  if (Number.isNaN(sample)) return false;
  const prior = clockOffsetByAgent.get(agentKey);
  if (prior !== undefined && sample >= prior) return false;
  clockOffsetByAgent.set(agentKey, sample);
  invalidateCache(agentKey);
  return true;
}

function parseTimestamp(timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function startTurn(
  agentPubkey: string,
  channelId: string,
  turnId: string,
  timestamp: string,
) {
  const key = normalizePubkey(agentPubkey);
  let agentTurns = activeTurnsByAgent.get(key);
  if (!agentTurns) {
    agentTurns = new Map();
    activeTurnsByAgent.set(key, agentTurns);
  }

  // Cap at MAX_TURNS_PER_AGENT — evict oldest if exceeded
  if (agentTurns.size >= MAX_TURNS_PER_AGENT && !agentTurns.has(turnId)) {
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [tid, turn] of agentTurns) {
      if (turn.startedAt < oldestTime) {
        oldestTime = turn.startedAt;
        oldestKey = tid;
      }
    }
    if (oldestKey) {
      agentTurns.delete(oldestKey);
    }
  }

  const startedAt = parseTimestamp(timestamp) ?? Date.now();
  agentTurns.set(turnId, {
    turnId,
    channelId,
    startedAt,
    lastActivityAt: Date.now(),
    // No phase until the turn's first ACP frame — a turn is live for a beat
    // before it says what it is doing.
    activity: null,
  });
  invalidateCache(key);
}

/** `"none"` — no such turn. `"refreshed"` — liveness only, nothing surfaced
 *  changed. `"changed"` — the phase moved and the UI must re-read. */
type ActivityRecordResult = "none" | "refreshed" | "changed";

function recordActivity(
  agentPubkey: string,
  turnId: string | null,
  activity: AgentActivity | null = null,
): ActivityRecordResult {
  if (!turnId) return "none";
  const key = normalizePubkey(agentPubkey);
  const agentTurns = activeTurnsByAgent.get(key);
  if (!agentTurns) return "none";
  const turn = agentTurns.get(turnId);
  if (!turn) return "none";

  turn.lastActivityAt = Date.now();
  // A frame that carries no phase (liveness, writes) refreshes the turn without
  // clearing what the resident was last seen doing — otherwise the label would
  // flicker to nothing between chunks.
  if (!activity) return "refreshed";

  const previous = turn.activity;
  turn.activity = activity;
  if (
    previous?.phase === activity.phase &&
    previous?.toolKind === activity.toolKind
  ) {
    // Same phase as the last frame — a stream of thought chunks must not
    // re-render the timeline on every chunk.
    return "refreshed";
  }
  invalidateCache(key);
  return "changed";
}

/**
 * A — resurrect a badge that was pruned out from under a still-running turn.
 * A recovered liveness/acp frame for a turn no longer in the live map recreates
 * it, UNLESS C's tombstone shows the turn already terminally ended at or after
 * this frame's time (a stale frame must not revive a completed turn). The frame
 * may carry its original `startedAt` envelope field; when valid and not later
 * than the frame, preserve the elapsed timer by anchoring to that timestamp.
 * Old, malformed, or impossible future starts fall back to the recovery
 * timestamp. Returns true on revive.
 */
function resurrectTurn(agentPubkey: string, event: ObserverEvent): boolean {
  if (!event.turnId || !event.channelId) return false;
  const key = normalizePubkey(agentPubkey);
  const terminalAt = terminalAtByAgent.get(key)?.get(event.turnId);
  const frameAt = parseTimestamp(event.timestamp);
  // Only revive when this frame is strictly newer than the recorded terminal.
  if (terminalAt !== undefined && (frameAt === null || frameAt <= terminalAt)) {
    return false;
  }
  const startedAt =
    typeof event.startedAt === "string" &&
    parseTimestamp(event.startedAt) !== null
      ? event.startedAt
      : event.timestamp;
  const startedAtMs = parseTimestamp(startedAt);
  const safeStartedAt =
    frameAt !== null && startedAtMs !== null && startedAtMs <= frameAt
      ? startedAt
      : event.timestamp;
  startTurn(agentPubkey, event.channelId, event.turnId, safeStartedAt);
  return true;
}

function recordTerminal(agentKey: string, turnId: string, terminalAt: number) {
  // Positive infinity is reserved for an explicit native cancellation: the
  // watchdog replaced that process, so this exact turn ID must never revive.
  // The bounded tombstone map still prevents unbounded retention.
  if (Number.isNaN(terminalAt)) return;
  let terminals = terminalAtByAgent.get(agentKey);
  if (!terminals) {
    terminals = new Map();
    terminalAtByAgent.set(agentKey, terminals);
  }
  terminals.set(turnId, terminalAt);
  // Bound the tombstone map: only recently-completed turns can be the target of
  // a racing late liveness frame (older ones are already below the watermark).
  // Evict the oldest terminal once past the cap so the map can't grow unbounded
  // across a long session. Insertion order tracks completion order closely
  // enough; the first key is the oldest survivor.
  if (terminals.size > MAX_TERMINAL_TOMBSTONES) {
    const oldest = terminals.keys().next().value;
    if (oldest !== undefined) terminals.delete(oldest);
  }
}

function endTurn(
  agentPubkey: string,
  turnId: string | null,
  channelId: string | null,
  terminalAt: number,
) {
  const key = normalizePubkey(agentPubkey);
  // Tombstone the terminal time so a late liveness frame can't resurrect a
  // completed turn (A's guard). With an explicit turnId this is recorded even
  // when the turn was already pruned and the agent's live map is gone — the
  // completion is authoritative and must outlive the active record.
  if (turnId) {
    recordTerminal(key, turnId, terminalAt);
  }

  const agentTurns = activeTurnsByAgent.get(key);
  if (!agentTurns) return;

  if (turnId) {
    agentTurns.delete(turnId);
  } else if (channelId) {
    // Fallback: remove by channelId if turnId not available. Tombstone the
    // resolved turn so a later stale liveness for it can't resurrect a badge.
    for (const [tid, turn] of agentTurns) {
      if (turn.channelId === channelId) {
        agentTurns.delete(tid);
        recordTerminal(key, tid, terminalAt);
        break;
      }
    }
  }
  if (agentTurns.size === 0) {
    activeTurnsByAgent.delete(key);
  }
  invalidateCache(key);
}

/**
 * Remove one exact turn after the native cancellation watchdog has completed.
 *
 * A killed ACP host cannot be relied on to emit `turn_completed`. Record the
 * terminal permanently for this exact turn ID so delayed observer frames from
 * the replaced process cannot resurrect the cancelled activity badge.
 */
export function cancelActiveAgentTurn(
  agentPubkey: string,
  channelId: string,
  turnId?: string | null,
): void {
  endTurn(agentPubkey, turnId ?? null, channelId, Number.POSITIVE_INFINITY);
  notifyListeners();
}

/** True when every tracked turn for one agent is stale, but only until the
 * bounded backstop expires. Other agents' activity intentionally has no effect. */
function shouldPausePrune(
  agentTurns: Map<string, ActiveTurn>,
  now: number,
): boolean {
  let maxActivity = 0;
  for (const turn of agentTurns.values()) {
    if (turn.lastActivityAt > maxActivity) maxActivity = turn.lastActivityAt;
  }
  const silentFor = now - maxActivity;
  return (
    maxActivity > 0 &&
    silentFor > FRAME_GAP_PAUSE_MS &&
    silentFor < PRUNE_PAUSE_MAX_MS
  );
}

function pruneExpired() {
  const now = Date.now();
  let changed = false;
  for (const [agentKey, agentTurns] of activeTurnsByAgent) {
    // A single fresh tracked turn for this agent means a stale sibling is
    // genuinely dead and must still prune at 25s. Conversely, all of this
    // agent's turns going stale together identifies a per-agent frame-stream
    // gap, regardless of whether other agents keep reporting activity.
    if (shouldPausePrune(agentTurns, now)) continue;

    for (const [turnId, turn] of agentTurns) {
      if (now - turn.lastActivityAt > REMOVE_AFTER_MS) {
        agentTurns.delete(turnId);
        invalidateCache(agentKey);
        changed = true;
      }
    }
    if (agentTurns.size === 0) {
      activeTurnsByAgent.delete(agentKey);
    }
  }
  if (changed) {
    notifyListeners();
  }
}

// INVARIANT: events must be sorted by (timestamp, seq) ascending.
// syncAgentTurnsFromEvents receives sorted arrays from observerRelayStore.
// Calling with unsorted events will cause silent data loss.
function processEvent(agentPubkey: string, event: ObserverEvent) {
  const key = normalizePubkey(agentPubkey);

  // Gate every event kind on the watermark uniformly: process only events
  // strictly newer than the last one seen for this agent. With sorted buffers
  // (the documented invariant), this makes full-buffer replays a complete
  // no-op. Evictions must be gated too — replaying a stale turn_error/
  // agent_panic (emitted with a null turnId) would otherwise fall back to
  // deleting the first turn in the channel, killing the live turn. Resurrection
  // (the turn_liveness/acp case below) is gated here too: it runs only for a
  // frame that passes the watermark, so replayed stale frames cannot revive a
  // pruned turn, and the per-turn terminal tombstone blocks reviving a turn
  // that already completed.
  const last = lastProcessed.get(key);
  if (last && compareObserverEvents(event, last) <= 0) {
    return;
  }
  lastProcessed.set(key, event);

  // Refine the clock offset from every fresh event. A tighter offset shifts
  // every live anchor for this agent, so a change must reach the UI even when
  // the event itself surfaces no new turn.
  const offsetChanged = sampleClockOffset(key, event.timestamp);

  switch (event.kind) {
    case "turn_started":
      if (event.channelId) {
        startTurn(
          agentPubkey,
          event.channelId,
          event.turnId ?? `seq-${event.seq}`,
          event.timestamp,
        );
        notifyListeners();
        return;
      }
      break;
    case "turn_completed":
    case "turn_error":
    case "agent_panic":
      endTurn(
        agentPubkey,
        event.turnId ?? null,
        event.channelId ?? null,
        Date.parse(event.timestamp),
      );
      notifyListeners();
      return;
    case "acp_read":
    case "acp_write":
    // turn_liveness keeps a quiet-but-alive turn from being pruned; same
    // refresh-only path as stream activity — no surfaced summary change on its
    // own, so it only notifies when the offset above actually moved. If the
    // turn was pruned out from under a still-running host (a transient drop
    // raced the pause, or the lone-crash residual self-healed), resurrect it.
    case "turn_liveness": {
      const result = recordActivity(
        agentPubkey,
        event.turnId ?? null,
        deriveActivity(event),
      );
      // A phase change is a surfaced change and must reach the UI on its own —
      // the fall-through below only notifies when the clock offset moved.
      if (result === "changed") {
        notifyListeners();
        return;
      }
      if (result === "none" && resurrectTurn(agentPubkey, event)) {
        notifyListeners();
        return;
      }
      break;
    }
  }

  if (offsetChanged) {
    notifyListeners();
  }
}

function ensurePruneInterval() {
  if (pruneInterval) return;
  pruneInterval = setInterval(pruneExpired, PRUNE_INTERVAL_MS);
}

function stopPruneInterval() {
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
}

export function subscribeActiveAgentTurns(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    ensurePruneInterval();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopPruneInterval();
    }
  };
}

/**
 * Returns the channels where the given agent has active turns, sorted by
 * channelId, each anchored to the earliest `anchorAt` for that channel.
 * The array reference is cached and stable until the turn map mutates — a
 * requirement for `useSyncExternalStore`.
 */
export function getActiveTurnsForAgent(
  agentPubkey: string | null | undefined,
): ActiveTurnSummary[] {
  if (!agentPubkey) return EMPTY_TURNS;
  const key = normalizePubkey(agentPubkey);
  const agentTurns = activeTurnsByAgent.get(key);
  if (!agentTurns || agentTurns.size === 0) return EMPTY_TURNS;

  const cached = cachedTurnSummaries.get(key);
  if (cached) return cached;

  const offset = clockOffsetByAgent.get(key) ?? 0;

  // Collapse multiple turns in one channel to the earliest start — the badge
  // should count from when the channel's oldest live turn began. Anchors are
  // derived here (startedAt + offset) so the latest skew estimate applies.
  const earliestByChannel = new Map<string, number>();
  for (const turn of agentTurns.values()) {
    const prior = earliestByChannel.get(turn.channelId);
    if (prior === undefined || turn.startedAt < prior) {
      earliestByChannel.set(turn.channelId, turn.startedAt);
    }
  }

  const result = [...earliestByChannel.entries()]
    .map(([channelId, startedAt]) => ({
      channelId,
      anchorAt: startedAt + offset,
    }))
    .sort((a, b) => a.channelId.localeCompare(b.channelId));
  cachedTurnSummaries.set(key, result);
  return result;
}

const EMPTY_TURNS: ActiveTurnSummary[] = [];
const EMPTY_ACTIVITY: ChannelAgentActivity[] = [];
const EMPTY_CHANNEL_TURNS: ActiveChannelTurnSummary[] = [];

/**
 * One resident working in one channel, with what they are doing and since when.
 * This is what the conversation surface needs; `ActiveChannelTurnSummary` only
 * answers "is anyone busy here", which is the flattening this replaces.
 */
export type ChannelAgentActivity = {
  agentPubkey: string;
  turnId: string;
  /** Desktop-clock start, already corrected for the agent's clock offset, so an
   *  elapsed counter reads true even when the agent's clock drifts. */
  anchorAt: number;
  activity: AgentActivity | null;
};

/**
 * Every resident currently working in one channel. Cached per channel because
 * `useSyncExternalStore` compares snapshots by identity — rebuilding the array
 * on every read would re-render the timeline on every frame.
 */
export function getChannelAgentActivity(
  channelId: string | null | undefined,
): ChannelAgentActivity[] {
  if (!channelId) return EMPTY_ACTIVITY;
  const cached = cachedChannelActivity.get(channelId);
  if (cached) return cached;
  if (activeTurnsByAgent.size === 0) return EMPTY_ACTIVITY;

  // One row per RESIDENT, not per turn. An agent may run several concurrent
  // turns in a channel (up to MAX_TURNS_PER_AGENT), but a resident is one
  // person — listing them twice reads as two residents. Keep the turn that
  // started earliest so the elapsed counter reports how long the wait has
  // really been, and carry the most recent phase, which is what they are doing
  // now.
  const byAgent = new Map<string, ChannelAgentActivity>();
  for (const [agentKey, agentTurns] of activeTurnsByAgent) {
    const offset = clockOffsetByAgent.get(agentKey) ?? 0;
    for (const turn of agentTurns.values()) {
      if (turn.channelId !== channelId) continue;
      const anchorAt = turn.startedAt + offset;
      const existing = byAgent.get(agentKey);
      if (!existing) {
        byAgent.set(agentKey, {
          agentPubkey: agentKey,
          turnId: turn.turnId,
          anchorAt,
          activity: turn.activity,
        });
        continue;
      }
      existing.anchorAt = Math.min(existing.anchorAt, anchorAt);
      if (turn.activity) existing.activity = turn.activity;
    }
  }
  const rows = [...byAgent.values()];
  if (rows.length === 0) return EMPTY_ACTIVITY;

  // Oldest first: the resident who has been waiting on longest reads first.
  rows.sort(
    (a, b) => a.anchorAt - b.anchorAt || a.turnId.localeCompare(b.turnId),
  );
  cachedChannelActivity.set(channelId, rows);
  return rows;
}

/** Hook form. Re-renders when the working set or any phase changes. */
export function useChannelAgentActivity(
  channelId: string | null | undefined,
): ChannelAgentActivity[] {
  const getSnapshot = React.useCallback(
    () => getChannelAgentActivity(channelId),
    [channelId],
  );
  return React.useSyncExternalStore(subscribeActiveAgentTurns, getSnapshot);
}

/**
 * Returns active working channels across all tracked agents, sorted by
 * channelId and anchored to the earliest live turn in each channel.
 */
export function getActiveTurnsByChannel(): ActiveChannelTurnSummary[] {
  if (cachedChannelTurnSummaries) return cachedChannelTurnSummaries;
  if (activeTurnsByAgent.size === 0) return EMPTY_CHANNEL_TURNS;

  const summaries = new Map<
    string,
    { anchorAt: number; agentPubkeys: Set<string> }
  >();

  for (const [agentKey, agentTurns] of activeTurnsByAgent) {
    if (agentTurns.size === 0) continue;
    const offset = clockOffsetByAgent.get(agentKey) ?? 0;

    for (const turn of agentTurns.values()) {
      const anchorAt = turn.startedAt + offset;
      const summary = summaries.get(turn.channelId);
      if (!summary) {
        summaries.set(turn.channelId, {
          anchorAt,
          agentPubkeys: new Set([agentKey]),
        });
        continue;
      }

      summary.agentPubkeys.add(agentKey);
      if (anchorAt < summary.anchorAt) {
        summary.anchorAt = anchorAt;
      }
    }
  }

  const result = [...summaries.entries()]
    .map(([channelId, summary]) => ({
      channelId,
      anchorAt: summary.anchorAt,
      agentCount: summary.agentPubkeys.size,
      agentPubkeys: [...summary.agentPubkeys].sort(),
    }))
    .sort((a, b) => a.channelId.localeCompare(b.channelId));
  cachedChannelTurnSummaries = result;
  return result;
}

/**
 * Synchronize the active-turns store with the latest observer events for a
 * given agent.
 */
export function syncAgentTurnsFromEvents(
  agentPubkey: string,
  events: ObserverEvent[],
) {
  for (const event of events) {
    processEvent(agentPubkey, event);
  }
}

/**
 * Hook: returns the channels where the given agent is currently working, each
 * with the desktop-clock `anchorAt` to anchor a live elapsed counter.
 * Re-renders when the set of channels changes — not when the clock ticks.
 */
export function useActiveAgentTurns(
  agentPubkey: string | null | undefined,
): ActiveTurnSummary[] {
  const getSnapshot = React.useCallback(
    () => getActiveTurnsForAgent(agentPubkey),
    [agentPubkey],
  );

  return React.useSyncExternalStore(subscribeActiveAgentTurns, getSnapshot);
}

/**
 * Hook: returns channels with active agent work across all tracked agents.
 * Re-renders when the channel set changes — not when the clock ticks.
 */
export function useActiveAgentTurnsByChannel(): ActiveChannelTurnSummary[] {
  return React.useSyncExternalStore(
    subscribeActiveAgentTurns,
    getActiveTurnsByChannel,
  );
}

/**
 * Sync every running/deployed agent's observer events into the active-turns
 * store. Extracted from the bridge hook so a regression can drive the exact
 * observer→derived-liveness path without a React renderer.
 */
export function syncActiveAgentTurnsFromObserver(
  agents: readonly { pubkey: string; status: string }[],
) {
  for (const agent of agents) {
    if (agent.status !== "running" && agent.status !== "deployed") continue;
    const snapshot = getAgentObserverSnapshot(agent.pubkey, true);
    syncAgentTurnsFromEvents(agent.pubkey, snapshot.events);
  }
}

/**
 * Bridge hook: processes observer events into the active-turns store.
 * Should be called by a parent component that has access to the observer events.
 */
export function useActiveAgentTurnsBridge(
  agents: readonly { pubkey: string; status: string }[],
) {
  React.useEffect(() => {
    function syncAll() {
      syncActiveAgentTurnsFromObserver(agents);
    }

    syncAll();
    return subscribeAgentObserverStore(syncAll);
  }, [agents]);
}

/**
 * Clears all live turn state (active turns, offsets, watermarks, tombstones).
 * Intentionally preserves `savedByCommunity` — community-switch snapshots
 * must survive the reset that runs between save and restore.
 */
export function resetActiveAgentTurnsStore() {
  activeTurnsByAgent.clear();
  lastProcessed.clear();
  clockOffsetByAgent.clear();
  cachedTurnSummaries.clear();
  cachedChannelTurnSummaries = null;
  // Community-scoped: channel ids do not survive a community switch, so a
  // retained entry would surface another community's residents as working.
  cachedChannelActivity.clear();
  terminalAtByAgent.clear();
  notifyListeners();
}

// ---------------------------------------------------------------------------
// Community-switch save / restore
// ---------------------------------------------------------------------------

type TurnsStoreSnapshot = {
  turns: Map<string, Map<string, ActiveTurn>>;
  offsets: Map<string, number>;
  watermarks: Map<string, ObserverEvent>;
  terminals: Map<string, Map<string, number>>;
};

/** Per-community snapshots. Keyed by community ID. */
const savedByCommunity = new Map<string, TurnsStoreSnapshot>();

/**
 * Snapshot the current active-turns state under `communityId` so it can be
 * restored when the user switches back.  If both the turns map and the
 * tombstone map are empty there is nothing worth restoring — discard any
 * previously-saved snapshot instead.
 *
 * Deep-clones all four maps so subsequent mutations on the live maps do not
 * corrupt the snapshot.
 */
export function saveActiveAgentTurnsForCommunity(communityId: string): void {
  if (activeTurnsByAgent.size === 0 && terminalAtByAgent.size === 0) {
    savedByCommunity.delete(communityId);
    return;
  }

  // Deep-clone activeTurnsByAgent: outer map + inner per-agent maps + turn
  // objects (plain structs, no nested references beyond primitives).
  const turns = new Map<string, Map<string, ActiveTurn>>();
  for (const [agentKey, agentTurns] of activeTurnsByAgent) {
    const clonedAgent = new Map<string, ActiveTurn>();
    for (const [turnId, turn] of agentTurns) {
      clonedAgent.set(turnId, { ...turn });
    }
    turns.set(agentKey, clonedAgent);
  }

  // Shallow-clone scalar maps (primitives as values).
  const offsets = new Map(clockOffsetByAgent);
  const watermarks = new Map(lastProcessed);

  // Deep-clone terminalAtByAgent: outer map + inner per-agent maps.
  const terminals = new Map<string, Map<string, number>>();
  for (const [agentKey, tombstones] of terminalAtByAgent) {
    terminals.set(agentKey, new Map(tombstones));
  }

  savedByCommunity.set(communityId, { turns, offsets, watermarks, terminals });
}

/**
 * Restore a previously saved active-turns snapshot for `communityId` into the
 * module maps.  No-op when no snapshot exists.
 *
 * Clears all four module maps before writing so the function is
 * self-contained — it replaces rather than merging, regardless of whether the
 * caller pre-cleared.  At the primary call site (`useCommunityInit`) the maps
 * are already empty after `resetCommunityState()`, but this guard makes the
 * contract explicit.
 *
 * Refreshes `lastActivityAt` on every restored turn so the prune interval
 * doesn't immediately kill turns that were saved more than 25 s ago (the prune
 * threshold).  New observer events arriving after restore will update
 * `lastActivityAt` normally via `recordActivity`.
 *
 * Consumes the snapshot (deletes it from `savedByCommunity`) — a given
 * community's snapshot is only usable once per round-trip.
 */
export function restoreActiveAgentTurnsForCommunity(communityId: string): void {
  const snap = savedByCommunity.get(communityId);
  if (!snap) return;
  savedByCommunity.delete(communityId);

  // Clear before writing so this is a replace, not a merge.
  activeTurnsByAgent.clear();
  clockOffsetByAgent.clear();
  lastProcessed.clear();
  terminalAtByAgent.clear();

  const now = Date.now();

  for (const [agentKey, agentTurns] of snap.turns) {
    const restored = new Map<string, ActiveTurn>();
    for (const [turnId, turn] of agentTurns) {
      restored.set(turnId, { ...turn, lastActivityAt: now });
    }
    activeTurnsByAgent.set(agentKey, restored);
  }

  for (const [agentKey, offset] of snap.offsets) {
    clockOffsetByAgent.set(agentKey, offset);
  }

  for (const [agentKey, event] of snap.watermarks) {
    lastProcessed.set(agentKey, event);
  }

  for (const [agentKey, tombstones] of snap.terminals) {
    terminalAtByAgent.set(agentKey, new Map(tombstones));
  }

  cachedTurnSummaries.clear();
  cachedChannelTurnSummaries = null;
  notifyListeners();
}

/**
 * Discard the saved turn-state snapshot for a community that has been
 * permanently deleted so the entry doesn't sit in memory indefinitely.
 * Call this alongside the other relay-specific GC in `removeCommunity`.
 */
export function clearSavedCommunitySnapshot(communityId: string): void {
  savedByCommunity.delete(communityId);
}
