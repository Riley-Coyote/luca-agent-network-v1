import * as React from "react";
import { createPortal } from "react-dom";

import "./conversation-presence.css";
import { useShellLipPresenceSlot } from "@/app/shell/lipPresenceSlot";
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
/** The text window's padding and rim on each side, in points (the CSS). */
const PLATE_INSET = 11 + 1;
/** The widest the text window grows, and what it keeps clear of the card's
 *  sides. */
const PLATE_MAX = 360;
const PLATE_CLEAR = 32;

/** What the text window says. `rest` marks their name standing in it while
 *  nothing is happening; "off" dims it, for a mind with no process. */
export type PresenceLine = {
  live: boolean;
  rest?: "name" | "off";
  text: string;
};

const capitalized = (word: string) =>
  word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word;

/**
 * What the text window under the mark says. While they work here it is the
 * reply row's own word (pendingReplyRows): the phase, or the step they are
 * on. Otherwise it is their page's state while that is something happening
 * (working somewhere else, waking, needing attention), and their name while
 * nothing is: the lip's name comes down to stand there.
 */
export function useConversationPresenceLine({
  agent,
  channelId,
  managedActivity,
  name,
  observerActivity,
}: {
  agent: Pick<ChannelAgentSessionAgent, "pubkey" | "status"> | null;
  channelId: string | null;
  managedActivity: ManagedConversationActivity | undefined;
  name: string;
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
    // Talking is a side conversation of theirs left open, which can stand
    // for hours: here it rests, as resting does.
    if (state === "waking") return { live: true, text: mindStateLabel(state) };
    if (state === "needs attention")
      return { live: false, text: mindStateLabel(state) };
    return { live: false, rest: state === "off" ? "off" : "name", text: name };
  }, [
    channelId,
    channelsQuery.data,
    key,
    managedActivity,
    name,
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
    if (
      line.text === shown.text &&
      line.live === shown.live &&
      line.rest === shown.rest
    ) {
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
  }, [line.live, line.rest, line.text, shown.live, shown.rest, shown.text]);
  return { leaving, shown };
}

/**
 * The text window hugs its words: its width is a hidden copy's, set before
 * paint, and the CSS carries it to the next words' on the drawer's curve, so
 * it opens or closes round them from the middle. Past the card's room it
 * stops, and the words end in an ellipsis.
 */
function usePlateWidth(
  plate: React.RefObject<HTMLSpanElement | null>,
  measure: React.RefObject<HTMLSpanElement | null>,
  slot: HTMLElement | null,
) {
  React.useLayoutEffect(() => {
    const box = plate.current;
    const words = measure.current;
    const card = slot?.parentElement;
    if (!box || !words || !card) return;
    const fit = () => {
      const room = Math.min(PLATE_MAX, card.clientWidth - PLATE_CLEAR);
      const wanted =
        Math.ceil(words.getBoundingClientRect().width) + 2 * PLATE_INSET;
      box.style.width = `${Math.max(0, Math.min(wanted, room))}px`;
      box.toggleAttribute("data-clamped", wanted > room);
    };
    fit();
    const sizes = new ResizeObserver(fit);
    sizes.observe(words);
    sizes.observe(card);
    return () => sizes.disconnect();
  }, [measure, plate, slot]);
}

/**
 * The agent at the top of a conversation with one agent: their mark in its
 * circle window, risen out of the card into the lip on the card's axis, and
 * under it a small text window: what they're doing, or their name while
 * nothing is. The reply rows keep the step-by-step; this is the glance. It
 * opens their page. Drawn into the lip's presence slot, so nothing until
 * the lip has one.
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
  const slot = useShellLipPresenceSlot();
  const { leaving, shown } = useHeldLine(line);
  const plate = React.useRef<HTMLSpanElement>(null);
  const measure = React.useRef<HTMLSpanElement>(null);
  usePlateWidth(plate, measure, slot);
  if (!slot) return null;
  const said = shown.rest
    ? shown.rest === "off"
      ? ", off"
      : ""
    : `, ${shown.text.charAt(0).toLowerCase()}${shown.text.slice(1)}`;
  const words = (
    <>
      {shown.live ? <span aria-hidden className="luca-presence-dot" /> : null}
      {shown.text}
    </>
  );
  return createPortal(
    <div
      className="luca-presence"
      data-luca-presence=""
      data-testid="conversation-presence"
    >
      <button
        aria-label={`${name}${said}. Open ${name}'s page.`}
        className="luca-presence-open"
        data-live={line.live ? "" : undefined}
        onClick={onOpen}
        type="button"
      >
        <span className="luca-presence-face">
          <AgentDendrite
            residentKey={pubkey}
            size={MARK_SIZE}
            working={line.live}
          />
        </span>
        <span
          className="luca-presence-plate text-lip"
          data-rest={shown.rest}
          ref={plate}
        >
          <span aria-hidden className="luca-presence-measure" ref={measure}>
            {words}
          </span>
          <span
            className="luca-presence-line"
            data-leaving={leaving ? "" : undefined}
          >
            <span
              className="luca-presence-words"
              data-testid="conversation-presence-line"
              key={`${shown.live}:${shown.rest}:${shown.text}`}
            >
              {words}
            </span>
          </span>
        </span>
      </button>
    </div>,
    slot,
  );
}
