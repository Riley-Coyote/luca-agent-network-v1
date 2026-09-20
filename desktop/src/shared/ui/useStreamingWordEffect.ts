import * as React from "react";

import {
  createStreamingWordSchedule,
  STREAMING_SETTLE_GRACE_MS,
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
  const rescanRef = React.useRef(true);
  // Sticky for the life of this mount: once a message has been word-spanned
  // for streaming, it stays that way, even after every word has settled and
  // the row has gone idle. Unwrapping back to plain markdown was itself the
  // remaining source of the settle-time jump — the same text, split across
  // many small boxes versus laid out as one continuous run, can measure a
  // fraction of a pixel differently, and a DOM swap is a re-measure no
  // matter how long after the animation it happens. Spans cost nothing once
  // settled (see `settle()` below and the effects that stop touching them
  // once `running` goes false), so there is nothing to gain by removing them.
  const everWordSpannedRef = React.useRef(false);

  // Derived during render so the very first streamed paint already carries
  // spans — an effect would land one frame late and flash unstyled words.
  let resolvedPhase = phase;
  if (!animation && phase !== "idle") resolvedPhase = "idle";
  else if (active && animation && phase !== "running")
    resolvedPhase = "running";
  if (resolvedPhase !== phase) setPhase(resolvedPhase);
  if (resolvedPhase !== "idle") everWordSpannedRef.current = true;

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
        rescanRef.current = true;
      }
      const words = wordsRef.current;
      const schedule = scheduleRef.current;

      // Only when the tree actually changed: a provisional tail can rewrite the
      // word at an index — `[So much](color:warmth~care)` streams as three
      // literal words and parses into two — and those words need their own
      // clock, not the spent one their index was holding.
      const from = rescanRef.current ? 0 : schedule.assignedCount();
      rescanRef.current = false;
      for (let i = from; i < words.length; i += 1) {
        const word = words[i];
        if (!word) continue;
        const text = word.textContent ?? "";
        if (schedule.assignedAtMs(i, text) !== null) continue;
        const blockIndex = blockIndexOf(root, word);
        const startsBlock =
          lastBlockIndexRef.current >= 0 &&
          blockIndex !== lastBlockIndexRef.current;
        schedule.startAtMs(i, text, startsBlock, nowMs, words.length - i);
        lastBlockIndexRef.current = blockIndex;
        // A word that just took a fresh clock is in flight again, whatever the
        // settle cursor believed.
        if (i < firstUnsettledRef.current) firstUnsettledRef.current = i;
      }

      let firstUnsettled = firstUnsettledRef.current;
      for (let i = firstUnsettled; i < words.length; i += 1) {
        const word = words[i];
        const startedAt = word
          ? schedule.assignedAtMs(i, word.textContent ?? "")
          : null;
        if (!word || startedAt === null) continue;
        const progress = streamingWordProgress(startedAt, nowMs);
        current.apply(word, progress);
        if (progress >= 1 && i === firstUnsettled) firstUnsettled = i + 1;
      }
      firstUnsettledRef.current = firstUnsettled;

      // A reply with no prose at all (only a code block, or nothing yet) is
      // vacuously settled — otherwise the loop would never find a reason to
      // stop once the row went quiet.
      return (
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

  // A grace beat after the last word settles, before the gesture animations
  // paused by the `data-md-stream-effect` attribute (see the stylesheet)
  // resume. No longer gates an unwrap — see `everWordSpannedRef` above.
  React.useEffect(() => {
    if (resolvedPhase !== "settling") return;
    wordsRef.current = [];
    staleRef.current = true;
    const timer = window.setTimeout(
      () => setPhase("idle"),
      STREAMING_SETTLE_GRACE_MS + 40,
    );
    return () => window.clearTimeout(timer);
  }, [resolvedPhase]);

  if (resolvedPhase === "idle") {
    // A message that never streamed (history, "off", reduced motion) takes
    // the ordinary idle path — no spans, ever. One that did keeps its spans
    // now that every word has settled and the attribute is gone; they carry
    // no styles the plain markup wouldn't also carry (see `settle()`), so
    // this is the same box either way, just never swapped for a different
    // element.
    return everWordSpannedRef.current
      ? { effectAttribute: undefined, wordSpans: true }
      : IDLE;
  }
  return {
    // True through both "running" and "settling", same as the idle branch
    // above once a message has ever streamed: the row never drops spans, so
    // there is no moment where the render swaps to a differently-measured
    // tree.
    wordSpans: true,
    effectAttribute: running ? effect : "settling",
  };
}
