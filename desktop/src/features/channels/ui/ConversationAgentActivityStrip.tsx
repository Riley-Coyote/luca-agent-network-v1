import * as React from "react";
import { RotateCcw, Square, X } from "lucide-react";

import type { AgentActivity } from "@/features/agents/lib/activityPhase";
import type { BotActivityAgent } from "@/features/channels/ui/BotActivityBar";
import type { ChannelAgentSessionAgent } from "@/features/channels/ui/useChannelAgentSessions";
import type {
  ManagedConversationActivity,
  ManagedTurnActivityStep,
} from "@/features/messages/managedPresentationTypes";
import { dismissManagedPresentationActivity } from "@/features/messages/managedPresentationActivityStore";
import { getManagedPresentationTurn } from "@/features/messages/managedPresentationStore";
import {
  managedActivityRunSummary,
  managedActivityStepDetail,
  managedActivityStepIsMono,
  managedActivityStepLabel,
  managedElapsedReadout,
  managedOperationalCopy,
} from "@/features/messages/lib/managedOperationalStatus";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  EMPTY_ACTIVITY_SHELF_SLOTS,
  type ActivityAnnouncementItem,
  type ActivityShelfRetryTarget,
  type ConversationActivityState,
  activityAnnouncementDelta,
  activityLongWaitLabel,
  activityShelfRetryTarget,
  activityShelfOverflow,
  activityWaitTier,
  conversationActivityLabel,
  currentActivityStep,
  fallbackConversationActivityState,
  isTerminalConversationActivity,
  nextActivityWaitChangeMs,
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

/** Shared so an un-narrated item keeps one identity between renders. */
const EMPTY_STEPS: readonly ManagedTurnActivityStep[] = [];

type ActivityShelfItem = {
  key: string;
  name: string;
  pubkey: string;
  retryTarget: ActivityShelfRetryTarget | null;
  state: ConversationActivityState;
  canStop: boolean;
  detail: string | null;
  /** Set only when the owner may close this line themselves. */
  dismissUiKey: string | null;
  /** Null when this line came from an observer phase with no managed turn
   *  behind it: there is no honest clock to start, so none is shown. */
  startedAt: number | null;
  steps: readonly ManagedTurnActivityStep[];
};

/** A resident is still working; nothing has settled and nothing has failed. */
function isLiveState(state: ConversationActivityState) {
  return (
    state === "waking" ||
    state === "thinking" ||
    state === "working" ||
    state === "writing" ||
    state === "finalizing" ||
    state === "stopping"
  );
}

/**
 * Outcomes the owner has to close themselves. A stopped turn is excluded on
 * purpose: the owner pressed Stop, so they already know, and the partial
 * response stays in the timeline either way — that line may fade on its own.
 */
function isDismissableState(state: ConversationActivityState) {
  return (
    state === "settled" ||
    state === "interrupted" ||
    state === "needs-attention"
  );
}

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

/** A seeded turn (sessionEpoch 0, no dispatch receipt) has nothing the
 * runtime can cancel yet — offering Stop in that window always produced
 * the false "could not be stopped" failure. Mirrors the stop control's
 * own cancellability condition. */
