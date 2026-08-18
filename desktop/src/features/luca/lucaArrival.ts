import * as React from "react";

import type { AgentActivity } from "@/features/agents/lib/activityPhase";
import type { TimelineMessage } from "@/features/messages/types";
import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  isCanonicalLucaDm,
  isLucaGreeting,
  useCanonicalLucaPubkey,
} from "./canonicalLucaResident";

/**
 * When the owner lands in the first conversation, Luca is about to speak: the
 * greeting is already durable, but for a beat the conversation shows Luca in
 * the thinking state and only then lets the greeting land. This session flag
 * carries that intent from the preparing step to the conversation; it is
 * consumed once and never survives a relaunch, so the greeting is an ordinary
 * past message from then on.
 */
const ARRIVAL_KEY = "polyphonic-onboarding.luca-arrival.v1";
const ARRIVAL_MS = 1600;

export function markLucaArrival(channelId: string) {
  try {
    window.sessionStorage.setItem(ARRIVAL_KEY, channelId);
  } catch {
    // Session storage unavailable: the greeting simply appears.
  }
}

function takeLucaArrival(channelId: string): boolean {
  try {
    const pending = window.sessionStorage.getItem(ARRIVAL_KEY);
    if (pending !== channelId) return false;
    window.sessionStorage.removeItem(ARRIVAL_KEY);
    return true;
  } catch {
    return false;
  }
}

const THINKING: AgentActivity = { phase: "thinking", toolKind: null };

/**
 * Stage Luca's arrival in the canonical DM. While arriving, the greeting is
 * withheld from `messages` and Luca is reported as thinking; after the beat,
 * both revert and the greeting lands as a new message.
 */
export function useLucaArrival({
  activeChannel,
  currentPubkey,
  messages,
}: {
  activeChannel: Channel | null;
  currentPubkey: string | undefined;
  messages: TimelineMessage[];
}) {
  const lucaPubkey = useCanonicalLucaPubkey();
  const channelId = activeChannel?.id ?? null;
  const [arrivingChannel, setArrivingChannel] = React.useState<string | null>(
    null,
  );

  // Two effects on purpose: the flag is consumed once, and the beat's timer
  // is owned by the arriving state. A single effect that both consumed the
  // flag and armed the timer would lose the timer to StrictMode's rerun (the
  // flag is gone the second time) and leave the conversation arriving forever.
  React.useEffect(() => {
    if (channelId && takeLucaArrival(channelId)) setArrivingChannel(channelId);
  }, [channelId]);
  React.useEffect(() => {
    if (!arrivingChannel) return;
    const timer = window.setTimeout(() => setArrivingChannel(null), ARRIVAL_MS);
    return () => window.clearTimeout(timer);
  }, [arrivingChannel]);

  const isLucaDm =
    lucaPubkey !== null &&
    isCanonicalLucaDm(activeChannel, currentPubkey, lucaPubkey);
  const arriving = isLucaDm && arrivingChannel === channelId;

  const visibleMessages = React.useMemo<TimelineMessage[]>(() => {
    if (!arriving || !lucaPubkey) return messages;
    return messages.filter((message) => !isLucaGreeting(message, lucaPubkey));
  }, [arriving, lucaPubkey, messages]);

  const arrivalActivity = React.useMemo(() => {
    if (!arriving || !lucaPubkey) return null;
    return new Map<string, AgentActivity | null>([
      [normalizePubkey(lucaPubkey), THINKING],
    ]);
  }, [arriving, lucaPubkey]);

  return { arriving, arrivalActivity, isLucaDm, lucaPubkey, visibleMessages };
}
