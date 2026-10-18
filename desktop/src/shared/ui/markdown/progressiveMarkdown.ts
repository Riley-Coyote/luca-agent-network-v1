export type ProgressiveMarkdownSegments = {
  complete: string;
  trailing: string;
};

export type ProgressiveMarkdownBlock = Readonly<{
  content: string;
  start: number;
}>;

export type ProgressiveMarkdownBlocks = {
  blocks: readonly ProgressiveMarkdownBlock[];
  trailing: string;
};

type Fence = Readonly<{
  character: "`" | "~";
  length: number;
}>;

/**
 * Incremental block-boundary state for one provisional response. Completed
 * blocks and their array retain identity until a new boundary is observed.
 */
export type ProgressiveMarkdownSnapshot = Readonly<{
  blocks: readonly ProgressiveMarkdownBlock[];
  content: string;
  lastAdvanceScannedCharacters: number;
  totalScannedCharacters: number;
  trailing: string;
  trailingStart: number;
  /** Internal cursor fields are public only so the pure state can be tested. */
  _blockStart: number;
  _lineStart: number;
  _openFence: Fence | null;
  _scanOffset: number;
}>;

export type ProgressiveMarkdownTailMode = "literal" | "markdown";

function openingFenceForLine(line: string): Fence | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  const marker = match?.[1];
  if (!marker) return null;
  return {
    character: marker[0] as Fence["character"],
    length: marker.length,
  };
}

function closesFence(line: string, fence: Fence): boolean {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/);
  const marker = match?.[1];
  return marker?.[0] === fence.character && marker.length >= fence.length;
}

function emptySnapshot(): ProgressiveMarkdownSnapshot {
  return {
    blocks: [],
    content: "",
    lastAdvanceScannedCharacters: 0,
    totalScannedCharacters: 0,
    trailing: "",
    trailingStart: 0,
    _blockStart: 0,
    _lineStart: 0,
    _openFence: null,
    _scanOffset: 0,
  };
}

/**
 * Advances only across newly appended characters. A corrected/truncated body
 * rebuilds safely, while the common public-stream path never rescans the
 * completed prefix or recreates frozen block objects.
 */
export function advanceProgressiveMarkdownSnapshot(
  previous: ProgressiveMarkdownSnapshot | null,
  content: string,
): ProgressiveMarkdownSnapshot {
  if (previous?.content === content) return previous;

  const canAppend = previous !== null && content.startsWith(previous.content);
  const base = canAppend ? previous : emptySnapshot();
  let blocks = base.blocks;
  let blocksChanged = false;
  let blockStart = base._blockStart;
  let lineStart = base._lineStart;
  let openFence = base._openFence;
  const scanOffset = base._scanOffset;

  const freezeThrough = (end: number) => {
    if (end <= blockStart) return;
    if (!blocksChanged) {
      blocks = [...blocks];
      blocksChanged = true;
    }
    (blocks as ProgressiveMarkdownBlock[]).push({
      content: content.slice(blockStart, end),
      start: blockStart,
    });
    blockStart = end;
  };

  for (let cursor = scanOffset; cursor < content.length; cursor += 1) {
    if (content.charCodeAt(cursor) !== 10) continue;

    const line = content.slice(lineStart, cursor);
    if (openFence) {
      if (closesFence(line, openFence)) {
        openFence = null;
        freezeThrough(cursor + 1);
      }
    } else {
      const openingFence = openingFenceForLine(line);
      if (openingFence) {
        openFence = openingFence;
      } else if (line.trim().length === 0) {
        freezeThrough(cursor + 1);
      }
    }
    lineStart = cursor + 1;
  }

  const scannedCharacters = content.length - scanOffset;
  return {
    blocks,
    content,
    lastAdvanceScannedCharacters: scannedCharacters,
    totalScannedCharacters: base.totalScannedCharacters + scannedCharacters,
    trailing: content.slice(blockStart),
    trailingStart: blockStart,
    _blockStart: blockStart,
    _lineStart: lineStart,
    _openFence: openFence,
    _scanOffset: content.length,
  };
}

function hasClosedTerminalFence(content: string): boolean {
  const lines = content.split("\n");
  const opening = openingFenceForLine(lines[0] ?? "");
  if (!opening || lines.length < 2) return false;
  return lines.slice(1).some((line) => closesFence(line, opening));
}

/** A closed living ink link, whose words may run across soft line breaks. */
const CLOSED_INK_LINK =
  /\[[^\]]+\]\((?:ink|color):[^\s()]*(?:\([^\s()]*\)[^\s()]*)*\)/;

