import * as React from "react";
import { motion, usePresence, useReducedMotion } from "motion/react";

import type { DirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  blinkAmount,
  drawGhostEyes,
  GHOST_EYE,
} from "@/shared/ui/living-surface/ghostEyes";
import {
  type LivingSurfaceHandle,
  LivingSurfaceCanvas,
  parseColor,
} from "@/shared/ui/living-surface/LivingSurfaceCanvas";
import { TURING_DRAIN_SECONDS } from "@/shared/ui/living-surface/turingSurface";
import type { SurfaceColor } from "@/shared/ui/living-surface/types";
import "./firstMessageView.css";

/**
 * The first-message view: a direct conversation with one resident, before
 * anyone has said anything. The room is Ghost's black liquid, held still: a
 * Turing film across the whole surface, lit only from above, with the one you
 * are about to talk to as a drop of the same ink in the middle, its eyes on
 * you. The composer waits under them as glass. Each keystroke lands in the
 * film as a seed that divides; the pointer moves through it like water.
 * Sending draws the whole film into the composer, and the conversation
 * begins on a clear surface.
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
 * composer travels down only when this room's own first message sent it: first
 * it holds its place while the film drains into it (draining), then it glides
 * to the bottom (leaving).
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
  const [draining, setDraining] = React.useState(false);
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
    let settled = 0;
    const glide = () => {
      setDraining(false);
      setLeaving(true);
      settled = window.setTimeout(() => setLeaving(false), 900);
    };
    // The film drains into the composer where it waits; only then does it go.
    const drains =
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      document.querySelector(".luca-first-message-surface canvas") !== null;
    let drained = 0;
    if (drains) {
      setDraining(true);
      drained = window.setTimeout(glide, TURING_DRAIN_SECONDS * 1000);
    } else {
      glide();
    }
    return () => {
      window.clearTimeout(drained);
      window.clearTimeout(settled);
      setDraining(false);
      setLeaving(false);
    };
  }, [activeChannelId, empty]);
  return { subject, open, draining, leaving };
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

/** The composer's pill: the shape drawn as glass. */
function composerPill(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-first-message-column] footer[data-luca-reading-plane] [data-testid="message-composer"]',
  );
}

/** Where the caret is, or the start of the composer when it can't be read. */
function caretPoint(input: HTMLElement) {
  const selection = window.getSelection();
  const caret =
    selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).getBoundingClientRect()
      : null;
  const box = input.getBoundingClientRect();
  return caret && caret.width + caret.height > 0
    ? { x: caret.right, y: caret.top + caret.height / 2 }
    : { x: box.left + 32, y: box.top + box.height / 2 };
}

/** The tight box of a line's words, not the width of its block. */
function textRect(element: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 ? rect : element.getBoundingClientRect();
}

/** The composer's own colour, which the glass settles into once it has drunk the film. */
function composerColor(): SurfaceColor {
  const probe = document.createElement("div");
  probe.className = "bg-muted";
  probe.style.cssText =
    "position:absolute;width:0;height:0;pointer-events:none";
  document.body.appendChild(probe);
  const color = parseColor(getComputedStyle(probe).backgroundColor);
  probe.remove();
  return color ?? [0.086, 0.086, 0.086];
}

/** Ghost's eyes on the drop: they open once it's lit, blink now and then, and follow you. */
const EYES_SHOW_AT = 0.55;
const EYES_OPEN_AT = 0.9;
const EYES_OPENING = 0.35;

