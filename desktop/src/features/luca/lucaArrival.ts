import * as React from "react";

import type { TimelineMessage } from "@/features/messages/types";
import type { Channel } from "@/shared/api/types";
import {
  isCanonicalLucaDm,
  isLucaGreeting,
  useCanonicalLucaPubkey,
} from "./canonicalLucaResident";

/**
 * When the owner lands in the first conversation, Luca is about to speak. The
 * greeting is already durable, but the conversation stages its arrival once,
 * through the same row a live reply uses: Luca's row appears with the mark
 * thinking, then the words stream into it, then the durable message takes
 * over. Nothing is faked about the message; only its arrival is paced.
 *
 * A session flag carries the intent from the preparing step; it is consumed
 * once and never survives a relaunch, so from then on the greeting is an
 * ordinary past message.
 */
const ARRIVAL_KEY = "polyphonic-onboarding.luca-arrival.v1";
/** Mark thinking, no words. */
const THINK_MS = 1400;
/** Words arriving, roughly at a reader's pace. */
const STREAM_MS = 1900;
const TICK_MS = 45;

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

/** Reveal a body word by word; graphemes inside a word arrive together. */
function prefixOf(body: string, progress: number): string {
  const words = body.split(/(\s+)/);
  const total = words.filter((w) => w.trim().length > 0).length;
  const target = Math.floor(Math.min(1, progress) * total);
  let seen = 0;
  const out: string[] = [];
  for (const piece of words) {
    if (piece.trim().length > 0) {
      if (seen >= target) break;
      seen += 1;
    }
    out.push(piece);
  }
  return out.join("");
}

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
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(0);

  // Two effects on purpose: the flag is consumed once, and the beat's clock is
  // owned by the arriving state. Consuming and arming in one effect would lose
  // the clock to StrictMode's rerun and leave the conversation arriving.
  React.useEffect(() => {
    if (channelId && takeLucaArrival(channelId)) {
      setArrivingChannel(channelId);
      setStartedAt(performance.now());
    }
  }, [channelId]);
  React.useEffect(() => {
    if (!arrivingChannel) return;
    const timer = window.setInterval(() => {
      setNow(performance.now());
    }, TICK_MS);
    const done = window.setTimeout(() => {
      window.clearInterval(timer);
      setArrivingChannel(null);
      setStartedAt(null);
    }, THINK_MS + STREAM_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(done);
    };
  }, [arrivingChannel]);

  const isLucaDm =
    lucaPubkey !== null &&
    isCanonicalLucaDm(activeChannel, currentPubkey, lucaPubkey);
  const arriving = isLucaDm && arrivingChannel === channelId;
  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);

  const visibleMessages = React.useMemo<TimelineMessage[]>(() => {
    if (!arriving || !lucaPubkey) return messages;
    const greeting = messages.find((message) =>
      isLucaGreeting(message, lucaPubkey),
    );
    if (!greeting) return messages;
    const streaming = elapsed >= THINK_MS;
    const progress = streaming ? (elapsed - THINK_MS) / STREAM_MS : 0;
    const staged: TimelineMessage = {
      ...greeting,
      renderKey: `${greeting.id}:arrival`,
      body: streaming ? prefixOf(greeting.body, progress) : "",
      managedPresentation: {
        canonicalPresent: false,
        failure: null,
        finalReconciliation: null,
        finalMessageId: null,
        phase: streaming ? "writing" : "thinking",
        streaming: true,
        uiKey: `${greeting.id}:arrival`,
      },
    };
    return messages.map((message) => (message === greeting ? staged : message));
  }, [arriving, elapsed, lucaPubkey, messages]);

  return { arriving, isLucaDm, lucaPubkey, visibleMessages };
}