function hasCompleteInlineMarkdown(content: string): boolean {
  return (
    CLOSED_INK_LINK.test(content) ||
    /`[^`\n]+`/.test(content) ||
    /\*\*[^\n]+\*\*/.test(content) ||
    /__[^\n]+__/.test(content) ||
    /(^|[^*])\*[^*\n]+\*(?!\*)/.test(content) ||
    /(^|[^_])_[^_\n]+_(?!_)/.test(content) ||
    /~~[^\n]+~~/.test(content) ||
    /!?\[[^\]\n]+\]\([^\s)]+(?:\s+["'][^"']*["'])?\)/.test(content) ||
    /(?:https?|buzz):\/\/\S+/.test(content) ||
    /(?:^|\s)[@#][\p{L}\p{N}_-]+/u.test(content) ||
    /:[A-Za-z0-9_+-]+:/.test(content) ||
    /\|\|[^\n]+\|\|/.test(content)
  );
}

/**
 * Chooses whether the unfinished tail needs the Markdown parser to preserve
 * its established geometry. Plain and syntactically open paragraphs stay a
 * literal paragraph, so ordinary word-by-word streaming does no parse work.
 */
export function progressiveMarkdownTailMode(
  trailing: string,
): ProgressiveMarkdownTailMode {
  if (!trailing) return "literal";
  const firstLine = trailing.split("\n", 1)[0] ?? "";
  if (/^ {0,3}#{1,6}\s+\S/.test(firstLine)) return "markdown";
  if (/^ {0,3}>\s*\S/.test(firstLine)) return "markdown";
  if (/^ {0,3}(?:[-+*]|\d+[.)])\s+\S/.test(firstLine)) return "markdown";
  if (/^ {0,3}(?:[*_-][\t ]*){3,}$/.test(firstLine)) return "markdown";
  if (/^(?: {4}|\t)\S/.test(firstLine)) return "markdown";
  if (hasClosedTerminalFence(trailing)) return "markdown";

  const lines = trailing.split("\n");
  const hasTableDelimiter = lines.some((line) =>
    /^ {0,3}\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line),
  );
  if (hasTableDelimiter) return "markdown";
  return hasCompleteInlineMarkdown(trailing) ? "markdown" : "literal";
}

const INK_SCHEMES = ["ink:", "color:"] as const;
/** Past this much link text, a bracket is read as words, not a passage. */
const INK_WITHHELD_TEXT_LIMIT = 1024;
/** The parser reads at most 512 characters of notation. */
const INK_WITHHELD_VALUE_LIMIT = 512;

type InkLinkState = "open" | "closed" | "not";

/** Whether the `[` at `open` starts a living ink link, still open or closed. */
function inkLinkState(tail: string, open: number): InkLinkState {
  let close = open + 1;
  let depth = 0;
  for (; close < tail.length; close += 1) {
    const character = tail[close];
    if (character === "\\") {
      close += 1;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      if (depth === 0) break;
      depth -= 1;
    }
    if (close - open > INK_WITHHELD_TEXT_LIMIT) return "not";
  }
  // No `]` yet, or nothing after it yet: it may still become ink.
  if (close >= tail.length - 1) return "open";
  if (tail[close + 1] !== "(") return "not";
  const start = close + 2;
  const written = tail.slice(start, start + 6);
  const scheme = INK_SCHEMES.find((name) => written.startsWith(name));
  if (!scheme) {
    const unfinished = start + written.length === tail.length;
    return unfinished && INK_SCHEMES.some((name) => name.startsWith(written))
      ? "open"
      : "not";
  }
  // One level of parentheses belongs to the paint, as in `hsl(…)`.
  let nested = 0;
  for (let at = start + scheme.length; at < tail.length; at += 1) {
    const character = tail[at];
    if (character === "(") nested += 1;
    else if (character === ")") {
      if (nested === 0) return "closed";
      nested -= 1;
    } else if (/\s/.test(character)) return "not";
    if (at - start > INK_WITHHELD_VALUE_LIMIT + scheme.length) return "not";
  }
  return "open";
}

/**
 * Where an unfinished living ink link starts in a streaming tail, or -1.
 *
 * `[words](ink:hold)` is plain text until its closing parenthesis arrives:
 * the bracket, then the words, then the notation would each show for a
 * moment before the parse paints them. Holding the link back until it closes
 * keeps the notation off the page and lets its words arrive as the passage
 * they are, so a hold can wait at their edge. Only a link that can still
 * become ink is held; any other bracket shows as it comes.
 */
export function openInkLinkStart(tail: string): number {
  for (let at = 0; at < tail.length; at += 1) {
    const character = tail[at];
    if (character === "\\") {
      at += 1;
    } else if (character === "`") {
      // Inside a closed code span a bracket is code, never a link.
      let run = 1;
      while (tail[at + run] === "`") run += 1;
      const end = tail.indexOf("`".repeat(run), at + run);
      if (end !== -1) at = end + run - 1;
      else at += run - 1;
    } else if (
      character === "[" &&
      tail[at - 1] !== "!" &&
      inkLinkState(tail, at) === "open"
    ) {
      return at;
    }
  }
  return -1;
}

/** The part of a streaming tail that may show now. */
export function streamingTailShown(tail: string): string {
  const start = openInkLinkStart(tail);
  return start < 0 ? tail : tail.slice(0, start);
}

/** Compatibility predicate used by geometry-focused tests and callers. */
export function progressiveMarkdownTailIsStructurallyStable(
  trailing: string,
): boolean {
  return progressiveMarkdownTailMode(trailing) === "markdown";
}

/**
 * Splits an in-flight response at stable Markdown block boundaries. The
 * production renderer uses `advanceProgressiveMarkdownSnapshot` directly;
 * this convenience shape remains useful for focused tests.
 */
export function splitProgressiveMarkdown(
  content: string,
): ProgressiveMarkdownSegments {
  const { blocks, trailing } = splitProgressiveMarkdownBlocks(content);
  return { complete: blocks.map((block) => block.content).join(""), trailing };
}

/** Returns independently frozen blocks for one complete input snapshot. */
export function splitProgressiveMarkdownBlocks(
  content: string,
): ProgressiveMarkdownBlocks {
  const snapshot = advanceProgressiveMarkdownSnapshot(null, content);
  if (
    snapshot.trailing &&
    hasClosedTerminalFence(snapshot.trailing) &&
    snapshot.trailingStart < content.length
  ) {
    return {
      blocks: [
        ...snapshot.blocks,
        {
          content: snapshot.trailing,
          start: snapshot.trailingStart,
        },
      ],
      trailing: "",
    };
  }
  return { blocks: snapshot.blocks, trailing: snapshot.trailing };
}
