import * as React from "react";
import { RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";

import type { AgentActivity } from "@/features/agents/lib/activityPhase";
import type { BotActivityAgent } from "@/features/channels/ui/BotActivityBar";
import type { ChannelAgentSessionAgent } from "@/features/channels/ui/useChannelAgentSessions";
import { getManagedPresentationTurn } from "@/features/messages/managedPresentationStore";
import type { ManagedConversationActivity } from "@/features/messages/managedPresentationTypes";
import {
  cancelManagedAgentTurn,
  listCancellableManagedTurns,
} from "@/shared/api/agentControl";
import type { CancellableManagedTurn } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  EMPTY_ACTIVITY_SHELF_SLOTS,
  type ConversationActivityState,
  activityShelfOverflow,
  conversationActivityLabel,
  isTerminalConversationActivity,
  reconcileActivityShelfSlots,
} from "./conversationAgentActivityShelf";
import "./conversationAgentActivityShelf.css";

export type ConversationAgentActivityStripProps = {
  agents: BotActivityAgent[];
  channelId: string | null;
  onOpenResident: (pubkey: string) => void;
  sessionAgents: ChannelAgentSessionAgent[];
  workingPubkeys: string[];
  /** Observer-derived phase for residents whose native turn is still live. */
  activityByPubkey?: ReadonlyMap<string, AgentActivity | null>;
  /**
   * Optional presentation lifecycle supplied by the managed stream surface.
   * It takes precedence over observer phases so `finalizing`, terminal, and
   * reconciliation states can share this shelf without another polling loop.
   */
  presentationStateByPubkey?: ReadonlyMap<string, ConversationActivityState>;
  /** Body-free presentation identities used to resolve an exact cancellation
   * receipt only after the owner presses Stop. */
  presentationActivityByPubkey?: ManagedConversationActivity;
  /** Retry remains an explicit owner action; the shelf never retries itself. */
  onRetryResident?: (pubkey: string) => void;
  /** Human typing can occupy the same reserved shelf when no resident works. */
  idleContent?: React.ReactNode;
};

type ActivityShelfItem = {
  key: string;
  name: string;
  pubkey: string;
  state: ConversationActivityState;
  canStop: boolean;
};

const TERMINAL_SETTLE_MS = 3_200;
const LATTICE_CELL_KEYS = [
  "north-west",
  "north",
  "north-east",
  "west",
  "center",
  "east",
  "south-west",
  "south",
  "south-east",
] as const;

function stateForActivity(activity: AgentActivity | null | undefined) {
  switch (activity?.phase) {
    case "thinking":
      return "thinking" as const;
    case "working":
      return "working" as const;
    case "responding":
      return "writing" as const;
    default:
      return null;
  }
}

function isSessionReady(agent: ChannelAgentSessionAgent | undefined) {
  return !agent || agent.status === "running" || agent.status === "deployed";
}

function isStoppableState(state: ConversationActivityState) {
  return (
    state === "thinking" ||
    state === "working" ||
    state === "writing" ||
    state === "finalizing"
  );
}

function MurmurationLattice({ state }: { state: ConversationActivityState }) {
  return (
    <span
      aria-hidden="true"
      className="luca-activity-lattice"
      data-state={state}
    >
      {LATTICE_CELL_KEYS.map((key) => (
        <span className="luca-activity-lattice__cell" key={key} />
      ))}
    </span>
  );
}

function ActivityItem({
  compact = false,
  item,
  onOpenResident,
  onRetryResident,
  onStop,
  replacement = false,
}: {
  compact?: boolean;
  item: ActivityShelfItem;
  onOpenResident: (pubkey: string) => void;
  onRetryResident?: (pubkey: string) => void;
  onStop: (pubkey: string) => void;
  replacement?: boolean;
}) {
  const terminal = isTerminalConversationActivity(item.state);
  const stateLabel = conversationActivityLabel(item.state);
  return (
    <div
      className={cn(
        "luca-activity-item",
        compact && "luca-activity-item--compact",
        replacement && "luca-activity-item--replacement",
      )}
      data-activity-state={item.state}
      data-resident-pubkey={item.key}
      data-testid={`resident-activity-${item.key}`}
    >
      <MurmurationLattice state={item.state} />
      <button
        aria-label={`Open details for ${item.name}`}
        className="luca-activity-item__resident"
        onClick={() => onOpenResident(item.pubkey)}
        type="button"
      >
        <span className="luca-activity-item__name">{item.name}</span>
        <span
          className="luca-activity-item__state"
          data-sweeping={!terminal && item.state !== "stopping"}
        >
          {stateLabel}
        </span>
      </button>
      {terminal && onRetryResident ? (
        <button
          aria-label={`Retry ${item.name}`}
          className="luca-activity-item__action"
          onClick={() => onRetryResident(item.pubkey)}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="h-3 w-3" />
          <span>Retry</span>
        </button>
      ) : (
        <button
          aria-label={`Stop ${item.name}`}
          className="luca-activity-item__action"
          disabled={!item.canStop || item.state === "stopping"}
          onClick={() => onStop(item.pubkey)}
          type="button"
        >
          <Square aria-hidden="true" className="h-3 w-3" />
          <span>{item.state === "stopping" ? "Stopping" : "Stop"}</span>
        </button>
      )}
    </div>
  );
}

