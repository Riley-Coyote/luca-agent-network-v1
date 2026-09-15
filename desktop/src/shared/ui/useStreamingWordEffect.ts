import * as React from "react";

import {
  createStreamingWordSchedule,
  STREAMING_SPACING_EASE_MS,
  STREAMING_WORD_SELECTOR,
  type StreamingTextEffect,
  streamingWordAnimation,
  streamingWordProgress,
} from "./markdownStreamingText";
import "./markdownStreamingText.css";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function reducedMotionSnapshot(): boolean {
  return globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
}

/** Device-level motion preference, read live so a mid-stream change lands. */
export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeToReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
}

/**
 * Which top-level block of the markdown root a word sits in, by position
 * rather than by node identity: React replaces the tail's element as blocks
 * complete, and an identity comparison would read that churn as a paragraph
 * break and insert a pause that is not there.
 */
function blockIndexOf(root: Element, word: Element): number {
  let node: Element | null = word;
  while (node?.parentElement && node.parentElement !== root) {
    node = node.parentElement;
  }
  if (!node || node.parentElement !== root) return -1;
  return Array.prototype.indexOf.call(root.children, node);
}

type StreamingWordState = {
  /** Render word spans for this pass. */
  wordSpans: boolean;
  /** Value for the root's `data-md-stream-effect`, or undefined when idle. */
  effectAttribute: string | undefined;
};

const IDLE: StreamingWordState = {
  wordSpans: false,
  effectAttribute: undefined,
};

type Phase = "idle" | "running" | "settling";

/**
 * Drives one streaming row's words from a single animation frame loop.
 *
 * Word identity comes from the index in plain-text order, never from a DOM
 * node: the reply's markdown re-renders on every chunk, so a node-keyed effect
 * would restart words that had already settled. A start time is assigned the
 * first time an index is seen and is never revised, which makes a re-render
 * invisible — a settled word stays settled whether or not its span survived.
 *
 * Only words still in flight are touched each frame. Settled words are written
 * once with `filter: none` / `transform: none` and then skipped, and a freshly
 * re-rendered span below the settle cursor needs no write at all: an untouched
 * span already computes to exactly that.
 */
export function useStreamingWordEffect(
  rootRef: React.RefObject<HTMLElement | null>,
  options: { active: boolean; effect: StreamingTextEffect },
): StreamingWordState {
  const { active, effect } = options;
  const reducedMotion = usePrefersReducedMotion();
  const animation = reducedMotion ? null : streamingWordAnimation(effect);

  const [phase, setPhase] = React.useState<Phase>("idle");
  const scheduleRef = React.useRef(createStreamingWordSchedule());
  const firstUnsettledRef = React.useRef(0);
  const lastBlockIndexRef = React.useRef(-1);
  const wordsRef = React.useRef<HTMLElement[]>([]);
  const staleRef = React.useRef(true);

  // Derived during render so the very first streamed paint already carries
  // spans — an effect would land one frame late and flash unstyled words.
  let resolvedPhase = phase;
  if (!animation && phase !== "idle") resolvedPhase = "idle";
  else if (active && animation && phase !== "running")
    resolvedPhase = "running";
  if (resolvedPhase !== phase) setPhase(resolvedPhase);

  const running = resolvedPhase === "running";

  const paint = React.useCallback(
    (nowMs: number): boolean => {
      const root = rootRef.current;
      const current = animation;
      if (!root || !current) return true;

      if (staleRef.current || wordsRef.current.length === 0) {
        wordsRef.current = Array.from(
          root.querySelectorAll<HTMLElement>(STREAMING_WORD_SELECTOR),
        );
        staleRef.current = false;
      }
      const words = wordsRef.current;
      const schedule = scheduleRef.current;

      for (let i = schedule.assignedCount(); i < words.length; i += 1) {
        const word = words[i];
        if (!word) continue;
        const blockIndex = blockIndexOf(root, word);
        const startsBlock =
          lastBlockIndexRef.current >= 0 &&
          blockIndex !== lastBlockIndexRef.current;
        schedule.startAtMs(i, startsBlock, nowMs);
        lastBlockIndexRef.current = blockIndex;
      }

      let firstUnsettled = firstUnsettledRef.current;
      for (let i = firstUnsettled; i < words.length; i += 1) {
        const word = words[i];
        const startedAt = schedule.assignedAtMs(i);
        if (!word || startedAt === null) continue;
        const progress = streamingWordProgress(startedAt, nowMs);
        current.apply(word, progress);
        if (progress >= 1 && i === firstUnsettled) firstUnsettled = i + 1;
      }
      firstUnsettledRef.current = firstUnsettled;

      return (
        words.length > 0 &&
        firstUnsettled >= words.length &&
        schedule.assignedCount() >= words.length
      );
    },
    [animation, rootRef],
  );

  // Paint synchronously after every commit that could have added words, so a
  // newly rendered word is never shown at full strength for one frame first.
  React.useLayoutEffect(() => {
    if (!running) return;
    staleRef.current = true;
    paint(performance.now());
  });

  React.useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = () => {
      const settled = paint(performance.now());
      if (!active && settled) {
        setPhase("settling");
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, paint, running]);

  // The row's word-spacing eases shut after the spans are gone; drop the
  // attribute once that transition has had its time.
  React.useEffect(() => {
    if (resolvedPhase !== "settling") return;
    wordsRef.current = [];
    staleRef.current = true;
    const timer = window.setTimeout(
      () => setPhase("idle"),
      STREAMING_SPACING_EASE_MS + 40,
    );
    return () => window.clearTimeout(timer);
  }, [resolvedPhase]);

  if (resolvedPhase === "idle") return IDLE;
  return {
    wordSpans: running,
    effectAttribute: running ? effect : "settling",
  };
}
