import * as React from "react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";

import type { DirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  paintIndexForWord,
  varyInk,
  waterPalette,
} from "@/shared/ui/ink-water/inkPaints";
import { InkWater, type InkWaterHandle } from "@/shared/ui/ink-water/InkWater";
import "./firstMessageView.css";

/**
 * The first-message view: a direct conversation with one resident, before
 * anyone has said anything. The composer waits in the middle under the
 * resident's name, and the conversation's own ink moves in still water behind
 * them. Each word you write lets a little ink go; sending opens it, the
 * composer sinks to its place, and the water clears for the conversation.
 *
 * The retired ConversationIntro had the right rule and it still holds:
 * present the one you are about to talk to, then get out of the way. Nothing
 * is written about them that the app cannot vouch for.
 */
export type FirstMessageSubject = {
  name: string;
  /** At most one line about who they are, only when the app knows it. */
  role?: string | null;
};

/**
 * When the view is open. A direct conversation with one resident opens on it
 * once the room has settled as empty, so a conversation whose history is still
 * on its way never flashes it. It leaves when a message arrives, and the
 * composer travels down only when this room's own first message sent it.
 */
export function useFirstMessageView({
  activeChannelId,
  activityAgents,
  directMessageIntro,
  isTimelineLoading,
  messageCount,
  openThreadHeadId,
}: {
  activeChannelId: string | null;
  activityAgents: readonly { pubkey: string; name: string }[];
  directMessageIntro: DirectMessageIntro | null;
  isTimelineLoading: boolean;
  messageCount: number;
  openThreadHeadId: string | null;
}) {
  const subject = React.useMemo<FirstMessageSubject | null>(() => {
    if (directMessageIntro?.participants.length !== 1) return null;
    const other = directMessageIntro.participants[0];
    const key = normalizePubkey(other.pubkey);
    const resident = activityAgents.find(
      (agent) => normalizePubkey(agent.pubkey) === key,
    );
    if (!resident) return null;
    return {
      name: resident.name || other.displayName,
      role: directMessageIntro.role ?? null,
    };
  }, [activityAgents, directMessageIntro]);
  const empty =
    subject !== null &&
    !isTimelineLoading &&
    !openThreadHeadId &&
    messageCount === 0;
  const [open, setOpen] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);
  const openFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (empty) {
      const opening = window.setTimeout(() => {
        openFor.current = activeChannelId;
        setOpen(true);
      }, 160);
      return () => window.clearTimeout(opening);
    }
    if (openFor.current === null) return;
    const sent = openFor.current === activeChannelId;
    openFor.current = null;
    setOpen(false);
    if (!sent) return;
    setLeaving(true);
    const settled = window.setTimeout(() => setLeaving(false), 900);
    return () => window.clearTimeout(settled);
  }, [activeChannelId, empty]);
  return { subject, open, leaving };
}

/** The composer's own editable surface, and nothing else that takes text. */
function composerInput(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (!target.closest("footer[data-luca-reading-plane]")) return null;
  return target instanceof HTMLTextAreaElement || target.isContentEditable
    ? target
    : null;
}

function composerFooter(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    "[data-first-message-column] footer[data-luca-reading-plane]",
  );
}

export function FirstMessageGreeting({
  subject,
}: {
  subject: FirstMessageSubject;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="luca-first-message-greeting"
      data-first-message-presence=""
      data-testid="first-message-greeting"
      exit={{
        opacity: 0,
        transition: { duration: reduceMotion ? 0.12 : 0.22 },
      }}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      transition={{
        duration: reduceMotion ? 0.2 : 0.7,
        delay: reduceMotion ? 0 : 0.3,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      <p className="luca-first-message-greeting__name">{subject.name}</p>
      {subject.role ? (
        <p className="luca-first-message-greeting__role">{subject.role}</p>
      ) : null}
    </motion.div>
  );
}

/** Ink in water behind the first-message view. */
export function FirstMessageInk() {
  const inkRef = React.useRef<InkWaterHandle | null>(null);
  const [available, setAvailable] = React.useState(true);
  const isPresent = useIsPresent();
  const wrote = React.useRef(false);
  const palette = React.useMemo(() => waterPalette(), []);

  // Every word you write lets its own ink go, just under the composer.
  React.useEffect(() => {
    let word = 0;
    let bead = 0;
    let lastDrop = 0;
    const onInput = (event: Event) => {
      const input = composerInput(event.target);
      if (!input || !(event instanceof InputEvent)) return;
      if (event.inputType.startsWith("delete")) return;
      const typed = event.data ?? "";
      if (/^\s+$/.test(typed)) {
        word += 1;
        return;
      }
      const now = performance.now();
      if (now - lastDrop < 45) return;
      lastDrop = now;
      const footer = composerFooter();
      const box = (footer ?? input).getBoundingClientRect();
      const selection = window.getSelection();
      const caret =
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).getBoundingClientRect()
          : null;
      const x =
        caret && caret.width + caret.height > 0 ? caret.right : box.left + 32;
      bead += 1;
      wrote.current = true;
      const paint = palette[paintIndexForWord(word, palette.length)];
      if (paint) inkRef.current?.drop(x, box.bottom + 6, varyInk(paint, bead));
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, [palette]);

  // The words above the composer keep the water quiet around them.
  React.useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const greeting = document.querySelector<HTMLElement>(
        "[data-first-message-presence]",
      );
      const footer = composerFooter();
      if (!greeting || !footer) {
        inkRef.current?.quiet(null);
        return;
      }
      const a = greeting.getBoundingClientRect();
      const b = footer.getBoundingClientRect();
      const left = Math.min(a.left, b.left);
      const top = Math.min(a.top, b.top);
      inkRef.current?.quiet(
        new DOMRect(
          left,
          top,
          Math.max(a.right, b.right) - left,
          Math.max(a.bottom, b.bottom) - top,
        ),
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const settle = window.setTimeout(schedule, 900);
    schedule();
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  // Sending: what was written opens behind the composer as it sinks away.
  React.useEffect(() => {
    if (isPresent || !wrote.current) return;
    const footer = composerFooter();
    if (footer) inkRef.current?.release(footer.getBoundingClientRect());
  }, [isPresent]);

  if (!available) return null;
  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-hidden="true"
      className="luca-first-message-ink"
      exit={{
        opacity: 0,
        transition: { duration: 1.6, delay: 0.5, ease: [0.4, 0, 0.2, 1] },
      }}
      initial={{ opacity: 1 }}
    >
      <InkWater
        className="luca-first-message-ink__water"
        onUnavailable={() => setAvailable(false)}
        ref={inkRef}
      />
    </motion.div>
  );
}