function ActivityDisclosure({
  items,
  label,
  onOpenResident,
  onRetryResident,
  onStop,
  onStopAll,
}: {
  items: ActivityShelfItem[];
  label: string;
  onOpenResident: (pubkey: string) => void;
  onRetryResident?: (pubkey: string) => void;
  onStop: (pubkey: string) => void;
  onStopAll: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`${label}. View all resident activity.`}
          className="luca-activity-disclosure"
          type="button"
        >
          <MurmurationLattice state="working" />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="All resident activity"
        className="luca-activity-popover w-80 p-2"
        side="top"
        sideOffset={8}
      >
        <div className="luca-activity-popover__heading">
          <span>Resident activity</span>
          <span>{items.length} active</span>
        </div>
        <div className="luca-activity-popover__list">
          {items.map((item) => (
            <ActivityItem
              compact
              item={item}
              key={item.key}
              onOpenResident={onOpenResident}
              onRetryResident={onRetryResident}
              onStop={onStop}
            />
          ))}
        </div>
        {items.filter((item) => item.canStop).length > 1 ? (
          <button
            className="luca-activity-popover__stop-all"
            onClick={onStopAll}
            type="button"
          >
            <Square aria-hidden="true" className="h-3 w-3" />
            Stop all
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function normalizedStateMap(
  states: ReadonlyMap<string, ConversationActivityState> | undefined,
): Map<string, ConversationActivityState> {
  return new Map(
    [...(states?.entries() ?? [])].map(([pubkey, state]) => [
      normalizePubkey(pubkey),
      state,
    ]),
  );
}

export function ConversationAgentActivityStrip({
  agents,
  channelId,
  onOpenResident,
  sessionAgents,
  workingPubkeys,
  activityByPubkey,
  presentationActivityByPubkey,
  presentationStateByPubkey,
  onRetryResident,
  idleContent,
}: ConversationAgentActivityStripProps) {
  const [localStates, setLocalStates] = React.useState<
    Map<string, ConversationActivityState>
  >(() => new Map());
  const terminalTimers = React.useRef(new Map<string, number>());
  const slotState = React.useRef(EMPTY_ACTIVITY_SHELF_SLOTS);

  React.useEffect(
    () => () => {
      for (const timer of terminalTimers.current.values()) {
        window.clearTimeout(timer);
      }
      terminalTimers.current.clear();
    },
    [],
  );

  const sessions = React.useMemo(
    () =>
      new Map(
        sessionAgents.map((agent) => [normalizePubkey(agent.pubkey), agent]),
      ),
    [sessionAgents],
  );
  const knownAgents = React.useMemo(() => {
    const known = new Map<string, BotActivityAgent>();
    for (const agent of sessionAgents) {
      known.set(normalizePubkey(agent.pubkey), agent);
    }
    for (const agent of agents) {
      known.set(normalizePubkey(agent.pubkey), agent);
    }
    return known;
  }, [agents, sessionAgents]);
  const observerActivity = React.useMemo(
    () =>
      new Map(
        [...(activityByPubkey?.entries() ?? [])].map(([pubkey, activity]) => [
          normalizePubkey(pubkey),
          activity,
        ]),
      ),
    [activityByPubkey],
  );
  const presentationStates = React.useMemo(
    () => normalizedStateMap(presentationStateByPubkey),
    [presentationStateByPubkey],
  );
  const presentationActivity = React.useMemo(
    () =>
      new Map(
        [...(presentationActivityByPubkey?.entries() ?? [])].map(
          ([pubkey, activity]) => [normalizePubkey(pubkey), activity],
        ),
      ),
    [presentationActivityByPubkey],
  );

  const activeKeys = React.useMemo(() => {
    const keys: string[] = [];
    const seen = new Set<string>();
    const add = (pubkey: string) => {
      const key = normalizePubkey(pubkey);
      if (!key || seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    };
    for (const pubkey of workingPubkeys) add(pubkey);
    for (const pubkey of observerActivity.keys()) add(pubkey);
    for (const pubkey of presentationStates.keys()) add(pubkey);
    for (const pubkey of localStates.keys()) add(pubkey);
    return keys;
  }, [localStates, observerActivity, presentationStates, workingPubkeys]);

  const previousSlotState = slotState.current;
  slotState.current = reconcileActivityShelfSlots(
    previousSlotState,
    activeKeys,
  );

  const itemsByKey = React.useMemo(() => {
    const items = new Map<string, ActivityShelfItem>();
    for (const key of activeKeys) {
      const agent = knownAgents.get(key);
      const local = localStates.get(key);
      const presentation = presentationStates.get(key);
      const observed = stateForActivity(observerActivity.get(key));
      const state =
        local ??
        presentation ??
        observed ??
        (isSessionReady(sessions.get(key)) ? "thinking" : "needs-attention");
      items.set(key, {
        key,
        name: agent?.name ?? "Resident",
        pubkey: agent?.pubkey ?? key,
        state,
        canStop: Boolean(channelId) && isStoppableState(state),
      });
    }
    return items;
  }, [
    activeKeys,
    channelId,
    knownAgents,
    localStates,
    observerActivity,
    presentationStates,
    sessions,
  ]);

  const orderedItems = slotState.current.order.flatMap((key) => {
    const item = itemsByKey.get(key);
    return item ? [item] : [];
  });
  const visibleSlots = slotState.current.slots.slice(
    0,
    slotState.current.capacity,
  );
  const visibleSlotEntries = [
    {
      id: "first",
      residentKey: visibleSlots[0] ?? null,
      replacement:
        Boolean(previousSlotState.slots[0]) &&
        previousSlotState.slots[0] !== visibleSlots[0],
    },
    {
      id: "second",
      residentKey: visibleSlots[1] ?? null,
      replacement:
        Boolean(previousSlotState.slots[1]) &&
        previousSlotState.slots[1] !== visibleSlots[1],
    },
    {
      id: "third",
      residentKey: visibleSlots[2] ?? null,
      replacement:
        Boolean(previousSlotState.slots[2]) &&
        previousSlotState.slots[2] !== visibleSlots[2],
    },
  ].slice(0, slotState.current.capacity);
  const overflowCount = activityShelfOverflow(slotState.current).length;
  const stoppableItems = orderedItems.filter((item) => item.canStop);

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
        if (indices.length === 0) {
          nextStates.set(key, inspectionFailed ? "needs-attention" : "stopped");
          if (inspectionFailed) failed += 1;
          else stopped += 1;
          continue;
        }
        const residentResults = indices.map((index) => results[index]);
        if (residentResults.some((result) => result?.status === "rejected")) {
          nextStates.set(key, "needs-attention");
          failed += 1;
          continue;
        }
        const hasAmbiguousFinal = residentResults.some(
          (result) =>
            result?.status === "fulfilled" &&
            result.value.status === "publication_ambiguous",
        );
        nextStates.set(key, hasAmbiguousFinal ? "needs-attention" : "stopped");
        if (hasAmbiguousFinal) ambiguous += 1;
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

  const handleStopResident = React.useCallback(
    (pubkey: string) => void stopResidents([pubkey]),
    [stopResidents],
  );
  const handleStopAll = React.useCallback(
    () => void stopResidents(stoppableItems.map((item) => item.pubkey)),
    [stopResidents, stoppableItems],
  );
  const announcement = orderedItems
    .map((item) => `${item.name} ${conversationActivityLabel(item.state)}`)
    .join(". ");

  return (
    <section
      aria-label="Resident activity"
      className="luca-activity-shelf"
      data-active-count={orderedItems.length}
      data-state={orderedItems.length > 0 ? "active" : "idle"}
      data-testid="conversation-activity-shelf"
    >
      <div className="luca-activity-shelf__inner">
        {orderedItems.length === 0 && idleContent ? (
          <div className="luca-activity-shelf__idle-content">{idleContent}</div>
        ) : null}
        <div
          className="luca-activity-shelf__slots"
          data-testid="conversation-activity-slots"
          style={{
            visibility:
              orderedItems.length === 0 && idleContent ? "hidden" : undefined,
            gridTemplateColumns: `repeat(${Math.max(
              1,
              slotState.current.capacity,
            )}, minmax(0, 1fr))`,
          }}
        >
          {visibleSlotEntries.map((slot, index) => (
            <div
              className="luca-activity-shelf__slot"
              data-activity-slot={index}
              key={slot.id}
            >
              {slot.residentKey && itemsByKey.has(slot.residentKey) ? (
                <ActivityItem
                  item={itemsByKey.get(slot.residentKey) as ActivityShelfItem}
                  key={slot.residentKey}
                  onOpenResident={onOpenResident}
                  onRetryResident={onRetryResident}
                  onStop={handleStopResident}
                  replacement={slot.replacement}
                />
              ) : null}
            </div>
          ))}
        </div>
        {overflowCount > 0 ? (
          <div className="luca-activity-shelf__overflow">
            <ActivityDisclosure
              items={orderedItems}
              label={`+${overflowCount} working`}
              onOpenResident={onOpenResident}
              onRetryResident={onRetryResident}
              onStop={handleStopResident}
              onStopAll={handleStopAll}
            />
          </div>
        ) : null}
        {stoppableItems.length > 1 ? (
          <button
            aria-label="Stop all active residents in this conversation"
            className="luca-activity-shelf__stop-all"
            onClick={handleStopAll}
            type="button"
          >
            <Square aria-hidden="true" className="h-3 w-3" />
            Stop all
          </button>
        ) : null}
        {orderedItems.length > 1 ? (
          <div className="luca-activity-shelf__compact">
            <ActivityDisclosure
              items={orderedItems}
              label={`${orderedItems.length} residents working`}
              onOpenResident={onOpenResident}
              onRetryResident={onRetryResident}
              onStop={handleStopResident}
              onStopAll={handleStopAll}
            />
          </div>
        ) : null}
      </div>
      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </section>
  );
}
