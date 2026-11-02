import * as React from "react";

import "./conversation-presence.css";
import type { ChannelAgentActivity } from "@/features/agents/activeAgentTurnsStore";
import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import { activityLabel } from "@/features/agents/lib/activityPhase";
import {
  mindStateLabel,
  useMindState,
} from "@/features/agents/lib/useMindState";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  conversationActivityLabel,
  currentActivityStep,
} from "@/features/channels/ui/conversationAgentActivityShelf";
import type { ChannelAgentSessionAgent } from "@/features/channels/ui/useChannelAgentSessions";
import { managedActivityStepLabel } from "@/features/messages/lib/managedOperationalStatus";
import type { ManagedConversationActivity } from "@/features/messages/managedPresentationTypes";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { AgentDendrite } from "@/shared/ui/dendrite/AgentDendrite";

/** The mark at the top of a conversation with one agent (Nov 2 study). */
const MARK_SIZE = 56;
/** A word stays up at least this long, so a quick turn reads as words. */
const HOLD_MS = 600;
/** The old word's fade; the new one rises in over 120 ms (the CSS). */
const OUT_MS = 80;

export type PresenceLine = { live: boolean; text: string };

const capitalized = (word: string) =>
  word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word;

/**
 * What the line under the mark says. While they work here it is the reply
 * row's own word (pendingReplyRows): the phase, or the step they are on.
 * Otherwise it is their page's state: working somewhere else, talking,
 * resting, off.
 */
export function useConversationPresenceLine({
  agent,
  channelId,
  managedActivity,
  observerActivity,
}: {
  agent: Pick<ChannelAgentSessionAgent, "pubkey" | "status"> | null;
  channelId: string | null;
  managedActivity: ManagedConversationActivity | undefined;
  observerActivity: readonly ChannelAgentActivity[] | undefined;
}): PresenceLine | null {
  const key = agent ? normalizePubkey(agent.pubkey) : null;
  const working = useAgentWorking(key);
  const channelsQuery = useChannelsQuery();
  const state = useMindState(key, {
    availability:
      agent?.status === "stopped" || agent?.status === "not_deployed"
        ? "offline"
        : "ready",
    lastError: null,
    waking: false,
  });
  return React.useMemo(() => {
    if (!key) return null;
    for (const [pubkey, activity] of managedActivity ?? []) {
      if (normalizePubkey(pubkey) !== key || activity.settled) continue;
      const phase = activity.phase;
      if (
        phase === "waking" ||
        phase === "thinking" ||
        phase === "working" ||
        phase === "writing" ||
        phase === "finalizing"
      ) {
        const step = currentActivityStep(activity.steps);
        return {
          live: true,
          text: step
            ? managedActivityStepLabel(step)
            : conversationActivityLabel(phase),
        };
      }
    }
    const observed = observerActivity?.find(
      (row) => normalizePubkey(row.agentPubkey) === key,
    );
    const said = observed?.activity ? activityLabel(observed.activity) : "";
    if (said) return { live: true, text: capitalized(said) };
    if (state === "working") {
      const elsewhere = working.channels.filter(
        (each) => each.channelId !== channelId,
      );
      if (elsewhere.length > 1)
        return {
          live: true,
          text: `Working in ${elsewhere.length} conversations`,
        };
      const channel = elsewhere[0]
        ? channelsQuery.data?.find((each) => each.id === elsewhere[0].channelId)
        : undefined;
      return {
        live: true,
        text: channel ? `Working in ${channel.name}` : "Working",
      };
    }
    return { live: state === "talking", text: mindStateLabel(state) };
  }, [
    channelId,
    channelsQuery.data,
    key,
    managedActivity,
    observerActivity,
    state,
    working.channels,
  ]);
}

/** Holds each line for HOLD_MS, then fades it out and the next one in. */
function useHeldLine(line: PresenceLine) {
  const [shown, setShown] = React.useState(line);
  const [leaving, setLeaving] = React.useState(false);
  const shownAt = React.useRef(performance.now());
  const latest = React.useRef(line);
  latest.current = line;
  React.useEffect(() => {
    if (line.text === shown.text && line.live === shown.live) {
      setLeaving(false);
      return;
    }
    let swap = 0;
    const leave = window.setTimeout(
      () => {
        setLeaving(true);
        swap = window.setTimeout(() => {
          shownAt.current = performance.now();
          setShown(latest.current);
          setLeaving(false);
        }, OUT_MS);
      },
      Math.max(0, shownAt.current + HOLD_MS - performance.now()),
    );
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(swap);
    };
  }, [line.live, line.text, shown.live, shown.text]);
  return { leaving, shown };
}

/**
 * The agent at the top of a conversation with one agent: their mark,
 * centred, and one line under it saying what they're doing. The reply rows
 * keep the step-by-step; this is the glance. It opens their page.
 */
export function ConversationPresence({
  line,
  name,
  onOpen,
  pubkey,
}: {
  line: PresenceLine;
  name: string;
  onOpen: () => void;
  pubkey: string;
}) {
  const { leaving, shown } = useHeldLine(line);
  const said = `${shown.text.charAt(0).toLowerCase()}${shown.text.slice(1)}`;
  return (
    <div
      className="luca-presence"
      data-luca-presence=""
      data-testid="conversation-presence"
    >
      <button
        aria-label={`${name}, ${said}. Open ${name}'s page.`}
        className="luca-presence-open"
        data-live={line.live ? "" : undefined}
        onClick={onOpen}
        type="button"
      >
        <AgentDendrite
          residentKey={pubkey}
          size={MARK_SIZE}
          working={line.live}
        />
        <span
          className="luca-presence-line"
          data-leaving={leaving ? "" : undefined}
        >
          <span
            className="luca-presence-words"
            data-testid="conversation-presence-line"
            key={`${shown.live}:${shown.text}`}
          >
            {shown.live ? (
              <span aria-hidden className="luca-presence-dot" />
            ) : null}
            {shown.text}
          </span>
        </span>
      </button>
    </div>
  );
}
