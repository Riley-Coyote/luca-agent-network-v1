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

/**
 * Marks a span the rehype pass created, and the class that gives it a box. The
 * value says how the word may be animated:
 *
 * - `""`      ordinary prose: opacity, blur and transform.
 * - `"plain"` inside an expression: no `filter` (see below).
 * - `"clip"`  inside a gradient expression: no `filter`, and its own clip.
 *
 * An expression paints its gradient through the text of its whole subtree
 * (`background-clip: text`). A descendant that takes an opacity or a filter
 * drops out of that mask completely — it does not fade, it disappears — and a
 * filter can push the engine into rasterizing the whole clipped element as one
 * unit, so the entire coloured line blurs and clears together. Giving each
 * word its own clip puts the paint back under its own opacity and transform.
 */
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
/**
 * How long the row holds its `data-md-stream-effect` attribute after the last
 * word settles, before the spans unwrap to plain text. Nothing layout-
 * affecting animates during this window — it exists only so the unwrap (and
 * the gesture animations paused by the attribute, see the stylesheet) happens
 * a beat after the row goes quiet rather than on the same frame.
 */
export const STREAMING_SETTLE_GRACE_MS = 300;
/**
 * When a whole remainder lands at once — the terminal drain flushes its buffer
 * in 300ms — the ramp would spend half a minute reading it back out. The tail
 * tightens instead so the sentence finishes within this, which reads as the
 * sentence ending rather than as a second reveal.
 */
export const STREAMING_TAIL_BUDGET_MS = 1200;
/** However large the backlog, words never start closer together than this. */
export const STREAMING_GAP_MIN_MS = 4;
/**
 * Living ink's pace, as the phone writes it: a lingering word is written on a
 * letter at a time, about one every 48ms, and the next word waits for it; a
 * rushed passage lands two words at a time, so in one sweep. Neither is
 * tightened by a backlog — the slowness or the rush is the mind's own.
 */
export const STREAMING_LINGER_LETTER_MS = 48;
export const STREAMING_RUSH_GAP_MS = 8;

/**
 * Whether a reply may hold a breath: a cheap look for living ink's `hold`, so
 * a reply that streams plain under Reduce Motion stays plain unless it does.
 * A false yes only costs the reply its word spans.
 */
export function inkMayHold(content: string): boolean {
  return (
    content.includes("hold") &&
    (content.includes("(ink:") || content.includes("(color:"))
  );
}

/** What living ink asks of one word's clock. */
export type StreamingWordInk = {
  /** A held breath before this word, when it is the first of its passage. */
  holdMs?: number;
  tempo?: "linger" | "rush";
  /** The word's length in graphemes, which a lingering word is written at. */
  letters: number;
};

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
 *
 * `backlog` is how many words are still waiting behind this one. It only ever
 * shortens the gap: on a live stream it is a word or two and the ramp stands,
 * and on a bulk arrival it closes the rhythm up rather than trickling.
 */
export function streamingWordGapMs(index: number, backlog = 1): number {
  const ramp = Math.min(Math.max(index, 0), STREAMING_GAP_RAMP_WORDS);
  const paced = lerp(
    STREAMING_GAP_FIRST_MS,
    STREAMING_GAP_STEADY_MS,
    ramp / STREAMING_GAP_RAMP_WORDS,
  );
  if (backlog <= 1) return paced;
  const budgeted = (STREAMING_TAIL_BUDGET_MS - STREAMING_WORD_MS) / backlog;
  return Math.max(STREAMING_GAP_MIN_MS, Math.min(paced, budgeted));
}

/** Progress of a word whose clock started at `startedAtMs`. */
export function streamingWordProgress(
  startedAtMs: number,
  nowMs: number,
  durationMs = STREAMING_WORD_MS,
): number {
  if (durationMs <= 0) return nowMs >= startedAtMs ? 1 : 0;
  return STREAMING_EASE(clamp01((nowMs - startedAtMs) / durationMs));
}

export type StreamingWordAnimation = {
  readonly unit: "word";
  readonly durationMs: number;
  /** Shared ramp — the two effects differ only in `apply`. */
  readonly gapMs: (index: number, backlog?: number) => number;
  /**
   * Kept for effects that may want it later; neither current effect reserves
   * row space today. Nothing that affects layout may animate — a transform's
   * overflow is left uncompensated rather than opened and eased shut by a
   * layout property, which is what used to make the row re-wrap once it
   * closed back up.
   */
  readonly spacedRow: boolean;
  readonly apply: (node: HTMLElement, progress: number) => void;
  readonly reset: (node: HTMLElement) => void;
};

/** Expression words carry their colour through a clip, which no filter survives. */
function blurred(node: HTMLElement): boolean {
  return node.getAttribute(STREAMING_WORD_ATTRIBUTE) === "";
}

function settle(node: HTMLElement): void {
  node.style.opacity = "";
  node.style.filter = "none";
  node.style.transform = "none";
}

/**
 * A lingering word is written on rather than bloomed: the ink runs left to
 * right through it behind a soft leading edge, so its letters arrive one after
 * another while the word stays one box with its own kerning. Nothing moves.
 */