function hasCancellableManagedTurn(uiKey: string | undefined): boolean {
  if (!uiKey) {
    return false;
  }
  const turn = getManagedPresentationTurn(uiKey);
  return Boolean(
    turn && turn.sessionEpoch !== 0 && turn.dispatchReceiptId.length > 0,
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

/**
 * The shelf's only ticking clock.
 *
 * The clock lives in this leaf rather than in the strip so a passing second
 * repaints one span — the item, the shelf, and the timeline above it all stay
 * still. It runs only while the resident is live; a finished line has nothing
 * left to count.
 *
 * And it wakes only when the line would actually read differently: a chained
 * timeout to the next tier boundary while there is no clock on screen, then
 * once a second once there is. A fixed interval spent its first ten wakes
 * repainting identical words, in the ten seconds the resident is most likely
 * to be streaming into the row directly above this one.
 */
function ActivityWait({
  detail,
  label,
  mono,
  startedAt,
}: {
  detail: string | null;
  label: string;
  mono: boolean;
  startedAt: number;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const elapsed = Math.max(0, now - startedAt);
  // Scheduled from the elapsed value this render actually PAINTED, not from a
  // fresh clock read, so the next wake lands where the line's own arithmetic
  // says it should — and so each tick re-arms the one after it.
  React.useEffect(() => {
    const id = setTimeout(
      () => setNow(Date.now()),
      nextActivityWaitChangeMs(elapsed),
    );
    return () => clearTimeout(id);
  }, [elapsed]);
  const tier = activityWaitTier(elapsed);
  // Under a few seconds the app does not narrate its own latency at all.
  if (tier === "indicator")
    return <span className="luca-activity-item__state" />;
  const showElapsed = tier === "elapsed" || tier === "long";
  return (
    <span className="luca-activity-item__state">
      <span className="luca-activity-item__label">
        {tier === "long" ? activityLongWaitLabel(label) : label}
      </span>
      {detail ? (
        <span
          className="luca-activity-item__detail"
          data-mono={mono ? "true" : "false"}
        >
          {detail}
        </span>
      ) : null}
      {showElapsed ? (
        <span className="luca-activity-item__elapsed">
          {managedElapsedReadout(elapsed)}
        </span>
      ) : null}
    </span>
  );
}

/** One narrated step. Lines are placed by their ordinal and never move again;
 *  a repeated ordinal updates in place, so nothing reorders under the eye. */
function ActivityStepLine({
  live,
  step,
}: {
  live: boolean;
  step: ManagedTurnActivityStep;
}) {
  const detail = managedActivityStepDetail(step);
  return (
    <div
      className="luca-activity-step"
      data-live={live && step.status === "active" ? "true" : "false"}
      data-status={step.status}
    >
      {step.kind === "web" ? (
        // A reserved, neutral mark rather than a favicon: fetching one would
        // tell a third party which pages this conversation touched. The box is
        // sized here so a locally-sourced icon could land without any shift.
        <span aria-hidden="true" className="luca-activity-step__favicon" />
      ) : (
        <span aria-hidden="true" className="luca-activity-step__mark" />
      )}
      <span className="luca-activity-step__label">
        {managedActivityStepLabel(step)}
      </span>
      {detail ? (
        <span
          className="luca-activity-step__detail"
          data-mono={managedActivityStepIsMono(step.kind) ? "true" : "false"}
        >
          {detail}
        </span>
      ) : null}
    </div>
  );
}

/** The work history, kept out of the collapsed line but never discarded. */
function ActivitySteps({ item }: { item: ActivityShelfItem }) {
  const live = isLiveState(item.state);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`What ${item.name} did: ${item.steps.length} ${
            item.steps.length === 1 ? "step" : "steps"
          }`}
          className="luca-activity-item__steps"
          type="button"
        >
          {item.steps.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`What ${item.name} did`}
        className="luca-activity-popover luca-activity-steps w-96 p-2"
        side="top"
        sideOffset={8}
      >
        <div className="luca-activity-popover__heading">
          <span>{item.name}</span>
          <span>
            {item.steps.length} {item.steps.length === 1 ? "step" : "steps"}
          </span>
        </div>
        <div className="luca-activity-steps__list">
          {item.steps.map((step) => (
            <ActivityStepLine
              key={`${step.step}:${step.label}`}
              live={live}
              step={step}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The settled state of a narrated run, or the plain phase word. Live turns do
 * not resolve their text here — see `ActivityWait`, which decides how much to
 * say based on how long the owner has been waiting.
 */
function settledStateLabel(item: ActivityShelfItem): string {
  if (item.state === "settled") {
    return managedActivityRunSummary(item.steps) ?? "Done";
  }
  if (item.state === "interrupted")
    return conversationActivityLabel(item.state);
  return item.detail ?? conversationActivityLabel(item.state);
}

function ActivityItem({
  compact = false,
  item,
  onDismiss,
  onOpenResident,
  onRetryResident,
  onStop,
  replacement = false,
}: {
  compact?: boolean;
  item: ActivityShelfItem;
  onDismiss: (item: ActivityShelfItem) => void;
  onOpenResident: (pubkey: string) => void;
  onRetryResident?: (target: ActivityShelfRetryTarget) => void;
  onStop: (pubkey: string) => void;
  replacement?: boolean;
}) {
  const terminal = isTerminalConversationActivity(item.state);
  const live = isLiveState(item.state);
  const step = currentActivityStep(item.steps);
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
        {live && item.startedAt !== null ? (
          <ActivityWait
            detail={step ? managedActivityStepDetail(step) : null}
            label={
              step
                ? managedActivityStepLabel(step)
                : conversationActivityLabel(item.state)
            }
            mono={step ? managedActivityStepIsMono(step.kind) : false}
            startedAt={item.startedAt}
          />
        ) : (
          <span className="luca-activity-item__state">
            <span className="luca-activity-item__label">
              {settledStateLabel(item)}
            </span>
          </span>
        )}
      </button>
      {item.steps.length > 0 ? <ActivitySteps item={item} /> : null}
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
      ) : !terminal && item.state !== "settled" ? (
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
      {item.dismissUiKey ? (
        <button
          aria-label={`Dismiss ${item.name}`}
          className="luca-activity-item__dismiss"
          data-testid={`resident-activity-dismiss-${item.key}`}
          onClick={() => onDismiss(item)}
          type="button"
        >
          <X aria-hidden="true" className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function ActivityDisclosure({
  items,
  label,
  onDismiss,
  onOpenResident,
  onRetryResident,
  onStop,
  onStopAll,
}: {
  items: ActivityShelfItem[];
  label: string;
  onDismiss: (item: ActivityShelfItem) => void;
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
              onDismiss={onDismiss}
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
      const resolvedState =
        local ??
        presentation ??
        observed ??
        fallbackConversationActivityState(isSessionReady(sessions.get(key)));
      const pubkey = agent?.pubkey ?? key;
      const processActivity = presentationActivity.get(key);
      // A retained work summary reports its turn's phase as "finalizing", and
      // the presentation state is derived from that same phase — so the settled
      // flag is the only thing that tells a finished run from a live one, and
      // it has to outrank both. Reading the phase alone would leave a Stop
      // button under an answer that already arrived. A local stop still wins:
      // that is an owner action in flight, and it is about to be the truth.
      const state =
        processActivity?.settled && !local
          ? ("settled" as const)
          : resolvedState;
      items.set(key, {
        key,
        name: agent?.name ?? "Resident",
        pubkey,
        retryTarget: activityShelfRetryTarget(
          processActivity?.phase,
          pubkey,
          processActivity?.uiKey,
          processActivity?.failure != null,
        ),
        state,
        canStop:
          Boolean(channelId) &&
          Boolean(processActivity?.uiKey) &&
          isStoppableState(state) &&
          hasCancellableManagedTurn(processActivity?.uiKey),
        detail:
          state === "interrupted"
            ? "The previous response ended when Luca restarted. Retry is an owner action."
            : (managedOperationalCopy(
                processActivity?.phase ?? "thinking",
                processActivity?.failure ?? null,
                processActivity?.handoffTargetName ?? null,
              )?.label ?? null),
        dismissUiKey:
          isDismissableState(state) && processActivity?.uiKey
            ? processActivity.uiKey
            : null,
        startedAt: processActivity?.startedAt ?? null,
        steps: processActivity?.steps ?? EMPTY_STEPS,
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
  // A retained work summary is background information. Someone typing right
  // now is not, so the settled row yields the shelf back for the duration.
  const liveItems = orderedItems.filter((item) => item.state !== "settled");
  const showIdleContent = liveItems.length === 0 && Boolean(idleContent);

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
  const handleDismissResident = React.useCallback(
    (item: ActivityShelfItem) => {
      if (!item.dismissUiKey) return;
      // Both halves have to go, or the local stop state re-seeds the line the
      // owner just closed.
      clearLocalState(item.pubkey);
      dismissManagedPresentationActivity(
        item.dismissUiKey,
        channelId ?? undefined,
      );
    },
    [channelId, clearLocalState],
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
        showIdleContent
          ? "typing"
          : orderedItems.length > 0
            ? "active"
            : idleContent
              ? "typing"
              : "idle"
      }
      data-testid="conversation-activity-shelf"
    >
      <div className="luca-activity-shelf__inner">
        {showIdleContent ? (
          <div className="luca-activity-shelf__idle-content">{idleContent}</div>
        ) : null}
        <div
          className="luca-activity-shelf__slots"
          data-testid="conversation-activity-slots"
          style={{
            visibility: showIdleContent ? "hidden" : undefined,
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
                  onDismiss={handleDismissResident}
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
              onDismiss={handleDismissResident}
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
              label={
                liveItems.length > 0
                  ? `${orderedItems.length} residents working`
                  : `${orderedItems.length} residents`
              }
              onDismiss={handleDismissResident}
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
