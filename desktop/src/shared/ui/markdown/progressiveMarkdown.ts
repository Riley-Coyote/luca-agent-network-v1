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
  _container: "list" | "quote" | null;
  _containerBlank: boolean;
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
    _container: null,
    _containerBlank: false,
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
  let container = base._container;
  let containerBlank = base._containerBlank;
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
    const listLine = /^ {0,3}(?:[-+*]|\d+[.)])\s+/.test(line);
    const quoteLine = /^ {0,3}>/.test(line);
    const blank = line.trim().length === 0;
    // A blank line can belong to a loose list or a multi-paragraph quote.
    // Wait for the following complete line before declaring that block done.
    if (container && containerBlank && !blank && !openFence) {
      const continues =
        container === "quote" ? quoteLine : listLine || /^(?: +|\t)/.test(line);
      if (!continues) {
        container = null;
        freezeThrough(lineStart);
      }
      containerBlank = false;
    }
    if (!container && !openFence) {
      if (listLine) container = "list";
      else if (quoteLine) container = "quote";
    }
    if (openFence) {
      if (closesFence(line, openFence)) {
        openFence = null;
        if (!container) freezeThrough(cursor + 1);
      }
    } else {
      const openingFence = openingFenceForLine(line);
      if (openingFence) {
        openFence = openingFence;
      } else if (blank) {
        if (container) containerBlank = true;
        else freezeThrough(cursor + 1);
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
    _container: container,
    _containerBlank: containerBlank,
    _scanOffset: content.length,
  };
}

function hasClosedTerminalFence(content: string): boolean {
  const lines = content.split("\n");
  const opening = openingFenceForLine(lines[0] ?? "");
  if (!opening || lines.length < 2) return false;
  return lines.slice(1).some((line) => closesFence(line, opening));
}

