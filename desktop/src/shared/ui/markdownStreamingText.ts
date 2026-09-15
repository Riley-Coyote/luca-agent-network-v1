/**
 * Streamed replies arrive word by word.
 *
 * One clock, per-word progress, every animated property derived from that one
 * value. Three separate animations on one element look like three effects; one
 * clock driving three properties looks like a single physical event. At p = 1
 * `filter` and `transform` are set to `none` rather than to zero, so a settled
 * word leaves its composited layer instead of holding one for the rest of the
 * conversation.
 *
 * This module is the mechanism only: the ramp that decides when a word starts,
 * the two `apply` functions that differ between the effects, and the rehype
 * pass that gives each prose word a box to animate. The React glue — the frame
 * loop, the settle detection, the unwrap — lives in `useStreamingWordEffect`.
 */

export const STREAMING_TEXT_EFFECTS = ["bloom", "diffusion", "off"] as const;

export type StreamingTextEffect = (typeof STREAMING_TEXT_EFFECTS)[number];

export type StreamingWordEffect = Exclude<StreamingTextEffect, "off">;

export const DEFAULT_STREAMING_TEXT_EFFECT: StreamingTextEffect = "bloom";

/** Marks a span the rehype pass created, and the class that gives it a box. */
export const STREAMING_WORD_ATTRIBUTE = "data-md-stream-word";
export const STREAMING_WORD_CLASS = "md-stream-word";
export const STREAMING_WORD_SELECTOR = `[${STREAMING_WORD_ATTRIBUTE}]`;
/** Carries the in-flight effect on the markdown root (see the stylesheet). */
export const STREAMING_EFFECT_ATTRIBUTE = "data-md-stream-effect";

/** One word's own transition, from first light to settled. */
export const STREAMING_WORD_MS = 320;
/** Gap between consecutive word starts, first word … tenth word onward. */
export const STREAMING_GAP_FIRST_MS = 44;
export const STREAMING_GAP_STEADY_MS = 26;
export const STREAMING_GAP_RAMP_WORDS = 10;
/** A block break holds the rhythm for a beat before the next word starts. */
export const STREAMING_BLOCK_PAUSE_MS = 120;
/** How long the bloom row takes to ease its word-spacing back to normal. */
export const STREAMING_SPACING_EASE_MS = 300;

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/** Newton-solved cubic bezier, the same curve the design prototype uses. */
function cubicBezier(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): (x: number) => number {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-5) break;
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

export const STREAMING_EASE = cubicBezier(0.22, 0.61, 0.36, 1);

/**
 * A constant gap reads as mechanical from the first word; starting slower and
 * settling into a rhythm reads as the sentence gathering momentum.
 */
export function streamingWordGapMs(index: number): number {
  const ramp = Math.min(Math.max(index, 0), STREAMING_GAP_RAMP_WORDS);
  return lerp(
    STREAMING_GAP_FIRST_MS,
    STREAMING_GAP_STEADY_MS,
    ramp / STREAMING_GAP_RAMP_WORDS,
  );
}

/** Progress of a word whose clock started at `startedAtMs`. */
export function streamingWordProgress(
  startedAtMs: number,
  nowMs: number,
): number {
  return STREAMING_EASE(clamp01((nowMs - startedAtMs) / STREAMING_WORD_MS));
}

export type StreamingWordAnimation = {
  readonly unit: "word";
  readonly durationMs: number;
  /** Shared ramp — the two effects differ only in `apply` and row spacing. */
  readonly gapMs: (index: number) => number;
  /** True when the row has to reserve room for words that outgrow their box. */
  readonly spacedRow: boolean;
  readonly apply: (node: HTMLElement, progress: number) => void;
  readonly reset: (node: HTMLElement) => void;
};

function settle(node: HTMLElement): void {
  node.style.opacity = "";
  node.style.filter = "none";
  node.style.transform = "none";
}

export const STREAMING_WORD_ANIMATIONS: Record<
  StreamingWordEffect,
  StreamingWordAnimation
> = {
  /** Words condense out of the page: opacity, blur and rise from one value. */
  diffusion: {
    unit: "word",
    durationMs: STREAMING_WORD_MS,
    gapMs: streamingWordGapMs,
    spacedRow: false,
    apply(node, progress) {
      if (progress >= 1) {
        settle(node);
        return;
      }
      node.style.opacity = progress.toFixed(3);
      node.style.filter = `blur(${(5 * (1 - progress)).toFixed(2)}px)`;
      node.style.transform = `translateY(${(2 * (1 - progress)).toFixed(2)}px)`;
    },
    reset(node) {
      STREAMING_WORD_ANIMATIONS.diffusion.apply(node, 0);
    },
  },
  /**
   * Words land a touch large and contract to size. A center-origin scale
   * overflows its layout box without reserving any space, so the peak stays
   * capped at 1.10 and the row carries extra word-spacing — otherwise adjacent
   * words collide while in flight and the line is illegible.
   */
  bloom: {
    unit: "word",
    durationMs: STREAMING_WORD_MS,
    gapMs: streamingWordGapMs,
    spacedRow: true,
    apply(node, progress) {
      if (progress >= 1) {
        settle(node);
        return;
      }
      node.style.opacity = Math.min(1, progress * 1.5).toFixed(3);
      node.style.transform = `scale(${(1 + 0.1 * (1 - progress)).toFixed(4)})`;
      node.style.filter = `blur(${(2 * (1 - progress)).toFixed(2)}px)`;
    },
    reset(node) {
      STREAMING_WORD_ANIMATIONS.bloom.apply(node, 0);
    },
  },
};