export function writeOnWord(node: HTMLElement, progress: number): void {
  if (progress >= 1) {
    node.style.removeProperty("mask-image");
    node.style.removeProperty("-webkit-mask-image");
    settle(node);
    return;
  }
  const edge = -30 + 130 * progress;
  const mask = `linear-gradient(90deg, #000 ${edge.toFixed(1)}%, transparent ${(edge + 30).toFixed(1)}%)`;
  node.style.setProperty("mask-image", mask);
  node.style.setProperty("-webkit-mask-image", mask);
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
      node.style.filter = blurred(node)
        ? `blur(${(5 * (1 - progress)).toFixed(2)}px)`
        : "none";
      node.style.transform = `translateY(${(2 * (1 - progress)).toFixed(2)}px)`;
    },
    reset(node) {
      STREAMING_WORD_ANIMATIONS.diffusion.apply(node, 0);
    },
  },
  /**
   * Words land a touch large and contract to size. A center-origin scale
   * overflows its layout box without reserving any space — nothing about the
   * row may reserve that room either, or the row itself becomes a layout
   * property with a frame-by-frame value. The peak stays capped at 1.10 so
   * the overlap with a neighbour, while a word is still near-transparent
   * early in its own transition, stays slight enough to read as texture
   * rather than as a collision.
   *
   * Opacity and transform only, on purpose — bloom never carries a filter.
   * This is also the fix for a real, measured one-device-pixel settle-time
   * reflow (offsetLeft/offsetTop, which ignore `transform`, moved on the
   * vertical axis only once a word's filter cleared). Bloom is the default
   * effect, so it is the one that has to be exactly flat, and dropping its
   * blur is a smaller loss than diffusion dropping its own, since
   * diffusion's *is* the blur — see the isolation notes in the unit test
   * below for what is and isn't confirmed yet.
   */
  bloom: {
    unit: "word",
    durationMs: STREAMING_WORD_MS,
    gapMs: streamingWordGapMs,
    spacedRow: false,
    apply(node, progress) {
      if (progress >= 1) {
        settle(node);
        return;
      }
      node.style.opacity = Math.min(1, progress * 1.5).toFixed(3);
      node.style.transform = `scale(${(1 + 0.1 * (1 - progress)).toFixed(4)})`;
      node.style.filter = "none";
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

/**
 * With Reduce Motion on, or the effect off, a word shows the moment it
 * arrives and nothing moves. A hold is time, not motion, so it stays: the
 * held passage, and everything after it, waits out its breath.
 */
export const STREAMING_WORD_STILL: StreamingWordAnimation = {
  unit: "word",
  durationMs: 0,
  gapMs: () => 0,
  spacedRow: false,
  apply(node, progress) {
    if (progress >= 1) settle(node);
    else node.style.opacity = "0";
  },
  reset(node) {
    node.style.opacity = "0";
  },
};

/** How a word's clock is paced: its gap to the next word and its own length. */
export type StreamingWordPace = Pick<
  StreamingWordAnimation,
  "durationMs" | "gapMs"
>;

const STREAMING_PACE: StreamingWordPace = {
  durationMs: STREAMING_WORD_MS,
  gapMs: streamingWordGapMs,
};

/** One word's gap and length, with its living ink. */
function inkPace(
  pace: StreamingWordPace,
  index: number,
  backlog: number,
  ink: StreamingWordInk | undefined,
): { durationMs: number; gapMs: number } {
  if (ink?.tempo === "linger") {
    const writing = Math.max(1, ink.letters) * STREAMING_LINGER_LETTER_MS;
    return {
      durationMs: writing + STREAMING_LINGER_LETTER_MS,
      gapMs: writing + STREAMING_LINGER_LETTER_MS,
    };
  }
  if (ink?.tempo === "rush") {
    return { durationMs: pace.durationMs, gapMs: STREAMING_RUSH_GAP_MS };
  }
  return { durationMs: pace.durationMs, gapMs: pace.gapMs(index, backlog) };
}

export type StreamingWordStart = {
  /** When this word's own transition begins. */
  atMs: number;
  /** How long that transition runs. */
  durationMs: number;
  /** The word that clock belongs to. */
  text: string;
};

export type StreamingWordSchedule = {
  /**
   * The clock for a word, assigned the first time it is seen and never revised
   * while it stays the same word. The reply's markdown re-renders on every
   * chunk, so identity cannot come from a DOM node — a settled word must never
   * animate again because React rebuilt its span. It comes from the pair of
   * the word's place in the plain-text order and the word itself.
   *
   * The text matters because a provisional tail is not yet the text it will
   * become: `[So much](color:warmth~care)` streams as three literal words and
   * then parses into two coloured ones. Index alone would hand those new words
   * a clock that had already run out, and the coloured line would finish in a
   * burst before the plain sentence above it had.
   */
  startAtMs(
    index: number,
    text: string,
    startsBlock: boolean,
    nowMs: number,
    backlog?: number,
    ink?: StreamingWordInk,
    pace?: StreamingWordPace,
  ): number;
  /** The clock assigned to this index for this word, or null if it has none. */
  assignedAtMs(index: number, text: string): number | null;
  /** How long the transition assigned to this index runs. */
  assignedDurationMs(index: number): number;
  /** How many leading indices have been assigned a clock. */
  assignedCount(): number;
  /** The latest clock assigned so far — the stream's own settle deadline. */
  latestStartMs(): number;
};

/**
 * Whether two spellings at one index are the same word still.
 *
 * Markdown only ever decorates around a word: a provisional tail shows
 * `[So` and `here?](color:warmth~care)` and parses them into `So` and `here?`.
 * Those words were already on screen and already part-way through their own
 * clock — restarting them would step the line backwards and land its ends
 * after its middle. A word that is genuinely new at this index (a `##` that
 * became a title, a table's pipes collapsing into cells) shares no edge with
 * what was there, and takes a fresh clock.
 */
function sameWord(before: string, after: string): boolean {
  if (before === after) return true;
  const [short, long] =
    before.length < after.length ? [before, after] : [after, before];
  return short.length > 0 && (long.startsWith(short) || long.endsWith(short));
}

export function createStreamingWordSchedule(): StreamingWordSchedule {
  const startAt: (StreamingWordStart | undefined)[] = [];
  let nextFreeMs: number | null = null;
  let latestMs = 0;

  return {
    startAtMs(
      index,
      text,
      startsBlock,
      nowMs,
      backlog = 1,
      ink,
      pace = STREAMING_PACE,
    ) {
      const known = startAt[index];
      if (known && sameWord(known.text, text)) {
        known.text = text;
        return known.atMs;
      }

      // A word cannot start before it exists, and never bunches against the
      // word ahead of it: whichever comes later wins. A held breath waits at
      // the passage's edge, after the word before it has started; if the
      // stream itself already paused that long, it adds nothing more.
      const earliestMs =
        nextFreeMs === null
          ? nowMs
          : nextFreeMs + (startsBlock ? STREAMING_BLOCK_PAUSE_MS : 0);
      let assigned = Math.max(nowMs, earliestMs + (ink?.holdMs ?? 0));
      // A word never overtakes its neighbours. When a provisional tail is
      // re-tokenised, one word can need a fresh clock while the words after it
      // are already running on theirs; left alone it would land after the rest
      // of its own line. Reading order wins: it arrives with them instead.
      const ahead = startAt[index + 1];
      if (ahead) assigned = Math.min(assigned, ahead.atMs);
      const behind = startAt[index - 1];
      if (behind) assigned = Math.max(assigned, behind.atMs);
      const timing = inkPace(pace, index, backlog, ink);
      startAt[index] = { atMs: assigned, durationMs: timing.durationMs, text };
      nextFreeMs = assigned + timing.gapMs;
      if (assigned > latestMs) latestMs = assigned;
      return assigned;
    },
    assignedAtMs(index, text) {
      const known = startAt[index];
      return known && sameWord(known.text, text) ? known.atMs : null;
    },
    assignedDurationMs(index) {
      return startAt[index]?.durationMs ?? STREAMING_WORD_MS;
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

export type StreamingWordKind = "" | "plain" | "clip";

function wordSpan(value: string, kind: StreamingWordKind): HastElement {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: [STREAMING_WORD_CLASS],
      [STREAMING_WORD_ATTRIBUTE]: kind,
    },
    children: [{ type: "text", value }],
  };
}

function splitTextNode(node: HastText, kind: StreamingWordKind): HastNode[] {
  if (!node.value.trim()) return [node];
  const parts = node.value.split(/(\s+)/);
  const out: HastNode[] = [];
  for (const part of parts) {
    if (!part) continue;
    // Whitespace runs stay text nodes so the line still breaks and collapses
    // exactly the way it did before the pass ran.
    out.push(
      part.trim() ? wordSpan(part, kind) : { type: "text", value: part },
    );
  }
  return out;
}

/** True when this element paints its subtree's text itself, one way or another. */
function expressionKind(node: HastElement): StreamingWordKind {
  let kind: StreamingWordKind = "";
  for (const key of Object.keys(node.properties)) {
    const name = key.toLowerCase();
    if (
      name.startsWith("data-expression") ||
      name.startsWith("dataexpression")
    ) {
      kind = "plain";
      if (name.includes("gradient")) return "clip";
    }
  }
  return kind;
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
    const walk = (nodes: HastNode[], kind: StreamingWordKind): HastNode[] => {
      const out: HastNode[] = [];
      for (const node of nodes) {
        if (isText(node)) {
          out.push(...splitTextNode(node, kind));
        } else if (isElement(node)) {
          if (STREAMING_WORD_SKIP_TAGS.has(node.tagName)) {
            out.push(node);
          } else {
            // An expression is prose, not a pill: its words still split and
            // still schedule in document order. Only how they may be painted
            // changes, and that is inherited by everything beneath it.
            const own = expressionKind(node);
            const inherited = own === "" ? kind : own;
            out.push({ ...node, children: walk(node.children, inherited) });
          }
        } else {
          out.push(node);
        }
      }
      return out;
    };
    tree.children = walk(tree.children, "");
  };
}