/** A line that starts a block of its own: the parser, not a literal, draws it. */
const BLOCK_START_LINE =
  /^ {0,3}(?:#{1,6}\s+\S|>\s*\S|(?:[-+*]|\d+[.)])\s+\S|(?:[*_-][\t ]*){3,}$)/;

/**
 * Whether a later line of the tail, outside any code, needs the parser: a
 * closed fence, or a heading, quote, list item or rule that interrupts the
 * paragraph above it. The first line is judged by the caller.
 */
function hasLaterBlockStructure(content: string): boolean {
  const lines = content.split("\n");
  let fence: Fence | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (fence) {
      if (closesFence(line, fence)) return true;
      continue;
    }
    fence = openingFenceForLine(line);
    if (!fence && index > 0 && BLOCK_START_LINE.test(line)) return true;
  }
  return false;
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
  if (hasLaterBlockStructure(trailing)) return "markdown";

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

/**
 * How long each unfinished construct may wait, in characters from its opener.
 * Past it, the construct shows as written, as it always did.
 */
export const STREAMING_HOLD_LIMITS = Object.freeze({
  emphasis: 200,
  code: 200,
  pictureWords: 200,
  linkAddress: 512,
  tableRow: 300,
});

const WHITESPACE = /\s/;
const PUNCTUATION = /[\p{P}\p{S}]/u;
type Flank = "space" | "punct" | "other";

function flankOf(character: string | undefined): Flank {
  if (character === undefined || WHITESPACE.test(character)) return "space";
  return PUNCTUATION.test(character) ? "punct" : "other";
}

/** The run of `character` starting at `at`. */
function runLength(tail: string, at: number, character: string): number {
  let length = 0;
  while (tail[at + length] === character) length += 1;
  return length;
}

type LinkState = Readonly<{ state: "open" | "closed" | "not"; end: number }>;

/**
 * An ordinary link or picture at `open` (its `[`): words up to `]`, then an
 * address and an optional title up to `)`. Open while it may still become
 * one, within its limits; `not` the moment it cannot.
 */
function plainLinkState(
  tail: string,
  open: number,
  wordsLimit: number,
  from: number,
): LinkState {
  let close = open + 1;
  let depth = 0;
  for (; close < tail.length; close += 1) {
    // Past the words limit without its `]`, it shows as written.
    if (close - from >= wordsLimit) return { state: "not", end: 0 };
    const character = tail[close];
    if (character === "\\") close += 1;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  if (close >= tail.length) {
    return { state: tail.length - from <= wordsLimit ? "open" : "not", end: 0 };
  }
  if (close === tail.length - 1) return { state: "open", end: 0 };
  if (tail[close + 1] !== "(") return { state: "not", end: 0 };
  const start = close + 2;
  let nested = 0;
  let title: string | null = null;
  let afterSpace = false;
  for (let at = start; at < tail.length; at += 1) {
    if (at - start >= STREAMING_HOLD_LIMITS.linkAddress) {
      return { state: "not", end: 0 };
    }
    const character = tail[at] ?? "";
    if (character === "\n") return { state: "not", end: 0 };
    if (title !== null) {
      if (character === "\\") at += 1;
      else if (character === title) title = "";
      else if (title === "" && character === ")") {
        return { state: "closed", end: at + 1 };
      } else if (title === "" && !WHITESPACE.test(character)) {
        return { state: "not", end: 0 };
      }
      continue;
    }
    if (afterSpace) {
      if (WHITESPACE.test(character)) continue;
      if (character === ")") return { state: "closed", end: at + 1 };
      if (character === '"' || character === "'") title = character;
      else if (character === "(") title = ")";
      else return { state: "not", end: 0 };
      continue;
    }
    if (character === "\\") at += 1;
    else if (WHITESPACE.test(character)) afterSpace = true;
    else if (character === "(") nested += 1;
    else if (character === ")") {
      if (nested === 0) return { state: "closed", end: at + 1 };
      nested -= 1;
    }
  }
  return { state: "open", end: 0 };
}

/** The end of the closed living ink link at `open`, its `)` included. */
function closedInkLinkEnd(tail: string, open: number): number {
  let close = tail.indexOf("](", open);
  let nested = 0;
  for (close += 2; close < tail.length; close += 1) {
    if (tail[close] === "(") nested += 1;
    else if (tail[close] === ")") {
      if (nested === 0) return close + 1;
      nested -= 1;
    }
  }
  return tail.length;
}

type HeldOpener = { character: string; position: number; length: number };

/**
 * Where the first construct still open in one paragraph starts, or -1. The
 * paragraph runs from `from` to the end of the tail. Delimiters pair as the
 * parser pairs them (CommonMark's flanking rules, nearest opener first); a run
 * that touches the end of the tail is not decided yet, so it may only open.
 * The first open code span or link ends the scan: until it closes, nothing
 * after it can be known to close anything before it.
 */
function openInlineStart(
  tail: string,
  from: number,
  tableRow: boolean,
): number {
  const openers: HeldOpener[] = [];
  let spoiler = -1;
  let barrier = -1;
  for (let at = from; at < tail.length; at += 1) {
    const character = tail[at] ?? "";
    if (character === "\\") {
      at += 1;
      continue;
    }
    if (character === "`") {
      const length = runLength(tail, at, "`");
      let close = tail.indexOf("`".repeat(length), at + length);
      while (close !== -1 && tail[close + length] === "`") {
        close = tail.indexOf(
          "`".repeat(length),
          close + runLength(tail, close, "`"),
        );
      }
      if (close === -1 || close + length >= tail.length) {
        if (tail.length - at <= STREAMING_HOLD_LIMITS.code) barrier = at;
        else barrier = tail.length;
        break;
      }
      at = close + length - 1;
      continue;
    }
    // A `!` at the very end may still open a picture: shown now, it would
    // be taken back into one a moment later.
    if (character === "!" && at === tail.length - 1) {
      barrier = at;
      break;
    }
    const picture = character === "!" && tail[at + 1] === "[";
    if (character === "[" || picture) {
      const open = picture ? at + 1 : at;
      if (!picture) {
        const ink = inkLinkState(tail, open);
        if (ink === "open") {
          barrier = at;
          break;
        }
        if (ink === "closed") {
          at = closedInkLinkEnd(tail, open) - 1;
          continue;
        }
      }
      const link = plainLinkState(
        tail,
        open,
        picture ? STREAMING_HOLD_LIMITS.pictureWords : INK_WITHHELD_TEXT_LIMIT,
        at,
      );
      if (link.state === "open") {
        barrier = at;
        break;
      }
      if (link.state === "closed") at = link.end - 1;
      // A picture's bracket is never a coloured phrase.
      else if (picture) at += 1;
      continue;
    }
    if (character === "|") {
      const length = runLength(tail, at, "|");
      if (!tableRow) {
        for (let pair = 0; pair + 1 < length; pair += 2) {
          spoiler = spoiler === -1 ? at + pair : -1;
        }
        // A last odd pipe at the end may still become a delimiter.
        if (length % 2 === 1 && at + length >= tail.length && spoiler === -1) {
          spoiler = at + length - 1;
        }
      }
      at += length - 1;
      continue;
    }
    if (character !== "*" && character !== "_" && character !== "~") continue;
    const length = runLength(tail, at, character);
    const atEnd = at + length >= tail.length;
    const before = flankOf(tail[at - 1]);
    const after = atEnd ? "other" : flankOf(tail[at + length]);
    const left = after !== "space" && (after !== "punct" || before !== "other");
    // The shape it would have if the next character were a letter; a run
    // that touches the end has no next character yet, so it cannot close.
    const rightShape =
      before !== "space" && (before !== "punct" || after !== "other");
    const right = !atEnd && rightShape;
    let canOpen = left;
    let canClose = right;
    if (character === "_") {
      // Inside a word an underscore never opens, whatever follows it.
      canOpen = left && (!rightShape || before === "punct");
      canClose = right && (!left || after === "punct");
    }
    // Strike-through is a pair of tildes; one may still become two.
    if (character === "~" && length !== 2 && !(atEnd && length === 1)) {
      at += length - 1;
      continue;
    }
    let remaining = length;
    if (canClose) {
      for (let index = openers.length - 1; index >= 0 && remaining > 0; ) {
        const opener = openers[index];
        if (!opener || opener.character !== character) {
          index -= 1;
          continue;
        }
        const use =
          character === "~" ? 2 : opener.length >= 2 && remaining >= 2 ? 2 : 1;
        opener.length -= use;
        remaining -= use;
        openers.length = opener.length > 0 ? index + 1 : index;
        index = openers.length - 1;
      }
    }
    if (remaining > 0 && canOpen) {
      openers.push({ character, position: at, length: remaining });
    }
    at += length - 1;
  }
  let first = barrier === tail.length ? -1 : barrier;
  const consider = (position: number) => {
    if (tail.length - position > STREAMING_HOLD_LIMITS.emphasis) return;
    if (first === -1 || position < first) first = position;
  };
  for (const opener of openers) consider(opener.position);
  if (spoiler !== -1) consider(spoiler);
  return first;
}

/** A fence line however it is indented, as a list item may indent it. */
function streamingFenceForLine(line: string): Fence | null {
  const match = line.match(/^\s*(`{3,}|~{3,})/);
  const marker = match?.[1];
  if (!marker) return null;
  const fence = {
    character: marker[0] as Fence["character"],
    length: marker.length,
  };
  // A backtick fence's info string never holds a backtick.
  if (
    fence.character === "`" &&
    line.slice(line.indexOf(marker) + marker.length).includes("`")
  ) {
    return null;
  }
  return fence;
}

function closesStreamingFence(line: string, fence: Fence): boolean {
  const match = line.match(/^\s*(`{3,}|~{3,})[\t ]*$/);
  const marker = match?.[1];
  return marker?.[0] === fence.character && marker.length >= fence.length;
}

/** Inside an open code block, a last line that may still be its close. */
const MAY_CLOSE_FENCE = /^[\t ]*[`~]*[\t ]*$/;
/** A line that so far is only the marker of a list, quote, heading or rule. */
const MARKER_ONLY_LINE =
  /^ {0,3}(?:#{1,6}|>|[-+*]|\d{1,9}[.)]?|(?:[-*_][\t ]*){2,})[\t ]*$/;
/** A line that starts a paragraph of its own, ending the one above it. */
const STARTS_PARAGRAPH = /^ {0,3}(?:[-+*][\t ]|\d{1,9}[.)][\t ]|>|#{1,6}[\t ])/;
const HEADING_LINE = /^ {0,3}#{1,6}(?:[\t ]|$)/;
const TABLE_ROW = /^ {0,3}\|/;
const MAY_BE_TABLE_DELIMITER = /^[\t |:-]*$/;

/**
 * Where a streaming tail stops showing: its length, or the start of the first
 * construct still unfinished. Only the last paragraph can hold one; every
 * paragraph before it has ended, and whatever it left open is final.
 */
function streamingTailCut(tail: string): number {
  let fence: Fence | null = null;
  let paragraphStart = 0;
  let paragraphEnded = false;
  let previousRow = false;
  let headerStart = -1;
  let lineStart = 0;
  for (;;) {
    const newline = tail.indexOf("\n", lineStart);
    const complete = newline !== -1;
    const line = tail.slice(lineStart, complete ? newline : tail.length);
    if (fence) {
      if (!complete)
        return MAY_CLOSE_FENCE.test(line) ? lineStart : tail.length;
      if (closesStreamingFence(line, fence)) {
        fence = null;
        paragraphEnded = true;
      }
      lineStart = newline + 1;
      continue;
    }
    const opening = streamingFenceForLine(line);
    if (opening) {
      if (!complete) return lineStart;
      fence = opening;
      previousRow = false;
      headerStart = -1;
      lineStart = newline + 1;
      continue;
    }
    const row = TABLE_ROW.test(line);
    if (!complete) {
      if (row && !previousRow) {
        return tail.length - lineStart <= STREAMING_HOLD_LIMITS.tableRow
          ? lineStart
          : tail.length;
      }
      if (
        headerStart !== -1 &&
        MAY_BE_TABLE_DELIMITER.test(line) &&
        tail.length - headerStart <= STREAMING_HOLD_LIMITS.tableRow
      ) {
        return headerStart;
      }
      if (MARKER_ONLY_LINE.test(line)) return lineStart;
      const from =
        paragraphEnded || row || previousRow || STARTS_PARAGRAPH.test(line)
          ? lineStart
          : paragraphStart;
      const open = openInlineStart(tail, from, row);
      return open === -1 ? tail.length : open;
    }
    if (line.trim().length === 0) {
      paragraphEnded = true;
    } else {
      if (paragraphEnded || row || previousRow || STARTS_PARAGRAPH.test(line)) {
        paragraphStart = lineStart;
      }
      paragraphEnded = HEADING_LINE.test(line) || row;
    }
    // A first row waits through the next line; once that line is complete it
    // has shown whether the pair is a table, and the parser draws either.
    headerStart = row && !previousRow ? lineStart : -1;
    previousRow = row;
    lineStart = newline + 1;
  }
}

/**
 * The part of a streaming tail that may show now. While a reply is written,
 * whatever is not yet in its final form waits: emphasis, strike-through,
 * spoilers, inline code, links, pictures, a table's first row and a code
 * fence's opening line, each within its limit. The result is always the tail
 * cut at one point, and only ever grows as the tail does.
 */
export function streamingTailShown(tail: string): string {
  return tail.slice(0, streamingTailCut(tail));
}

export type StreamingOpenCodeBlock = Readonly<{
  /** Where the fence line starts in the shown tail. */
  start: number;
  language: string;
  /** The lines written so far, each complete or still being written. */
  lines: readonly string[];
}>;

/**
 * A code block still open at the end of the shown tail, at the top level,
 * with its opening line complete: it is drawn in the finished block's frame
 * from then on. Inside a list or quote the parser keeps drawing it.
 */
export function streamingOpenCodeBlock(
  shown: string,
): StreamingOpenCodeBlock | null {
  let fence: Fence | null = null;
  let start = -1;
  let codeStart = -1;
  let lineStart = 0;
  for (;;) {
    const newline = shown.indexOf("\n", lineStart);
    if (newline === -1) break;
    const line = shown.slice(lineStart, newline);
    if (fence) {
      if (closesFence(line, fence)) fence = null;
    } else {
      fence = openingFenceForLine(line);
      if (fence) {
        start = lineStart;
        codeStart = newline + 1;
      } else if (/^ {0,3}(?:[-+*]|\d+[.)])\s|^ {0,3}>/.test(line)) {
        return null;
      }
    }
    lineStart = newline + 1;
  }
  if (!fence) return null;
  const opening = shown.slice(start, codeStart - 1).trim();
  const info = opening.slice(fence.length).trim();
  const code = shown.slice(codeStart).replace(/\n$/, "");
  return {
    start,
    language: info.split(/\s+/, 1)[0] ?? "",
    lines: code.split("\n"),
  };
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