function FirstMessageEyes() {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const born = performance.now();
    let raf = 0;
    let last = born;
    let blinkAt = -10;
    let nextBlink = 2.8;
    const gaze = { x: 0, y: 0 };
    let lookAt: { x: number; y: number } | null = null;
    const onPointer = (event: PointerEvent) => {
      lookAt = { x: event.clientX, y: event.clientY };
    };
    const onInput = (event: Event) => {
      const input = composerInput(event.target);
      if (input) lookAt = caretPoint(input);
    };
    const draw = (now: number) => {
      raf = 0;
      const t = motion.matches
        ? EYES_OPEN_AT + EYES_OPENING
        : (now - born) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const box = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(box.width * scale);
      if (canvas.width !== width) {
        canvas.width = width;
        canvas.height = Math.round(box.height * scale);
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, box.width, box.height);
      if (t >= EYES_SHOW_AT && box.width > 0) {
        if (!motion.matches && lookAt) {
          const dx = lookAt.x - (box.left + box.width / 2);
          const dy = lookAt.y - (box.top + box.height / 2);
          const far = Math.max(Math.hypot(dx, dy), 260);
          const follow = 1 - Math.exp(-dt / 0.14);
          gaze.x += (dx / far - gaze.x) * follow;
          gaze.y += (dy / far - gaze.y) * follow;
        }
        if (!motion.matches && t > nextBlink) {
          blinkAt = t;
          nextBlink = t + 2.8 + Math.random() * 3.6;
        }
        const opening = Math.min(
          1,
          Math.max(0, (t - EYES_OPEN_AT) / EYES_OPENING),
        );
        const lid = Math.max(
          1 - (1 - GHOST_EYE.restingLid) * opening,
          blinkAmount(t - blinkAt),
        );
        drawGhostEyes(context, box.width / 2, box.height / 2, box.width / 2, {
          gazeX: gaze.x,
          gazeY: gaze.y,
          lid,
        });
      }
      if (!motion.matches && !document.hidden)
        raf = requestAnimationFrame(draw);
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const onVisibility = () => {
      if (!document.hidden) start();
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("input", onInput, true);
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", start);
    start();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", start);
    };
  }, []);
  return (
    <canvas className="luca-first-message-greeting__eyes" ref={canvasRef} />
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
      <div
        aria-hidden="true"
        className="luca-first-message-greeting__body"
        data-first-message-body=""
      >
        <FirstMessageEyes />
      </div>
      <p className="luca-first-message-greeting__name">{subject.name}</p>
      {subject.role ? (
        <p className="luca-first-message-greeting__role">{subject.role}</p>
      ) : null}
    </motion.div>
  );
}

/** A press on the room itself, not on anything in it that wants the press. */
function pressable(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (!target.closest("[data-first-message-column]")) return false;
  return !target.closest(
    "footer, button, a, input, textarea, select, [contenteditable], [role='button'], [role='menu'], [data-first-message-presence]",
  );
}

/** The Turing film behind the first-message view. */
export function FirstMessageSurface() {
  const surfaceRef = React.useRef<LivingSurfaceHandle | null>(null);
  const [available, setAvailable] = React.useState(true);
  const [isPresent, safeToRemove] = usePresence();
  const reduceMotion = useReducedMotion();
  const wrote = React.useRef(false);
  const leaving = React.useRef(false);
  const fill = React.useMemo(() => composerColor(), []);

  // Every keystroke lands as a seed in the film, just under the composer.
  React.useEffect(() => {
    let lastSeed = 0;
    const onInput = (event: Event) => {
      const input = composerInput(event.target);
      if (!input || !(event instanceof InputEvent)) return;
      if (event.inputType.startsWith("delete")) return;
      if (/^\s+$/.test(event.data ?? "")) return;
      const now = performance.now();
      if (now - lastSeed < 45) return;
      lastSeed = now;
      wrote.current = true;
      const pill = composerPill() ?? input;
      const caret = caretPoint(input);
      surfaceRef.current?.pulse(
        caret.x,
        pill.getBoundingClientRect().bottom + 20,
      );
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, []);

  // Measured on the surface's own frame: the words, the drop, the glass.
  const beforeFrame = React.useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const greeting = document.querySelector("[data-first-message-presence]");
    const wells = greeting
      ? Array.from(greeting.querySelectorAll("p"), textRect)
      : [];
    const footer = composerFooter();
    for (const control of footer?.querySelectorAll(
      '[data-testid="message-composer-toolbar"] button',
    ) ?? []) {
      const rect = control.getBoundingClientRect();
      if (rect.width > 0) wells.push(rect);
    }
    surface.wells(wells);
    if (!leaving.current) {
      const body = document.querySelector("[data-first-message-body]");
      surface.body(body ? body.getBoundingClientRect() : null);
    }
    const pill = composerPill();
    const rect = pill?.getBoundingClientRect() ?? null;
    surface.glass(rect, rect ? rect.height / 2 : 0, fill);
  }, [fill]);

  // Sending: the film, and the drop with it, drain into the composer.
  React.useEffect(() => {
    if (isPresent) return;
    leaving.current = true;
    const pill = composerPill();
    if (!wrote.current || !available || reduceMotion || !pill) {
      safeToRemove?.();
      return;
    }
    surfaceRef.current?.release(pill.getBoundingClientRect());
    const drained = window.setTimeout(
      () => safeToRemove?.(),
      TURING_DRAIN_SECONDS * 1000 + 60,
    );
    return () => window.clearTimeout(drained);
  }, [available, isPresent, reduceMotion, safeToRemove]);

  if (!available) return null;
  return (
    <div aria-hidden="true" className="luca-first-message-surface">
      <LivingSurfaceCanvas
        beforeFrame={beforeFrame}
        className="luca-first-message-surface__canvas"
        kind="turing"
        onUnavailable={() => setAvailable(false)}
        pressable={pressable}
        ref={surfaceRef}
      />
    </div>
  );
}
