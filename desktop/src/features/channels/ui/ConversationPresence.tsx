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
import { useAgentChatPicture } from "@/features/agents/lib/agentChatPicture";
import { useIdentityQuery } from "@/shared/api/hooks";

/** The mark at the top of a conversation with one agent (Nov 2 study). */
const MARK_SIZE = 56;
/** A word stays up at least this long, so a quick turn reads as words. */
const HOLD_MS = 600;
/** The old words' dissolve (luca-presence-out, the CSS). */
const OUT_MS = 200;
/** How far in from the text window's rounded ends its words sit, in points. */
const PLATE_INSET = 12;
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

/** A line as the text window holds it: numbered, so the same words coming
 *  back are a new arrival, not the old ones. */
type HeldLine = { id: number; line: PresenceLine };

/**
 * Holds each line for HOLD_MS, then puts up the next at once: the new words
 * come in while the old ones leave, for OUT_MS, on the same place, so the
 * window is never empty.
 */
function useHeldLine(line: PresenceLine) {
  const [held, setHeld] = React.useState<{
    gone: HeldLine | null;
    now: HeldLine;
  }>(() => ({ gone: null, now: { id: 0, line } }));
  const shownAt = React.useRef(performance.now());
  const latest = React.useRef(line);
  latest.current = line;
  const { gone, now } = held;
  React.useEffect(() => {
    if (
      line.text === now.line.text &&
      line.live === now.line.live &&
      line.rest === now.line.rest
    )
      return;
    const swap = window.setTimeout(
      () => {
        shownAt.current = performance.now();
        setHeld({ gone: now, now: { id: now.id + 1, line: latest.current } });
      },
      Math.max(0, shownAt.current + HOLD_MS - performance.now()),
    );
    return () => window.clearTimeout(swap);
  }, [line.live, line.rest, line.text, now]);
  React.useEffect(() => {
    if (!gone) return;
    const left = window.setTimeout(
      () => setHeld((each) => ({ ...each, gone: null })),
      OUT_MS,
    );
    return () => window.clearTimeout(left);
  }, [gone]);
  return { gone, now };
}

/**
 * The text window hugs its words: its width is a hidden copy's, set before
 * paint in the frame the words change, and the CSS carries it to the new
 * words' on the line spring while they come in, so it opens or closes round
 * them from the middle. Past the card's room it stops, and the words end in
 * an ellipsis.
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
      box.style.setProperty(
        "--luca-presence-room",
        `${Math.max(0, room - 2 * PLATE_INSET)}px`,
      );
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
  const owner = useIdentityQuery().data?.pubkey;
  const picture = useAgentChatPicture(owner, pubkey);
  const [failedPicture, setFailedPicture] = React.useState<string | null>(null);
  const { gone, now } = useHeldLine(line);
  const plate = React.useRef<HTMLSpanElement>(null);
  const measure = React.useRef<HTMLSpanElement>(null);
  usePlateWidth(plate, measure, slot);
  if (!slot) return null;
  const shown = now.line;
  const said = shown.rest
    ? shown.rest === "off"
      ? ", off"
      : ""
    : `, ${shown.text.charAt(0).toLowerCase()}${shown.text.slice(1)}`;
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
          {picture && picture !== failedPicture ? (
            <img
              src={picture}
              alt=""
              width={MARK_SIZE}
              height={MARK_SIZE}
              className="size-full rounded-full object-cover"
              onError={() => setFailedPicture(picture)}
            />
          ) : (
            <AgentDendrite
              residentKey={pubkey}
              size={MARK_SIZE}
              working={line.live}
            />
          )}
        </span>
        <span className="luca-presence-plate text-lip" ref={plate}>
          <span aria-hidden className="luca-presence-measure" ref={measure}>
            {shown.text}
          </span>
          <span className="luca-presence-line">
            {gone ? (
              <span
                aria-hidden
                className="luca-presence-words"
                data-leaving=""
                data-rest={gone.line.rest}
                key={gone.id}
              >
                {gone.line.text}
              </span>
            ) : null}
            <span
              className="luca-presence-words"
              data-in={now.id ? "" : undefined}
              data-rest={shown.rest}
              data-testid="conversation-presence-line"
              key={now.id}
            >
              {shown.text}
            </span>
          </span>
        </span>
      </button>
    </div>,
    slot,
  );
}
