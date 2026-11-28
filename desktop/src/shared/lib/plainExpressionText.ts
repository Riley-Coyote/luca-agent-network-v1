import { EXPRESSION_SCHEMES, expressionValue } from "./remarkExpressionColors";

/*
 * Link syntax is found by one linear pass, not by the Markdown parser: on a
 * hostile message (200,000 brackets and parentheses) that parser takes 15 to
 * 30 seconds, and these readings run on every row of a list. What counts as a
 * coloured phrase is still decided by `expressionValue`, the renderer's own
 * definition, and the pass follows the renderer's reading where it matters:
 * code stays code, an escaped bracket is a bracket, images are not links, and
 * links do not nest.
 */

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const BREAK = /[\s\p{Cc}]/u;

/** For each `(`, the `)` that closes it within one unbroken address, or -1. */
function closingParentheses(text: string): Int32Array {
  const close = new Int32Array(text.length).fill(-1);
  const open: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\" && PUNCTUATION.test(text[index + 1] ?? "")) index++;
    else if (BREAK.test(char)) open.length = 0;
    else if (char === "(") open.push(index);
    else if (char === ")") {
      const at = open.pop();
      if (at !== undefined) close[at] = index;
    }
  }
  return close;
}

/** For the first backtick of each run: just past the run that closes it,
 * or -1; for other positions, just past their own run. */
function codeSpans(text: string): Int32Array {
  const end = new Int32Array(text.length).fill(-1);
  const runs: [number, number][] = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "`") continue;
    let to = index;
    while (text[to] === "`") to++;
    runs.push([index, to]);
    index = to - 1;
  }
  const later = new Map<number, number>();
  for (let run = runs.length - 1; run >= 0; run--) {
    const [from, to] = runs[run];
    const size = to - from;
    end[from] = later.get(size) ?? -1;
    later.set(size, to);
    for (let index = from + 1; index < to; index++) end[index] = to;
  }
  return end;
}

/** Every finished coloured phrase reduced to its words, in one pass. */
function reduceLinks(text: string): string {
  const close = closingParentheses(text);
  const code = codeSpans(text);
  const openers: { at: number; image: boolean }[] = [];
  let out = "";
  let cursor = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\" && PUNCTUATION.test(text[index + 1] ?? "")) {
      index++;
    } else if (char === "`") {
      // A closed run is code, skipped to its end; an unclosed run is
      // literal backticks.
      const past = code[index];
      if (past > 0) index = past - 1;
      else while (text[index + 1] === "`") index++;
    } else if (char === "[") {
      openers.push({ at: index, image: text[index - 1] === "!" });
    } else if (char === "]") {
      const opener = openers.pop();
      const end = text[index + 1] === "(" ? close[index + 1] : -1;
      if (!opener || end < 0) continue;
      if (!opener.image) {
        // A link ends every bracket opened before it: links don't nest.
        openers.length = 0;
        if (expressionValue(text.slice(index + 2, end)) !== undefined) {
          out +=
            text.slice(cursor, opener.at) + text.slice(opener.at + 1, index);
          cursor = end + 1;
        }
      }
      index = end;
    }
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}

const ELLIPSES = ["…", "..."];

/** The `[` that opens the words ending just before `close`, or -1. */
function openingBracket(text: string, close: number): number {
  let depth = 0;
  for (let index = close - 1; index >= 0; index--) {
    const char = text[index];
    if (char !== "[" && char !== "]") continue;
    if (text[index - 1] === "\\") continue;
    if (char === "]") depth++;
    else if (depth === 0) return index;
    else depth--;
  }
  return -1;
}

/**
 * A coloured phrase cut off at the end, as text shortened in the past leaves
 * it: `…[Good to see](ink:war` reads `…Good to see`. Only a tail whose address
 * has clearly begun (the whole scheme is there) is reduced; anything less
 * certain is left as it is. Finished phrases are left for a renderer to draw.
 */
export function plainExpressionTail(text: string): string {
  const close = text.lastIndexOf("](");
  if (close < 0) return text;
  let address = text.slice(close + 2);
  let suffix = "";
  for (const ellipsis of ELLIPSES)
    if (address.endsWith(ellipsis)) {
      suffix = ellipsis;
      address = address.slice(0, -ellipsis.length);
      break;
    }
  if (!EXPRESSION_SCHEMES.some((scheme) => address.startsWith(scheme)))
    return text;
  if (/[\s()`]/.test(address)) return text;
  const open = openingBracket(text, close);
  if (open < 0) return text;
  return text.slice(0, open) + text.slice(open + 1, close) + suffix;
}

/**
 * A message's words as plain text, with each coloured phrase reduced to its
 * words: `[Good to see you.](ink:warmth?hush)` reads `Good to see you.`. For
 * every place that shows a message without the renderer, or hands it to a
 * person (a notification, the clipboard). Reduce before shortening, so a cut
 * never lands inside the code. Nothing else changes: bold, headings, code,
 * ordinary links and mentions stay exactly as written.
 */
export function plainExpressionText(text: string): string {
  // Every inline link has "](" in it, so text without one has no phrase.
  if (!text.includes("](")) return text;
  return plainExpressionTail(reduceLinks(text));
}
