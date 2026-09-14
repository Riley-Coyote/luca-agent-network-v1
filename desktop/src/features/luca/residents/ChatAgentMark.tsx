import * as React from "react";

import { SandpileActivityIndicator } from "@/shared/ui/SandpileActivityIndicator";
import "@/shared/ui/mote3d.js";
import motePoster from "./mote-chat-poster.png";
import "./chatAgentMark.css";

const TRANSITION_MS = 560;
// Match the Mote renderer's four pooled WebGL stages; older rows keep the still.
const MAX_LIVE_MARKS = 4;

type VisibleMark = {
  element: HTMLElement;
  setLive: React.Dispatch<React.SetStateAction<boolean>>;
  active: boolean;
  visible: boolean;
  live: boolean;
};

const visibleMarks = new Map<HTMLElement, VisibleMark>();
let markObserver: IntersectionObserver | null = null;
let motionQuery: MediaQueryList | null = null;
let reconcileFrame = 0;

function reconcileLiveMarks() {
  reconcileFrame = 0;
  const eligible =
    document.hidden || motionQuery?.matches
      ? []
      : [...visibleMarks.values()]
          .filter((mark) => mark.visible && !mark.active)
          .map((mark) => ({
            mark,
            top: mark.element.getBoundingClientRect().top,
          }))
          .sort((a, b) => b.top - a.top)
          .slice(0, MAX_LIVE_MARKS);
  const live = new Set(eligible.map(({ mark }) => mark));
  for (const mark of visibleMarks.values()) {
    const next = live.has(mark);
    if (mark.live === next) continue;
    mark.live = next;
    mark.setLive(next);
  }
}

function scheduleLiveMarks() {
  if (!reconcileFrame) {
    reconcileFrame = window.requestAnimationFrame(reconcileLiveMarks);
  }
}

function observeMark(mark: VisibleMark) {
  if (!markObserver) {
    markObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const observed = visibleMarks.get(entry.target as HTMLElement);
        if (observed) observed.visible = entry.isIntersecting;
      }
      scheduleLiveMarks();
    });
    motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    motionQuery.addEventListener("change", scheduleLiveMarks);
    document.addEventListener("visibilitychange", scheduleLiveMarks);
    window.addEventListener("scroll", scheduleLiveMarks, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", scheduleLiveMarks);
  }
  visibleMarks.set(mark.element, mark);
  markObserver.observe(mark.element);
}

function unobserveMark(element: HTMLElement) {
  markObserver?.unobserve(element);
  visibleMarks.delete(element);
  if (visibleMarks.size > 0) {
    scheduleLiveMarks();
    return;
  }
  markObserver?.disconnect();
  markObserver = null;
  motionQuery?.removeEventListener("change", scheduleLiveMarks);
  motionQuery = null;
  document.removeEventListener("visibilitychange", scheduleLiveMarks);
  window.removeEventListener("scroll", scheduleLiveMarks, true);
  window.removeEventListener("resize", scheduleLiveMarks);
  window.cancelAnimationFrame(reconcileFrame);
  reconcileFrame = 0;
}

/** A live resident presence perched above the main composer. */
export function ChatAgentMark({
  active,
  name,
  seed,
  showIdentity = true,
}: {
  active: boolean;
  name: string;
  seed: string;
  showIdentity?: boolean;
}) {
  const [showSandpile, setShowSandpile] = React.useState(active);
  const [visualActive, setVisualActive] = React.useState(
    active && !showIdentity,
  );
  const [liveMote, setLiveMote] = React.useState(false);
  const markRef = React.useRef<HTMLSpanElement>(null);
  const initialActive = React.useRef(active);

  React.useEffect(() => {
    if (!showIdentity) return;
    const element = markRef.current;
    if (!element) return;
    observeMark({
      element,
      setLive: setLiveMote,
      active: initialActive.current,
      visible: false,
      live: false,
    });
    return () => unobserveMark(element);
  }, [showIdentity]);

  React.useEffect(() => {
    const mark = markRef.current && visibleMarks.get(markRef.current);
    if (mark) {
      mark.active = active;
      scheduleLiveMarks();
    }
  }, [active]);

  React.useEffect(() => {
    if (active) {
      setShowSandpile(true);
      if (!showIdentity) {
        setVisualActive(true);
        return;
      }
      // Let the field animate behind the sphere before the crossfade begins.
      // Revealing its first avalanche is the stray pink flash.
      const reveal = window.setTimeout(() => setVisualActive(true), 220);
      return () => window.clearTimeout(reveal);
    }
    setVisualActive(false);
    const timeout = window.setTimeout(
      () => setShowSandpile(false),
      TRANSITION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [active, showIdentity]);

  return (
    <span
      aria-label={`${name} ${active ? "working" : "identity"} mark`}
      className="luca-chat-agent-mark"
      data-active={visualActive}
      data-identity-visible={showIdentity}
      data-testid="chat-agent-mark"
      ref={markRef}
      role="img"
      title={name}
    >
      {showIdentity ? (
        <img
          alt=""
          aria-hidden="true"
          className="luca-chat-agent-mark__mote"
          src={motePoster}
        />
      ) : null}
      {showIdentity && liveMote && !active
        ? React.createElement("mote-3d", {
            "aria-hidden": true,
            className: "luca-chat-agent-mark__live-mote",
            expression: "ambient",
            "no-caustic": "",
            species: "mote",
            style: { height: 49, width: 49 },
            tint: "#b8b8b8",
          })
        : null}
      {showSandpile ? (
        <span aria-hidden="true" className="luca-chat-agent-mark__sandpile">
          <SandpileActivityIndicator seed={`${seed}:activity`} size={49} />
        </span>
      ) : null}
      {showIdentity ? (
        <span aria-hidden="true" className="luca-chat-agent-mark__wake" />
      ) : null}
    </span>
  );
}