export function streamingWordAnimation(
  effect: StreamingTextEffect,
): StreamingWordAnimation | null {
  return effect === "off" ? null : STREAMING_WORD_ANIMATIONS[effect];
}

export type StreamingWordSchedule = {
  /**
   * The clock for a word, assigned the first time its index is seen and never
   * revised. The reply's markdown re-renders on every chunk, so identity has
   * to come from the word's place in the plain-text order, not from a DOM
   * node: a word that already settled must never animate again.
   */
  startAtMs(index: number, startsBlock: boolean, nowMs: number): number;
  /** The clock already assigned to this index, or null if it has none. */
  assignedAtMs(index: number): number | null;
  /** How many leading indices have been assigned a clock. */
  assignedCount(): number;
  /** The latest clock assigned so far — the stream's own settle deadline. */
  latestStartMs(): number;
};

export function createStreamingWordSchedule(): StreamingWordSchedule {
  const startAt: number[] = [];
  let nextFreeMs: number | null = null;
  let latestMs = 0;

  return {
    startAtMs(index, startsBlock, nowMs) {
      const known = startAt[index];
      if (known !== undefined) return known;

      // A word cannot start before it exists, and never bunches against the
      // word ahead of it: whichever comes later wins.
      const earliestMs =
        nextFreeMs === null
          ? nowMs
          : nextFreeMs + (startsBlock ? STREAMING_BLOCK_PAUSE_MS : 0);
      const assigned = Math.max(nowMs, earliestMs);
      startAt[index] = assigned;
      nextFreeMs = assigned + streamingWordGapMs(index);
      if (assigned > latestMs) latestMs = assigned;
      return assigned;
    },
    assignedAtMs(index) {
      return startAt[index] ?? null;
    },
    assignedCount() {
      return startAt.length;
    },
    latestStartMs() {
      return latestMs;
    },
  };
}

// --- The rehype pass -------------------------------------------------------

// Minimal HAST types — matches the pattern in rehypeSearchHighlight.ts.
type HastText = { type: "text"; value: string };

type HastElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
};

type HastNode = HastElement | HastText | { type: string };

type HastRoot = { type: "root"; children: HastNode[] };

/**
 * Subtrees that never get word spans. Code blocks and inline code arrive plain
 * — their whitespace is content. The custom pills (`mention`, `emoji`,
 * `channel-link`, `message-link`, `spoiler`) are single objects, not prose, and
 * splitting their label would take them apart.
 */
const STREAMING_WORD_SKIP_TAGS: ReadonlySet<string> = new Set([
  "channel-link",
  "code",
  "emoji",
  "kbd",
  "math",
  "mention",
  "message-link",
  "pre",
  "samp",
  "script",
  "spoiler",
  "style",
  "textarea",
]);

function isElement(node: HastNode): node is HastElement {
  return node.type === "element";
}

function isText(node: HastNode): node is HastText {
  return node.type === "text";
}

function wordSpan(value: string): HastElement {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: [STREAMING_WORD_CLASS],
      [STREAMING_WORD_ATTRIBUTE]: "",
    },
    children: [{ type: "text", value }],
  };
}

function splitTextNode(node: HastText): HastNode[] {
  if (!node.value.trim()) return [node];
  const parts = node.value.split(/(\s+)/);
  const out: HastNode[] = [];
  for (const part of parts) {
    if (!part) continue;
    // Whitespace runs stay text nodes so the line still breaks and collapses
    // exactly the way it did before the pass ran.
    out.push(part.trim() ? wordSpan(part) : { type: "text", value: part });
  }
  return out;
}

/**
 * Wraps every prose word in an inline-block span, leaving link and emphasis
 * structure intact — the element is kept, only its text is split. Word
 * identity is deliberately *not* encoded here: each block parses on its own,
 * so the index has to come from document order at the DOM, which is the same
 * thing as plain-text order.
 */
export default function rehypeStreamingWords() {
  return (tree: HastRoot) => {
    const walk = (nodes: HastNode[]): HastNode[] => {
      const out: HastNode[] = [];
      for (const node of nodes) {
        if (isText(node)) {
          out.push(...splitTextNode(node));
        } else if (isElement(node)) {
          if (STREAMING_WORD_SKIP_TAGS.has(node.tagName)) {
            out.push(node);
          } else {
            out.push({ ...node, children: walk(node.children) });
          }
        } else {
          out.push(node);
        }
      }
      return out;
    };
    tree.children = walk(tree.children);
  };
}
