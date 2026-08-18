import * as React from "react";
import { RotateCcw, Square } from "lucide-react";

import type { AgentActivity } from "@/features/agents/lib/activityPhase";
import type { BotActivityAgent } from "@/features/channels/ui/BotActivityBar";
import type { ChannelAgentSessionAgent } from "@/features/channels/ui/useChannelAgentSessions";
import type { ManagedConversationActivity } from "@/features/messages/managedPresentationTypes";
import { managedOperationalCopy } from "@/features/messages/lib/managedOperationalStatus";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  EMPTY_ACTIVITY_SHELF_SLOTS,
  type ActivityAnnouncementItem,
  type ActivityShelfRetryTarget,
  type ConversationActivityState,
  activityAnnouncementDelta,
  activityShelfRetryTarget,
  activityShelfOverflow,
  conversationActivityLabel,
  isTerminalConversationActivity,
  reconcileActivityShelfSlots,
} from "./conversationAgentActivityShelf";
import { useResidentStopControl } from "./useResidentStopControl";
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
  onRetryResident?: (target: ActivityShelfRetryTarget) => void;
  /** Human typing can occupy the same reserved shelf when no resident works. */
  idleContent?: React.ReactNode;
};

type ActivityShelfItem = {
  key: string;
  name: string;
  pubkey: string;
  retryTarget: ActivityShelfRetryTarget | null;
  state: ConversationActivityState;
  canStop: boolean;
  detail: string | null;
};

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

function ActivityPulse({ state }: { state: ConversationActivityState }) {
  return (
    <span
      aria-hidden="true"
      className="luca-activity-pulse"
      data-state={state}
    />
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
  onRetryResident?: (target: ActivityShelfRetryTarget) => void;
  onStop: (pubkey: string) => void;
  replacement?: boolean;
}) {
  const terminal = isTerminalConversationActivity(item.state);
  const stateLabel =
    item.state === "interrupted"
      ? conversationActivityLabel(item.state)
      : (item.detail ?? conversationActivityLabel(item.state));
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
      <ActivityPulse state={item.state} />
      <button
        aria-label={`Open details for ${item.name}`}
        className="luca-activity-item__resident"
        onClick={() => onOpenResident(item.pubkey)}
        type="button"
      >
        <span className="luca-activity-item__name">{item.name}</span>
        <span className="luca-activity-item__state">{stateLabel}</span>
      </button>
      {item.retryTarget && onRetryResident ? (
        <button
          aria-label={`Retry ${item.name}`}
          className="luca-activity-item__action"
          onClick={() => {
            if (item.retryTarget) onRetryResident(item.retryTarget);
          }}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="h-3 w-3" />
          <span>Retry</span>
        </button>
      ) : !terminal ? (
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
      ) : null}
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
  onRetryResident?: (target: ActivityShelfRetryTarget) => void;
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
          <ActivityPulse state="working" />
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
  const slotState = React.useRef(EMPTY_ACTIVITY_SHELF_SLOTS);
  const announcedChannelId = React.useRef(channelId);
  const announcedItems = React.useRef(
    new Map<string, ActivityAnnouncementItem>(),
  );
  const [liveAnnouncement, setLiveAnnouncement] = React.useState("");

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
  const { localStates, stopResidents, clearLocalState } =
    useResidentStopControl({ channelId, presentationActivity });

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
    for (const pubkey of presentationActivity.keys()) add(pubkey);
    for (const pubkey of localStates.keys()) add(pubkey);
    return keys;
  }, [
    localStates,
    observerActivity,
    presentationActivity,
    presentationStates,
    workingPubkeys,
  ]);

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
      const pubkey = agent?.pubkey ?? key;
      const processActivity = presentationActivity.get(key);
      items.set(key, {
        key,
        name: agent?.name ?? "Resident",
        pubkey,
        retryTarget: activityShelfRetryTarget(
          processActivity?.phase,
          pubkey,
          processActivity?.uiKey,
        ),
        state,
        canStop:
          Boolean(channelId) &&
          Boolean(processActivity?.uiKey) &&
          isStoppableState(state),
        detail:
          state === "interrupted"
            ? "The previous response ended when Luca restarted. Retry is an owner action."
            : (managedOperationalCopy(
                processActivity?.phase ?? "thinking",
                processActivity?.failure ?? null,
              )?.label ?? null),
      });
    }
    return items;
  }, [
    activeKeys,
    channelId,
    knownAgents,
    localStates,
    observerActivity,
    presentationActivity,
    presentationStates,
    sessions,
  ]);

  const orderedItems = React.useMemo(
    () =>
      slotState.current.order.flatMap((key) => {
        const item = itemsByKey.get(key);
        return item ? [item] : [];
      }),
    [itemsByKey],
  );
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

  const handleStopResident = React.useCallback(
    (pubkey: string) => void stopResidents([pubkey]),
    [stopResidents],
  );
  const handleRetryResident = React.useCallback(
    (target: ActivityShelfRetryTarget) => {
      clearLocalState(target.residentPubkey);
      onRetryResident?.(target);
    },
    [clearLocalState, onRetryResident],
  );
  const handleStopAll = React.useCallback(
    () => void stopResidents(stoppableItems.map((item) => item.pubkey)),
    [stopResidents, stoppableItems],
  );
  React.useEffect(() => {
    const current = new Map(
      orderedItems.map((item) => [
        item.key,
        { name: item.name, state: item.state },
      ]),
    );
    const previous =
      announcedChannelId.current === channelId
        ? announcedItems.current
        : new Map<string, ActivityAnnouncementItem>();
    announcedChannelId.current = channelId;
    announcedItems.current = current;
    setLiveAnnouncement(activityAnnouncementDelta(previous, current));
  }, [channelId, orderedItems]);

  return (
    <section
      aria-label="Resident activity"
      className="luca-activity-shelf"
      data-active-count={orderedItems.length}
      data-state={
        orderedItems.length > 0 ? "active" : idleContent ? "typing" : "idle"
      }
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
                  onRetryResident={
                    onRetryResident ? handleRetryResident : undefined
                  }
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
              onRetryResident={
                onRetryResident ? handleRetryResident : undefined
              }
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
              onRetryResident={
                onRetryResident ? handleRetryResident : undefined
              }
              onStop={handleStopResident}
              onStopAll={handleStopAll}
            />
          </div>
        ) : null}
      </div>
      <span aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </span>
    </section>
  );
}
