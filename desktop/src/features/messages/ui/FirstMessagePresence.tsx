import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import motePoster from "@/features/luca/residents/mote-chat-poster.png";
import { IdentityMark } from "@/shared/ui/dot-display/identity/IdentityMark";
import "@/shared/ui/mote3d.js";
import "./firstMessagePresence.css";

/**
 * Who is on the other side of an empty conversation with a resident.
 *
 * The retired ConversationIntro had the right idea and the wrong weight: a
 * conversation should present the one you are about to talk to and then get
 * out of the way. This presents them as present rather than as a badge: the
 * companion's own sphere, awake, looking at you, and its name. Nothing is
 * written about it that the app cannot vouch for.
 */
export type FirstMessagePresenceSubject = {
  pubkey: string;
  name: string;
  /** At most one line about who they are, only when the app knows it. */
  role?: string | null;
  /** The owner's chat-mark preference: the sphere, the glyph, or neither. */
  mark: "sphere" | "glyph" | "none";
  glyphSeed: string;
};

type MoteElement = HTMLElement & { attend?: (x: number, y: number) => void };

/** While words keep arriving the companion listens; this long after the last
 *  keystroke it goes back to its own thoughts. */
const LISTENING_MS = 1800;
const MOTE_BOX = 116;
const GLYPH_SIZE = 56;

function caretPoint(target: Element): { x: number; y: number } {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      return { x: rect.right, y: rect.top + rect.height / 2 };
    }
  }
  const box = target.getBoundingClientRect();
  return { x: box.left + 24, y: box.top + box.height / 2 };
}

/** True for text being written in the conversation's own composer. */
function isComposerInput(target: EventTarget | null): target is Element {
  return (
    target instanceof Element &&
    target.closest("footer[data-luca-reading-plane]") !== null &&
    (target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable))
  );
}

export function FirstMessagePresence({
  subject,
}: {
  subject: FirstMessagePresenceSubject;
}) {
  const reduceMotion = useReducedMotion();
  const moteRef = React.useRef<MoteElement | null>(null);
  const [listening, setListening] = React.useState(false);

  React.useEffect(() => {
    if (subject.mark !== "sphere") return;
    let quiet = 0;
    const listen = (event: Event) => {
      if (!isComposerInput(event.target)) return;
      const point = caretPoint(event.target);
      moteRef.current?.attend?.(point.x, point.y);
      const hasWords = (event.target.textContent ?? "").trim().length > 0;
      window.clearTimeout(quiet);
      setListening(hasWords);
      if (hasWords) {
        quiet = window.setTimeout(() => setListening(false), LISTENING_MS);
      }
    };
    const look = (event: FocusEvent) => {
      if (!isComposerInput(event.target)) return;
      const point = caretPoint(event.target);
      moteRef.current?.attend?.(point.x, point.y);
    };
    document.addEventListener("input", listen, true);
    document.addEventListener("focusin", look, true);
    return () => {
      window.clearTimeout(quiet);
      document.removeEventListener("input", listen, true);
      document.removeEventListener("focusin", look, true);
    };
  }, [subject.mark]);

  return (
    <motion.div
      animate={{ opacity: 1, y: 0, scale: 1 }}
      aria-label={`Conversation with ${subject.name}`}
      className="luca-first-message"
      data-first-message-presence=""
      data-listening={listening ? "" : undefined}
      data-testid="first-message-presence"
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0.16 } }
          : {
              opacity: 0,
              y: -10,
              scale: 0.97,
              transition: { duration: 0.32, ease: [0.4, 0, 0.2, 1] },
            }
      }
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 1 }}
      role="group"
      transition={
        reduceMotion
          ? { duration: 0.2 }
          : { duration: 0.62, delay: 0.14, ease: [0.16, 1, 0.3, 1] }
      }
    >
      {subject.mark === "sphere" ? (
        <span aria-hidden="true" className="luca-first-message__mote">
          <img alt="" className="luca-first-message__poster" src={motePoster} />
          {React.createElement("mote-3d", {
            className: "luca-first-message__live",
            expression: listening ? "curious" : "ambient",
            "no-caustic": "",
            ref: moteRef,
            species: "mote",
            style: { height: MOTE_BOX, width: MOTE_BOX },
            tint: "#b8b8b8",
          })}
        </span>
      ) : subject.mark === "glyph" ? (
        <IdentityMark
          breath
          className="luca-first-message__glyph"
          seed={subject.glyphSeed}
          size={GLYPH_SIZE}
        />
      ) : null}
      <p className="luca-first-message__name">{subject.name}</p>
      {subject.role ? (
        <p className="luca-first-message__role">{subject.role}</p>
      ) : null}
    </motion.div>
  );
}
